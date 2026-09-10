# ---------------------------------------------------------------------------
# Pitchside API
#
# Two stages: wheels are built with a compiler present, then copied into a slim
# runtime that has no build tools, no package index credentials and no root user.
# ---------------------------------------------------------------------------

FROM python:3.12-slim-bookworm AS build

ENV PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    PYTHONDONTWRITEBYTECODE=1

WORKDIR /build

# psycopg ships binary wheels, so nothing here needs libpq or gcc — but keep the
# stage anyway: it means a dependency that *does* need to compile cannot quietly
# drag a compiler into the runtime image.
COPY requirements.txt ./
RUN python -m venv /opt/venv \
    && /opt/venv/bin/pip install --upgrade pip setuptools wheel \
    && /opt/venv/bin/pip install -r requirements.txt


FROM python:3.12-slim-bookworm AS runtime

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PATH="/opt/venv/bin:$PATH" \
    ENV=production

# Tini reaps zombies and forwards signals, so a rolling deploy actually finishes
# the in-flight scoring request instead of having it killed mid-transaction.
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini curl ffmpeg \
    && rm -rf /var/lib/apt/lists/* \
    && useradd --create-home --uid 10001 --shell /usr/sbin/nologin pitchside

COPY --from=build /opt/venv /opt/venv

WORKDIR /app
COPY --chown=10001:10001 alembic.ini pyproject.toml ./
COPY --chown=10001:10001 alembic ./alembic
COPY --chown=10001:10001 app ./app

USER 10001

EXPOSE 8000

# Readiness checks the database and the cache; the platform's own health probe
# should use this same path so a degraded instance is taken out of rotation.
# start-period is long because Render free + Neon free both cold-start, and
# alembic must finish before /ready is meaningful.
HEALTHCHECK --interval=30s --timeout=5s --start-period=90s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/v1/health/ready || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]

# One worker per container: the scoring path serialises writes per match with a
# row lock, and horizontal scaling belongs to the orchestrator, not to a
# process manager hidden inside the image. Live updates fan out through Redis,
# so any number of containers stay in step.
#
# PORT is read at runtime so PaaS hosts (Render, Railway, Fly) can inject it.
# Render free never runs preDeployCommand, so migrate here (with retries for a
# sleeping Neon) before listening. A second pass in app lifespan is a no-op.
CMD ["sh", "-c", "n=0; until alembic upgrade head; do n=$((n+1)); [ \"$n\" -ge 8 ] && exit 1; sleep $((n*2)); done; exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --timeout-graceful-shutdown 25 --no-server-header --no-access-log"]
