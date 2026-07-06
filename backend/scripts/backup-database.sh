#!/bin/bash
# Backup database Klinik Matras → Google Drive via rclone
# Dijalankan otomatis oleh cron setiap hari jam 03:00 WIB
# Jalankan dari root project: cd ~/klinik-matras && ./backend/scripts/backup-database.sh

set -e

BACKUP_DIR="/home/ubuntu/klinik-matras/backups"
TIMESTAMP=$(date +%Y-%m-%d_%H-%M-%S)
FILENAME="klinik_matras_backup_${TIMESTAMP}.sql.gz"

# Kirim notifikasi WhatsApp ke admin kalau ada langkah yang gagal
backup_fail_alert() {
  local waktu
  waktu=$(date '+%Y-%m-%d %H:%M:%S')
  curl -sf -X POST http://localhost:4000/api/internal/backup-alert \
    -H "Content-Type: application/json" \
    -d "{\"timestamp\":\"$waktu\",\"file\":\"$FILENAME\"}" || true
}
trap backup_fail_alert ERR

mkdir -p "$BACKUP_DIR"

echo "$(date) — Mulai backup: $FILENAME"

# Dump database + kompres langsung ke file
docker compose exec -T postgres pg_dump -U klinik klinik_matras \
  | gzip > "$BACKUP_DIR/$FILENAME"

echo "✅ Backup dibuat: $FILENAME ($(du -h "$BACKUP_DIR/$FILENAME" | cut -f1))"

# Upload ke Google Drive
rclone copy "$BACKUP_DIR/$FILENAME" gdrive:klinik-matras-backups/ --progress

echo "✅ Upload ke Google Drive selesai"

# Hapus backup LOKAL lebih dari 7 hari
find "$BACKUP_DIR" -name "klinik_matras_backup_*.sql.gz" -mtime +7 -delete
echo "✅ Cleanup lokal selesai (file >7 hari dihapus)"

# Hapus backup di Google Drive lebih dari 30 hari
rclone delete gdrive:klinik-matras-backups/ \
  --min-age 30d --include "klinik_matras_backup_*.sql.gz"
echo "✅ Cleanup Google Drive selesai (file >30 hari dihapus)"

echo "🎉 $(date) — Backup selesai"
