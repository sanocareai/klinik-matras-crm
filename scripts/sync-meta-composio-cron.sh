#!/usr/bin/env bash
# Pembungkus CRON sinkron harian Meta lewat Composio (host VPS): --commit rolling 7 hari lalu --verify.
# Setiap hasil selain rc=0, termasuk rc=3, mengirim WA agregat lewat backend/scripts/notifikasi-sync-meta.js.
# Bila backend mati, WA tidak bisa dikirim dari container; kejadian itu hanya tercatat di log dan exit 2.
# Kode keluar: 0 bersih | selain itu rc tahap yang gagal.
set -uo pipefail
export PATH="${SYNC_META_PATH:-/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin}"
umask 077
DIR="${SYNC_META_DIR:-$HOME/ops/sync-meta-composio}"
LOG="$DIR/sync-meta-composio.cron.log"
BATAS_DTK="${SYNC_META_TIMEOUT:-1500}"
MAKS_BYTE=$((1024 * 1024))
mkdir -p "$DIR"
catat() { echo "$(date -u +%FT%TZ) $*" | cut -c1-1500 >> "$LOG"; }
exec 9>"$DIR/.lock"
flock -n 9; RC_KUNCI=$?
if [ "$RC_KUNCI" = 1 ]; then catat 'rc=0 {"status":"DILEWATI","alasan":"PROSES_SEBELUMNYA_MASIH_BERJALAN"}'; exit 0; fi
if [ "$RC_KUNCI" != 0 ]; then catat 'rc=2 {"status":"SINKRON_GAGAL","kode":"KUNCI_GAGAL"}'; exit 2; fi
if [ -f "$LOG" ] && [ "$(stat -c %s "$LOG" 2>/dev/null || echo 0)" -gt "$MAKS_BYTE" ]; then mv -f "$LOG" "$LOG.1"; fi
CID="$(docker ps -q --filter "label=com.docker.compose.project=klinik-matras" --filter "label=com.docker.compose.service=backend" | head -1)"
if [ -z "$CID" ]; then catat 'rc=2 {"status":"SINKRON_GAGAL","kode":"BACKEND_TIDAK_BERJALAN"}'; exit 2; fi

laporkan() { # tahap rc keluaran
  if printf '%s' "$3" | timeout 60 docker exec -i "$CID" node scripts/notifikasi-sync-meta.js "--tahap=$1" "--rc=$2" >/dev/null 2>&1; then
    catat 'notifikasi=TERKIRIM'
  else
    catat 'notifikasi=GAGAL'
  fi
}
for TAHAP in commit verify; do
  OUT="$(timeout "$BATAS_DTK" docker exec "$CID" node scripts/sync-meta-composio.js "--$TAHAP" 2>&1)"; RC=$?
  [ "$RC" = 124 ] && OUT='{"status":"SINKRON_GAGAL","kode":"TIMEOUT"}' && RC=2
  catat "tahap=$TAHAP rc=$RC $OUT"
  if [ "$RC" != 0 ]; then laporkan "$TAHAP" "$RC" "$OUT"; exit "$RC"; fi
done
exit 0
