#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Manifest Delivery + Gabungkan Order Duplikat (baca-saja). Menolak (exit 1) bila SUDAH ada:
#   - penggabungan order (order_merges / "Order".merged_into_order_id): kode lama TIDAK menyaring order digabung dari daftar aktif, jadi order duplikat
#     akan tampil lagi sebagai pesanan aktif kedua (omzet/daftar kerja berlipat secara tampilan), dan relasinya tidak dikenal.
#   - konfirmasi muat unit (job_unit_loads): kode lama tidak membaca/menghormati konfirmasi muat; gerbang penyelesaian hilang tanpa jejak.
# Perubahan DATA yang sudah terjadi TIDAK dibalik oleh rollback kode; pembatalan penggabungan = keputusan data terpisah (backup + persetujuan Owner).
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }
echo "Release aktif: $RELEASE_DIR"
N_MERGE="$(q "select count(*) from order_merges")"
N_LOAD="$(q "select count(*) from job_unit_loads")"
for v in "$N_MERGE" "$N_LOAD"; do
  [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }
done
echo "  penggabungan order (order_merges) ........ $N_MERGE"
echo "  konfirmasi muat unit (job_unit_loads) .... $N_LOAD"
if [ "$N_MERGE" -gt 0 ] || [ "$N_LOAD" -gt 0 ]; then
  echo "TOLAK: sudah ada data fitur ini -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau rencanakan koreksi DATA dengan backup dan persetujuan Owner."
  exit 1
fi
echo "AMAN: belum ada penggabungan/konfirmasi muat -> rollback KODE diperbolehkan (2 migrasi aditif dibiarkan terpasang)."
