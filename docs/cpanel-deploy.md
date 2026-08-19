# cPanel deploy — ODCC subdomains

Host Pitchside on shared/cPanel hosting that has **Setup Python App**:

| Host | Role |
|------|------|
| `https://web.odcc.nextframesoft.com` | React SPA (`frontend/dist`) |
| `https://api.odcc.nextframesoft.com` | FastAPI via **uvicorn** + Apache reverse proxy |

Use **Neon** for Postgres and **Upstash** (`rediss://`) for Redis. Templates live in [`deploy/cpanel/`](../deploy/cpanel/).

> **Do not run the API under Passenger.** Passenger is WSGI-first; live SSE score feeds need ASGI (uvicorn). Create the Python App only to get a virtualenv, then **Stop App** and run `start-api.sh`.

---

## 1. DNS and SSL

1. cPanel → **Domains** → create:
   - `web.odcc.nextframesoft.com` (note the document root)
   - `api.odcc.nextframesoft.com` (note the document root)
2. Wait until both resolve to this server.
3. **SSL/TLS Status** → **Run AutoSSL** until both show valid HTTPS.

---

## 2. API — Python App + uvicorn

### 2.1 Create the virtualenv

1. **Software → Setup Python App → Create**
   - Python version: **3.11+** (3.12 if listed)
   - Application root: `pitchside-api`
   - Application URL: `api.odcc.nextframesoft.com` + `/`
2. Copy the **Enter to the virtual environment** command shown on the page.
3. Click **Stop App**.

### 2.2 Upload backend

Upload the contents of `backend/` into `~/pitchside-api/` so you have:

```text
~/pitchside-api/
  app/
  alembic/
  alembic.ini
  requirements.txt
  .env
  passenger_wsgi.py      ← from deploy/cpanel/passenger_wsgi.py
  start-api.sh           ← from deploy/cpanel/start-api.sh
  ensure-api.sh          ← from deploy/cpanel/ensure-api.sh
  media/                 ← created on first upload
```

Also copy `deploy/cpanel/api.htaccess` into the **api subdomain document root** as `.htaccess` (this may be a different folder than `pitchside-api` if cPanel separated them).

### 2.3 Configure `.env`

If you uploaded `pitchside-api-cpanel.zip`, the example env is already in the app root:

```bash
cd ~/pitchside-api
cp env.production.example .env
# edit secrets, Neon, Upstash, and MEDIA_LOCAL_DIR=/home/odccofficial/pitchside-api/media
```

(If you cloned the full repo instead: `cp deploy/cpanel/env.production.example .env`.)

Required production values:

```env
ENV=production
PUBLIC_WEB_URL=https://web.odcc.nextframesoft.com
PUBLIC_API_URL=https://api.odcc.nextframesoft.com
CORS_ORIGINS=https://web.odcc.nextframesoft.com
ALLOWED_HOSTS=api.odcc.nextframesoft.com,localhost,127.0.0.1
AUTH_REFRESH_COOKIE_ENABLED=false
```

If the host blocks outbound **5432** (Neon) and **6379** (Upstash Redis) — common on shared cPanel — the API cannot run there. Confirm with:

```bash
timeout 5 bash -c 'echo >/dev/tcp/ep-YOUR-HOST.neon.tech/5432' && echo PG_OPEN || echo PG_BLOCKED
timeout 5 bash -c 'echo >/dev/tcp/YOUR.upstash.io:6379' && echo REDIS_OPEN || echo REDIS_BLOCKED
```

Temporary: leave `REDIS_URL=` empty (app still boots; live fan-out is single-process). **Postgres cannot be skipped.** Until 5432 is open (or you move the API off this host), `alembic` and the API will keep failing.

Generate a secret:

```bash
python -c "import secrets; print(secrets.token_urlsafe(48))"
```

### 2.4 Install, migrate, start

In **Terminal** / SSH:

```bash
# paste the activate command from Setup Python App, then:
cd ~/pitchside-api
pip install -r requirements.txt
alembic upgrade head
chmod +x start-api.sh ensure-api.sh
./start-api.sh
```

Confirm locally on the server:

```bash
curl -s http://127.0.0.1:8000/healthz
curl -s http://127.0.0.1:8000/api/v1/health/ready
```

Then from the public internet:

- `https://api.odcc.nextframesoft.com/healthz`
- `https://api.odcc.nextframesoft.com/api/v1/health/ready`

If the public URL fails but localhost works, the api `.htaccess` proxy (`[P]`) is blocked — ask the host to enable reverse proxy for the account.

### 2.6 LiteSpeed 404 on `/healthz` (common)

If `https://api…/` shows a **directory listing** (`cgi-bin`, `php.ini`) and `/healthz` is **404 from LiteSpeed**, the API subdomain document root has **no working proxy** — uvicorn is either not running, or `.htaccess` is missing from the *wrong* folder.

Fix:

1. In File Manager, open the **api subdomain document root** (Domains → api.odcc… → Document Root). It is usually **not** `~/pitchside-api`.
2. Put `api.htaccess` there as **`.htaccess`**.
3. On the server:

```bash
source ~/virtualenv/pitchside-api/3.11/bin/activate
cd ~/pitchside-api
# Neon must be reachable (port 5432)
alembic upgrade head
./start-api.sh
curl -s http://127.0.0.1:8000/healthz
```

4. Reload `https://api.odcc.nextframesoft.com/healthz`.  
   - Still LiteSpeed 404 → `.htaccess` missing from docroot (must be named `.htaccess`).  
   - LiteSpeed **403 Forbidden** → `[P]` proxy is disabled. Use the PHP fallback:

```bash
cp ~/pitchside-api/proxy.php ~/api.odcc.nextframesoft.com/proxy.php
# or copy from deploy/cpanel/ after re-upload
cp ~/api.odcc.nextframesoft.com/api.htaccess-php-fallback ~/api.odcc.nextframesoft.com/.htaccess
# if you only have the fallback file name from a fresh zip:
# cp deploy/cpanel/api.htaccess-php-fallback ~/api.odcc.nextframesoft.com/.htaccess
curl -s https://api.odcc.nextframesoft.com/healthz
```

   - Or ask the host to enable LiteSpeed reverse-proxy to `127.0.0.1:8000`.  
   - JSON `{"status":"ok"}` → public path works.  
   - 500 from uvicorn → check `~/logs/pitchside-api.log` (often DB still blocked).

### 2.5 Keep uvicorn alive

**Cron Jobs**:

```cron
@reboot /bin/bash /home/YOUR_USER/pitchside-api/ensure-api.sh
*/5 * * * * /bin/bash /home/YOUR_USER/pitchside-api/ensure-api.sh
```

If `ensure-api.sh` cannot find the venv, set `VENV_ACTIVATE` inside that script to the activate path from Setup Python App.

Logs default to `~/logs/pitchside-api.log`.

---

## 3. Web — static frontend

### 3.1 Build on your PC

`VITE_API_BASE_URL` is baked in at build time:

**PowerShell** (use `npm.cmd` if you hit “running scripts is disabled”):

```powershell
cd frontend
$env:VITE_API_BASE_URL="https://pitchside-api-kugn.onrender.com"
npm.cmd ci
npm.cmd run build
Copy-Item ..\deploy\cpanel\web.htaccess .\dist\.htaccess -Force
```

**cmd.exe**:

```bat
cd frontend
set VITE_API_BASE_URL=https://pitchside-api-kugn.onrender.com
npm ci
npm run build
copy /Y ..\deploy\cpanel\web.htaccess dist\.htaccess
```

Or one shot: `powershell -ExecutionPolicy Bypass -File deploy\cpanel\build-web.ps1` from the repo root.

### 3.2 Upload

1. Upload **everything inside** `frontend/dist/` into the **web** subdomain document root.
2. Copy `deploy/cpanel/web.htaccess` there as `.htaccess`.

### 3.3 Verify

- `https://web.odcc.nextframesoft.com/` loads the marketing/home page
- Sign-in / API calls hit `https://pitchside-api-kugn.onrender.com` (Render). `api.odcc.nextframesoft.com` is unused until it CNAMEs there.
- `https://web.odcc.nextframesoft.com/install` for phone home-screen icon (HTTPS required)

---

## 4. Click checklist

| Step | cPanel place | Done when |
|------|----------------|-----------|
| Subdomains | Domains | `web.*` + `api.*` exist |
| SSL | SSL/TLS Status | AutoSSL green |
| Python App | Setup Python App | venv created, then **Stopped** |
| API files | File Manager | `~/pitchside-api` + `.env` |
| Proxy | api docroot `.htaccess` | from `api.htaccess` |
| Terminal | Terminal | pip, alembic, `./start-api.sh` |
| Cron | Cron Jobs | `ensure-api.sh` |
| Web files | web docroot | `dist/` + `web.htaccess` → `.htaccess` |

---

## 5. Limits on shared cPanel

- Idle/memory killers may stop uvicorn — cron `ensure-api.sh` restarts it.
- **MediaMTX / phone camera ingest** is not included on shared cPanel; scoring, public pages, and OBS overlays work without it.
- For in-app phone WHIP publish, run MediaMTX on a VPS/Docker host and set API ``MEDIAMTX_WHIP_BASE_URL`` to that host’s **public HTTPS** WHIP base (phones cannot use localhost). See [architecture.md](./architecture.md#stream-sessions-and-mediamtx).
- Prefer a VPS + Docker ([`infra/docker-compose.yml`](../infra/docker-compose.yml)) if proxy is disabled or the process is killed constantly.

See also [deployment.md](./deployment.md) for Neon/Upstash and general production env rules.
