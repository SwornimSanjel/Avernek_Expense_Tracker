#!/usr/bin/env bash
#
# Restore the self-hosted Supabase database from a dump.
#
#   ./scripts/db-restore.sh                      # newest dump, with confirmation
#   ./scripts/db-restore.sh /path/to/x.dump      # a specific dump
#   ./scripts/db-restore.sh --yes                # skip the prompt (for automation)
#
# THIS OVERWRITES THE LIVE DATABASE. Expenses, users, sessions -- all of it is
# replaced by whatever is in the dump. The script therefore:
#
#   1. shows you what is about to be destroyed and what replaces it,
#   2. takes a safety dump of the current state first,
#   3. stops the services that hold connections, so the restore is not fighting
#      the app for locks,
#   4. only then restores.
#
# To check a dump WITHOUT touching production, use db-restore-drill.sh instead.

set -Eeuo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/avernek-supabase}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avernek-supabase}"
COMPOSE_FILE="$SUPABASE_DIR/docker-compose.yml"

ASSUME_YES=0
DUMP=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    --yes|-y) ASSUME_YES=1; shift ;;
    -h|--help) sed -n '2,20p' "$0"; exit 0 ;;
    *)         DUMP="$1"; shift ;;
  esac
done

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: no compose file at $COMPOSE_FILE" >&2
  exit 1
fi

dc() {
  docker compose -f "$COMPOSE_FILE" --project-directory "$SUPABASE_DIR" "$@"
}

psql_q() {
  dc exec -T db psql -U postgres -d postgres -tAc "$1" 2>/dev/null || echo "?"
}

# ---------------------------------------------------------------------------
# Pick the dump
# ---------------------------------------------------------------------------
if [[ -z "$DUMP" ]]; then
  DUMP="$(
    find "$BACKUP_DIR" -maxdepth 1 -name 'avernek-*.dump' -printf '%T@ %p\n' 2>/dev/null \
      | sort -rn | head -n1 | cut -d' ' -f2-
  )"
fi

if [[ -z "$DUMP" || ! -f "$DUMP" ]]; then
  echo "ERROR: no dump found. Looked in $BACKUP_DIR" >&2
  exit 1
fi

if ! pg_restore --list "$DUMP" >/dev/null 2>&1; then
  echo "ERROR: $DUMP is not a readable custom-format dump." >&2
  exit 1
fi

# ---------------------------------------------------------------------------
# Show both sides of the trade before doing anything irreversible
# ---------------------------------------------------------------------------
echo "============================================================"
echo "RESTORE — this REPLACES the live database"
echo "============================================================"
echo
echo "Dump:    $DUMP"
echo "         $(du -h "$DUMP" | cut -f1), modified $(date -r "$DUMP" -u '+%Y-%m-%d %H:%M:%SZ')"
echo "         $(pg_restore --list "$DUMP" | grep -cE '^[0-9]') restorable objects"
echo
echo "Live database RIGHT NOW (this is what you lose):"
if [[ -n "$(dc ps -q db 2>/dev/null)" ]]; then
  for table in users expenses expense_shares recurring settlements; do
    printf '         %-18s %s rows\n' "$table" "$(psql_q "select count(*) from public.${table}")"
  done
  printf '         %-18s %s rows\n' "auth.users" "$(psql_q 'select count(*) from auth.users')"
else
  echo "         (db container not running)"
fi
echo

if [[ "$ASSUME_YES" -ne 1 ]]; then
  read -r -p "Type RESTORE to proceed: " reply
  if [[ "$reply" != "RESTORE" ]]; then
    echo "Aborted. Nothing was changed."
    exit 1
  fi
fi

# ---------------------------------------------------------------------------
# Safety dump — the restore itself is the risky step, so capture the current
# state first. This has saved more databases than the backups have.
# ---------------------------------------------------------------------------
if [[ -n "$(dc ps -q db 2>/dev/null)" ]]; then
  SAFETY="$BACKUP_DIR/pre-restore-$(date -u +%Y%m%d-%H%M%SZ).dump"
  mkdir -p "$BACKUP_DIR"
  echo "Taking a safety dump first: $SAFETY"
  if dc exec -T db pg_dump -U postgres -d postgres -Fc -Z6 > "${SAFETY}.partial"; then
    mv "${SAFETY}.partial" "$SAFETY"
    chmod 600 "$SAFETY"
    echo "Safety dump written. If this restore is wrong, come back with:"
    echo "  $0 $SAFETY"
  else
    rm -f "${SAFETY}.partial"
    echo "WARNING: safety dump failed." >&2
    if [[ "$ASSUME_YES" -ne 1 ]]; then
      read -r -p "Continue anyway with no undo? [y/N] " ok
      [[ "$ok" == "y" ]] || { echo "Aborted."; exit 1; }
    fi
  fi
fi

# ---------------------------------------------------------------------------
# Quiesce everything that holds a connection, or pg_restore will deadlock
# against the app's open transactions.
# ---------------------------------------------------------------------------
echo "Stopping auth/rest/studio/meta while the restore runs..."
dc stop auth rest studio meta >/dev/null 2>&1 || true

dc up -d db >/dev/null
for _ in $(seq 1 30); do
  if dc exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 2
done

echo "Restoring..."

# --clean --if-exists drops existing objects first, so this is a replace and
# not a merge. Ordering errors across the auth/public boundary are normal
# during a clean restore, hence --exit-on-error is deliberately NOT set.
set +e
dc exec -T db pg_restore \
  --username postgres \
  --dbname postgres \
  --clean \
  --if-exists \
  --no-owner \
  --no-privileges \
  --verbose \
  < "$DUMP" 2>"${TMPDIR:-/tmp}/avernek-restore.log"
RESTORE_RC=$?
set -e

echo "Restarting services..."
dc up -d >/dev/null

for _ in $(seq 1 30); do
  if dc exec -T db pg_isready -U postgres -h localhost >/dev/null 2>&1; then break; fi
  sleep 2
done

# ---------------------------------------------------------------------------
# Verify rather than trust the exit code
# ---------------------------------------------------------------------------
echo
echo "Restored database:"
FAILED=0
for table in users expenses expense_shares recurring settlements; do
  count="$(psql_q "select count(*) from public.${table}")"
  printf '  %-18s %s rows\n' "$table" "$count"
  [[ "$count" == "?" ]] && FAILED=1
done
auth_users="$(psql_q 'select count(*) from auth.users')"
printf '  %-18s %s rows\n' "auth.users" "$auth_users"

echo
if [[ "$FAILED" -eq 1 ]]; then
  echo "FAILED: some tables are unreadable. See ${TMPDIR:-/tmp}/avernek-restore.log" >&2
  exit 1
fi

if [[ "$auth_users" == "0" ]]; then
  echo "WARNING: auth.users is empty — nobody can log in."
  echo "The dump may have covered only the public schema."
fi

if [[ "$RESTORE_RC" -ne 0 ]]; then
  echo "pg_restore exited $RESTORE_RC but the tables above are readable."
  echo "That is usually harmless drop-ordering noise. Full log:"
  echo "  ${TMPDIR:-/tmp}/avernek-restore.log"
fi

echo "Restore complete."
