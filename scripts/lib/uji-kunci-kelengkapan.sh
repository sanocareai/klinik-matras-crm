#!/usr/bin/env bash
# Uji terarah PENGUNCIAN DEPLOY rilis Kelengkapan — terisolasi: LOCK_DIR sementara, tanpa Docker, tanpa production. Butuh Linux (flock, pgrep, ps, setsid).
# Memuat blok KUNCI-DEPLOY dan fungsi uji_gerbang_kunci LANGSUNG dari skrip rilis (yang sama dengan yang dijalankan di VPS), lalu menjalankannya.
# Pakai: bash scripts/lib/uji-kunci-kelengkapan.sh scripts/release-kelengkapan.sh
set -Eeuo pipefail
SKRIP="$(readlink -f "${1:?pakai: uji-kunci-kelengkapan.sh <skrip-rilis>}")"
for c in flock pgrep ps setsid stat; do command -v "$c" >/dev/null 2>&1 || { echo "SKIP: perintah '$c' tidak ada (uji ini hanya untuk Linux)"; exit 77; }; done
die() { echo "GAGAL: $*" >&2; exit 1; }
ok() { echo "  OK    $*"; }
FN="$(sed -n '/^uji_gerbang_kunci() {/,/^}/p' "$SKRIP")"
[ "$(printf '%s\n' "$FN" | grep -c .)" -gt 30 ] || die "fungsi uji_gerbang_kunci tidak terbaca dari $SKRIP"
# shellcheck disable=SC1090
. <(sed -n '/^# >>> KUNCI-DEPLOY/,/^# <<< KUNCI-DEPLOY/p' "$SKRIP")
eval "$FN"
export UJI_SELF="$SKRIP"
# Reproduksi kondisi skrip rilis: stdout lewat 'tee' (proses latar yang tidak pernah selesai) — 'wait' tanpa argumen akan MACET di sini, seperti yang terjadi di rehearsal 29 Okt. Batas waktu 90 detik.
exec > >(cat)
( sleep 100 & uji_gerbang_kunci ) & UJI=$!
SEL=0; while kill -0 "$UJI" 2>/dev/null; do sleep 1; SEL=$((SEL+1)); [ "$SEL" -lt 90 ] || { kill -9 "$UJI" 2>/dev/null; pkill -P "$UJI" 2>/dev/null; die "uji kunci MACET (>90 dtk): kemungkinan 'wait' tanpa argumen"; }; done
wait "$UJI" || die "uji kunci gagal"
echo "SEMUA UJI KUNCI LULUS"
