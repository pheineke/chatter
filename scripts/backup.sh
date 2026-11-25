#!/usr/bin/env bash
# Back up the database and uploaded files.
#
#   scripts/backup.sh                 # writes to ./backups
#   BACKUP_DIR=/mnt/usb/chatter scripts/backup.sh
#
# Keeps BACKUP_KEEP_DAYS (default 14) days of backups. Run it from cron, e.g.
#   15 3 * * * cd /path/to/chatter && scripts/backup.sh >> backups/backup.log 2>&1
# Uses the same compose files as `docker compose` here (set COMPOSE_FILE in
# .env for the prod overlay). Restore: see docs/deploying.md.
#
# A backup on the same disk doesn't survive that disk dying: copy BACKUP_DIR
# somewhere else too (rsync, rclone, ...).
set -euo pipefail

cd "$(dirname "$0")/.."
dest=${BACKUP_DIR:-./backups}
keep=${BACKUP_KEEP_DAYS:-14}
ts=$(date -u +%Y%m%dT%H%M%SZ)

umask 077 # dumps contain password hashes and private messages
mkdir -p "$dest"

# Database: custom format (compressed, restorable with pg_restore).
docker compose exec -T db sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
    > "$dest/db-$ts.dump.partial"
mv "$dest/db-$ts.dump.partial" "$dest/db-$ts.dump"

# Uploads (attachments, avatars, server images).
tar -C backend -czf "$dest/static-$ts.tar.gz.partial" static
mv "$dest/static-$ts.tar.gz.partial" "$dest/static-$ts.tar.gz"

find "$dest" -maxdepth 1 \( -name 'db-*.dump' -o -name 'static-*.tar.gz' \) -mtime +"$keep" -delete
find "$dest" -maxdepth 1 -name '*.partial' -mmin +60 -delete

echo "$(date -u +%FT%TZ) backup ok: $dest/db-$ts.dump ($(du -h "$dest/db-$ts.dump" | cut -f1)), static-$ts.tar.gz"
