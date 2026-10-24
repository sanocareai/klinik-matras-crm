#!/usr/bin/env bash
# PEMANGGIL RESMI rollback kode "Rekonsiliasi pemakaian historis". Menjalankan guard (baca-saja) dan MENOLAK semua exit selain 0. Default = RENCANA saja (tidak mengubah apa pun); --jalankan baru memasang kembali image lama.
#   bash scripts/rollback-rekon-pemakaian.sh <release-dir-sebelumnya> <tag-image-rollback> [--jalankan]
#   contoh: bash ~/releases/klinik-matras/<sha-baru>/scripts/rollback-rekon-pemakaian.sh ~/releases/klinik-matras/693b8c52 klinik-matras-backend:rollback-pre-rkp-<sha8>
# Exit 0 hanya bila guard exit 0 (tabel kosong). Apa pun selain itu → exit 30 (DITOLAK) dengan penjelasan guard; pemulihannya perbaikan maju atau keputusan pemulihan khusus, BUKAN skrip ini.
set -Eeuo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
PREV_DIR="${1:-}"; TAG="${2:-}"; MODE="${3:---rencana}"
[ -n "$PREV_DIR" ] && [ -n "$TAG" ] || { echo "Pemakaian: rollback-rekon-pemakaian.sh <release-dir-sebelumnya> <tag-image-rollback> [--jalankan]" >&2; exit 64; }
set +e; bash "$DIR/scripts/rollback-guard-rekon-pemakaian.sh"; RC=$?; set -e
if [ "$RC" != "0" ]; then
  echo
  echo "ROLLBACK RUTIN DITOLAK (guard exit ${RC}). Tidak ada yang dijalankan. Pemulihan = perbaikan maju atau keputusan pemulihan khusus setelah dampak data dinilai."
  exit 30
fi
[ -d "$PREV_DIR" ] && [ -f "$PREV_DIR/docker-compose.release.yml" ] || { echo "release sebelumnya tidak lengkap: $PREV_DIR" >&2; exit 65; }
docker image inspect "$TAG" >/dev/null 2>&1 || { echo "tag image rollback tidak ada: $TAG" >&2; exit 65; }
IMG="${TAG%%:*}:latest"
echo "RENCANA rollback kode (guard KOSONG):"
echo "   cd ${PREV_DIR}"
echo "   docker tag ${TAG} ${IMG}"
echo "   SANSS_PERSIST_ROOT=\$HOME/klinik-matras docker compose -p klinik-matras -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend"
[ "$MODE" = "--jalankan" ] || { echo "(rencana saja; tambahkan --jalankan untuk melaksanakan)"; exit 0; }
# Periksa ulang tepat sebelum melaksanakan (keadaan bisa berubah sejak pemeriksaan pertama)
set +e; bash "$DIR/scripts/rollback-guard-rekon-pemakaian.sh" >/dev/null 2>&1; RC2=$?; set -e
[ "$RC2" = "0" ] || { echo "ROLLBACK RUTIN DITOLAK pada pemeriksaan ulang (guard exit ${RC2}); tidak ada yang dijalankan." >&2; exit 30; }
docker tag "$TAG" "$IMG"
( cd "$PREV_DIR" && SANSS_PERSIST_ROOT="$HOME/klinik-matras" docker compose -p klinik-matras -f docker-compose.yml -f docker-compose.release.yml up -d --no-deps --force-recreate backend )
echo "Rollback kode dilaksanakan. Migrasi TIDAK dibalik (tabel baru kosong)."
