#!/usr/bin/env bash
# =============================================================================
# Daily database backup (spec Section 8).
#
#   ./scripts/backup.sh                 # uses DATABASE_URL from .env
#   BACKUP_DIR=/mnt/backups ./scripts/backup.sh
#
# Writes a compressed custom-format dump (restore with pg_restore) and prunes
# dumps older than BACKUP_KEEP_DAYS. Add it to cron for a daily run:
#   0 2 * * *  cd /srv/sales-erp && ./scripts/backup.sh >> backups/backup.log 2>&1
# =============================================================================
set -euo pipefail

if [ -f .env ]; then
  # shellcheck disable=SC1091
  set -a; . ./.env; set +a
fi

: "${DATABASE_URL:?DATABASE_URL must be set (in .env or the environment)}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
BACKUP_KEEP_DAYS="${BACKUP_KEEP_DAYS:-14}"

mkdir -p "$BACKUP_DIR"
STAMP="$(date +%Y-%m-%d_%H%M%S)"
TARGET="${BACKUP_DIR}/sales_erp_${STAMP}.dump"

echo "[backup] dumping to ${TARGET}"
pg_dump --format=custom --no-owner --no-privileges --file="${TARGET}" "${DATABASE_URL}"

# Never leave a half-written dump behind.
if [ ! -s "${TARGET}" ]; then
  echo "[backup] dump looks empty — removing it and failing" >&2
  rm -f "${TARGET}"
  exit 1
fi

SIZE="$(du -h "${TARGET}" | cut -f1)"
echo "[backup] done (${SIZE})"

echo "[backup] pruning dumps older than ${BACKUP_KEEP_DAYS} days"
find "${BACKUP_DIR}" -name 'sales_erp_*.dump' -type f -mtime "+${BACKUP_KEEP_DAYS}" -print -delete

echo "[backup] keeping:"
ls -1t "${BACKUP_DIR}"/sales_erp_*.dump 2>/dev/null | head -n 5 || true

cat <<'EOF'

Restore instructions
--------------------
  # 1. stop the app so nothing writes while you restore
  docker compose stop app

  # 2. restore into a fresh database
  docker compose exec -T db createdb -U postgres sales_erp_restore
  docker compose exec -T db pg_restore -U postgres -d sales_erp_restore --clean --if-exists \
      < backups/sales_erp_YYYY-MM-DD_HHMMSS.dump

  # 3. point the app at the restored database (DATABASE_URL) and start it
  docker compose start app
EOF
