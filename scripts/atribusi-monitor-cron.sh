#!/usr/bin/env bash
# Pembungkus CRON untuk monitoring atribusi Meta Ads (host VPS). AGREGAT SAJA; tidak mencetak nomor/nama/chat/JID/clid/payload.
#
# Contoh crontab (TIDAK dipasang otomatis oleh rilis; Owner/operator memutuskan):
#   */5 * * * * bash /home/ubuntu/atribusi-monitor-cron.sh >> /home/ubuntu/release-backups/atribusi-monitor.cron.log 2>&1
#
# Kode keluar: 0 SEHAT | 1 PERINGATAN | 2 KRITIS (juga bila backend/pemeriksaan tidak dapat dijalankan).
# Cooldown (bawaan 60 menit; ATRIBUSI_ALERT_COOLDOWN_MIN) dan pemberitahuan PULIH ditangani scripts/atribusi-monitor.js di dalam container; keadaan alarm disimpan di
# tabel attribution_alert_state, log JSON-lines agregat di /app/data/atribusi-monitor.log. WA hanya bila ATRIBUSI_ALERT_NOTIFY_PHONE diisi eksplisit (bawaan: log saja).
set -uo pipefail
CID="$(docker ps -q --filter "label=com.docker.compose.project=klinik-matras" --filter "label=com.docker.compose.service=backend" | head -1)"
if [ -z "$CID" ]; then echo "$(date -u +%FT%TZ) {\"status\":\"MONITOR_ERROR\",\"kode\":\"BACKEND_TIDAK_BERJALAN\"}"; exit 2; fi
OUT="$(docker exec "$CID" node scripts/atribusi-monitor.js "$@" 2>&1)"; RC=$?
echo "$(date -u +%FT%TZ) rc=${RC} ${OUT}" | cut -c1-1500
exit "$RC"
