#!/usr/bin/env bash
# =============================================================================
# Installs the nightly backup in the current user's crontab (Linux / macOS).
#
#   ./scripts/install-backup-cron.sh
#
# Default schedule: every day at 01:15 (server time), log to backups/cron.log.
# The job is idempotent: re-running replaces the previous entry.
# =============================================================================
set -euo pipefail

DIR="$(cd "$(dirname "$0")/.." && pwd)"
SCHEDULE="${BACKUP_CRON:-15 1 * * *}"
LINE="${SCHEDULE} cd ${DIR} && ./scripts/backup-docker.sh >> backups/cron.log 2>&1"

mkdir -p "${DIR}/backups"

if command -v crontab >/dev/null 2>&1; then
  ( crontab -l 2>/dev/null | grep -v 'backup-docker.sh' || true; echo "$LINE" ) | crontab -
  echo "[cron] installed:"
  echo "       $LINE"
  echo "[cron] current schedule:"
  crontab -l | grep 'backup-docker.sh' || true
else
  cat <<EOF
crontab is not available on this machine.

Add this line to your scheduler manually (systemd timer, Windows Task Scheduler,
or the cloud provider's cron):

  $LINE
EOF
fi

echo
echo "Test it now with:  ${DIR}/scripts/backup-docker.sh"
