# Security

This is a free product whose users are club scorers, and whose data includes the
names of amateur players — some of them children. That shapes the posture: collect as
little as possible, publish only what the user chose to publish, and make sure the
person holding the phone is the only one who can score with it.

## What is actually at risk

| Asset                      | Why someone would want it                                     | Worst case                                   |
| -------------------------- | ------------------------------------------------------------- | -------------------------------------------- |
| The delivery log           | It is the only non-derivable data in the system               | A match's history is lost or falsified        |
| A scorer's session         | Write access to their matches and tournaments                 | Someone else scores your final                |
| Player names               | Personal data about identifiable people, some of them minors  | Names exposed beyond the intended audience    |
| `SECRET_KEY`               | Forges access tokens and toss receipts                        | Full impersonation of any user                |
| The database credentials   | Everything                                                    | Everything                                    |

Note what is **not** on the list: there are no payments, no messages, and no
uploaded files. That absence is a security decision, not an oversight.

## Threats and the answer to each

### Someone tries to score a match that is not theirs

Every match has an owner and an explicit collaborator list with roles
(`owner`, `scorer`, `viewer`). Authorisation is checked in the service layer against
the match row, not inferred from a URL, and a viewer's write is refused with
`forbidden` rather than silently ignored. Reads of a *private* match are refused the
same way; the public scorecard is a separate, deliberately unauthenticated route that
serves only what a spectator should see.

### Someone steals a token

- **Access tokens** are JWTs with a 15-minute life, held in memory by the browser and
  never written to storage. A stolen one expires before it is much use.
- **Refresh tokens** are opaque random strings — not JWTs — stored only as a hash
  (`SHA-256`) in the database. The database cannot leak usable tokens.
- **Rotation with reuse detection**: every refresh mints a new token and revokes the
  old one. Presenting an already-rotated token means it leaked, so the entire token
  *family* is revoked and the user must sign in again. The event is written to the
  audit log.
- **Session inventory**: every device appears on the account page with its user agent,
  address and creation time, and can be revoked individually. Changing a password
  revokes every other session.
- A maximum of 10 concurrent sessions per account keeps that list meaningful.

### Someone guesses a password

- Argon2id, 64 MiB / 3 iterations / 2 lanes by default (OWASP's floor), with automatic
  rehashing on login when the cost parameters change.
- A minimum length of 10 characters, plus rejection of the obvious: the user's own
  email, common passwords, and single-character repetition.
- Progressive lockout: 8 failed attempts locks the account for 15 minutes. This sits
  *behind* the per-address rate limiter, so a distributed attempt still hits a wall.
- Login answers identically for a wrong email and a wrong password, and runs a hash
  verification either way so the timing does not reveal which accounts exist.

### Someone floods the API

Rate limits are per identity — the user id when signed in, the client address when not:

| Bucket        | Default            | Why                                             |
| ------------- | ------------------ | ----------------------------------------------- |
| Anonymous     | 120 / minute       | Enough for a spectator refreshing a scorecard    |
| Authenticated | 600 / minute       | A busy console with a live stream open           |
| Auth routes   | 20 / 15 minutes    | Login, register, refresh. Deliberately tight     |
| Writes        | 300 / minute       | A fast scorer peaks near 40                      |

Responses carry `RateLimit-Limit`, `RateLimit-Remaining`, `RateLimit-Reset` and
`Retry-After`, so a client can behave properly instead of hammering. Counters live in
Redis so the limit is shared across instances; with no Redis they fall back to
in-process counters, which is weaker and reported as `degraded` by the readiness probe.

Request bodies are capped at 1 MiB and rejected **before** being buffered into memory.

### Someone tries to inject or traverse

- Every query is SQLAlchemy Core/ORM with bound parameters. There is no string-built
  SQL anywhere in the codebase.
- Input is validated by Pydantic models at the boundary, with explicit bounds on
  everything numeric (runs, overs, players per side) — the scoring engine never sees an
  unbounded integer.
- Identifiers are UUIDs; public links use unguessable slugs rather than sequential ids,
  so a scorecard cannot be found by counting.
- No file uploads, no template rendering, no shell invocation, no deserialisation of
  anything but JSON.

### Someone attacks the browser

The API returns JSON only, so it ships a maximally strict policy:
`default-src 'none'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`,
plus `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy: no-referrer`,
`Cross-Origin-Opener-Policy` and `Cross-Origin-Resource-Policy`. HSTS is added in
production. The interactive docs get a narrowly relaxed policy, and only they.

The web app is served by nginx with its own header set, repeated in every location
because nginx's `add_header` replaces rather than extends the inherited set. The one
deliberate exception is the broadcast overlay, which opts out of `SAMEORIGIN` because
streaming software frames it — and which carries no session and no controls, so there
is nothing to click-jack.

CORS lists exact origins. `*` is **refused at start-up** in staging and production,
because credentials are allowed on cross-origin requests and the combination is
meaningless.

### Someone poisons a link

Every share link is built from `PUBLIC_WEB_URL`, never from the request's `Host`
header, and `ALLOWED_HOSTS` must be explicit in production (start-up fails on `*`).
A `X-Request-Id` supplied by a client is only echoed back if it is short and
alphanumeric, so nothing unvetted reaches the logs or a response header.

### Someone re-rolls the toss

The coin flip and the wheel spin are decided on the server with `secrets`, and each
result comes back with an HMAC receipt over the outcome and the timestamp, keyed by
`SECRET_KEY`. Two captains who do not trust each other's phone can both verify that
the result they were shown is the one that was generated.

### Someone falsifies a score

The delivery log is append-only in normal operation. An edit or deletion writes a
`delivery_revisions` row holding the previous and new state, the reason and the actor,
and every privileged action is written to `audit_logs` with the actor, entity, address
and user agent. A match's history can be reconstructed, including its corrections.

## Data protection

- **Collected**: email, display name, password hash, timezone, sign-in times, session
  metadata (user agent, address). Nothing else about a user.
- **Third-party personal data**: player names, because a scorecard without names is
  useless. There is no field for anything else about a player, deliberately.
- **Not collected**: no advertising or analytics scripts on any page, no third-party
  trackers, no data sharing.
- **Deletion**: deleting an account removes its matches, teams and sessions. Backups
  age out on the platform's 30-day schedule.
- **Logs** redact secrets by key name (`password`, `token`, `authorization`,
  `secret`, …) in the structlog processor chain, so a bug report cannot carry a
  credential into the aggregator.

The user-facing statement of this lives on `/privacy` in the app, and the two must be
changed together.

## Secrets

- Nothing secret is ever committed. `.env` is git-ignored and only `.env.example` is
  tracked.
- `SECRET_KEY` must be 48 random bytes from a secret manager; start-up refuses to run
  in production with a placeholder or anything under 32 characters.
- Rotating `SECRET_KEY` invalidates every access token (users refresh transparently)
  and every previously issued toss receipt. Refresh tokens are unaffected, because
  they are opaque and hashed rather than signed.
- `VITE_*` values are compiled into the browser bundle. Nothing secret may ever be
  one.

## Supply chain

- CI runs `pip-audit` against the backend requirements and `npm audit` against the
  frontend on every pull request. An advisory that reaches the browser fails the
  build; a build-time-only advisory is reported as a warning.
- `npm ci` from a committed lockfile; the audit job installs with `--ignore-scripts`.
- Container images are multi-stage: the runtime layer has no compiler, no package
  index credentials and no shell for the app user. The API runs as UID 10001, the web
  image is nginx-unprivileged.
- The PWA icons are generated by a script using only Node's standard library, rather
  than pulling in an image-processing dependency to draw a circle.

## Verifying it yourself

```bash
# Headers on a live instance
curl -sI https://api.example.com/api/v1/health | grep -iE 'content-security|x-frame|strict-transport|referrer'

# Rate limiting responds rather than collapsing
for i in $(seq 1 30); do curl -s -o /dev/null -w '%{http_code} ' \
  -X POST https://api.example.com/api/v1/auth/login \
  -H 'content-type: application/json' -d '{"email":"a@b.co","password":"wrong"}'; done

# A viewer cannot write, and a stranger cannot read
# (both are covered by backend/tests/test_api_flows.py)
pytest -k "stranger or viewer_collaborator"
```

## Pre-deploy checklist

```
[ ] SECRET_KEY from a secret manager, 48+ bytes, never in an image or a log
[ ] ENV=production
[ ] CORS_ORIGINS lists exact origins, no wildcard
[ ] ALLOWED_HOSTS lists exact hostnames, no wildcard
[ ] TLS terminated at the edge; HSTS observed on a real response
[ ] OPENAPI_ENABLED=false if the deployment is private
[ ] ALLOW_REGISTRATION=false if the deployment is invite-only
[ ] /metrics not reachable from the public internet
[ ] Database credentials scoped to the application's own database
[ ] Backups verified by actually restoring one, not by reading a dashboard
```

## Reporting a vulnerability

Email the address on the site's legal pages with the details and a way to reproduce.
Please do not open a public issue first. We will confirm within a few days, and we
will credit you unless you would rather we did not.
