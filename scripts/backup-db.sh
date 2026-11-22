#!/bin/sh
# FewFeww Automated PostgreSQL Nightly Backup Script
# Retention: 14 days rolling window

set -e

BACKUP_DIR="/var/backups/fewfeww"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
BACKUP_FILE="${BACKUP_DIR}/fewfeww_backup_${TIMESTAMP}.sql.gz"

mkdir -p "${BACKUP_DIR}"

echo "[$(date)] Starting PostgreSQL backup for fewfeww..."

# Dump database using pg_dump compressed with gzip
docker exec -t fewfeww-db pg_dump -U fewfeww fewfeww | gzip > "${BACKUP_FILE}"

echo "[$(date)] Backup completed: ${BACKUP_FILE} ($(du -h "${BACKUP_FILE}" | cut -f1))"

# Prune backups older than 14 days
echo "[$(date)] Cleaning up backups older than 14 days..."
find "${BACKUP_DIR}" -name "fewfeww_backup_*.sql.gz" -type f -mtime +14 -delete

echo "[$(date)] Backup cycle complete."
