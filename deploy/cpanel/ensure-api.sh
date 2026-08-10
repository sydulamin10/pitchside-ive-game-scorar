#!/usr/bin/env bash
# Cron-friendly: start uvicorn if it is not already running.
# Example crontab (cPanel → Cron Jobs):
#   @reboot /bin/bash /home/USER/pitchside-api/ensure-api.sh
#   */5 * * * * /bin/bash /home/USER/pitchside-api/ensure-api.sh
#
# Before first use, edit VENV_ACTIVATE below (copy from Setup Python App).

set -euo pipefail

# --- edit these two paths for your account ---
APP_ROOT="${APP_ROOT:-${HOME}/pitchside-api}"
VENV_ACTIVATE="${VENV_ACTIVATE:-}"  # e.g. source /home/USER/virtualenv/pitchside-api/3.12/bin/activate && cd ~/pitchside-api
# ---------------------------------------------

if [[ -z "${VENV_ACTIVATE}" ]]; then
  # Common CloudLinux layout; override if yours differs
  for candidate in \
    "${HOME}/virtualenv/pitchside-api"/*/bin/activate \
    "${HOME}/virtualenv/"*/bin/activate
  do
    if [[ -f "${candidate}" ]]; then
      # shellcheck disable=SC1090
      source "${candidate}"
      break
    fi
  done
else
  # shellcheck disable=SC1090
  source "${VENV_ACTIVATE}"
fi

cd "${APP_ROOT}"

PID_FILE="${PID_FILE:-${APP_ROOT}/uvicorn.pid}"
if [[ -f "${PID_FILE}" ]]; then
  pid="$(cat "${PID_FILE}" || true)"
  if [[ -n "${pid}" ]] && kill -0 "${pid}" 2>/dev/null; then
    exit 0
  fi
fi

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
if [[ -f "${SCRIPT_DIR}/start-api.sh" ]]; then
  bash "${SCRIPT_DIR}/start-api.sh"
elif [[ -f "${APP_ROOT}/start-api.sh" ]]; then
  bash "${APP_ROOT}/start-api.sh"
else
  echo "start-api.sh not found" >&2
  exit 1
fi
