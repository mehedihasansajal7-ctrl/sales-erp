#!/bin/sh
# =============================================================================
# Container entrypoint: wait for PostgreSQL -> migrate -> optional seed -> serve
# =============================================================================
set -e

echo "[entrypoint] waiting for the database to accept connections…"
ATTEMPTS=0
until node -e "
const { PrismaClient } = require('@prisma/client');
const client = new PrismaClient();
client.\$queryRaw\`SELECT 1\`.then(() => process.exit(0)).catch(() => process.exit(1));
" >/dev/null 2>&1; do
  ATTEMPTS=$((ATTEMPTS + 1))
  if [ "$ATTEMPTS" -ge 60 ]; then
    echo "[entrypoint] database did not become ready in time" >&2
    exit 1
  fi
  sleep 2
done
echo "[entrypoint] database is up."

echo "[entrypoint] applying migrations…"
npx prisma migrate deploy

if [ "${SEED_ON_START:-true}" = "true" ]; then
  if [ "${SEED_DEFAULT_PASSWORD:-}" = "" ]; then
    export SEED_DEFAULT_PASSWORD="demo1234"
  fi
  echo "[entrypoint] ensuring demo data (idempotent)…"
  npx tsx prisma/seed.ts || echo "[entrypoint] seed step failed (continuing)"
fi

echo "[entrypoint] starting the application on port ${PORT:-3001}…"
exec npm run start
