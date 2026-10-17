#!/usr/bin/env bash
# Pembungkus backfill spend Windsor 1–14 Okt 2026 (jalankan dari laptop). Data tidak pernah ditulis ke berkas di server: CSV + control total dikirim lewat stdin ke proses di dalam container.
#   bash scripts/backfill-spend-windsor.sh cek    <csv> <kontrol.json> [accountId]    # lokal saja
#   bash scripts/backfill-spend-windsor.sh dry    <csv> <kontrol.json> [accountId]    # dry-run lewat jalur aplikasi (tidak menulis)
#   KOMIT=YA bash scripts/backfill-spend-windsor.sh commit <csv> <kontrol.json> [accountId]
#   bash scripts/backfill-spend-windsor.sh verify <csv> <kontrol.json> [accountId]
# Tidak memuat data apa pun. Lihat docs/BACKFILL-SPEND-WINDSOR-1-14-OKT.md.
set -euo pipefail
MODE="${1:-}"; CSV="${2:-}"; KONTROL="${3:-}"; AKUN="${4:-2081614415911241}"
HOST="${SSH_HOST:-ubuntu@43.133.152.6}"
HERE="$(cd "$(dirname "$0")" && pwd)"; JS="$HERE/backfill-spend-windsor.cjs"
case "$MODE" in cek|dry|commit|verify) ;; *) echo "pakai: $0 <cek|dry|commit|verify> <csv> <kontrol.json> [accountId]" >&2; exit 2;; esac
[ -r "$CSV" ] && [ -r "$KONTROL" ] || { echo "STOP: CSV dan kontrol.json harus ada dan terbaca" >&2; exit 2; }
[[ "$AKUN" =~ ^[0-9]{5,32}$ ]] || { echo "STOP: accountId harus digit" >&2; exit 2; }
if [ "$MODE" = "cek" ]; then exec node "$JS" --cek-lokal "$CSV" "$KONTROL" "$AKUN"; fi
if [ "$MODE" = "commit" ] && [ "${KOMIT:-}" != "YA" ]; then echo "STOP: commit memerlukan KOMIT=YA (setelah dry-run bersih dan control total diberikan Mesa)" >&2; exit 2; fi
B64="$(base64 -w0 "$JS")"
node "$JS" --payload "$CSV" "$KONTROL" | ssh "$HOST" "docker exec -i -w /app -e BACKFILL_MODE=${MODE} -e ACCOUNT_ID=${AKUN} -e KOMIT=${KOMIT:-} -e BACKFILL_DARI=${BACKFILL_DARI:-} -e BACKFILL_SAMPAI=${BACKFILL_SAMPAI:-} \$(docker ps -q --filter label=com.docker.compose.service=backend | head -1) node -e \"eval(Buffer.from('${B64}','base64').toString())\""
