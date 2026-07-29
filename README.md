# Pitchside

Ball-by-ball live cricket scoring for the cricket that actually gets played — club,
gully, box, turf, tape-ball. One person scores from a phone; everyone else opens a
link and watches the board turn over.

**The rule that governs the whole system: the ball-by-ball delivery log is the only
thing stored.** Totals, strike rates, economy rates, maidens, partnerships, the fall
of wickets, the required rate, the result and the tournament points table are all
_derived_ by replaying that log. Correct a ball from the ninth over and every number
that depended on it fixes itself, including whose strike it was for the rest of the
innings.

---

## What is in the box

| Area           | What it does                                                                                                                   |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Scoring        | Legal balls, wides, no-balls, byes, leg-byes, penalties, 12 dismissal types, free hits, strike rotation, maidens, bowler quotas |
| Corrections    | Edit or delete any ball at any time; the innings, the result and the points table are recomputed                                |
| Offline        | Balls are written to the device first and replayed in order, with duplicate detection by client event id                        |
| Realtime       | Server-sent events over Redis pub/sub, with a polling fallback and version-gap resync                                           |
| Public pages   | Live scorecard, tournament page, and a transparent broadcast overlay for OBS — all without an account                           |
| Tournaments    | Round-robin generation, ICC-style net run rate, groups, knockout brackets seeded from the standings                             |
| Toss tools     | Server-decided coin flip and wheel spin, each with an HMAC receipt so a result cannot be quietly re-rolled                      |
| Accounts       | Argon2id passwords, short-lived access tokens, rotating refresh tokens with reuse detection, per-device session revocation      |

## Stack

- **Backend** — Python 3.12, FastAPI, SQLAlchemy 2 (async, psycopg3), Alembic,
  PostgreSQL (Neon), Redis (Upstash), structlog, Prometheus.
- **Frontend** — React 19, Vite, TypeScript (strict), Tailwind 4, TanStack Query,
  Zustand, Dexie (IndexedDB), hand-written service worker.
- **Shared** — the scoring engine exists twice, in Python and TypeScript, and both
  are tested against the same `spec/scoring-fixtures.json`. That file is the contract
  that stops the phone and the server disagreeing about what a wide off a free hit
  means.

## Layout

```
backend/     FastAPI service: API, scoring engine, migrations, tests
frontend/    React app: scoring console, public pages, offline queue, TS engine
spec/        scoring-fixtures.json — the cross-language laws-of-cricket contract
infra/       docker-compose for the whole stack on one machine
scripts/     generate-icons.mjs (the PWA icons are generated, not hand-drawn)
docs/        architecture, deployment, security, runbook, scoring rules
```

---

## Run it

### The one-command way

```bash
docker compose -f infra/docker-compose.yml up --build
# web  http://localhost:8080
# api  http://localhost:8000/docs
```

Postgres and Redis come up in the stack, migrations run on the API's start-up, and
nothing needs a cloud account.

### The development way

Two terminals. **Backend:**

```bash
cd backend
python -m venv ../.venv && ../.venv/bin/pip install -r requirements-dev.txt
cp .env.example .env          # then set SECRET_KEY and DATABASE_URL
alembic upgrade head
python -m app                 # http://localhost:8000/docs
```

**Frontend:**

```bash
cd frontend
npm install
npm run dev                   # http://localhost:5173, proxying /api to :8000
```

The dev server proxies `/api` to the backend, so local development runs
same-origin: no CORS preflights and cookies behave as they do in production.

Two variables are all you need to point this at managed infrastructure:

```
DATABASE_URL=postgresql+psycopg://…@…neon.tech/pitchside?sslmode=require
REDIS_URL=rediss://default:…@….upstash.io:6379
```

Nothing in the code knows whether it is talking to a local container or to Neon and
Upstash. See [`docs/deployment.md`](docs/deployment.md).

> `python -m app` reloads on save, logs through the app's own structured logger, and
> picks an event loop the async Postgres driver can use — which on Windows uvicorn
> otherwise gets wrong, because psycopg cannot run on the default proactor loop.
> Containers call uvicorn directly; they are Linux, where the question does not arise.

---

## Verify it

```bash
# Backend: lint, types, tests
cd backend
ruff check . && ruff format --check .
mypy app tests tools
pytest                                  # 90 tests

# Integration tests need a real Postgres; without one they skip themselves
TEST_DATABASE_URL=postgresql+psycopg://postgres:postgres@localhost:5432/pitchside_test pytest

# The migrations and the ORM must agree
alembic upgrade head && python tools/check_migrations.py
```

```bash
# Frontend: lint, types, tests, build
cd frontend
npm run lint
npm run typecheck
npm run test                            # 40 tests, incl. the shared fixtures
npm run build
```

CI runs exactly these, plus a dependency audit and a build of both container
images, on every pull request: [`.github/workflows/ci.yml`](.github/workflows/ci.yml).

### The tests worth reading

`backend/tests/test_api_flows.py` is written in match language rather than in
assertions-about-functions, because these are the behaviours that matter:

- an over of singles rotates the strike correctly
- a wide adds a run without a ball
- a no-ball sets up a free hit
- correcting an early ball fixes every later number
- an offline queue syncs in order and survives a partial replay
- a stale state version is rejected
- a finished fixture moves the points table

---

## Documentation

| Document                                       | What it covers                                                                    |
| ---------------------------------------------- | --------------------------------------------------------------------------------- |
| [Architecture](docs/architecture.md)           | How a ball becomes a scorecard, why nothing is stored twice, realtime, offline     |
| [Deployment](docs/deployment.md)               | Neon, Upstash, containers, migrations as a release step, the full env var matrix   |
| [Security](docs/security.md)                   | Threat model, the controls that answer each threat, the pre-deploy checklist       |
| [Runbook](docs/runbook.md)                     | Symptom → check → action, for the things that actually go wrong mid-match          |
| [Scoring rules](docs/scoring-rules.md)         | Which laws are implemented, the edge cases, and how the two engines stay identical |

The API documents itself at `/docs` (OpenAPI), and can be turned off for a private
deployment with `OPENAPI_ENABLED=false`.

---

## Conventions

- **Derived, never stored.** If a number can be computed from the delivery log, it
  is computed. Any cache is a cache, and can be dropped without losing data.
- **Errors carry a code.** Every failure is `{"error": {"code": "...", "message": "..."}}`
  and the UI reacts to the code, never to the prose.
- **The engine is pure.** `app/scoring/` and `frontend/src/lib/scoring/` have no I/O,
  no clock and no database. That is what makes replay deterministic and the two
  implementations comparable.
- **Tests are named in English.** A failing test should tell you what a scorer would
  have seen.

## Licence

Not yet chosen — add one before publishing this repository.
