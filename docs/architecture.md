# Architecture

## The one decision everything else follows from

A cricket scorer's app has an obvious design and a correct one. The obvious design
keeps a running total and adds to it: a run arrives, `total += 1`. It is simple, it
is fast, and it is wrong, because the first mis-tap becomes permanent — every figure
downstream was computed from a total nobody can now reconstruct.

Pitchside stores **only the delivery log**. One row per ball, immutable except
through an audited revision. Everything else — the score, the overs, both batters'
cards, the bowlers' figures, maidens, partnerships, the fall of wickets, the required
rate, the result, the tournament table — is produced by replaying that log through a
pure function.

The cost is that a scorecard is a computation rather than a lookup. That cost is
tiny: an innings is at most a few hundred deliveries, and a replay is a single pass
of arithmetic — well under a millisecond. What it buys is that **a correction is
just a different input**. Change the ninth over's leg-bye to a wide and the over
count shifts, the strike rotation for every subsequent ball is recalculated, the
bowler's economy moves, the partnership figures move, the result changes if it needs
to, and no code had to know that any of that was connected.

## The shape of the system

```
   phone / laptop                        server                       managed
┌────────────────────┐        ┌──────────────────────────┐     ┌──────────────────┐
│ React app          │  HTTP  │ FastAPI                  │     │ Neon Postgres    │
│  ├ TS engine       │◄──────►│  ├ routers (thin)        │────►│  delivery log    │
│  ├ Dexie queue     │        │  ├ services (rules)      │     │  + everything    │
│  └ service worker  │  SSE   │  ├ scoring engine (pure) │     └──────────────────┘
└────────────────────┘◄───────│  └ broker ───────────────┼────►┌──────────────────┐
                              └──────────────────────────┘     │ Upstash Redis    │
                                                               │ pub/sub + cache  │
                                                               └──────────────────┘
```

Layering is strict and one-directional:

| Layer      | Knows about                | Must never                              |
| ---------- | -------------------------- | --------------------------------------- |
| `api/`     | HTTP, auth, serialisation  | contain a cricket rule                  |
| `services/`| the database, the engine   | build a response body                   |
| `scoring/` | nothing but its own types  | touch I/O, the clock or the database     |
| `models/`  | tables and relationships   | contain behaviour beyond column defaults|

The engine's purity is not aesthetic. It is what lets the same logic run in the
browser (for offline scoring and instant validation) and be tested by replaying
fixtures with no database in sight.

## The path of one ball

1. **The pad** composes a delivery: striker, non-striker, bowler, runs, extra type,
   boundary flag, wicket details.
2. **The browser engine** validates it against the current innings state. An
   impossible ball — bowled off a free hit, a bowler bowling consecutive overs, a
   batter who is already out — is refused in place, with the same machine-readable
   code the server would have returned.
3. **The write** goes out with a `client_event_id` (a UUID minted on the device) and
   an `expected_state_version`.
4. **The server** takes a row lock on the match (`SELECT … FOR UPDATE`), which is what
   serialises two scorers on the same match rather than interleaving them. If the
   expected version does not match, it answers `version_conflict` and the client
   refetches instead of overwriting.
5. **The delivery is appended.** The engine replays the innings, the derived
   projections are written to their (disposable) summary tables, and the match's
   `state_version` is bumped.
6. **The broker publishes** a small compact frame on a Redis channel for the match.
   Every API instance holding an SSE connection for that match forwards it.
7. **Viewers** receive the frame within about a second. Their `state_version` must be
   exactly one more than the last; a gap means a frame was lost and the client
   refetches the whole scorecard rather than rendering a score that drifted.

If step 3 fails for any network reason, the ball goes to IndexedDB instead and step 2's
result is what the scorer sees. The queue drains in order when the connection
returns, and a replayed `client_event_id` is recognised by the server as a duplicate
rather than recorded twice.

## Profiles and media

Club and player profiles carry branding fields (logo, cover, jersey colours, bio)
and a public slug. Images upload via ``POST /api/v1/media/upload-url`` — either a
Cloudflare R2 signed PUT (``MEDIA_BACKEND=r2``) or a local store under
``MEDIA_LOCAL_DIR`` served at ``/media`` (including single-node production such as
cPanel). Public pages live at ``/club/:slug`` and
``/p/:slug``.

## Career stats

Player career batting/bowling/fielding figures are **never** stored as mutable
aggregate columns. ``career_stats.compute_career_stats`` finds every
``MatchPlayer`` linked to the saved player and aggregates from the delivery log.
Results cache in Redis under ``career:{player_id}`` (≈60s) when available.
Public: ``GET /public/players/{id_or_slug}/stats``, ``…/qr`` (SVG), ``…/awards``.
Awards CRUD (owner/manager): ``/teams/{team_id}/players/{player_id}/awards``.

## Team memberships

``owner_user_id`` remains the canonical club owner; access also honours active
``team_memberships`` (owner, manager, coach, captain, vice_captain, player).
Creating a team inserts an owner membership; migration backfills existing clubs.
Endpoints: invites, token accept, join-requests accept/reject, role patch, remove.

## Compact overlay enrichment

``MatchSnapshot.compact()`` and the public overlay include venue, city, tournament
(id/name/slug/round), toss, and batter/bowler ``photo_url`` from linked ``Player``
rows (batch-loaded in ``build_snapshot`` / squad selectinload).

## Stream sessions and MediaMTX

Authenticated ``/matches/{id}/stream-sessions`` (create, active GET/PATCH,
go-live, end) manages a ``StreamSession`` (idle → preview|live → ended).
RTMP stream keys are Fernet-encrypted at rest and returned only on create/update.
Responses include ``whip_publish_url`` from ``MEDIAMTX_WHIP_BASE_URL``
(MediaMTX path + ``/whip``). Compose runs ``bluenviron/mediamtx`` (ports 8554
RTSP, 1935 RTMP, 8889 WHIP, 8888 HLS). Permissions-Policy allows
``camera=(self), microphone=(self)`` so the broadcast studio can capture.

**Phone WHIP publish** (Go Live → Phone camera QR / ExternalCamera) POSTs an SDP
offer from the browser to ``whip_publish_url``. For real devices,
``MEDIAMTX_WHIP_BASE_URL`` must be a **public HTTPS** origin reachable from
phones (not ``localhost``, and not HTTP-only on modern mobile Safari/Chrome).
Render’s API container alone does not terminate WHIP — run MediaMTX on Docker/VPS
([``infra/mediamtx.yml``](../infra/mediamtx.yml), [``infra/docker-compose.yml``](../infra/docker-compose.yml))
and point the API env at that public WHIP base. If the URL is missing or
unreachable, the camera UI shows a config error (never a blank page).
## Event graphics (SSE-driven)

Overlays and event graphics consume the compact live projection over SSE
(``/stream/matches/{slug}``) plus the public overlay JSON — no second source of
truth for score or photos.

## Slice 8 (later)

Wagon-wheel shot plots, AI commentary assists, and admin tooling are deferred;
they belong on top of the delivery log and media pipeline, not as parallel stores.

## Go Live graphics package

Host **Go Live** (`/app/matches/:id/broadcast`) prefers **Phone camera** (QR /
``camera_url`` → public ``/s/:slug/camera/:token``), which claims the session and
WHIP-publishes to MediaMTX. Optional **OBS overlay** browser-source link remains
for power users; **This device** can also WHIP-publish when the WHIP base URL is
public. QR is served at ``GET /public/matches/{slug}/camera/{token}/qr``. Overlay
skins use ``design=…``. Post-match awards/MVP and runs-per-over series are
derived on read via ``match_awards.compute_match_awards``
(``GET /public/matches/{slug}/awards``).

## Concurrency, honestly

Two scorers on one match is normal — a phone at the boundary and a laptop in the
pavilion. Three mechanisms keep it consistent, and each answers a specific failure:

| Failure                                    | Mechanism                                  |
| ------------------------------------------ | ------------------------------------------ |
| Two balls appended at the same instant     | Row lock on the match for the whole write  |
| A scorer's screen is stale before they tap | `expected_state_version` on every write    |
| The same ball arrives twice (a retry)      | Unique `client_event_id` per delivery      |

There is deliberately no last-write-wins anywhere in the scoring path.

## Realtime

Server-sent events, not WebSockets. The traffic is one-directional (writes go over
ordinary HTTP where they get auth, rate limiting and idempotency for free), SSE
survives proxies that mangle upgrades, and browsers reconnect on their own.

- Fan-out is via Redis pub/sub, so any number of API instances stay in step. With no
  Redis configured, the broker degrades to in-process pub/sub: correct for a single
  instance, and honest about it in `/health/ready`.
- Frames are the **compact** projection, a few hundred bytes — this travels over
  mobile data at a ground, and the full scorecard is a separate fetch.
- Connections are recycled on a timer, because letting an unknown proxy decide the
  lifetime of a stream is how you get a scoreboard that silently stopped updating.
- A slow consumer's queue overflows into a `resync` instruction rather than an
  ever-growing buffer.

## Offline

Offline is the default path, not a fallback, because a ground with no signal is the
normal case rather than the exception.

- **Writes** go to a Dexie (IndexedDB) queue: `{matchId, clientEventId, ball, label}`.
  Ordering is preserved, and a new ball joins the back of the queue rather than
  overtaking it even if the network comes back mid-over.
- **Reads** come from a cached snapshot plus a cached copy of the raw delivery log.
  With both, the browser engine can reproduce the entire scorecard locally — which is
  why the log is cached and not just the summary.
- **The service worker** (`frontend/public/sw.js`) is hand-written and caches the app
  shell and hashed assets. It never intercepts writes: an offline POST replayed by a
  worker would be a second, competing source of truth about the score.
- **Rejections** are surfaced, not swallowed. If the server refuses a queued ball
  (say the innings was closed from another device), it appears in a queue panel for
  the scorer to resolve.

## Derived projections

`innings_summaries` and the tournament standings snapshots exist for query speed and
are treated as a cache: they can be dropped and rebuilt from the log at any time, and
`POST /matches/{id}/rebuild` does exactly that. No code reads a summary to compute
another number — everything computes from the log — so a stale summary can never
poison a fresh calculation.

## The cross-language contract

`spec/scoring-fixtures.json` holds replay cases, validation cases and standings
cases. `backend/tests/test_engine_fixtures.py` and
`frontend/src/lib/scoring/engine.test.ts` both consume it. A rule change means
editing one file of fixtures and making two engines agree with it, which is the only
arrangement that keeps an offline projection and a server scorecard identical.
