#!/bin/sh
# Daily NRB exchange-rate refresh for the self-hosted deployment.
#
# On Netlify this was a Scheduled Function; here a busybox crond sidecar calls
# the same protected route, so the FX implementation stays in one place.
set -eu

: "${CRON_SECRET:?CRON_SECRET must be set (it comes from .env)}"

URL="${FX_CRON_URL:-http://web:3000/api/cron/fx}"
SCHEDULE="${FX_CRON_SCHEDULE:-0 4 * * *}"

# busybox crond hands jobs a bare environment, so bake the values into the job
# script instead of relying on inherited variables. The file is root-only and
# lives inside the container.
cat > /usr/local/bin/fx-refresh <<EOF
#!/bin/sh
echo "[fx-cron] \$(date -u +%FT%TZ) refreshing rates"
wget -q -O - --header="Authorization: Bearer ${CRON_SECRET}" "${URL}" \
  || echo "[fx-cron] refresh FAILED"
echo ""
EOF
chmod 0700 /usr/local/bin/fx-refresh

echo "${SCHEDULE} /usr/local/bin/fx-refresh" > /etc/crontabs/root

echo "[fx-cron] scheduled '${SCHEDULE}' (UTC) -> ${URL}"
exec crond -f -l 8 -L /dev/stdout
