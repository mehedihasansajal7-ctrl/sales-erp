#!/usr/bin/env bash
# =============================================================================
# Nightly backup for the docker-compose deployment.
#
#   ./scripts/backup-docker.sh                 # uses .env + running db container
#   BACKUP_DIR=/mnt/backups ./scripts/backup-docker.sh
#
# Runs pg_dump *inside* the database container, so nothing has to be installed on
# the host. Writes a custom-format dump atomically (tmp -> verify -> rename) and
# prunes dumps older than BACKUP_KEEP_DAYS.
#
# Install the schedule once with:  ./scripts/install-backup-cron.sh
# Restore:                          ./scripts/restore-docker.sh <dump-file>
# =============================================================================
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"
DB_CONTAINER="${DB_CONTAINER:-sales-erp-postgres}"
DB_NAME="${POSTGRES_DB:-sales_erp}"
DB_USER="${POSTGRES_USER:-postgres}"

if ! docker inspect -f '{{.State.Running}}' "$DB_CONTAINER" >/dev/null 2>&1; then
  echo "[backup] database container ${DB_CONTAINER} is not running" >&2
  exit 1
fi

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="${BACKUP_DIR}/sales_erp_${STAMP}.dump"
TMP="${TARGET}.part"

echo "[backup] dumping ${DB_NAME} to ${TARGET}"
docker exec "$DB_CONTAINER" pg_dump -U "$DB_USER" -d "$DB_NAME" \
  --format=custom --no-owner --no-privileges > "$TMP"

# A partial file must never look like a good backup.
if [ ! -s "$TMP" ]; then
  rm -f "$TMP"
  echo "[backup] dump is empty - aborted" >&2
  exit 1
fi
if ! docker exec -i "$DB_CONTAINER" pg_restore --list < "$TMP" > /dev/null; then
  rm -f "$TMP"
  echo "[backup] dump could not be verified with pg_restore --list - aborted" >&2
  exit 1
fi

mv "$TMP" "$TARGET"
echo "[backup] ok ($(du -h "$TARGET" | cut -f1))"

echo "[backup] pruning dumps older than ${BACKUP_KEEP_DAYS} days"
find "$BACKUP_DIR" -name 'sales_erp_*.dump' -type f -mtime "+${BACKUP_KEEP_DAYS}" -print -delete

echo "[backup] newest backups:"
ls -1t "$BACKUP_DIR"/sales_erp_*.dump 2>/dev/null | head -n 5 || true

echo "[backup] remember to copy ${BACKUP_DIR} to another disk / off-site storage."
