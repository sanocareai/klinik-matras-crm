#!/usr/bin/env bash
# GUARD ROLLBACK "Customer aktual Penjualan Karyawan + jumlah item hingga 200 + koreksi pembeli" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - Customer ber-sumber PENJUALAN_KARYAWAN: nilai enum "LeadSource" itu tidak dikenal Prisma kode lama — MEMBACA baris Customer tsb (daftar Pelanggan, detail order, laporan) dapat GAGAL;
#   - order PKR yang customernya sudah berpindah ke pembeli aktual: kode lama menganggap pemilik order = profil karyawan (tampilan pembeli kembali salah, bukan merusak data).
# Informasi (bukan penghalang): kolom penerima/catatan baru pada "Order" diabaikan kode lama; CHECK qty 200 dibiarkan terpasang; revisi jenis PEMBELI dibaca kode lama sebagai revisi biasa.
# Exit 0  = belum ada data baru -> rollback KODE aman (migrasi aditif dibiarkan terpasang).
# Exit 1  = ADA data baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau koreksi DATA terencana (backup + persetujuan Owner).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-pkr-customer.sh
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="$HOME/klinik-matras"
MIG="20261109090000_leadsource_penjualan_karyawan"
gagal2() { printf '\033[31mTIDAK DAPAT MEMASTIKAN: %s\033[0m\n' "$*" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || gagal2 "perintah 'docker' tidak ada"
CID="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || gagal2 "harus tepat satu container backend berjalan"
DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
[ -d "$DIR" ] || gagal2 "release aktif tidak terbaca (${DIR})"
Q() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null ); }
TERPASANG="$(Q "select count(*) from _prisma_migrations where migration_name = '${MIG}' and finished_at is not null and rolled_back_at is null" || true)"
[[ "$TERPASANG" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$TERPASANG'"
if [ "$TERPASANG" != "1" ]; then
  printf 'Release aktif: %s\n' "$DIR"
  echo "Migrasi ${MIG} belum terpasang (tidak ada data baru)."
  echo "AMAN: rollback kode diperbolehkan."; exit 0
fi
CUST="$(Q "select count(*) from \"Customer\" where \"leadSource\"::text = 'PENJUALAN_KARYAWAN'")" || gagal2 "query customer PKR aktual gagal"
CUST_DIPAKAI="$(Q "select count(*) from \"Customer\" c where c.\"leadSource\"::text = 'PENJUALAN_KARYAWAN' and exists (select 1 from \"Order\" o where o.\"customerId\" = c.id)")" || gagal2 "query order customer PKR gagal"
PENERIMA="$(Q "select count(*) from \"Order\" where recipient_name is not null or recipient_phone is not null or delivery_landmark is not null or production_note is not null or delivery_note is not null")" || gagal2 "query kolom penerima gagal"
BESAR="$(Q "select count(*) from pkr_order_items where qty > 20")" || gagal2 "query item >20 gagal"
REV="$(Q "select count(*) from pkr_item_revisions where kind = 'PEMBELI'")" || gagal2 "query revisi pembeli gagal"
for v in "$CUST" "$CUST_DIPAKAI" "$PENERIMA" "$BESAR" "$REV"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n  customer ber-sumber PENJUALAN_KARYAWAN ........ %s (dipakai order: %s)\n  order dengan data penerima/catatan baru ....... %s (informasi)\n  item PKR dengan jumlah > 20 .................. %s (informasi)\n  revisi jenis PEMBELI ......................... %s (informasi)\n' "$DIR" "$CUST" "$CUST_DIPAKAI" "$PENERIMA" "$BESAR" "$REV"
if [ "$CUST" = "0" ]; then
  echo
  echo "AMAN: belum ada customer ber-sumber PENJUALAN_KARYAWAN -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  [ "$BESAR" = "0" ] || echo "Catatan: ${BESAR} item PKR berjumlah > 20 tetap sah di data; kode lama membatasi input baru 20."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-pkr-customer-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Sudah ada customer yang nilai enum sumbernya tidak dikenal kode lama (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) koreksi DATA terencana dengan backup dan persetujuan Owner (mis. memindahkan order ke customer lain lalu menghapus customer PKR yang tidak dipakai)."
echo "         Guard ini tidak mengubah apa pun."
exit 1
