#!/usr/bin/env bash
#
# Import Supabase CSV exports into the compose Postgres.
#
#   scripts/import-csvs.sh ~/csvs
#
# Reads each file's header row to build the column list, so the CSVs do not
# have to match the table's column order and may omit columns that have
# defaults. Loads in foreign-key order inside ONE transaction: if any row is
# rejected, nothing is written and the database is left exactly as it was.
#
# DESTRUCTIVE: every table listed below is truncated first, because the fresh
# database already contains the three seeded default participants whose ids
# collide with the exported ones. Run this before anyone enters real data.
#
# The users table is truncated too, which removes the administrator login
# (Supabase never had a password_hash column). The script prints the command to
# recreate it at the end.
set -Eeuo pipefail

CSV_DIR="${1:-.}"
CONTAINER="${PG_CONTAINER:-avernek-postgres}"
DB_USER="${DB_USER:-avernek}"
DB_NAME="${DB_NAME:-avernek}"

# file:table, in foreign-key order. Parents before children.
MAPPINGS=(
  "user_rows.csv:users"
  "categories_rows.csv:categories"
  "fx_rates_row.csv:fx_rates"
  "vendors_csv:vendors"
  "recurring_rows.csv:recurring"
  "expenses_rows.csv:expenses"
  "expense_shares_rows.csv:expense_shares"
  "recurring_shares_rows.csv:recurring_shares"
)

# Truncated in reverse dependency order. settlements has no export but
# references users, so it must go too rather than block the truncate.
TRUNCATE_TABLES="public.expense_shares, public.recurring_shares,
                 public.settlements, public.expenses, public.recurring,
                 public.vendors, public.categories, public.fx_rates,
                 public.users"

psql_db() {
  docker exec -i "$CONTAINER" \
    psql -v ON_ERROR_STOP=1 -U "$DB_USER" -d "$DB_NAME" "$@"
}

if ! docker inspect "$CONTAINER" >/dev/null 2>&1; then
  echo "ERROR: no container named '$CONTAINER'. Set PG_CONTAINER to override."
  exit 1
fi

# -----------------------------------------------------------------------------
# Pre-flight: every file present, and every CSV column real.
# -----------------------------------------------------------------------------

echo "Checking ${CSV_DIR} ..."

declare -A COLUMNS
problems=0

for mapping in "${MAPPINGS[@]}"; do
  file="${mapping%%:*}"
  table="${mapping##*:}"
  path="$CSV_DIR/$file"

  if [[ ! -s "$path" ]]; then
    echo "  MISSING  $file"
    problems=1
    continue
  fi

  # Strip a UTF-8 BOM and CRLF, then unquote each name.
  header="$(head -n 1 "$path" | sed 's/^\xEF\xBB\xBF//' | tr -d '\r')"

  IFS=',' read -ra raw <<< "$header"
  list=""
  plain=""
  for name in "${raw[@]}"; do
    name="$(echo "$name" | tr -d ' "')"
    list+="\"$name\","
    plain+="$name,"
  done
  COLUMNS[$table]="${list%,}"

  unknown="$(
    psql_db -tAc "
      select coalesce(string_agg(c, ', '), '')
        from unnest(string_to_array('${plain%,}', ',')) as c
       where c not in (
         select column_name from information_schema.columns
          where table_schema = 'public' and table_name = '$table'
       )" | tr -d '\r'
  )"

  if [[ -n "$unknown" ]]; then
    echo "  BAD      $file -> $table has no column(s): $unknown"
    problems=1
  else
    # Lines, not rows: a quoted note containing a newline spans several.
    lines="$(( $(wc -l < "$path") - 1 ))"
    echo "  ok       $file -> $table  (${lines} lines, ${#raw[@]} columns)"
  fi
done

if [[ "$problems" -ne 0 ]]; then
  echo
  echo "Fix the problems above and re-run. Nothing was changed."
  exit 1
fi

# -----------------------------------------------------------------------------
# Build one psql stream: truncate, then every \copy back to back.
# -----------------------------------------------------------------------------

stream="$(mktemp)"
trap 'rm -f "$stream"' EXIT

printf 'truncate %s cascade;\n' "$TRUNCATE_TABLES" >> "$stream"

for mapping in "${MAPPINGS[@]}"; do
  file="${mapping%%:*}"
  table="${mapping##*:}"

  printf '\\copy public.%s (%s) from stdin with (format csv)\n' \
    "$table" "${COLUMNS[$table]}" >> "$stream"

  # Header dropped here because the column list above already fixes the order.
  tail -n +2 "$CSV_DIR/$file" | tr -d '\r' >> "$stream"

  # The terminator must start its own line, but an unconditional newline would
  # add a blank line that COPY reads as an empty row. Blank lines cannot simply
  # be filtered out either: a quoted note may legitimately span several.
  if [[ -n "$(tail -c 1 "$stream")" ]]; then
    printf '\n' >> "$stream"
  fi

  printf '\\.\n' >> "$stream"
done

echo
echo "Importing (single transaction) ..."

psql_db --single-transaction < "$stream"

# -----------------------------------------------------------------------------
# Report.
# -----------------------------------------------------------------------------

echo
echo "Row counts:"
psql_db -c "
  select 'users' as table, count(*) from public.users
  union all select 'categories',       count(*) from public.categories
  union all select 'vendors',          count(*) from public.vendors
  union all select 'fx_rates',         count(*) from public.fx_rates
  union all select 'recurring',        count(*) from public.recurring
  union all select 'expenses',         count(*) from public.expenses
  union all select 'expense_shares',   count(*) from public.expense_shares
  union all select 'recurring_shares', count(*) from public.recurring_shares
  union all select 'settlements',      count(*) from public.settlements
  order by 1;"

echo
echo "Nobody can sign in yet — the import cleared every password."
echo "Recreate the administrator with:"
echo
echo "  docker exec -e ADMIN_EMAIL=admin@avernek.com -e ADMIN_PASSWORD='<password>' \\"
echo "    avernek-expense-tracker node scripts/seed-admin.mjs"
echo
echo "Then give everyone else a password from Settings -> Set a password."
