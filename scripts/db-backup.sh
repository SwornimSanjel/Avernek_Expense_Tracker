#!/usr/bin/env bash
#
# Dump the self-hosted Supabase database.
#
#   ./scripts/db-backup.sh                  # write a new dump, prune old ones
#   BACKUP_DIR=/mnt/x ./scripts/db-backup.sh
#
# Dumps the whole `postgres` database, which means public (your expenses) AND
# auth (your users). Dumping only public would restore a database nobody can
# log in to.
#
# Custom format (-Fc): compressed, and pg_restore can filter it selectively,
# which db-restore.sh relies on.

set -Eeuo pipefail

SUPABASE_DIR="${SUPABASE_DIR:-/opt/avernek-supabase}"
BACKUP_DIR="${BACKUP_DIR:-/var/backups/avernek-supabase}"
KEEP="${KEEP:-14}"

COMPOSE_FILE="$SUPABASE_DIR/docker-compose.yml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "ERROR: no compose file at $COMPOSE_FILE" >&2
  echo "Set SUPABASE_DIR to where the stack lives." >&2
  exit 1
fi

dc() {
  docker compose -f "$COMPOSE_FILE" --project-directory "$SUPABASE_DIR" "$@"
}

if [[ -z "$(dc ps -q db 2>/dev/null)" ]]; then
  echo "ERROR: the db service is not running. Start it with:" >&2
  echo "  docker compose -f $COMPOSE_FILE up -d db" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
chmod 700 "$BACKUP_DIR"

STAMP="$(date -u +%Y%m%d-%H%M%SZ)"
TARGET="$BACKUP_DIR/avernek-${STAMP}.dump"

echo "Dumping to $TARGET"

# Write to .partial first: a dump interrupted halfway must never be mistaken
# for a usable backup by the restore or drill scripts.
if ! dc exec -T db pg_dump \
      --username postgres \
      --dbname postgres \
      --format=custom \
      --compress=6 \
      > "${TARGET}.partial"; then
  echo "ERROR: pg_dump failed; leaving ${TARGET}.partial for inspection." >&2
  exit 1
fi

mv "${TARGET}.partial" "$TARGET"
chmod 600 "$TARGET"

SIZE="$(du -h "$TARGET" | cut -f1)"

# A dump of an empty database still weighs a few KB, so size alone proves
# little. Ask pg_restore to parse it and count what is actually inside.
OBJECTS="$(pg_restore --list "$TARGET" 2>/dev/null | grep -cE '^[0-9]' || true)"

if [[ "${OBJECTS:-0}" -lt 1 ]]; then
  echo "ERROR: $TARGET contains no restorable objects. Treating as failed." >&2
  exit 1
fi

echo "Wrote $SIZE, $OBJECTS restorable objects."

# ---------------------------------------------------------------------------
# Retention
# ---------------------------------------------------------------------------
mapfile -t OLD < <(
  find "$BACKUP_DIR" -maxdepth 1 -name 'avernek-*.dump' -printf '%T@ %p\n' \
    | sort -rn \
    | tail -n "+$((KEEP + 1))" \
    | cut -d' ' -f2-
)

for file in "${OLD[@]:-}"; do
  [[ -n "$file" ]] || continue
  echo "Pruning $(basename "$file")"
  rm -f "$file"
done

REMAINING="$(find "$BACKUP_DIR" -maxdepth 1 -name 'avernek-*.dump' | wc -l)"
echo "Done. $REMAINING backup(s) retained in $BACKUP_DIR (keeping $KEEP)."
