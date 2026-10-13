#!/usr/bin/env bash
#
# docker-cache-maintenance.sh: the shared VPS's centralized Docker build-cache
# trim. Run it from ONE place (a dedicated Jenkins job or a systemd timer), not
# from each project's pipeline. See docs/DEPLOYMENT.md, "Build cache".
#
#   sudo /usr/local/sbin/docker-cache-maintenance.sh
#   MAX_USED_SPACE=8gb BUILDERS="default" ./docker-cache-maintenance.sh
#
# It takes the build-cache lock EXCLUSIVELY. Project builds (scripts/ci/build.sh)
# hold it SHARED, so this waits for running builds to finish and new builds
# wait for it. It only trims the BuildKit cache:
#
#   docker buildx prune --force --max-used-space 8gb
#
# It never touches images, containers, volumes or networks. Never replace it
# with `docker system prune -a --volumes`, `docker volume prune` or
# `docker compose down -v`.

set -Eeuo pipefail

MAX_USED_SPACE="${MAX_USED_SPACE:-8gb}"
BUILDERS="${BUILDERS:-default}"
LOCK_FILE="${DOCKER_BUILD_LOCK:-/run/lock/avernek-docker-build.lock}"
LOCK_WAIT="${DOCKER_BUILD_LOCK_WAIT:-3600}"

( umask 000; [[ -e "$LOCK_FILE" ]] || : > "$LOCK_FILE" ) 2>/dev/null || true
exec 9<"$LOCK_FILE"
echo "Waiting for running builds to finish (exclusive lock on $LOCK_FILE)"
flock -x -w "$LOCK_WAIT" 9 || { echo "ERROR: builds held the lock for ${LOCK_WAIT}s; try later." >&2; exit 1; }

# Newer Buildx: --max-used-space. Older Buildx: --keep-storage (same intent).
if docker buildx prune --help 2>/dev/null | grep -q -- '--max-used-space'; then
  limit_flag=(--max-used-space "$MAX_USED_SPACE")
else
  limit_flag=(--keep-storage "$MAX_USED_SPACE")
fi

for builder in $BUILDERS; do
  echo "== builder: $builder (limit $MAX_USED_SPACE)"
  docker buildx du --builder "$builder" 2>/dev/null | tail -n 3 || true
  docker buildx prune --builder "$builder" --force "${limit_flag[@]}"
  docker buildx du --builder "$builder" 2>/dev/null | tail -n 3 || true
done
