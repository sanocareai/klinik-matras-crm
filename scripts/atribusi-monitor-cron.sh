#!/usr/bin/env bash
# Pembungkus CRON monitoring atribusi Meta Ads (host VPS). AGREGAT SAJA; tidak mencetak nomor/nama/chat/JID/clid/payload.
#
# Terpasang di crontab user `ubuntu` sebagai blok bertanda (hanya blok ini yang ditambahkan/dicabut):
#   # BEGIN atribusi-monitor
#   */10 * * * * /home/ubuntu/ops/atribusi-monitor/atribusi-monitor-cron.sh
#   # END atribusi-monitor
# Cabut: crontab -l | sed '/^# BEGIN atribusi-monitor$/,/^# END atribusi-monitor$/d' | crontab -    (lalu hapus ~/ops/atribusi-monitor bila perlu)
#
# Pengaman: PATH eksplisit (lingkungan cron minimal), flock -n (tidak pernah paralel), timeout 120 dtk, log dibatasi (rotasi 1 MiB × 1 cadangan = maks ~2 MiB),
# umask 077. Kode keluar skrip: 0 SEHAT | 1 PERINGATAN | 2 KRITIS (juga bila backend/pemeriksaan tidak dapat dijalankan).
# Cooldown (60 menit; ATRIBUSI_ALERT_COOLDOWN_MIN) dan pemberitahuan PULIH ditangani scripts/atribusi-monitor.js di dalam container; keadaan alarm disimpan di tabel
# attribution_alert_state, log JSON-lines agregat di /app/data/atribusi-monitor.log (dirotasi 2 MiB oleh skrip). WA hanya bila ATRIBUSI_ALERT_NOTIFY_PHONE diisi eksplisit (bawaan: log saja).
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
DIR="${ATRIBUSI_MONITOR_DIR:-$HOME/ops/atribusi-monitor}"
LOG="$DIR/atribusi-monitor.cron.log"
MAKS_BYTE=$((1024 * 1024))
mkdir -p "$DIR"
exec 9>"$DIR/.lock"
if ! flock -n 9; then echo "$(date -u +%FT%TZ) rc=0 {\"status\":\"DILEWATI\",\"alasan\":\"PEMERIKSAAN_SEBELUMNYA_MASIH_BERJALAN\"}" >> "$LOG"; exit 0; fi
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt "$MAKS_BYTE" ]; then mv -f "$LOG" "$LOG.1"; fi
CID="$(docker ps -q --filter "label=com.docker.compose.project=klinik-matras" --filter "label=com.docker.compose.service=backend" | head -1)"
if [ -z "$CID" ]; then echo "$(date -u +%FT%TZ) rc=2 {\"status\":\"MONITOR_ERROR\",\"kode\":\"BACKEND_TIDAK_BERJALAN\"}" >> "$LOG"; exit 2; fi
OUT="$(timeout 120 docker exec "$CID" node scripts/atribusi-monitor.js "$@" 2>&1)"; RC=$?
[ "$RC" = "124" ] && OUT="{\"status\":\"MONITOR_ERROR\",\"kode\":\"TIMEOUT_120S\"}" && RC=2
echo "$(date -u +%FT%TZ) rc=${RC} ${OUT}" | cut -c1-1500 >> "$LOG"
exit "$RC"
