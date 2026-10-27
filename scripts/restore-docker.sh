#!/usr/bin/env bash
# =============================================================================
# Restore a dump made by scripts/backup-docker.sh
#
#   ./scripts/restore-docker.sh backups/sales_erp_2026-12-31_011500.dump
#
# Stops the app (so nothing writes), drops and recreates the database, restores,
# then starts the app again. Everything is confirmed first.
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

DUMP="${1:-}"
if [ -z "$DUMP" ] || [ ! -s "$DUMP" ]; then
  echo "usage: $0 <path-to-dump>" >&2
  exit 1
fi

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

DB_CONTAINER="${DB_CONTAINER:-sales-erp-postgres}"
DB_NAME="${POSTGRES_DB:-sales_erp}"
DB_USER="${POSTGRES_USER:-postgres}"

echo "This will REPLACE every record in database '${DB_NAME}' with the contents of:"
echo "  ${DUMP}"
echo
read -r -p "Type YES to continue: " CONFIRM
[ "$CONFIRM" = "YES" ] || { echo "aborted"; exit 1; }

echo "[restore] stopping the app"
docker compose stop app >/dev/null

echo "[restore] recreating the database"
docker exec "$DB_CONTAINER" psql -U "$DB_USER" -d postgres -v ON_ERROR_STOP=1 \
  -c "DROP DATABASE IF EXISTS ${DB_NAME};" \
  -c "CREATE DATABASE ${DB_NAME};"

echo "[restore] restoring"
docker exec -i "$DB_CONTAINER" pg_restore -U "$DB_USER" -d "$DB_NAME" --no-owner --no-privileges < "$DUMP"

echo "[restore] starting the app (migrations run automatically)"
docker compose start app >/dev/null

echo "[restore] done - open the app and check the dashboard."
