#!/usr/bin/env bash
#
# Restores a Mihenk database dump into the running compose stack.
#
#   ./scripts/restore.sh backups/mihenk-20260804-120000.sql.gz
#
# This REPLACES the current database. It asks for confirmation first, because
# the one time this gets run by accident is the one time it matters.
#
# Stop the workers before restoring: a worker that writes a grading result
# partway through a restore leaves the data inconsistent.

set -euo pipefail

cd "$(dirname "$0")/.."

FILE="${1:-}"
if [[ -z "$FILE" ]]; then
  echo "Usage: $0 <backup.sql.gz>" >&2
  echo "Available:" >&2
  ls -1t backups/mihenk-*.sql.gz 2>/dev/null | head -10 >&2 || echo "  (none in ./backups)" >&2
  exit 1
fi
if [[ ! -f "$FILE" ]]; then
  echo "No such file: $FILE" >&2
  exit 1
fi

if [[ -f .env ]]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi
DB_NAME="${DB_NAME:-mihenk}"
DB_USER="${DB_USER:-mihenk}"

CURRENT="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A \
  -c 'SELECT count(*) FROM users' 2>/dev/null || echo '?')"

echo "About to replace the contents of database '$DB_NAME'."
echo "  restoring from : $FILE"
echo "  current users  : $CURRENT"
echo
if [[ "${FORCE:-}" != "1" ]]; then
  read -r -p "Type the database name to confirm: " CONFIRM
  if [[ "$CONFIRM" != "$DB_NAME" ]]; then
    echo "Aborted."
    exit 1
  fi
fi

echo "Restoring..."
# The dump was taken with --clean --if-exists, so it drops and recreates each
# object as it goes. ON_ERROR_STOP makes a partial restore fail loudly instead
# of leaving a half-populated database that looks fine.
gunzip -c "$FILE" | docker compose exec -T postgres \
  psql --username "$DB_USER" --dbname "$DB_NAME" --set ON_ERROR_STOP=on --quiet

RESTORED="$(docker compose exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -t -A -c 'SELECT count(*) FROM users')"
echo "Restore complete. Users in the restored database: $RESTORED"
echo
echo "Next: run migrations in case the dump predates this version -"
echo "  docker compose run --rm api npm run migrate"
