#!/usr/bin/env bash
# Start Pitchside API (uvicorn) for cPanel.
#
# Usage (after activating the cPanel Python App virtualenv):
#   cd ~/pitchside-api
#   bash deploy/cpanel/start-api.sh
#   # or, if helpers were copied next to the app:
#   bash start-api.sh
#
# Environment overrides:
#   PORT=8000
#   BIND=127.0.0.1
#   LOG_FILE=~/logs/pitchside-api.log
#   PID_FILE=~/pitchside-api/uvicorn.pid

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
# If this script lives in deploy/cpanel/, the app root is two levels up when
# the whole repo is uploaded; when only backend/ is uploaded and this file is
# copied beside app/, ROOT is already the app root.
if [[ -d "${ROOT}/app" && -f "${ROOT}/requirements.txt" ]]; then
  APP_ROOT="${ROOT}"
elif [[ -d "${ROOT}/../../backend/app" ]]; then
  APP_ROOT="$(cd "${ROOT}/../../backend" && pwd)"
elif [[ -d "${ROOT}/../../app" ]]; then
  APP_ROOT="$(cd "${ROOT}/../.." && pwd)"
else
  APP_ROOT="${ROOT}"
fi

cd "${APP_ROOT}"

PORT="${PORT:-8000}"
BIND="${BIND:-127.0.0.1}"
LOG_DIR="${HOME}/logs"
LOG_FILE="${LOG_FILE:-${LOG_DIR}/pitchside-api.log}"
PID_FILE="${PID_FILE:-${APP_ROOT}/uvicorn.pid}"

mkdir -p "${LOG_DIR}"

if [[ -f "${PID_FILE}" ]]; then
  old_pid="$(cat "${PID_FILE}" || true)"
  if [[ -n "${old_pid}" ]] && kill -0 "${old_pid}" 2>/dev/null; then
    echo "Already running (pid ${old_pid}). Stop it first or remove ${PID_FILE}."
    exit 0
  fi
  rm -f "${PID_FILE}"
fi

if ! command -v uvicorn >/dev/null 2>&1; then
  echo "uvicorn not found. Activate the cPanel Python App virtualenv first."
  exit 1
fi

if [[ ! -f .env ]]; then
  echo "Missing ${APP_ROOT}/.env — copy deploy/cpanel/env.production.example and fill secrets."
  exit 1
fi

nohup uvicorn app.main:app \
  --host "${BIND}" \
  --port "${PORT}" \
  --proxy-headers \
  --forwarded-allow-ips='*' \
  >>"${LOG_FILE}" 2>&1 &

echo $! >"${PID_FILE}"
echo "Started uvicorn pid $(cat "${PID_FILE}") on ${BIND}:${PORT}"
echo "Logs: ${LOG_FILE}"
