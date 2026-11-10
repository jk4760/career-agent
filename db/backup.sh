#!/bin/sh
# NextCareer 数据库备份：pg_dump -Fc 导出，文件名带日期，保留最近 12 份。
# 服务器 cron（每月 1 日凌晨 3 点）：
#   0 3 1 * * /opt/nextcareer/db/backup.sh >> /opt/nextcareer/backups/cron.log 2>&1
set -e

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if [ -f "$ROOT/.env" ]; then
  set -a
  . "$ROOT/.env"
  set +a
fi

DB_USER="${DB_USER:-nextcareer}"
DB_NAME="${DB_NAME:-nextcareer}"
DIR="$ROOT/backups"
mkdir -p "$DIR"

FILE="$DIR/nextcareer-$(date +%F).dump"
docker compose -f "$ROOT/docker-compose.yml" exec -T db pg_dump -U "$DB_USER" -Fc "$DB_NAME" > "$FILE"
echo "backup written: $FILE ($(du -h "$FILE" | cut -f1))"

# 只保留最近 12 份
ls -t "$DIR"/nextcareer-*.dump | tail -n +13 | xargs rm -f 2>/dev/null || true
