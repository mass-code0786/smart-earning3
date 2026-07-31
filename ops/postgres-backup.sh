#!/usr/bin/env bash
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIRECTORY="${BACKUP_DIRECTORY:-/var/backups/smart-earning}"
BACKUP_RETENTION_DAYS="${BACKUP_RETENTION_DAYS:-14}"
umask 077
mkdir -p "$BACKUP_DIRECTORY"
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
target="$BACKUP_DIRECTORY/smart-earning-$timestamp.dump"
pg_dump --dbname="$DATABASE_URL" --format=custom --no-owner --no-acl --file="$target"
pg_restore --list "$target" >/dev/null
sha256sum "$target" >"$target.sha256"
find "$BACKUP_DIRECTORY" -type f -name 'smart-earning-*.dump*' -mtime "+$BACKUP_RETENTION_DAYS" -delete
printf '{"status":"ok","backup":"%s","sha256":"%s.sha256"}\n' "$target" "$target"
