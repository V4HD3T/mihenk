#!/usr/bin/env bash
#
# Dumps the Mihenk database from the running compose stack.
#
#   ./scripts/backup.sh                    -> backups/mihenk-<timestamp>.sql.gz
#   ./scripts/backup.sh /mnt/nas/mihenk -> writes there instead
#
# What is and isn't covered:
#   - The database holds everything that matters: accounts, courses, problems,
#     submissions, grades and the plagiarism archive.
#   - Redis is NOT backed up. It holds the grading queue, which is transient by
#     design - a lost queue means some submissions need resubmitting, not lost
#     work. Restoring a stale queue would be worse than an empty one.
#   - The sandbox images are rebuilt with `npm run sandbox:build`, not restored.
#
# Uses --clean --if-exists so the dump can be restored over an existing
# database without dropping it first, and a custom-free plain SQL format so the
# file stays readable and greppable years later.

set -euo pipefail

cd "$(dirname "$0")/.."

OUT_DIR="${1:-backups}"
mkdir -p "$OUT_DIR"

# Read the same .env compose uses, so the credentials can't drift apart.
if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

DB_NAME="${DB_NAME:-mihenk}"
DB_USER="${DB_USER:-mihenk}"
STAMP="$(date +%Y%m%d-%H%M%S)"
FILE="$OUT_DIR/mihenk-$STAMP.sql.gz"

echo "Dumping $DB_NAME ..."
docker compose exec -T postgres \
  pg_dump --username "$DB_USER" --dbname "$DB_NAME" --clean --if-exists \
  | gzip > "$FILE"

SIZE="$(du -h "$FILE" | cut -f1)"
echo "Wrote $FILE ($SIZE)"

# A dump that can't be read is not a backup. Check the gzip stream and confirm
# the file actually contains a schema, rather than an empty or truncated dump.
if ! gzip -t "$FILE" 2>/dev/null; then
  echo "ERROR: the dump is not a valid gzip stream - not keeping it" >&2
  rm -f "$FILE"
  exit 1
fi
if ! gunzip -c "$FILE" | grep -q "CREATE TABLE public.users"; then
  echo "ERROR: the dump has no users table - refusing to keep a bad backup" >&2
  rm -f "$FILE"
  exit 1
fi
echo "Verified: readable, and contains the expected schema."

# Retain a month of daily backups by default.
KEEP="${BACKUP_KEEP:-30}"
COUNT="$(find "$OUT_DIR" -name 'mihenk-*.sql.gz' | wc -l | tr -d ' ')"
if (( COUNT > KEEP )); then
  find "$OUT_DIR" -name 'mihenk-*.sql.gz' -print0 \
    | sort -z \
    | head -z -n "-$KEEP" \
    | xargs -0 rm -f
  echo "Pruned to the most recent $KEEP backups."
fi
