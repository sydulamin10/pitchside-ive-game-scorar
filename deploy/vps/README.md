# VPS deployment (103.228.134.134)

What runs where:

| Host | Serves | Where it comes from |
| --- | --- | --- |
| `odcc.live` | ODCC LIVE web app (static SPA) | `/opt/odcc-web/dist` on the VPS |
| `api.odcc.live` | ODCC LIVE API (FastAPI) | `odcc-api` container, `/opt/odcc-api` |
| `cbg-tasks.duckdns.org` | Pre-existing task manager | `cbg-task-manager` compose project |

All three sit behind Cloudflare (proxied A records) and share one origin Nginx.

## The constraint that shapes this deployment

Ports 80 and 443 on this box are **not** owned by a host Nginx — there is no
host Nginx installed. They belong to `cbg-task-manager-nginx-1`, an
`nginx:1.27-alpine` container from an unrelated project, whose only config is a
single bind-mounted file (`deploy/nginx.conf` → `conf.d/default.conf`).

So "add a server block" means adding a *new* include to that container. The
approach here is strictly additive:

- Two new conf files are mounted into `conf.d/`. The existing `default.conf` is
  never edited (verify with `md5sum`).
- Neither new block declares `default_server`, so `default.conf` keeps every
  request whose Host it already handled. Exact `server_name` matches win for
  `odcc.live` and `api.odcc.live`; everything else falls through unchanged.
- The only change to `docker-compose.prod.yml` is three added `volumes:` lines.
  Timestamped `.bak-*` backups sit next to it.
- Port 8000 was already taken by the task manager's backend, so the API
  publishes **8100**, bound to loopback only. No firewall rule was added or
  changed.

`proxy_pass` in the API block goes through a *variable*
(`set $odcc_api http://odcc-api:8000;` + `proxy_pass $odcc_api$request_uri;`).
That defers DNS resolution to request time via Docker's embedded resolver. With
a literal hostname, Nginx resolves upstreams at startup and **refuses to start**
if the name is unresolvable — which would take the co-hosted task manager
offline whenever the API container was down. With the variable, a stopped API
container only makes `api.odcc.live` return 502.

## Files

| File | Deployed to |
| --- | --- |
| `docker-compose.yml` | `/opt/odcc-api/docker-compose.yml` |
| `env.production.example` | `/opt/odcc-api/.env.production` (fill in, chmod 600) |
| `nginx.odcc-api.conf` | `/opt/cbg-task-manager/deploy/nginx.odcc-api.conf` |
| `nginx.odcc-web.conf` | `/opt/cbg-task-manager/deploy/nginx.odcc-web.conf` |
| `renew-certs.sh` | `/opt/odcc-api/deploy/renew-certs.sh` (cron, twice daily) |

The API container joins the pre-existing `cbg-task-manager_default` network as
an `external` network, which is what lets the Nginx container reach it as
`odcc-api`. Nothing about the other project's services is modified by this.

## Deploying an API change

```bash
cd /opt/odcc-api
# refresh ./backend from the repo, then:
docker compose build && docker compose up -d
docker compose logs -f api
```

Migrations run automatically: the image's `CMD` runs `alembic upgrade head`
(retrying for a cold Neon instance) before uvicorn binds, and app start-up runs
a second, no-op pass because `AUTO_MIGRATE=true`.

## Deploying a web change

Build locally, then replace the document root. Nginx serves it read-only, so
no container restart is needed:

```powershell
powershell -ExecutionPolicy Bypass -File deploy/cpanel/build-odcc-web.ps1
```

```bash
tar -xzf odcc-web.tar.gz -C /opt/odcc-web/dist   # after clearing it
```

`runtime-config.js` sets the API origin at runtime and is served
`no-store`, so the API host can be repointed by editing that one file on the
server — no rebuild.

## Editing Nginx config

Rewrite the conf file **in place** (`cat > file`), never `mv` over it. It is a
single-file bind mount, so replacing the inode detaches the container's view of
it. Then:

```bash
docker exec cbg-task-manager-nginx-1 nginx -t && \
docker exec cbg-task-manager-nginx-1 nginx -s reload
```

Always `nginx -t` first: a bad reload on this container takes down the task
manager too.

## Certificates

Three Let's Encrypt certs, all issued by the `certbot` service in the
task manager's compose project, because that is the only place with both
`/etc/letsencrypt` and the `certbot-www` webroot volume mounted. HTTP-01 works
through the Cloudflare proxy — the `/.well-known/acme-challenge/` location is
kept in every block, including the HTTPS ones, so renewals keep working.

There was **no renewal automation on this host at all** before this deployment;
the task manager's own cert would have silently expired. `renew-certs.sh` now
renews all three and reloads Nginx, twice daily via root cron.

```bash
/opt/odcc-api/deploy/renew-certs.sh   # safe anytime; no-op outside 30d window
tail -40 /var/log/odcc-cert-renew.log
```

To add `www.odcc.live` at the origin, create its DNS record first, then:

```bash
docker compose -f /opt/cbg-task-manager/docker-compose.prod.yml \
  --env-file /opt/cbg-task-manager/.env.production \
  run --rm -T --no-deps --entrypoint certbot certbot \
  certonly --webroot -w /var/www/certbot \
  -d odcc.live -d www.odcc.live --non-interactive --agree-tos --expand
```

`-T` and `</dev/null` matter when scripting `docker compose run`: it otherwise
consumes the calling script's stdin.

## Cloudflare notes

Set SSL/TLS mode to **Full (strict)** — every hostname now has a matching
Let's Encrypt cert at the origin, so strict verification passes. "Flexible"
would loop against the HTTP→HTTPS redirects.

Visitor IPs arrive in `CF-Connecting-IP`. Both blocks map it to
`X-Forwarded-For`, falling back to `$remote_addr` for direct origin hits, so the
API's per-client rate limiting keys on the real visitor instead of a shared
Cloudflare edge address.

## Phone camera / MediaMTX

`odcc-mediamtx` publishes WHIP at `https://api.odcc.live/live/{path}/whip`.
Nginx strips `/live` and forwards to MediaMTX `:8889` on the Docker network.
ICE media uses **new unused port 8189** (UDP + TCP) on the public IP — Cloudflare
cannot carry WebRTC, so phones connect to `103.228.134.134:8189` directly.

```bash
# After changing mediamtx.yml
cd /opt/odcc-api && docker compose up -d --force-recreate mediamtx
```

The API must have `MEDIAMTX_WHIP_BASE_URL=https://api.odcc.live/live` or the
camera page shows “No WHIP publish URL”.

## Health checks

```bash
curl -s https://api.odcc.live/api/v1/health/ready   # checks Postgres + Redis
curl -sN -H 'accept: text/event-stream' \
  https://api.odcc.live/api/v1/stream/matches/<slug> | head
```
