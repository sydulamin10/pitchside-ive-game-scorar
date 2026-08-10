# cPanel deploy helpers

Templates for hosting Pitchside on:

- `https://web.odcc.nextframesoft.com` — static frontend
- `https://api.odcc.nextframesoft.com` — uvicorn + Apache reverse proxy

Full click-path: [docs/cpanel-deploy.md](../../docs/cpanel-deploy.md)

If the host blocks Neon/Redis or LiteSpeed returns 403 on the API subdomain,
deploy the API on Render instead: [docs/render-deploy.md](../../docs/render-deploy.md).

| File | Where it goes |
|------|----------------|
| `env.production.example` | Copy → `~/pitchside-api/.env` |
| `start-api.sh` | Copy → `~/pitchside-api/start-api.sh` |
| `ensure-api.sh` | Copy → `~/pitchside-api/ensure-api.sh` (cron) |
| `passenger_wsgi.py` | Replace cPanel’s stub in app root |
| `api.htaccess` | Rename → `.htaccess` in **api** docroot |
| `web.htaccess` | Rename → `.htaccess` in **web** docroot (with `dist/`) |
| `build-web.ps1` | Run on your PC to produce `frontend/dist` + `.htaccess` |
