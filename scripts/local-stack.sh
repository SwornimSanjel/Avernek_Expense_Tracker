#!/usr/bin/env bash
#
# local-stack.sh: run the production stack on a developer machine, exactly as
# the pipeline deploys it: the same image build, compose.yaml, migrations,
# administrator seed and health checks, from a git-ignored .local-deploy/.
#
#   bash scripts/local-stack.sh up [--no-build]   build, migrate, start and verify
#   bash scripts/local-stack.sh down              stop the containers (the database is kept)
#   bash scripts/local-stack.sh status
#   bash scripts/local-stack.sh logs [web|db|fx-cron]
#
# A bare `docker compose up` cannot work in this repository: compose.yaml only
# runs prebuilt images, named in a .deployment.env that the pipeline writes.
#
# Needs Docker with Compose v2 and buildx (the Dockerfile uses BuildKit), and a
# filled-in .env in the repository root (cp .env.example .env). That .env is
# copied in on every `up`, so edits to it apply on the next `up`.
set -Eeuo pipefail

REPO="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
export PROJECT_NAME=avernek-expense-tracker
export DEPLOY_ROOT="$REPO/.local-deploy"
export DEPLOY_DIR="$DEPLOY_ROOT/$PROJECT_NAME"
export APP_IMAGE="${LOCAL_IMAGE:-avernek-expense-tracker:local}"
export BUILD_NUMBER=local
export SOURCE_BRANCH="$(git -C "$REPO" rev-parse --abbrev-ref HEAD 2>/dev/null || echo local)"
export GIT_COMMIT="$(git -C "$REPO" rev-parse HEAD 2>/dev/null || echo unknown)"

release() { bash "$REPO/scripts/ci/release.sh" "$@"; }
control() {
  [[ -x "$DEPLOY_DIR/deploy-control.sh" ]] || { echo "Nothing is deployed locally yet: run  bash scripts/local-stack.sh up" >&2; exit 1; }
  bash "$DEPLOY_DIR/deploy-control.sh" "$@"
}

cmd_up() {
  [[ -f "$REPO/.env" ]] || { echo "ERROR: no .env in $REPO. Create it: cp .env.example .env, then fill it in." >&2; exit 1; }
  if [[ "${1:-}" != "--no-build" ]]; then
    if ! docker buildx version >/dev/null 2>&1; then
      echo "ERROR: docker buildx is not installed; the Dockerfile needs BuildKit." >&2
      echo "       Arch/CachyOS: sudo pacman -S docker-buildx    Ubuntu/Debian: sudo apt-get install docker-buildx-plugin" >&2
      exit 1
    fi
    install -d -m 750 "$DEPLOY_ROOT"
    (cd "$REPO" && DOCKER_BUILD_LOCK="$DEPLOY_ROOT/.build.lock" bash scripts/ci/build.sh runner "$APP_IMAGE")
  fi
  install -d -m 750 "$DEPLOY_ROOT"
  release preflight
  install -m 600 "$REPO/.env" "$DEPLOY_DIR/.env"
  release prepare
  release deploy
  release verify
  release finalize
  local port
  port="$(grep -E '^APP_PORT=' "$DEPLOY_DIR/.env" | tail -n 1 | cut -d= -f2)"
  echo
  echo "Running at http://127.0.0.1:${port} (sign in with ADMIN_EMAIL / ADMIN_PASSWORD from .env)."
}

case "${1:-}" in
  up) shift; cmd_up "$@" ;;
  down) control stop ;;
  status) control status ;;
  logs) shift; control logs "$@" ;;
  *) sed -n '3,19p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'; exit 2 ;;
esac
