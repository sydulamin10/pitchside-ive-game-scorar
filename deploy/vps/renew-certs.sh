#!/usr/bin/env bash
# ---------------------------------------------------------------------------
# Renew every Let's Encrypt certificate on this host and reload nginx.
#
# The certs were issued by the certbot container from the cbg-task-manager
# compose project, which is the only place that has both /etc/letsencrypt and
# the certbot-www webroot volume mounted. The host's own certbot package
# cannot see that webroot, so renewal has to run the same way issuance did.
#
# Installed as a cron job; safe to run at any time. certbot only acts when a
# certificate is within 30 days of expiry, so this is a no-op most days.
# ---------------------------------------------------------------------------
set -uo pipefail

CBG=/opt/cbg-task-manager
COMPOSE="$CBG/docker-compose.prod.yml"
ENVFILE="$CBG/.env.production"
LOG=/var/log/odcc-cert-renew.log

exec >>"$LOG" 2>&1
echo "=== $(date -Is) renewal run ==="

docker compose -f "$COMPOSE" --env-file "$ENVFILE" run --rm -T --no-deps \
  --entrypoint certbot certbot renew --webroot -w /var/www/certbot \
  --non-interactive </dev/null
rc=$?
echo "certbot renew exit: $rc"

# Reload regardless: a renewal that replaced a cert is only picked up by a
# running nginx after a reload, and a reload with unchanged certs is harmless.
if docker exec cbg-task-manager-nginx-1 nginx -t; then
  docker exec cbg-task-manager-nginx-1 nginx -s reload
  echo "nginx reloaded"
else
  echo "WARNING: nginx config test failed; skipped reload"
fi

for d in /etc/letsencrypt/live/*/; do
  n=$(basename "$d")
  [ "$n" = "README" ] && continue
  exp=$(openssl x509 -in "$d/fullchain.pem" -noout -enddate 2>/dev/null | cut -d= -f2)
  echo "  $n expires $exp"
done

echo "=== done ==="
