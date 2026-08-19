#!/usr/bin/env bash
#
# Prove a backup can actually be restored — without touching production.
#
#   ./scripts/db-restore-drill.sh                 # drill the newest dump
#   ./scripts/db-restore-drill.sh /path/to.dump   # drill a specific one
#
# An untested backup is a guess. This restores the dump into a throwaway
# Postgres container, checks the data is really there, prints what it found,
# and destroys the container. Production is never opened for writing: the only
# thing this script reads from the live stack is a row count to compare against.
#
# Exit 0 = the dump is restorable and populated. Exit 1 = do not rely on it.
#
# Safe to run from cron. Safe to run during business hours.

set -Eeuo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/avernek-supabase}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avernek-supabase}"
COMPOSE_FILE="$SUPABASE_DIR/docker-compose.yml"

# Must match the image in docker-compose.yml, or the drill proves nothing about
# the environment you would actually restore into.
DRILL_IMAGE="${DRILL_IMAGE:-supabase/postgres:17.6.1.157-mmlb}"
DRILL_CONTAINER="avernek-restore-drill-$$"
DRILL_PASSWORD="drill-only-$(date +%s)"

DUMP="${1:-}"

# Tables that must come back with rows. `users` and `auth.users` are the pair
# that decides whether the restored system is usable or just structurally
# present -- an expenses table full of rows is worthless if nobody can log in.
EXPECT_NONEMPTY=(users expenses)

cleanup() {
  if docker ps -aq --filter "name=^${DRILL_CONTAINER}$" | grep -q .; then
    echo "Cleaning up drill container..."
    docker rm -f "$DRILL_CONTAINER" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT INT TERM

# ---------------------------------------------------------------------------
# Pick and sanity-check the dump
# ---------------------------------------------------------------------------
if [[ -z "$DUMP" ]]; then
  DUMP="$(
    find "$BACKUP_DIR" -maxdepth 1 -name 'avernek-*.dump' -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | head -n1 | cut -d' ' -f2-
  )"
fi

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "FAIL: no dump found in $BACKUP_DIR" >&2
  exit 1
fi

echo "============================================================"
echo "RESTORE DRILL"
echo "============================================================"
echo "Dump:  $DUMP"
echo "       $(du -h "$DUMP" | cut -f1), modified $(date -r "$DUMP" -u '+%Y-%m-%d %H:%M:%SZ')"

AGE_HOURS=$(( ( $(date +%s) - $(date -r "$DUMP" +%s) ) / 3600 ))
echo "       ${AGE_HOURS}h old"
if [[ "$AGE_HOURS" -gt 48 ]]; then
  echo "       NOTE: older than 48h — is the backup job still running?"
fi

if ! pg_restore --list "$DUMP" >/dev/null 2>&1; then
  echo "FAIL: not a readable custom-format dump — it is corrupt or truncated." >&2
  exit 1
fi
echo "       $(pg_restore --list "$DUMP" | grep -cE '^[0-9]') restorable objects"
echo

# ---------------------------------------------------------------------------
# Throwaway target. No volume: everything dies with the container.
# ---------------------------------------------------------------------------
echo "Starting throwaway Postgres ($DRILL_IMAGE)..."
docker run -d \
  --name "$DRILL_CONTAINER" \
  -e POSTGRES_PASSWORD="$DRILL_PASSWORD" \
  -e POSTGRES_DB=postgres \
  "$DRILL_IMAGE" >/dev/null

echo -n "Waiting for it to accept connections"
READY=0
for _ in $(seq 1 60); do
  if docker exec "$DRILL_CONTAINER" pg_isready -U postgres -h localhost >/dev/null 2>&1; then
    READY=1; echo " ok"; break
  fi
  echo -n "."
  sleep 2
done

if [[ "$READY" -ne 1 ]]; then
  echo
  echo "FAIL: drill container never became ready." >&2
  docker logs --tail 30 "$DRILL_CONTAINER" 2>&1 | sed 's/^/    /' >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Restore into it
# ---------------------------------------------------------------------------
echo "Restoring into the throwaway instance..."
RESTORE_LOG="${TMPDIR:-/tmp}/avernek-drill-$$.log"

set +e
docker exec -i "$DRILL_CONTAINER" pg_restore \
  --username postgres \
  --dbname postgres \
  --no-owner \
  --no-privileges \
  < "$DUMP" >"$RESTORE_LOG" 2>&1
RESTORE_RC=$?
set -e

drill_q() {
  docker exec "$DRILL_CONTAINER" psql -U postgres -d postgres -tAc "$1" 2>/dev/null | tr -d '[:space:]'
}

# ---------------------------------------------------------------------------
# The actual verdict: is the data there?
# ---------------------------------------------------------------------------
echo
echo "Restored contents:"
FAILURES=0

for table in users expenses expense_shares recurring recurring_shares settlements categories vendors fx_rates; do
  count="$(drill_q "select count(*) from public.${table}")"
  if [[ -z "$count" ]]; then
    printf '  %-18s MISSING\n' "$table"
    FAILURES=$((FAILURES + 1))
    continue
  fi
  printf '  %-18s %s rows\n' "$table" "$count"
  for required in "${EXPECT_NONEMPTY[@]}"; do
    if [[ "$table" == "$required" && "$count" == "0" ]]; then
      printf '  %-18s ^^ expected rows, found none\n' ""
      FAILURES=$((FAILURES + 1))
    fi
  done
done

AUTH_USERS="$(drill_q 'select count(*) from auth.users')"
if [[ -z "$AUTH_USERS" ]]; then
  echo "  auth.users         MISSING — restoring this would lock everyone out"
  FAILURES=$((FAILURES + 1))
else
  printf '  %-18s %s rows\n' "auth.users" "$AUTH_USERS"
  if [[ "$AUTH_USERS" == "0" ]]; then
    echo "                     ^^ no accounts: nobody could log in after a restore"
    FAILURES=$((FAILURES + 1))
  fi
fi

# RLS is the app's entire authorization model, so a dump that silently lost the
# policies would restore into a database where every user sees everything.
POLICIES="$(drill_q "select count(*) from pg_policies where schemaname = 'public'")"
printf '  %-18s %s policies\n' "RLS" "${POLICIES:-0}"
if [[ "${POLICIES:-0}" == "0" ]]; then
  echo "                     ^^ no RLS policies restored — authorization would be wide open"
  FAILURES=$((FAILURES + 1))
fi

# ---------------------------------------------------------------------------
# Compare against live, when the live stack is reachable
# ---------------------------------------------------------------------------
if [[ -f "$COMPOSE_FILE" ]]; then
  LIVE="$(
    docker compose -f "$COMPOSE_FILE" --project-directory "$SUPABASE_DIR" \
      exec -T db psql -U postgres -d postgres -tAc 'select count(*) from public.expenses' 2>/dev/null \
      | tr -d '[:space:]'
  )"
  RESTORED="$(drill_q 'select count(*) from public.expenses')"
  if [[ -n "$LIVE" && -n "$RESTORED" ]]; then
    echo
    echo "Drift check (expenses): live=$LIVE  backup=$RESTORED  delta=$((LIVE - RESTORED))"
    if [[ "$LIVE" -gt 0 && "$RESTORED" -eq 0 ]]; then
      echo "  ^^ live has data the backup does not. The backup is not usable."
      FAILURES=$((FAILURES + 1))
    fi
  fi
fi

echo
if [[ "$FAILURES" -gt 0 ]]; then
  echo "DRILL FAILED — $FAILURES problem(s). Do NOT rely on this backup."
  echo "pg_restore log: $RESTORE_LOG"
  exit 1
fi

if [[ "$RESTORE_RC" -ne 0 ]]; then
  echo "NOTE: pg_restore exited $RESTORE_RC, but every check above passed."
  echo "      Usually ownership/extension warnings. Log: $RESTORE_LOG"
fi

rm -f "$RESTORE_LOG"
echo "DRILL PASSED — this backup restores to a working, populated database."
