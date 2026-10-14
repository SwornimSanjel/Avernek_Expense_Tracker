#!/usr/bin/env bash
#
# healthcheck.sh: verify a deployment of the Avernek Expense Tracker.
#
# Installed as bin/healthcheck.sh in the deployment directory and run by the
# pipeline after every deployment and rollback, and by
# `./deploy-control.sh health`. A release counts as working only when all of
# these pass (with bounded retries, HEALTH_TIMEOUT seconds in total):
#
#   1. containers: web running, Docker health "healthy", on the release's image;
#      db healthy; fx-cron running
#   2. /api/health answers ok:true for this service, with a database configured
#   3. /login is rendered by the server (following its redirect when the user
#      is already signed in): HTTP 200 with the app's <title>. Warns when the
#      sign-in form is not served, which means authentication is bypassed
#   4. the web container reaches Postgres and finds the schema (public.users)
#   5. PUBLIC_URL/api/health through Caddy, when PUBLIC_URL is set
#      (a warning by default; HEALTH_PUBLIC_STRICT=true makes it fatal)
#
# Prints no secrets: database errors are reduced to their error code.

set -Eeuo pipefail

PROJECT_NAME="avernek-expense-tracker"
DEPLOY_DIR="${DEPLOY_DIR:-$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)}"
ENV_FILE="$DEPLOY_DIR/.env"
DEPLOYMENT_ENV="$DEPLOY_DIR/.deployment.env"
HEALTH_TIMEOUT="${HEALTH_TIMEOUT:-180}"
INTERVAL=5
LOGIN_MARKER="Sign in to the Avernek finance workspace"
PAGE_MARKER="<title>Avernek Finance Tracker</title>"

dc() {
  # Variables in the shell environment would override the env files (Jenkins
  # exports APP_IMAGE, for one): only the files decide what is deployed.
  env -u APP_IMAGE -u APP_PORT -u POSTGRES_USER -u POSTGRES_PASSWORD -u POSTGRES_DB \
    -u CRON_SECRET -u FX_CRON_SCHEDULE \
  docker compose \
    --project-name "$PROJECT_NAME" \
    --project-directory "$DEPLOY_DIR" \
    -f "$DEPLOY_DIR/compose.yaml" \
    --env-file "$ENV_FILE" \
    --env-file "$DEPLOYMENT_ENV" \
    "$@"
}

env_value() {
  local file="$1" key="$2" line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" =~ ^\'(.*)\'$ || "$line" =~ ^\"(.*)\"$ ]]; then line="${BASH_REMATCH[1]}"; fi
  printf '%s' "$line"
}

fail() { echo "HEALTH FAIL: $*" >&2; exit 1; }
pass() { echo "  ok    $*"; }

APP_PORT="$(env_value "$ENV_FILE" APP_PORT)"
PUBLIC_URL="$(env_value "$ENV_FILE" PUBLIC_URL)"
EXPECTED_IMAGE="$(env_value "$DEPLOYMENT_ENV" APP_IMAGE)"
[[ -n "$APP_PORT" ]] || fail "APP_PORT is not set in $ENV_FILE."
[[ -n "$EXPECTED_IMAGE" ]] || fail "APP_IMAGE is not set in $DEPLOYMENT_ENV."
BASE_URL="http://127.0.0.1:${APP_PORT}"
deadline=$((SECONDS + HEALTH_TIMEOUT))

# Retry a check until it passes or the overall deadline passes.
retry() {
  local description="$1"; shift
  local last=""
  while true; do
    if last="$("$@" 2>&1)"; then
      pass "$description"
      return 0
    fi
    if (( SECONDS >= deadline )); then
      echo "  last result: ${last:-no output}" >&2
      fail "$description (gave up after ${HEALTH_TIMEOUT}s)"
    fi
    sleep "$INTERVAL"
  done
}

container_of() { dc ps -q "$1" 2>/dev/null | head -n 1; }

check_web_container() {
  local id state health image
  id="$(container_of web)"; [[ -n "$id" ]] || { echo "no web container"; return 1; }
  read -r state health image < <(docker inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.Config.Image}}' "$id")
  [[ "$image" == "$EXPECTED_IMAGE" ]] || { echo "web runs $image, expected $EXPECTED_IMAGE"; return 1; }
  [[ "$state" == "running" ]] || { echo "web is $state"; return 1; }
  [[ "$health" == "healthy" ]] || { echo "web health is $health"; return 1; }
}

check_db_container() {
  local id health
  id="$(container_of db)"; [[ -n "$id" ]] || { echo "no db container"; return 1; }
  health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
  [[ "$health" == "healthy" ]] || { echo "db health is $health"; return 1; }
}

check_cron_container() {
  local id state
  id="$(container_of fx-cron)"; [[ -n "$id" ]] || { echo "no fx-cron container"; return 1; }
  state="$(docker inspect -f '{{.State.Status}}' "$id")"
  [[ "$state" == "running" ]] || { echo "fx-cron is $state"; return 1; }
}

check_health_endpoint() {
  local body
  body="$(curl -fsS --max-time 5 "$BASE_URL/api/health")" || return 1
  [[ "$body" == *'"ok":true'* ]] || { echo "unexpected body: ${body:0:200}"; return 1; }
  [[ "$body" == *'"service":"avernek-expense-tracker"'* ]] || { echo "another service answers on port $APP_PORT"; return 1; }
  [[ "$body" != *'"database":"UNSET"'* && "$body" != *'"database":"INVALID"'* ]] \
    || { echo "DATABASE_URL is unset or invalid in the container"; return 1; }
}

LOGIN_FORM_SERVED=""
check_app_page() {
  local page
  page="$(curl -fsSL --max-redirs 3 --max-time 15 "$BASE_URL/login")" || return 1
  [[ "$page" == *"$PAGE_MARKER"* ]] || { echo "/login did not render the application page"; return 1; }
  if [[ "$page" == *"$LOGIN_MARKER"* ]]; then LOGIN_FORM_SERVED=yes; else LOGIN_FORM_SERVED=no; fi
}

check_database_from_app() {
  dc exec -T web node -e '
    const { Client } = require("pg");
    const client = new Client({
      connectionString: process.env.DATABASE_URL,
      ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : undefined,
      connectionTimeoutMillis: 5000,
    });
    client.connect()
      .then(() => client.query("select to_regclass($1) is not null as ready", ["public.users"]))
      .then((result) => {
        if (!result.rows[0].ready) { console.error("schema missing: public.users"); process.exit(2); }
        return client.end();
      })
      .then(() => process.exit(0))
      .catch((error) => { console.error("database check failed: " + (error.code || error.name)); process.exit(1); });
  '
}

check_public_url() {
  curl -fsS --max-time 10 -o /dev/null "${PUBLIC_URL%/}/api/health"
}

echo "Health checks for $EXPECTED_IMAGE on $BASE_URL (timeout ${HEALTH_TIMEOUT}s)"
retry "db container healthy" check_db_container
retry "web container running and healthy on $EXPECTED_IMAGE" check_web_container
retry "fx-cron container running" check_cron_container
retry "GET /api/health" check_health_endpoint
retry "GET /login is rendered by the server" check_app_page
check_app_page >/dev/null 2>&1 || true
if [[ "$LOGIN_FORM_SERVED" == "no" ]]; then
  echo "  WARN  /login does not show the sign-in form: authentication appears to be bypassed (src/lib/auth/bypass.ts)"
fi
retry "web container reaches Postgres and the schema" check_database_from_app

if [[ -n "$PUBLIC_URL" ]]; then
  if check_public_url >/dev/null 2>&1; then
    pass "public ${PUBLIC_URL%/}/api/health"
  elif [[ "${HEALTH_PUBLIC_STRICT:-false}" == "true" ]]; then
    fail "public ${PUBLIC_URL%/}/api/health is not reachable"
  else
    echo "  WARN  public ${PUBLIC_URL%/}/api/health is not reachable (check Caddy and DNS; not fatal)"
  fi
fi

echo "All health checks passed."
