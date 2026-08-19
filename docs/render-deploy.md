# Deploy API on Render (backend only)

Keep the website on cPanel:

| Host | Where |
|------|--------|
| `https://web.odcc.nextframesoft.com` | cPanel static `dist/` |
| `https://api.odcc.nextframesoft.com` | **Render** (this guide) |

cPanel cannot reach Neon/Upstash and locks the API subdomain. Render can.

Templates: [`deploy/render/env.example`](../deploy/render/env.example), blueprint [`render.yaml`](../render.yaml).

---

## 1. Create the web service

1. Go to [https://render.com](https://render.com) → sign in (GitHub).
2. **New → Web Service** → connect the **Live Game Scorar** repo  
   (or **New → Blueprint** and select `render.yaml`).
3. Settings:

| Field | Value |
|-------|--------|
| Name | `pitchside-api` |
| Region | Singapore (or closest to you / Neon) |
| Runtime | **Docker** |
| **Root Directory** | `backend` |
| Dockerfile path | `./Dockerfile` (or leave default — file is inside `backend/`) |
| Instance | Free |
| Health check path | `/healthz` |

> If Root Directory stays empty and Dockerfile is `./backend/Dockerfile`, you **must** set  
> **Docker Build Context Directory** = `backend`. Otherwise the build fails with  
> `"/app": not found` / `requirements.txt: not found`.

4. **Pre-Deploy Command** (migrations):

```text
alembic upgrade head
```

5. Deploy.

---

## 2. Environment variables

Dashboard → Environment → add (from [`deploy/render/env.example`](../deploy/render/env.example)):

```env
ENV=production
SECRET_KEY=<python -c "import secrets; print(secrets.token_urlsafe(48))">
DATABASE_URL=<Neon pooled URL with sslmode=require>
REDIS_URL=<Upstash rediss:// URL>
PUBLIC_WEB_URL=https://web.odcc.nextframesoft.com
PUBLIC_API_URL=https://pitchside-api-kugn.onrender.com
CORS_ORIGINS=https://web.odcc.nextframesoft.com
ALLOWED_HOSTS=pitchside-api-kugn.onrender.com
AUTH_REFRESH_COOKIE_ENABLED=false
ALLOW_REGISTRATION=true
OPENAPI_ENABLED=false
LOG_JSON=true
MEDIA_BACKEND=local
MEDIA_LOCAL_DIR=/tmp/pitchside-media
MEDIA_PUBLIC_BASE_URL=https://pitchside-api-kugn.onrender.com/media
```

Replace `pitchside-api-kugn.onrender.com` if Render shows a different hostname. If you later CNAME `api.odcc.nextframesoft.com` here, add that host to `ALLOWED_HOSTS`.

Redeploy after saving env vars.

### Smoke test

```text
https://YOUR-SERVICE.onrender.com/healthz
https://YOUR-SERVICE.onrender.com/api/v1/health/ready
```

Ready should show database + cache ok.

---

## 3. Custom domain `api.odcc.nextframesoft.com`

1. Render → your service → **Settings → Custom Domains** → add `api.odcc.nextframesoft.com`.
2. DNS (cPanel → Zone Editor / DNS):

| Type | Name | Value |
|------|------|--------|
| CNAME | `api` | `YOUR-SERVICE.onrender.com` |

(If Render asks for a TXT verify record, add that too.)

3. Wait for TLS on Render (green).
4. Update Render env:

```env
PUBLIC_API_URL=https://api.odcc.nextframesoft.com
MEDIA_PUBLIC_BASE_URL=https://api.odcc.nextframesoft.com/media
ALLOWED_HOSTS=api.odcc.nextframesoft.com,YOUR-SERVICE.onrender.com
```

5. Redeploy once.

---

## 4. Point the frontend at the new API

`VITE_API_BASE_URL` is compile-time. Rebuild and re-upload `dist/` to the **web** cPanel docroot:

**PowerShell:**

```powershell
cd frontend
$env:VITE_API_BASE_URL="https://pitchside-api-kugn.onrender.com"
npm.cmd run build
Copy-Item ..\deploy\cpanel\web.htaccess .\dist\.htaccess -Force
```

Upload everything in `frontend/dist/` to `web.odcc.nextframesoft.com`. The built `runtime-config.js` also points at this origin so you can change it on the host later without a rebuild.

---

## 5. What to stop on cPanel

- You no longer need uvicorn / cron / `.htaccess` proxy on `api.odcc…`.
- Remove or ignore the old Python App on that subdomain (it was causing 403).
- DNS for `api` must **CNAME to Render**, not to the cPanel A record.

---

## Notes

- **Free tier** sleeps after idle; first request can take ~30–60s.
- **Local media** on free Render is wiped on redeploy; use R2 later for permanent logos.
- Live SSE works on Render; PHP proxy on cPanel is not used anymore.
- **Phone WHIP / MediaMTX** is not provided by Render alone. Run MediaMTX on a VPS
  (see `infra/docker-compose.yml`) and set `MEDIAMTX_WHIP_BASE_URL` to that host’s
  **public HTTPS** WHIP base so ExternalCamera can publish from phones.
