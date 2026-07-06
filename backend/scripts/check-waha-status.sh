#!/bin/bash
# Monitor status WAHA session, kirim alert kalau tidak WORKING
# Dijalankan setiap 15 menit oleh cron
# Jalankan dari root project: cd ~/klinik-matras && ./backend/scripts/check-waha-status.sh

WAHA_URL="http://localhost:3000/api/sessions/default"
WAHA_KEY="klinikmatras-rahasia-2026"
ALERT_URL="http://localhost:4000/api/internal/waha-alert"
LOG_FILE="/home/ubuntu/klinik-matras/backups/waha-monitor.log"
LOCK_FILE="/tmp/klinikmatras-waha-alert.lock"

mkdir -p "$(dirname "$LOG_FILE")"

# Cek status WAHA (max timeout 10 detik)
RESPONSE=$(curl -sf --max-time 10 \
  -H "X-Api-Key: $WAHA_KEY" "$WAHA_URL" 2>/dev/null || echo "")

STATUS=$(echo "$RESPONSE" | grep -o '"status":"[A-Z_]*"' | head -1)

# Kalau WORKING — hapus lock file (reset debounce) dan selesai
if [[ "$STATUS" == '"status":"WORKING"' ]]; then
  rm -f "$LOCK_FILE"
  exit 0
fi

# WAHA tidak WORKING — cek debounce agar tidak spam alert tiap 15 menit
if [ -f "$LOCK_FILE" ]; then
  LAST_ALERT=$(cat "$LOCK_FILE" 2>/dev/null || echo 0)
  NOW=$(date +%s)
  ELAPSED=$((NOW - LAST_ALERT))
  # Kirim alert maksimal sekali per jam
  if [ "$ELAPSED" -lt 3600 ]; then
    exit 0
  fi
fi

# Tentukan status display
ACTUAL_RAW="${STATUS:-UNREACHABLE}"
ACTUAL_DISPLAY=$(echo "$ACTUAL_RAW" | grep -o '"[A-Z_]*"$' | tr -d '"' || echo "UNREACHABLE")

# Tulis ke log
echo "$(date '+%Y-%m-%d %H:%M:%S') — WAHA tidak WORKING, status: $ACTUAL_DISPLAY" >> "$LOG_FILE"

# Kirim alert ke backend Express (yang lanjut kirim WA + email fallback)
curl -sf --max-time 5 -X POST "$ALERT_URL" \
  -H "Content-Type: application/json" \
  -d "{\"status\":\"$ACTUAL_DISPLAY\"}" 2>/dev/null || \
  echo "$(date '+%Y-%m-%d %H:%M:%S') — Gagal kirim alert ke backend (backend mungkin down)" >> "$LOG_FILE"

# Simpan waktu alert terakhir untuk debounce
date +%s > "$LOCK_FILE"
