#!/usr/bin/env bash
# GUARD ROLLBACK KODE — Mode rute Produksi transisi (baca-saja). Rilis ini TANPA migrasi, jadi rollback kode selalu aman secara skema; guard ini hanya MELAPORKAN dampak data yang sudah tersimpan:
#   - mode rute Produksi yang dipilih Admin (fin_settings PRODUKSI_RUTE_MODE) dan penanda transisi;
#   - konfirmasi kesiapan FISIK (delivery_execution_events UNIT_READY_PHYSICAL) dan unit di job aktif yang hanya "siap" karena konfirmasi itu;
#   - unit PKR yang lahir tanpa rute (menunggu penentuan alur Produksi).
# Kode lama: item tanpa rute ditolak lagi; konfirmasi fisik tidak dikenal (job yang sudah terbentuk tetap berjalan — kode lama tidak memeriksa kesiapan saat muat/POD).
# Exit 0 = laporan tampil; exit 2 = pembacaan gagal.
set -Eeuo pipefail
RELEASE_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DB_USER="${DB_USER:-klinik}"; DB_NAME="${DB_NAME:-klinik_matras}"; PROJECT="${PROJECT:-klinik-matras}"
cd "$RELEASE_DIR"
q() { SANSS_PERSIST_ROOT="${SANSS_PERSIST_ROOT:-$HOME/klinik-matras}" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T -e PGOPTIONS="-c default_transaction_read_only=on" postgres psql -U "$DB_USER" -d "$DB_NAME" -At -c "$1"; }
echo "Release aktif: $RELEASE_DIR"
MODE="$(q "select coalesce((select value from fin_settings where key = 'PRODUKSI_RUTE_MODE'), '(tidak disetel = TRANSISI)')")" || exit 2
BERLAKU="$(q "select coalesce((select value from fin_settings where key = 'PRODUKSI_SIAP_FISIK_BERLAKU_SEJAK'), '(tidak ada)')")" || exit 2
N_FISIK="$(q "select count(*) from delivery_execution_events where action = 'UNIT_READY_PHYSICAL'")" || exit 2
N_UNIT_FISIK_AKTIF="$(q "select count(distinct u.id) from units u join job_units ju on ju.unit_id = u.id join jobs j on j.id = ju.job_id where j.type::text = 'DELIVERY' and j.status::text in ('UNSCHEDULED','SCHEDULED','ASSIGNED','EN_ROUTE','ARRIVED') and u.status::text not in ('READY_FOR_DELIVERY','READY_ON_CUSTOMER_HOLD','IN_TRANSIT_OUT','DELIVERED','CANCELLED')")" || exit 2
N_TANPA_RUTE="$(q "select count(*) from units u join \"Order\" o on o.id = u.order_id where o.penjualan_karyawan_id is not null and u.status::text in ('AWAITING_PICKUP','RECEIVED') and u.product_type is null and (u.work_category is null or u.work_category::text = 'BARU')")" || exit 2
for v in "$N_FISIK" "$N_UNIT_FISIK_AKTIF" "$N_TANPA_RUTE"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hasil pemeriksaan bukan angka: '$v'" >&2; exit 2; }; done
echo "  mode rute Produksi ........................ ${MODE}"
echo "  penanda transisi aturan unit fisik ........ ${BERLAKU}"
echo "  konfirmasi kesiapan fisik tersimpan ....... ${N_FISIK}"
echo "  unit di job aktif yang belum siap Produksi  ${N_UNIT_FISIK_AKTIF} (job berjalan terus; kode lama tidak menolaknya)"
echo "  unit PKR belum mulai tanpa rute ........... ${N_TANPA_RUTE} (tetap ada; Produksi menahan sampai jenis produk dikonfirmasi)"
echo "AMAN: rilis ini tanpa migrasi — rollback KODE diperbolehkan. Data di atas tidak dihapus oleh rollback; item tanpa rute baru akan ditolak kembali oleh kode lama."
