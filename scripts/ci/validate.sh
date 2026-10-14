#!/usr/bin/env bash
#
# validate.sh: the pipeline's Validate stage. Checks the repository before
# anything is built or deployed; changes nothing.
#
#   - required files are present, and no .env with secrets is tracked by git
#   - every shell script parses
#   - the Dockerfile has the targets the pipeline builds
#   - compose.yaml validates (with placeholder values, never real secrets)
#   - .env.example documents every variable the deployment requires
#   - Docker and Compose are available to this user

set -Eeuo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/../.."
fail() { echo "VALIDATION FAILED: $*" >&2; exit 1; }
ok() { echo "  ok  $*"; }

required=(
  Dockerfile .dockerignore compose.yaml .env.example package.json package-lock.json
  docker/fx-cron.sh db/schema.sql scripts/seed-admin.mjs
  scripts/deploy-control.sh scripts/healthcheck.sh scripts/ci/build.sh scripts/ci/release.sh
)
for file in "${required[@]}"; do [[ -f "$file" ]] || fail "missing $file"; done
ok "required files present"

if git ls-files --error-unmatch .env >/dev/null 2>&1 || git ls-files | grep -qE '(^|/)\.env(\.local|\.production)?$'; then
  fail "a .env file is tracked by git: remove it from the repository (git rm --cached) and rotate its secrets"
fi
ok "no .env tracked by git"

for script in scripts/*.sh scripts/ci/*.sh; do bash -n "$script" || fail "$script does not parse"; done
sh -n docker/fx-cron.sh || fail "docker/fx-cron.sh does not parse"
ok "shell scripts parse"

for target in deps verify builder runner; do
  grep -qE "^FROM .+ AS ${target}\$" Dockerfile || fail "Dockerfile has no '${target}' stage"
done
grep -q '"typecheck"' package.json || fail "package.json has no typecheck script"
ok "Dockerfile stages: deps, verify, builder, runner"

keys=(APP_PORT DATABASE_URL POSTGRES_USER POSTGRES_PASSWORD POSTGRES_DB SESSION_SECRET ADMIN_EMAIL ADMIN_PASSWORD CRON_SECRET)
for key in "${keys[@]}"; do grep -qE "^${key}=" .env.example || fail ".env.example does not document $key"; done
ok ".env.example documents every required variable"

command -v docker >/dev/null || fail "docker is not installed for $(id -un)"
docker compose version >/dev/null 2>&1 || fail "the docker compose plugin is not installed"

# Compose syntax and interpolation, with placeholders in a scratch directory.
scratch="$(mktemp -d)"
trap 'rm -rf "$scratch"' EXIT
cat > "$scratch/.env" <<'EOF'
APP_PORT=3999
DATABASE_URL=postgres://placeholder:placeholder@db:5432/placeholder
POSTGRES_USER=placeholder
POSTGRES_PASSWORD=placeholder
POSTGRES_DB=placeholder
SESSION_SECRET=placeholder-placeholder-placeholder
ADMIN_EMAIL=placeholder@example.com
ADMIN_PASSWORD=placeholder
CRON_SECRET=placeholder
EOF
echo "APP_IMAGE=avernek-expense-tracker:validate" > "$scratch/.deployment.env"
cp compose.yaml "$scratch/compose.yaml"
env -u APP_IMAGE -u APP_PORT docker compose --project-name avernek-expense-tracker --project-directory "$scratch" \
  -f "$scratch/compose.yaml" --env-file "$scratch/.env" --env-file "$scratch/.deployment.env" config -q \
  || fail "compose.yaml does not validate"
ok "compose.yaml validates"

echo "Validation passed."
