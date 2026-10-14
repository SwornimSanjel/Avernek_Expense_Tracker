#!/usr/bin/env bash
#
# build.sh <target> [image-ref]: build one stage of the Dockerfile for Jenkins.
#
#   deps     Install Dependencies       (npm ci)
#   verify   Lint / Type Check / Test   (tsc --noEmit, npm test if present)
#   builder  Application Build          (next build)
#   runner   Docker Image Build         (tagged with image-ref)
#
# Each target reuses the cached layers of the one before it, so dependencies
# are installed once and the app is built once per commit.
#
# Builds hold a SHARED lock on the host's build-cache lock file. The central
# cache-maintenance job (scripts/docker-cache-maintenance.sh) takes it
# EXCLUSIVELY, so cache pruning never runs in the middle of a build, while
# builds of different projects still run side by side.

set -Eeuo pipefail

TARGET="${1:?usage: build.sh <deps|verify|builder|runner> [image-ref]}"
IMAGE_REF="${2:-}"
LOCK_FILE="${DOCKER_BUILD_LOCK:-/run/lock/avernek-docker-build.lock}"
LOCK_WAIT="${DOCKER_BUILD_LOCK_WAIT:-1800}"

case "$TARGET" in
  deps|verify|builder) ;;
  runner) [[ -n "$IMAGE_REF" ]] || { echo "ERROR: the runner target needs an image reference." >&2; exit 1; } ;;
  *) echo "ERROR: unknown target $TARGET" >&2; exit 1 ;;
esac

# Shared lock: created world-writable so the root-run maintenance job and the
# jenkins user can both open it; opened read-only so either can lock it.
( umask 000; [[ -e "$LOCK_FILE" ]] || : > "$LOCK_FILE" ) 2>/dev/null || true
if exec 9<"$LOCK_FILE" 2>/dev/null; then
  if ! flock -s -w "$LOCK_WAIT" 9; then
    echo "ERROR: waited ${LOCK_WAIT}s for Docker build-cache maintenance to finish." >&2
    exit 1
  fi
else
  echo "WARNING: cannot open $LOCK_FILE; building without the cache-maintenance lock." >&2
fi

args=(
  --target "$TARGET"
  --progress plain
  --label "org.opencontainers.image.title=avernek-expense-tracker"
  --label "org.opencontainers.image.revision=${GIT_COMMIT:-unknown}"
  --label "org.opencontainers.image.version=${IMAGE_TAG:-local}"
  --label "org.opencontainers.image.source=${GIT_URL:-unknown}"
  --label "com.avernek.jenkins.build=${BUILD_NUMBER:-local}"
)
[[ -n "$IMAGE_REF" ]] && args+=(--tag "$IMAGE_REF")

echo "Building target '$TARGET'${IMAGE_REF:+ as $IMAGE_REF}"
DOCKER_BUILDKIT=1 docker build "${args[@]}" .

if [[ -n "$IMAGE_REF" ]]; then
  docker image inspect "$IMAGE_REF" --format 'Built {{index .RepoTags 0}}: {{.Size}} bytes, {{.Id}}'
fi
