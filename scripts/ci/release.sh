#!/usr/bin/env bash
#
# release.sh <command>: the deployment steps of the Jenkins pipeline.
#
#   preflight            checks before anything on the server changes (first-
#                        deployment gate, Docker, directory, legacy stack)
#   env-install <file>   install .env from the Jenkins credential file, only when
#                        none exists (or SYNC_ENV_FROM_CREDENTIAL=true: backs up first)
#   prepare              validate .env and the port, keep the verified release for
#                        rollback, install compose.yaml, scripts and .deployment.env
#   deploy               database up, backup, migrations, app up, admin seed
#   verify               post-deployment health checks
#   finalize             record the release as verified (the next rollback target)
#   rollback             restore the verified release after a failed deployment
#                        (exit 0 restored and verified, 1 failed, 3 no prior
#                        release, 4 deployment had not started)
#   retain-images        keep the newest release images and every rollback image
#   diagnostics <dir>    container state and logs, for the build's artifacts
#
# Runs from the Jenkins workspace with APP_IMAGE, GIT_COMMIT, BUILD_NUMBER set.
# Nothing it installs refers back to the workspace: once a release is deployed
# the stack runs from /srv/deployments/<project> alone.

set -Eeuo pipefail

PROJECT_NAME="${PROJECT_NAME:-avernek-expense-tracker}"
DEPLOY_ROOT="${DEPLOY_ROOT:-/srv/deployments}"
DEPLOY_DIR="${DEPLOY_DIR:-$DEPLOY_ROOT/$PROJECT_NAME}"
IMAGE_REPO="${IMAGE_REPO:-$PROJECT_NAME}"
KEEP_RELEASE_IMAGES="${KEEP_RELEASE_IMAGES:-5}"
VOLUME_NAME="${PROJECT_NAME}_pgdata"
REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"

ENV_FILE="$DEPLOY_DIR/.env"
DEPLOYMENT_ENV="$DEPLOY_DIR/.deployment.env"
RELEASES_DIR="$DEPLOY_DIR/releases"
APPROVAL_FILE="$DEPLOY_DIR/.first-deploy-approved"
ACTIVATED_FILE="$DEPLOY_DIR/.activated"
IN_PROGRESS="$DEPLOY_DIR/.deploy-in-progress"
LOCK_FILE="$DEPLOY_DIR/.deploy.lock"

REQUIRED_KEYS=(APP_PORT DATABASE_URL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB SESSION_SECRET ADMIN_EMAIL ADMIN_PASSWORD CRON_SECRET)

# deploy-control.sh skips its own locking when called from here.
export DEPLOY_LOCK_HELD=1 DEPLOY_DIR

die() {
  echo "ERROR: $1" >&2
  shift
  for line in "$@"; do echo "       $line" >&2; done
  exit 1
}
info() { echo "==> $*"; }
warn() { echo "WARNING: $*" >&2; }

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

lock() {
  exec 8>>"$LOCK_FILE"
  flock -w 120 8 || die "$LOCK_FILE is held (deploy-control.sh running?). Retry the build when it is free."
}

approval() { [[ -f "$APPROVAL_FILE" ]] && head -n 1 "$APPROVAL_FILE" | tr -d '[:space:]' || true; }

# Containers of this Compose project that run from another directory: the
# deployment made by the earlier Jenkinsfile (under $JENKINS_HOME/deployments).
legacy_containers() {
  docker ps -a --filter "label=com.docker.compose.project=${PROJECT_NAME}" \
    --format '{{.ID}} {{.Label "com.docker.compose.project.working_dir"}} {{.Label "com.docker.compose.service"}} {{.Image}}' \
    | awk -v dir="$DEPLOY_DIR" '$2 != dir'
}

# ---------------------------------------------------------------------------
cmd_preflight() {
  info "Preflight for $PROJECT_NAME in $DEPLOY_DIR"
  local tool
  for tool in docker flock curl ss awk; do
    command -v "$tool" >/dev/null || die "'$tool' is not installed on the Jenkins host."
  done
  docker info >/dev/null 2>&1 || die "Jenkins cannot reach the Docker daemon." \
    "sudo usermod -aG docker jenkins && sudo systemctl restart jenkins"

  local version major minor
  version="$(docker compose version --short 2>/dev/null || true)"
  [[ -n "$version" ]] || die "Docker Compose v2 is not installed (docker compose plugin)."
  major="${version%%.*}"; minor="${version#*.}"; minor="${minor%%.*}"
  if (( major < 2 || (major == 2 && minor < 20) )); then
    die "Docker Compose $version is too old: 2.20 or newer is needed (several --env-file, depends_on conditions)."
  fi
  echo "    Docker Compose $version"

  if [[ ! -d "$DEPLOY_DIR" ]]; then
    if [[ -d "$DEPLOY_ROOT" && -w "$DEPLOY_ROOT" ]]; then
      install -d -m 750 "$DEPLOY_DIR"
      echo "    created $DEPLOY_DIR"
    else
      local why="does not exist"
      [[ -d "$DEPLOY_ROOT" ]] && why="is not writable by $(id -un)"
      # Only root can create or open up $DEPLOY_ROOT: a one-time step per VPS,
      # after which every project's pipeline creates its own directory.
      die "$DEPLOY_DIR does not exist, and $DEPLOY_ROOT $why, so the pipeline cannot create it." \
        "One-time server setup, shared by every project on this VPS (docs/DEPLOYMENT.md, 'Deployment directory'):" \
        "  sudo install -d -o root -g $(id -gn) -m 1775 $DEPLOY_ROOT" \
        "Then rebuild. The first run in the new directory stops for the first-deployment approval" \
        "(docs/DEPLOYMENT.md, 'First deployment'); you can write it before rebuilding."
    fi
  fi
  [[ -w "$DEPLOY_DIR" ]] || die "$DEPLOY_DIR is not writable by $(id -un)." \
    "sudo chown -R jenkins:jenkins $DEPLOY_DIR && sudo chmod 750 $DEPLOY_DIR"

  local legacy
  legacy="$(legacy_containers)"

  if [[ -f "$ACTIVATED_FILE" ]]; then
    [[ -z "$legacy" ]] || die "Compose project '$PROJECT_NAME' also has containers running from another directory:" \
      "$legacy" "Stop that stack before deploying (its volume is shared): docker compose -p $PROJECT_NAME -f <that dir>/docker-compose.yml stop"
    echo "    activated deployment; preflight passed"
    return 0
  fi

  # ---- First deployment under /srv/deployments: needs the operator's approval.
  local mode volume_project
  mode="$(approval)"
  volume_project=""
  if docker volume inspect "$VOLUME_NAME" >/dev/null 2>&1; then
    volume_project="$(docker volume inspect -f '{{index .Labels "com.docker.compose.project"}}' "$VOLUME_NAME")"
    [[ "$volume_project" == "$PROJECT_NAME" ]] || die "volume $VOLUME_NAME exists but belongs to '${volume_project:-no compose project}'." \
      "It is not this project's database. Resolve the name conflict before deploying; do not delete data blindly."
  fi

  local instructions=(
    "This is the first deployment to $DEPLOY_DIR. Follow docs/DEPLOYMENT.md, 'First deployment', then approve it:"
    "  new installation:      echo new | sudo -u jenkins tee $APPROVAL_FILE"
    "  take over the stack deployed by the old Jenkinsfile (keeps its database):"
    "                         echo adopt-legacy | sudo -u jenkins tee $APPROVAL_FILE"
  )

  case "$mode" in
    new)
      [[ -z "$legacy" ]] || die "approval says 'new', but Compose project '$PROJECT_NAME' is already running:" "$legacy" \
        "Use 'adopt-legacy' to take it over with its database, or stop it first."
      if [[ -n "$volume_project" && ! -f "$DEPLOYMENT_ENV" ]]; then
        die "approval says 'new', but database volume $VOLUME_NAME already exists (it may hold data)." \
          "Use 'adopt-legacy' to keep using it."
      fi
      echo "    first deployment approved: new installation"
      ;;
    adopt-legacy)
      [[ -n "$legacy" || -n "$volume_project" ]] || die "approval says 'adopt-legacy', but there is no existing stack or volume to adopt." \
        "Use 'new' instead."
      echo "    first deployment approved: adopting the existing stack and volume $VOLUME_NAME"
      [[ -n "$legacy" ]] && { echo "    existing containers:"; echo "$legacy" | sed 's/^/      /'; }
      ;;
    "")
      die "first deployment is not approved." "${instructions[@]}"
      ;;
    *)
      die "unknown approval '$mode' in $APPROVAL_FILE." "${instructions[@]}"
      ;;
  esac
}

# ---------------------------------------------------------------------------
cmd_env_install() {
  local source="${1:?env-install needs the credential file}" tmp
  lock
  if [[ -f "$ENV_FILE" && "${SYNC_ENV_FROM_CREDENTIAL:-false}" != "true" ]]; then
    info "$ENV_FILE exists; leaving it unchanged."
    return 0
  fi
  if [[ -f "$ENV_FILE" ]]; then
    install -d -m 700 "$RELEASES_DIR/env-backups"
    local backup
    backup="$RELEASES_DIR/env-backups/.env.$(date -u +%Y%m%dT%H%M%SZ)"
    install -m 600 "$ENV_FILE" "$backup"
    info "SYNC_ENV_FROM_CREDENTIAL: previous .env saved as $backup"
  fi
  tmp="$(mktemp "$DEPLOY_DIR/.env.XXXXXX")"
  tr -d '\r' < "$source" > "$tmp"
  chmod 600 "$tmp"
  mv "$tmp" "$ENV_FILE"
  info "Installed $ENV_FILE from the Jenkins credential ($(grep -cE '^[A-Za-z_][A-Za-z0-9_]*=' "$ENV_FILE") variables)."
}

validate_env() {
  [[ -f "$ENV_FILE" ]] || die "$ENV_FILE does not exist." \
    "Create it from .env.example (mode 600, owner jenkins), or add the Jenkins credential 'avernek-expense-tracker-env'."
  chmod 600 "$ENV_FILE" 2>/dev/null || warn "cannot chmod $ENV_FILE: make it owned by jenkins with mode 600."
  [[ -r "$ENV_FILE" ]] || die "$ENV_FILE is not readable by $(id -un)." "sudo chown jenkins:jenkins $ENV_FILE && sudo chmod 600 $ENV_FILE"

  local key missing=()
  for key in "${REQUIRED_KEYS[@]}"; do
    [[ -n "$(env_value "$ENV_FILE" "$key")" ]] || missing+=("$key")
  done
  [[ ${#missing[@]} -eq 0 ]] || die "missing or empty in $ENV_FILE: ${missing[*]}" \
    "Edit it on the server (values are never printed by the pipeline)."

  local port admin_password secret url
  port="$(env_value "$ENV_FILE" APP_PORT)"
  [[ "$port" =~ ^[0-9]+$ ]] && (( port >= 1024 && port <= 65535 )) \
    || die "APP_PORT must be a port number between 1024 and 65535."
  admin_password="$(env_value "$ENV_FILE" ADMIN_PASSWORD)"
  (( ${#admin_password} >= 10 )) || die "ADMIN_PASSWORD must be at least 10 characters (seed-admin.mjs refuses shorter)."
  secret="$(env_value "$ENV_FILE" SESSION_SECRET)"
  (( ${#secret} >= 32 )) || warn "SESSION_SECRET is shorter than 32 characters."
  url="$(env_value "$ENV_FILE" DATABASE_URL)"
  [[ "$url" == *"@db:"* || "$url" == *"@db/"* ]] || warn "DATABASE_URL does not point at host 'db', the bundled Postgres."
  echo "    .env: all required variables present"
}

check_port() {
  local port others listening ours
  port="$(env_value "$ENV_FILE" APP_PORT)"
  others="$(docker ps --filter "publish=${port}" \
    --format '{{.Label "com.docker.compose.project"}} {{.Names}}' | awk -v p="$PROJECT_NAME" '$1 != p')"
  [[ -z "$others" ]] || die "host port $port is published by another container:" "$others" \
    "Choose an unused APP_PORT in $ENV_FILE."
  listening="$(ss -ltnH "( sport = :${port} )" 2>/dev/null || true)"
  if [[ -n "$listening" ]]; then
    ours="$(docker ps -q --filter "publish=${port}" --filter "label=com.docker.compose.project=${PROJECT_NAME}")"
    [[ -n "$ours" ]] || die "host port $port is in use by a process outside Docker." \
      "Check with: sudo ss -ltnp 'sport = :$port'  and choose another APP_PORT."
  fi
  echo "    port $port: free or used by this project only"
}

snapshot_into() {
  local dest="$1" tmp="$1.tmp"
  rm -rf "$tmp"
  install -d -m 750 "$tmp/bin"
  install -m 640 "$DEPLOY_DIR/compose.yaml" "$tmp/compose.yaml"
  install -m 640 "$DEPLOYMENT_ENV" "$tmp/.deployment.env"
  [[ -f "$DEPLOY_DIR/bin/fx-cron.sh" ]] && install -m 750 "$DEPLOY_DIR/bin/fx-cron.sh" "$tmp/bin/fx-cron.sh"
  rm -rf "$dest"
  mv "$tmp" "$dest"
}

write_deployment_env() {
  local target="$1" image="$2" note="${3:-}" tmp
  tmp="$(mktemp "$DEPLOY_DIR/.deployment.env.XXXXXX")"
  {
    echo "# Written by the Jenkins pipeline. The image this deployment runs."
    echo "APP_IMAGE=$image"
    echo "GIT_COMMIT=${GIT_COMMIT:-unknown}"
    echo "BUILD_NUMBER=${BUILD_NUMBER:-unknown}"
    echo "SOURCE_BRANCH=${SOURCE_BRANCH:-unknown}"
    echo "DEPLOYED_AT=$(date -u +%Y-%m-%dT%H:%M:%SZ)"
    [[ -n "$note" ]] && echo "NOTE=$note"
  } > "$tmp"
  chmod 640 "$tmp"
  mv "$tmp" "$target"
}

cmd_prepare() {
  : "${APP_IMAGE:?APP_IMAGE is not set}"
  lock
  info "Preparing $APP_IMAGE"
  docker image inspect "$APP_IMAGE" >/dev/null 2>&1 || die "image $APP_IMAGE was not built on this host."
  validate_env
  check_port
  install -d -m 750 "$RELEASES_DIR" "$DEPLOY_DIR/bin"
  install -d -m 700 "$DEPLOY_DIR/backups"

  # The rollback target: the verified release now in service.
  if [[ -d "$RELEASES_DIR/verified" ]]; then
    echo "    rollback target: $(env_value "$RELEASES_DIR/verified/.deployment.env" APP_IMAGE)"
  elif [[ "$(approval)" == "adopt-legacy" ]]; then
    # Taking over the old deployment: its running image becomes the rollback
    # target, run with this compose file (same .env, port, volume and service names).
    local legacy_image
    legacy_image="$(legacy_containers | awk '$3 == "web" {print $4; exit}')"
    if [[ -n "$legacy_image" ]] && docker image inspect "$legacy_image" >/dev/null 2>&1; then
      install -d -m 750 "$RELEASES_DIR/verified.tmp/bin"
      install -m 640 "$REPO_ROOT/compose.yaml" "$RELEASES_DIR/verified.tmp/compose.yaml"
      install -m 750 "$REPO_ROOT/docker/fx-cron.sh" "$RELEASES_DIR/verified.tmp/bin/fx-cron.sh"
      write_deployment_env "$RELEASES_DIR/verified.tmp/.deployment.env" "$legacy_image" "adopted-from-legacy-jenkins-deployment"
      mv "$RELEASES_DIR/verified.tmp" "$RELEASES_DIR/verified"
      echo "    rollback target: $legacy_image (the old deployment's image)"
    else
      warn "no image of the old deployment found: this deployment has no rollback target."
    fi
  else
    echo "    no verified release yet: a failure cannot be rolled back (first deployment)"
  fi

  printf 'build %s, image %s, started %s\n' "${BUILD_NUMBER:-?}" "$APP_IMAGE" "$(date -u +%FT%TZ)" > "$IN_PROGRESS"

  install -m 640 "$REPO_ROOT/compose.yaml" "$DEPLOY_DIR/compose.yaml"
  install -m 750 "$REPO_ROOT/docker/fx-cron.sh" "$DEPLOY_DIR/bin/fx-cron.sh"
  install -m 750 "$REPO_ROOT/scripts/healthcheck.sh" "$DEPLOY_DIR/bin/healthcheck.sh"
  install -m 750 "$REPO_ROOT/scripts/deploy-control.sh" "$DEPLOY_DIR/deploy-control.sh"
  write_deployment_env "$DEPLOYMENT_ENV" "$APP_IMAGE"

  # Interpolation and schema check with the real files; -q prints no values.
  dc config -q || die "compose.yaml does not validate with $ENV_FILE and $DEPLOYMENT_ENV."
  echo "    installed compose.yaml, bin/, deploy-control.sh and .deployment.env"
}

# ---------------------------------------------------------------------------
wait_healthy() {
  local service="$1" tries="${2:-60}" id health i
  for ((i = 1; i <= tries; i++)); do
    id="$(dc ps -q "$service" | head -n 1)"
    if [[ -n "$id" ]]; then
      health="$(docker inspect -f '{{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}}' "$id")"
      [[ "$health" == "healthy" ]] && { echo "    $service healthy"; return 0; }
    fi
    sleep 2
  done
  dc logs --tail 40 "$service" >&2 || true
  die "$service did not become healthy."
}

psql_db() {
  dc exec -T db psql -v ON_ERROR_STOP=1 -X -q \
    -U "$(env_value "$ENV_FILE" POSTGRES_USER)" -d "$(env_value "$ENV_FILE" POSTGRES_DB)" "$@"
}

migrate() {
  info "Database schema and migrations"
  psql_db < "$REPO_ROOT/db/schema.sql"
  psql_db -c "create table if not exists public.schema_migrations (filename text primary key, applied_at timestamptz not null default now());"
  local file name applied
  for file in "$REPO_ROOT"/db/migrations/*.sql; do
    [[ -e "$file" ]] || continue
    name="$(basename "$file")"
    [[ "$name" =~ ^[A-Za-z0-9_.-]+$ ]] || die "unexpected migration file name: $name"
    applied="$(psql_db -tA -c "select 1 from public.schema_migrations where filename = '$name'" | tr -d '[:space:]')"
    if [[ -n "$applied" ]]; then
      echo "    already applied: $name"
      continue
    fi
    echo "    applying:        $name"
    # One transaction per file, recorded in the same transaction.
    { cat "$file"; printf "\ninsert into public.schema_migrations (filename) values ('%s');\n" "$name"; } \
      | psql_db --single-transaction
  done
}

cmd_deploy() {
  lock
  info "Deploying $(env_value "$DEPLOYMENT_ENV" APP_IMAGE)"
  # The database container is only recreated if its own definition changed.
  dc up -d db
  wait_healthy db

  local has_schema
  has_schema="$(psql_db -tA -c "select to_regclass('public.users') is not null" | tr -d '[:space:]')"
  if [[ "$has_schema" == "t" ]]; then
    info "Backing up the database before migrations"
    bash "$DEPLOY_DIR/deploy-control.sh" backup "pre-deploy-b${BUILD_NUMBER:-manual}"
  else
    echo "    empty database: no backup needed before initialisation"
  fi

  migrate

  info "Starting the application"
  # fx-cron waits for web to be healthy (depends_on), so this returns once the
  # new release answers its container health check, or fails.
  dc up -d --remove-orphans
  dc ps

  info "Administrator account"
  dc exec -T web node scripts/seed-admin.mjs
}

cmd_verify() {
  bash "$DEPLOY_DIR/bin/healthcheck.sh"   # DEPLOY_DIR is exported above
}

cmd_finalize() {
  lock
  local new="$RELEASES_DIR/.new"
  snapshot_into "$new"
  if [[ -d "$RELEASES_DIR/verified" ]]; then
    rm -rf "$RELEASES_DIR/prior"
    mv "$RELEASES_DIR/verified" "$RELEASES_DIR/prior"
  fi
  mv "$new" "$RELEASES_DIR/verified"
  rm -f "$IN_PROGRESS"
  if [[ ! -f "$ACTIVATED_FILE" ]]; then
    printf 'activated %s by build %s (%s)\n' "$(date -u +%FT%TZ)" "${BUILD_NUMBER:-?}" "$(approval)" > "$ACTIVATED_FILE"
    [[ -f "$APPROVAL_FILE" ]] && mv "$APPROVAL_FILE" "$APPROVAL_FILE.used"
    info "First deployment activated."
  fi
  info "Release verified: $(env_value "$DEPLOYMENT_ENV" APP_IMAGE)"
}

cmd_rollback() {
  if [[ ! -f "$IN_PROGRESS" ]]; then
    echo "Deployment had not started changing the server; nothing to roll back."
    return 4
  fi
  if [[ ! -d "$RELEASES_DIR/verified" ]]; then
    rm -f "$IN_PROGRESS"
    echo "No verified release exists (first deployment): nothing to restore."
    echo "The failed release is left in place for inspection: $DEPLOY_DIR/deploy-control.sh status"
    return 3
  fi
  info "Rolling back to $(env_value "$RELEASES_DIR/verified/.deployment.env" APP_IMAGE)"
  if HEALTHCHECK_SCRIPT="$REPO_ROOT/scripts/healthcheck.sh" \
       bash "$REPO_ROOT/scripts/deploy-control.sh" restore-verified; then
    rm -f "$IN_PROGRESS"
    info "Rollback restored and verified."
    return 0
  fi
  rm -f "$IN_PROGRESS"
  echo "Rollback FAILED. Inspect on the server: $DEPLOY_DIR/deploy-control.sh status / logs web" >&2
  return 1
}

cmd_retain_images() {
  local keep="$KEEP_RELEASE_IMAGES" protected=() ref count=0 file
  for file in "$DEPLOYMENT_ENV" "$RELEASES_DIR/verified/.deployment.env" "$RELEASES_DIR/prior/.deployment.env"; do
    [[ -f "$file" ]] && protected+=("$(env_value "$file" APP_IMAGE)")
  done
  [[ -n "${APP_IMAGE:-}" ]] && protected+=("$APP_IMAGE")

  info "Keeping the newest $keep release images of $IMAGE_REPO, plus every rollback image"
  # Newest first. Only tags this pipeline creates (<sha>-<build>) are considered.
  while read -r ref; do
    [[ -n "$ref" ]] || continue
    count=$((count + 1))
    if (( count <= keep )) || [[ " ${protected[*]} " == *" $ref "* ]]; then
      echo "    keep   $ref"
      continue
    fi
    echo "    remove $ref"
    docker image rm "$ref" >/dev/null || warn "could not remove $ref (in use?)"
  done < <(docker images "$IMAGE_REPO" --format '{{.Repository}}:{{.Tag}}' | grep -E ":[0-9a-f]{7,40}-[0-9]+$" || true)
  echo "    Build cache is not pruned here: the central maintenance job does it (docs/DEPLOYMENT.md)."
}

cmd_diagnostics() {
  local out="${1:?diagnostics needs an output directory}"
  mkdir -p "$out"
  [[ -f "$DEPLOY_DIR/compose.yaml" && -r "$ENV_FILE" && -f "$DEPLOYMENT_ENV" ]] || { echo "no deployment files to inspect"; return 0; }
  dc ps --all > "$out/compose-ps.txt" 2>&1 || true
  local service id
  for service in web db fx-cron; do
    dc logs --tail 300 --no-color --timestamps "$service" > "$out/logs-$service.txt" 2>&1 || true
    id="$(dc ps -aq "$service" 2>/dev/null | head -n 1)"
    [[ -n "$id" ]] && docker inspect -f '{{json .State}}' "$id" > "$out/state-$service.json" 2>&1 || true
  done
  grep -v '^#' "$DEPLOYMENT_ENV" > "$out/deployment.env.txt" 2>/dev/null || true
  echo "Diagnostics written to $out"
}

command="${1:-}"
shift || true
case "$command" in
  preflight) cmd_preflight ;;
  env-install) cmd_env_install "$@" ;;
  prepare) cmd_prepare ;;
  deploy) cmd_deploy ;;
  verify) cmd_verify ;;
  finalize) cmd_finalize ;;
  rollback) cmd_rollback ;;
  retain-images) cmd_retain_images ;;
  diagnostics) cmd_diagnostics "$@" ;;
  *) echo "usage: release.sh preflight|env-install <file>|prepare|deploy|verify|finalize|rollback|retain-images|diagnostics <dir>" >&2; exit 2 ;;
esac
