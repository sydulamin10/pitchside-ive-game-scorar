# Deployment

Two containers and two managed services. The API is stateless, so it scales
horizontally; live updates stay in step because fan-out goes through Redis rather
than through process memory.

For **cPanel + Setup Python App** (static web subdomain + uvicorn API), follow
[cpanel-deploy.md](./cpanel-deploy.md) and the templates in [`deploy/cpanel/`](../deploy/cpanel/).

Recommended when cPanel blocks outbound Postgres/Redis: host the **API on Render**
([render-deploy.md](./render-deploy.md)) and keep only the static web app on cPanel.

```
            ┌────────────┐        ┌──────────────────┐
  browser ──│  web (nginx)│        │ Neon Postgres    │
            └────────────┘        │ (pooled + branch)│
                  │               └──────────────────┘
                  │ /api                   ▲
            ┌────────────┐                 │
            │ api (n≥1)  │─────────────────┘
            └────────────┘─────────► Upstash Redis (TLS)
```

---

## 1. Postgres (Neon)

1. Create a project and a database called `pitchside`.
2. Copy the **pooled** connection string. Keep `?sslmode=require`.
3. Set it as `DATABASE_URL`. Any of `postgres://`, `postgresql://` or
   `postgresql+psycopg://` is accepted and normalised to psycopg3.

Notes that matter for Neon specifically:

- The app runs with **prepared statements disabled** and a small pool, because
  PgBouncer in transaction mode cannot support server-side prepared statements. This
  is already configured; do not "optimise" it back.
- Keep `DB_POOL_SIZE` small (5 is the default). The pooler multiplexes; a large app
  pool just holds pooler slots hostage.
- `DB_STATEMENT_TIMEOUT_MS` (15s) is a ceiling, not a target. A scoring write is
  milliseconds; anything approaching the ceiling is a bug you want to fail on.
- Use a Neon **branch** for staging and for CI if you prefer it to a container. A
  branch is cheap and has production's data shape.

## 2. Redis (Upstash)

1. Create a database in the region closest to the API.
2. Copy the `rediss://` URL (TLS) into `REDIS_URL`.

Redis carries the live-update pub/sub, the short-lived state cache and the rate-limit
counters. **It is optional**: with it unset the app still serves and scores correctly,
but fan-out is per-process (fine for exactly one instance) and rate limiting falls
back to in-memory counters. `/api/v1/health/ready` reports `degraded` rather than
pretending.

## 3. Migrations

Migrations are a **release step**, not something the API does on boot in production.
Run them once per deploy, before the new containers take traffic:

```bash
docker run --rm \
  -e ENV=production \
  -e SECRET_KEY="$SECRET_KEY" \
  -e DATABASE_URL="$DATABASE_URL" \
  ghcr.io/you/pitchside-api:1.2.3 \
  alembic upgrade head
```

Then verify the schema and the models still agree:

```bash
python tools/check_migrations.py    # exits non-zero on drift
```

Every migration must be backwards compatible with the currently running version, so a
rolling deploy is safe and a rollback does not need a down-migration under load. In
practice: add columns nullable, backfill separately, and only drop a column a release
after the code stopped reading it.

## 4. The API container

```bash
docker build -t pitchside-api:1.2.3 ./backend
docker run -p 8000:8000 --env-file backend/.env pitchside-api:1.2.3
```

- One uvicorn worker per container. Scaling is the orchestrator's job; a process
  manager hidden inside the image just makes resource limits lie.
- Runs as UID 10001, no shell, no build tools in the runtime layer.
- `--proxy-headers` is on, so put it behind a load balancer that sets
  `X-Forwarded-For` — the rate limiter and the audit log record the client address.
- Health probes: liveness `GET /healthz`, readiness `GET /api/v1/health/ready`
  (503 when the database is unreachable, so a broken instance leaves rotation).
- Graceful shutdown is 25s, which is long enough for an in-flight scoring
  transaction to finish rather than being killed mid-write.

### Sizing

A container with 0.5 vCPU and 512 MiB handles a few hundred concurrent viewers and
several simultaneous matches; the work per ball is arithmetic, and the memory floor is
Argon2's 64 MiB per concurrent password hash. If you raise `ARGON2_MEMORY_COST_KIB`,
raise the memory limit with it or logins will be OOM-killed under a burst.

SSE connections are cheap but not free: they are held open, so set the platform's
connection limit above `SSE_MAX_CONNECTIONS_PER_MATCH` × expected concurrent matches,
and make sure the load balancer's idle timeout exceeds `SSE_KEEPALIVE_SECONDS`.

## 5. The web container

`VITE_*` values are compile-time, so the API origin is a **build argument**:

```bash
docker build \
  --build-arg VITE_API_BASE_URL=https://api.example.com \
  --build-arg VITE_SUPPORT_EMAIL=hello@example.com \
  -t pitchside-web:1.2.3 ./frontend
```

A container built for one deployment cannot be re-pointed at another by changing an
environment variable. That is deliberate: the alternative is a start-up script that
rewrites the bundle, which breaks Subresource Integrity and hashed-asset caching.

The image is nginx (unprivileged, port 8080) with:

- hashed assets cached for a year and marked immutable,
- `sw.js` never cached, so a deploy is actually picked up,
- an SPA fallback to `index.html`,
- security headers on every location (see the note in `nginx.conf` about why they are
  repeated — nginx's `add_header` replaces the inherited set rather than adding to it).

If you would rather host the bundle on a CDN (Vercel, Netlify, Cloudflare Pages),
`npm run build` and upload `dist/`, but reproduce the three cache rules above and add
the same headers at the edge.

### Same-origin or cross-origin?

Same-origin is better if your platform allows it: put the web app at `/` and the API
at `/api` behind one edge. Then `VITE_API_BASE_URL` stays empty, there are no CORS
preflights on the scoring path, and `AUTH_REFRESH_COOKIE_ENABLED=true` becomes a
sensible option.

Cross-origin works too — set `CORS_ORIGINS` to the exact web origin, and leave the
refresh cookie off so the token travels in the JSON body instead of being dropped as
a third-party cookie.

---

## Environment variables

Every variable is documented in [`backend/.env.example`](../backend/.env.example).
The ones that decide whether a deployment is production-grade:

| Variable                | Production value                        | Why it matters                                                     |
| ----------------------- | --------------------------------------- | ------------------------------------------------------------------ |
| `ENV`                   | `production`                            | Enables the strict validators below and secure cookie attributes    |
| `SECRET_KEY`            | 48+ random bytes, from a secret manager | Signs access tokens and toss receipts; start-up refuses placeholders |
| `DATABASE_URL`          | Neon pooled URL with `sslmode=require`  | —                                                                  |
| `REDIS_URL`             | Upstash `rediss://`                     | Cross-instance live updates and shared rate limits                  |
| `PUBLIC_WEB_URL`        | `https://app.example.com`               | Every share link is built from this; wrong here means wrong links    |
| `CORS_ORIGINS`          | exact origins, never `*`                | Credentials are allowed, so `*` is refused outright                 |
| `ALLOWED_HOSTS`         | explicit hostnames, never `*`           | Stops host-header poisoning of those share links                    |
| `LOG_JSON`              | `true`                                  | Structured logs for the aggregator                                  |
| `OPENAPI_ENABLED`       | `false` for a private deployment        | Hides `/docs` and the schema                                        |
| `ALLOW_REGISTRATION`    | `false` for an invite-only deployment   | Closes the sign-up route                                            |

Start-up **fails loudly** in `production`/`staging` when `SECRET_KEY` is a placeholder
or shorter than 32 characters, when `ALLOWED_HOSTS` is `*`, or when `CORS_ORIGINS`
contains `*`. A misconfigured deployment should not boot quietly.

## Observability

- `GET /metrics` — Prometheus: request counts and latency by route, deliveries
  recorded, live stream subscribers. Scrape it from inside the network, or turn it off
  with `METRICS_ENABLED=false`.
- Logs are JSON with a `request_id` on every line, echoed to the client in the
  `X-Request-Id` header, so a user's report maps to exact log lines.
- `SENTRY_DSN` is read if set.

Four alerts worth having, in order of how much they tell you:

1. `GET /api/v1/health/ready` non-200 for 2 minutes.
2. 5xx rate above 1% of requests over 5 minutes.
3. p95 latency on `POST /matches/{id}/deliveries` above 500 ms — that is the tap a
   scorer is waiting on.
4. Postgres connection saturation above 80% of the pooler's allowance.

## Backups and recovery

Neon's point-in-time restore is the backup. Two things to know:

- The delivery log is the only thing you cannot recompute. Everything else in the
  database is derivable from it, so a restore that recovers `deliveries` recovers the
  product.
- After any restore, run `POST /matches/{id}/rebuild` for matches that were live at the
  restore point to regenerate their projections from the log.

## Release checklist

```
[ ] CI green (lint, types, tests, audit, images)
[ ] alembic upgrade head run against the target database
[ ] tools/check_migrations.py exits 0
[ ] secrets present and not defaults (SECRET_KEY rotated if it ever leaked)
[ ] CORS_ORIGINS and ALLOWED_HOSTS explicit
[ ] readiness green on the new instances before the old ones drain
[ ] a real match scored end-to-end on staging: toss → ball → wicket → correction →
    public link → overlay
```
