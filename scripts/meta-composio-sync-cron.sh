#!/usr/bin/env bash
# Pembungkus CRON sinkronisasi Meta lewat Composio (host VPS). BELUM TERPASANG; pemasangan butuh persetujuan.
#   # BEGIN meta-composio-sync
#   17 */3 * * * /home/ubuntu/ops/meta-composio-sync/meta-composio-sync-cron.sh
#   # END meta-composio-sync
# Hentikan: crontab -l | sed '/^# BEGIN meta-composio-sync$/,/^# END meta-composio-sync$/d' | crontab -    lalu COMPOSIO_META_SYNC_ENABLED=false. Histori tidak dihapus.
# Pengaman: flock (tidak paralel), timeout 900 dtk, log agregat dipotong 2000 karakter dan dirotasi 1 MiB.
set -uo pipefail
export PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
umask 077
DIR="${META_COMPOSIO_DIR:-$HOME/ops/meta-composio-sync}"; LOG="$DIR/sync.cron.log"
mkdir -p "$DIR"
exec 9>"$DIR/.lock"
flock -n 9 || { echo "$(date -u +%FT%TZ) rc=0 {\"status\":\"DILEWATI\"}" >> "$LOG"; exit 0; }
[ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt 1048576 ] && mv -f "$LOG" "$LOG.1"
CID="$(docker ps -q --filter label=com.docker.compose.project=klinik-matras --filter label=com.docker.compose.service=backend | head -1)"
[ -n "$CID" ] || { echo "$(date -u +%FT%TZ) rc=2 {\"status\":\"BACKEND_TIDAK_BERJALAN\"}" >> "$LOG"; exit 2; }
OUT="$(timeout 900 docker exec "$CID" node scripts/sync-meta-composio.js --commit 2>&1)"; RC=$?
echo "$(date -u +%FT%TZ) rc=${RC} ${OUT}" | cut -c1-2000 >> "$LOG"
exit "$RC"
