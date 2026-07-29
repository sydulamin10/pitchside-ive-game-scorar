# Runbook

Written for whoever is holding the phone when something breaks, which is usually
during a match. Symptom first, because that is all you have at the time.

## Before anything else

```bash
curl -s https://api.example.com/healthz                     # is the process up?
curl -s https://api.example.com/api/v1/health/ready | jq     # is Postgres? is Redis?
```

`ready` tells you which dependency is unhappy:

```json
{ "status": "degraded",
  "checks": { "database": {"ok": true, "latency_ms": 4.2},
              "cache": {"ok": false, "configured": true} },
  "realtime": { "subscribers": 37 } }
```

- `status: error` — the database is unreachable. Scoring is down. Go to **Postgres**.
- `status: degraded` — Redis is unreachable. Scoring still works; live updates only
  fan out within a single instance and rate limits are per-process. Go to **Redis**.

Every response carries `X-Request-Id`. If a scorer sends you a screenshot with an
error, that id maps to the exact log lines.

---

## "The score is not updating for viewers"

Scoring itself is fine — this is the live feed. In order of likelihood:

1. **Redis is down or unset.** `ready` shows `cache.ok: false`. Each API instance is
   then publishing only to its own subscribers, so a viewer connected to instance B
   never hears about a ball written on instance A. Fix Redis, or scale the API to one
   instance as a stopgap.
2. **A proxy is buffering the stream.** Symptom: updates arrive in bursts, or after
   about a minute of nothing. The client is designed to survive this — it falls back
   to polling after three failed SSE attempts — so viewers still get updates every few
   seconds. Fix properly by disabling response buffering for `/api/v1/stream/` at the
   edge (`proxy_buffering off`, `X-Accel-Buffering: no`).
3. **The load balancer's idle timeout is below the keepalive.** Streams are dropped
   every timeout period. Set the idle timeout above `SSE_KEEPALIVE_SECONDS` (15s).

Check the feed directly:

```bash
curl -N -H 'accept: text/event-stream' \
  https://api.example.com/api/v1/stream/matches/<slug>
# expect a frame per ball, plus a keepalive comment every 15s
```

## "A scorer's taps are not being saved"

Ask one question first: **does the app say the balls are queued?** If it does, this is
working as designed — the balls are on the device and will replay when the signal
returns. Nothing is lost, including if they close the tab.

If it does not:

- `429` with `Retry-After` — they are rate limited. 300 writes/minute is far above
  human scoring, so suspect a script or a stuck retry loop rather than the scorer.
- `409 version_conflict` — another device scored first. The app refetches and carries
  on; if it repeats, two people are scoring the same match and one should stop.
- `403 forbidden` — they are a `viewer` on that match, not a `scorer`. The owner can
  change it from the match's collaborator list.
- `422` with a rule code (`wicket_illegal_on_free_hit`, `bowler_cannot_bowl_consecutive_overs`)
  — the engine refused an impossible ball. Read the message; it is written for a scorer.

## "The scorecard numbers look wrong"

This is the one thing that cannot be fixed by restarting something, and also the one
thing that is always recoverable, because every number is derived from the log.

1. Read the log itself, which is the only stored truth:
   ```
   GET /api/v1/matches/{id}/deliveries?limit=2000
   ```
2. Find the ball that is wrong and correct it (`PATCH …/deliveries/{delivery_id}`), or
   have the scorer correct it from the over-by-over view. Everything after it is
   recomputed.
3. If the log is right but a *summary* disagrees with it — a stale projection after an
   incident or a restore — rebuild:
   ```
   POST /api/v1/matches/{id}/rebuild
   ```
   This replays the log and rewrites every derived row. It is safe to run at any time,
   including mid-match, and it is the correct first move after a database restore.
4. If the log is right and a rebuild does not fix it, you have found an engine bug.
   Capture the deliveries as a fixture in `spec/scoring-fixtures.json`, watch both test
   suites fail, then fix the engines. That is the workflow — not a patch to a summary.

## Postgres

```bash
# Is it the database or us?
psql "$DATABASE_URL" -c 'select 1'
```

- **Connection exhaustion** (`too many connections`, or readiness flapping): the app
  pool is deliberately small; check for a stuck migration holding a lock, or for more
  API instances than the pooler's allowance. `DB_POOL_SIZE × instances` must stay under
  it.
- **Statement timeouts** (`canceling statement due to statement timeout`): something is
  scanning. Find it:
  ```sql
  select pid, now() - query_start as age, state, left(query, 120)
  from pg_stat_activity where state <> 'idle' order by age desc limit 10;
  ```
- **A migration wedged mid-deploy**: migrations run in one transaction, so a failure
  leaves no half-applied schema. Check `alembic current`, fix the migration, and run
  `alembic upgrade head` again. Do not hand-edit the schema; the CI drift check exists
  precisely to catch that.

## Redis

Losing Redis costs a cache and a fan-out channel — no durable data lives there.

```bash
redis-cli -u "$REDIS_URL" ping
redis-cli -u "$REDIS_URL" info clients
```

Safe to flush if it is misbehaving: the state cache regenerates from the database, and
rate-limit counters reset (briefly generous, never permissive). Do not flush during a
denial-of-service.

## A deploy went wrong

The API is stateless, so a rollback is a redeploy of the previous image. Two rules:

1. Migrations are backwards compatible by policy, so the previous version runs against
   the new schema. **Do not run a down-migration under load.**
2. Check readiness on the new instances before draining the old ones. A 503 from
   `/health/ready` means the instance never got its database connection and should not
   take traffic.

## Someone reports a hijacked account

1. Revoke everything: `POST /api/v1/auth/logout-all` as that user, or revoke each
   session from the account page.
2. Have them change their password, which revokes every other session anyway.
3. Read the audit trail: `audit_logs` holds the actor, address and user agent for
   privileged actions, and `TOKEN_REUSE_DETECTED` there means a refresh token was
   replayed — the family was auto-revoked at that moment.
4. If `SECRET_KEY` might have leaked, rotate it. Access tokens die immediately, users
   refresh transparently, and previously issued toss receipts stop verifying.

## Restoring from a backup

1. Restore the branch or snapshot in Neon.
2. Point `DATABASE_URL` at it and run `alembic upgrade head` (a restore may predate a
   migration).
3. `python tools/check_migrations.py` to confirm the schema matches the models.
4. `POST /matches/{id}/rebuild` for any match that was live at the restore point.
5. Only the delivery log matters here. If `deliveries` came back intact, the product
   came back intact.

## Escalation

Something is an engine bug — and therefore worth waking someone for — when the
delivery log is correct and a rebuild still produces the wrong figure. Everything
else is configuration, capacity, or a network between a scorer and us, and the offline
queue means none of those lose a ball.
