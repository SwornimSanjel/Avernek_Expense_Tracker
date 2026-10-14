#!/usr/bin/env bash
#
# deploy-control.sh: manage the Avernek Expense Tracker on the server, without
# the source code. Installed by Jenkins at the root of the deployment directory:
#
#   cd /srv/deployments/avernek-expense-tracker
#   ./deploy-control.sh status
#
# Commands
#   status               containers, health and the deployed release
#   logs [service] [-f]  recent logs (web, db, fx-cron); -f to follow
#   start                start the stack (creates missing containers, recreates nothing)
#   stop                 stop the containers (data and volumes are kept)
#   restart [service]    restart containers in place
#   recreate [service]   recreate web and fx-cron (picks up .env changes);
#                        `recreate db` recreates the database container (data kept)
#   health               run the post-deployment health checks
#   backup [label]       pg_dump the database into backups/ (custom format)
#   rollback             go back to the verified release before the current one
#   images               this project's images, and which ones rollback needs
#
# It always uses this project's Compose name, compose.yaml and both env files
# (.env, .deployment.env), so plain `docker compose` invocations are not needed.
# It never removes volumes and never runs `down -v`.
#
# Run it as the jenkins user (it owns .env), or as root:
#   sudo -u jenkins ./deploy-control.sh status

set -Eeuo pipefail

PROJECT_NAME="avernek-expense-tracker"
SELF_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEPLOY_DIR="${DEPLOY_DIR:-$SELF_DIR}"
COMPOSE_FILE="$DEPLOY_DIR/compose.yaml"
ENV_FILE="$DEPLOY_DIR/.env"
DEPLOYMENT_ENV="$DEPLOY_DIR/.deployment.env"
RELEASES_DIR="$DEPLOY_DIR/releases"
BACKUP_DIR="${BACKUP_DIR:-$DEPLOY_DIR/backups}"
BACKUP_KEEP="${BACKUP_KEEP:-14}"
LOCK_FILE="$DEPLOY_DIR/.deploy.lock"
IN_PROGRESS="$DEPLOY_DIR/.deploy-in-progress"
APP_SERVICES=(web fx-cron)

die() { echo "ERROR: $*" >&2; exit 1; }
info() { echo "==> $*"; }

HEALTHCHECK_SCRIPT="${HEALTHCHECK_SCRIPT:-$DEPLOY_DIR/bin/healthcheck.sh}"

[[ -r "$ENV_FILE" ]] || die "$ENV_FILE is missing or not readable. Run as the jenkins user or root."
# restore-verified installs these itself; every other command needs them.
if [[ "${1:-}" != "restore-verified" && "${1:-help}" != "help" ]]; then
  [[ -f "$COMPOSE_FILE" ]] || die "no compose.yaml in $DEPLOY_DIR (set DEPLOY_DIR, or run this from the deployment directory)."
  [[ -r "$DEPLOYMENT_ENV" ]] || die "$DEPLOYMENT_ENV is missing: nothing has been deployed here yet."
fi

dc() {
  # Variables in the shell environment would override the env files (Jenkins
  # exports APP_IMAGE, for one): only the files decide what is deployed.
  env -u APP_IMAGE -u APP_PORT -u POSTGRES_USER -u POSTGRES_PASSWORD -u POSTGRES_DB \
    -u CRON_SECRET -u FX_CRON_SCHEDULE \
  docker compose \
    --project-name "$PROJECT_NAME" \
    --project-directory "$DEPLOY_DIR" \
    -f "$COMPOSE_FILE" \
    --env-file "$ENV_FILE" \
    --env-file "$DEPLOYMENT_ENV" \
    "$@"
}

# A value from an env file without sourcing it (values may hold shell syntax).
env_value() {
  local file="$1" key="$2" line
  line="$(grep -E "^${key}=" "$file" 2>/dev/null | tail -n 1 || true)"
  line="${line#*=}"
  line="${line%$'\r'}"
  if [[ "$line" =~ ^\'(.*)\'$ || "$line" =~ ^\"(.*)\"$ ]]; then line="${BASH_REMATCH[1]}"; fi
  printf '%s' "$line"
}

# Mutating commands take the deployment lock and refuse while the pipeline is
# deploying. The pipeline sets DEPLOY_LOCK_HELD=1 when it calls this script.
take_lock() {
  [[ "${DEPLOY_LOCK_HELD:-0}" == "1" ]] && return 0
  if [[ -e "$IN_PROGRESS" ]]; then
    die "a Jenkins deployment is in progress ($(cat "$IN_PROGRESS" 2>/dev/null)).
If no build is running, the marker is stale: remove $IN_PROGRESS and retry."
  fi
  exec 8>>"$LOCK_FILE"
  flock -n 8 || die "another deploy-control or pipeline step holds $LOCK_FILE. Try again shortly."
}

release_image() {
  local dir="$1"
  [[ -f "$dir/.deployment.env" ]] && env_value "$dir/.deployment.env" APP_IMAGE
}

cmd_status() {
  echo "Project:   $PROJECT_NAME"
  echo "Directory: $DEPLOY_DIR"
  echo "Deployed:  $(env_value "$DEPLOYMENT_ENV" APP_IMAGE) (commit $(env_value "$DEPLOYMENT_ENV" GIT_COMMIT | cut -c1-12), build $(env_value "$DEPLOYMENT_ENV" BUILD_NUMBER), at $(env_value "$DEPLOYMENT_ENV" DEPLOYED_AT))"
  echo "Verified:  $(release_image "$RELEASES_DIR/verified" || true)"
  echo "Previous:  $(release_image "$RELEASES_DIR/prior" || echo 'none')"
  [[ -e "$IN_PROGRESS" ]] && echo "NOTE: deployment in progress: $(cat "$IN_PROGRESS")"
  echo
  dc ps --all
}

cmd_logs() {
  local follow=() services=()
  for arg in "$@"; do
    case "$arg" in
      -f|--follow) follow=(--follow) ;;
      *) services+=("$arg") ;;
    esac
  done
  dc logs --tail "${LOG_LINES:-200}" --timestamps "${follow[@]}" "${services[@]}"
}

cmd_start() { take_lock; info "Starting"; dc up -d --no-recreate; dc ps; }
cmd_stop() { take_lock; info "Stopping (volumes and data are kept)"; dc stop; }

cmd_restart() {
  take_lock
  info "Restarting ${*:-all services}"
  dc restart "$@"
  dc ps
}

cmd_recreate() {
  take_lock
  local services=("$@")
  [[ ${#services[@]} -gt 0 ]] || services=("${APP_SERVICES[@]}")
  info "Recreating ${services[*]} (the database volume is kept)"
  dc up -d --force-recreate --no-deps "${services[@]}"
  dc ps
}

cmd_health() { DEPLOY_DIR="$DEPLOY_DIR" bash "$HEALTHCHECK_SCRIPT"; }

cmd_backup() {
  take_lock
  local label="${1:-manual}" user db stamp target objects
  user="$(env_value "$ENV_FILE" POSTGRES_USER)"
  db="$(env_value "$ENV_FILE" POSTGRES_DB)"
  [[ -n "$user" && -n "$db" ]] || die "POSTGRES_USER and POSTGRES_DB must be set in .env."
  [[ -n "$(dc ps -q db 2>/dev/null)" ]] || die "the db container is not running. Start it: ./deploy-control.sh start"

  install -d -m 700 "$BACKUP_DIR"
  stamp="$(date -u +%Y%m%d-%H%M%SZ)"
  target="$BACKUP_DIR/${PROJECT_NAME}-${stamp}-${label//[^A-Za-z0-9_-]/}.dump"
  info "Dumping the database to $target"

  # Written to .partial first, so an interrupted dump is never mistaken for a backup.
  if ! dc exec -T db pg_dump --username "$user" --dbname "$db" --format=custom --compress=6 > "$target.partial"; then
    rm -f "$target.partial"
    die "pg_dump failed."
  fi
  mv "$target.partial" "$target"
  chmod 600 "$target"

  # Size alone proves little: have pg_restore parse it and count the objects.
  objects="$(dc exec -T db pg_restore --list < "$target" 2>/dev/null | grep -cE '^[0-9]+;' || true)"
  if [[ "${objects:-0}" -lt 1 ]]; then
    die "$target contains no restorable objects; treat this backup as failed."
  fi
  info "Backup written: $(du -h "$target" | cut -f1), ${objects} objects."

  # Retention: the newest $BACKUP_KEEP dumps.
  find "$BACKUP_DIR" -maxdepth 1 -name "${PROJECT_NAME}-*.dump" -printf '%T@ %p\n' \
    | sort -rn | tail -n "+$((BACKUP_KEEP + 1))" | cut -d' ' -f2- \
    | while read -r old; do [[ -n "$old" ]] && rm -f -- "$old" && echo "    pruned $(basename "$old")"; done
  echo "Copy backups off this server too: see docs/DEPLOYMENT.md, Backups."
}

# Install a saved release's configuration and bring the stack to it.
restore_release() {
  local dir="$1" image
  [[ -f "$dir/compose.yaml" && -f "$dir/.deployment.env" ]] || die "release snapshot $dir is incomplete."
  image="$(release_image "$dir")"
  [[ -n "$image" ]] || die "release snapshot $dir has no APP_IMAGE."
  docker image inspect "$image" >/dev/null 2>&1 || die "image $image is no longer on this host; cannot restore it."

  info "Restoring release $image"
  install -m 640 "$dir/compose.yaml" "$DEPLOY_DIR/compose.yaml"
  install -m 640 "$dir/.deployment.env" "$DEPLOY_DIR/.deployment.env"
  if [[ -f "$dir/bin/fx-cron.sh" ]]; then
    install -d -m 750 "$DEPLOY_DIR/bin"
    install -m 750 "$dir/bin/fx-cron.sh" "$DEPLOY_DIR/bin/fx-cron.sh"
  fi
  dc up -d --remove-orphans
}

cmd_rollback() {
  take_lock
  local prior="$RELEASES_DIR/prior" verified="$RELEASES_DIR/verified" swap="$RELEASES_DIR/.swap"
  [[ -d "$prior" ]] || die "there is no earlier verified release to roll back to."
  echo "Rolling back from $(release_image "$verified" || echo unknown) to $(release_image "$prior")."
  echo "The application rolls back; the database does not (migrations are not undone)."
  if [[ "${ASSUME_YES:-0}" != "1" ]]; then
    read -r -p "Continue? [y/N] " answer
    [[ "$answer" =~ ^[Yy]$ ]] || die "cancelled."
  fi

  restore_release "$prior"
  if ! cmd_health; then
    die "the restored release failed its health checks. Inspect: ./deploy-control.sh logs web"
  fi
  # The restored release is now the verified one; the one it replaced becomes
  # the rollback target, so running rollback again rolls forward.
  rm -rf "$swap"
  mv "$verified" "$swap" 2>/dev/null || true
  mv "$prior" "$verified"
  [[ -d "$swap" ]] && mv "$swap" "$prior"
  info "Rolled back to $(release_image "$verified")."
}

# Restore the verified release (used by the pipeline when a deployment fails).
cmd_restore_verified() {
  take_lock
  restore_release "$RELEASES_DIR/verified"
  cmd_health
}

cmd_images() {
  local current verified prior
  current="$(env_value "$DEPLOYMENT_ENV" APP_IMAGE)"
  verified="$(release_image "$RELEASES_DIR/verified" || true)"
  prior="$(release_image "$RELEASES_DIR/prior" || true)"
  docker images "$PROJECT_NAME" --format '{{.Repository}}:{{.Tag}}\t{{.CreatedSince}}\t{{.Size}}' \
    | while IFS=$'\t' read -r ref created size; do
        local mark=""
        [[ "$ref" == "$current" ]] && mark+=" [deployed]"
        [[ "$ref" == "$verified" ]] && mark+=" [verified]"
        [[ "$ref" == "$prior" ]] && mark+=" [rollback target]"
        printf '%-48s %-16s %-8s%s\n' "$ref" "$created" "$size" "$mark"
      done
}

usage() { sed -n '3,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; }

command="${1:-help}"
shift || true
case "$command" in
  status) cmd_status ;;
  logs) cmd_logs "$@" ;;
  start) cmd_start ;;
  stop) cmd_stop ;;
  restart) cmd_restart "$@" ;;
  recreate) cmd_recreate "$@" ;;
  health) cmd_health ;;
  backup) cmd_backup "$@" ;;
  rollback) cmd_rollback ;;
  restore-verified) cmd_restore_verified ;;
  images) cmd_images ;;
  help|-h|--help) usage ;;
  *) usage; die "unknown command: $command" ;;
esac
