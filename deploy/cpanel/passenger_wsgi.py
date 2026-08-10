"""
cPanel Setup Python App creates this file for Passenger (WSGI).

Pitchside is ASGI (FastAPI + SSE). Do NOT serve it through Passenger.

Deploy steps:
  1. Create the Python App (venv only).
  2. Stop the app in Setup Python App.
  3. Run uvicorn via start-api.sh / ensure-api.sh.
  4. Proxy with api.htaccess in the subdomain document root.

If Passenger somehow loads this module, fail loudly instead of half-working.
"""

raise RuntimeError(
    "Pitchside must run under uvicorn, not Passenger. "
    "Stop the Python App in cPanel and run deploy/cpanel/start-api.sh."
)
