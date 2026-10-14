#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Koreksi Order PKR (baca-saja). Menolak (exit 1) bila SUDAH ada revisi jenis baru (ORDER_ADMIN/TAMBAHAN/ADOPSI/NILAI):
# kode lama tidak mengenal jenis itu dan CHECK lama (DIBUAT/DILENGKAPI/DIKOREKSI/PEMBELI) tidak akan menerima penulisan baru; membaca/menampilkan riwayatnya juga tidak dijamin.
# Perubahan DATA yang sudah terjadi (unit tambahan, jurnal delta) TIDAK dibalik oleh rollback kode — itu koreksi data dengan backup dan persetujuan Owner.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -c "$1" </dev/null; }
echo "Release aktif: $RELEASE_DIR"
N_BARU="$(q "select count(*) from pkr_item_revisions where kind in ('ORDER_ADMIN','TAMBAHAN','ADOPSI','NILAI')")"
[[ "$N_BARU" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$N_BARU'" >&2; exit 2; }
echo "  revisi jenis baru (ORDER_ADMIN/TAMBAHAN/ADOPSI/NILAI) .... $N_BARU"
if [ "$N_BARU" -gt 0 ]; then
  echo "TOLAK: sudah ada $N_BARU revisi jenis baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner."
  exit 1
fi
echo "AMAN: belum ada revisi jenis baru -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
