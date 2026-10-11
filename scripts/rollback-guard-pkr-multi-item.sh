#!/usr/bin/env bash
# GUARD ROLLBACK "Order PKR multi-item" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - Order berkategori CAMPURAN: Prisma kode lama tidak mengenal nilai enum itu dan GAGAL membaca barisnya (daftar order/Produksi/Delivery bisa error 500);
#   - item order PKR (pkr_order_items) + unit bertanda kategori/jenis produk efektif (units.work_category/product_line/product_type): kode lama merutekan unit menurut SATU
#     kategori/jenis di tingkat order dan menilai kelengkapan seluruh order — kasur + divan + sandaran tercampur, divan diuji sebagai kasur;
#   - buku revisi item (pkr_item_revisions) dan pengiriman sebagian (pkr_pengiriman_sebagian): kode lama tidak tahu job pengiriman gabungan/sebagian itu sah.
# Exit 0  = belum ada data baru -> rollback kode AMAN (perintah dicetak, TIDAK dijalankan).
# Exit 1  = ADA data baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau koreksi DATA terencana (backup + persetujuan Owner).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-pkr-multi-item.sh
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="$HOME/klinik-matras"
gagal2() { printf '\033[31mTIDAK DAPAT MEMASTIKAN: %s\033[0m\n' "$*" >&2; exit 2; }
for c in docker; do command -v "$c" >/dev/null 2>&1 || gagal2 "perintah '$c' tidak ada"; done
CID="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || gagal2 "harus tepat satu container backend berjalan"
DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
[ -d "$DIR" ] || gagal2 "release aktif tidak terbaca (${DIR})"
Q() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null ); }
TBL="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name='pkr_order_items'" || true)"
CAMPURAN="$(Q "select count(*) from pg_enum e join pg_type t on t.oid=e.enumtypid where t.typname='OrderCategory' and e.enumlabel='CAMPURAN'")" || gagal2 "query enum gagal"
for v in "$TBL" "$CAMPURAN"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
if [ "$TBL" != "1" ]; then
  printf 'Release aktif: %s\n' "$DIR"
  echo "Tabel pkr_order_items TIDAK ada: migrasi Order PKR multi-item belum terpasang (tidak ada data baru)."
  echo "AMAN: rollback kode diperbolehkan."; exit 0
fi
ORDER_CAMPURAN="$(Q "select count(*) from \"Order\" where category::text = 'CAMPURAN'")" || gagal2 "query order CAMPURAN gagal"
ITEM="$(Q "select count(*) from pkr_order_items")" || gagal2 "query item gagal"
ITEM_HAPUS="$(Q "select count(*) from pkr_order_items where removed_at is not null")" || gagal2 "query item dihapus gagal"
UNIT_TANDA="$(Q "select count(*) from units where work_category is not null or product_line is not null or product_type is not null")" || gagal2 "query unit bertanda gagal"
REVISI="$(Q "select count(*) from pkr_item_revisions")" || gagal2 "query revisi gagal"
KOREKSI="$(Q "select count(*) from pkr_item_revisions where kind = 'DIKOREKSI'")" || gagal2 "query koreksi gagal"
SEBAGIAN="$(Q "select count(*) from pkr_pengiriman_sebagian")" || gagal2 "query pengiriman sebagian gagal"
KATALOG_UBAH="$(Q "select count(*) from activity_events where event_type = 'PKR_KATALOG_DIUBAH'")" || gagal2 "query riwayat katalog gagal"
for v in "$ORDER_CAMPURAN" "$ITEM" "$ITEM_HAPUS" "$UNIT_TANDA" "$REVISI" "$KOREKSI" "$SEBAGIAN" "$KATALOG_UBAH"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n  order berkategori CAMPURAN ..... %s\n  item order PKR (semua) ......... %s (dihapus lunak: %s)\n  unit bertanda kategori/rute .... %s\n  revisi item (buku revisi) ...... %s (koreksi: %s)\n  pengiriman sebagian ............ %s\n  perubahan katalog (info) ....... %s\n' "$DIR" "$ORDER_CAMPURAN" "$ITEM" "$ITEM_HAPUS" "$UNIT_TANDA" "$REVISI" "$KOREKSI" "$SEBAGIAN" "$KATALOG_UBAH"
if [ "$ORDER_CAMPURAN" = "0" ] && [ "$ITEM" = "0" ] && [ "$UNIT_TANDA" = "0" ] && [ "$REVISI" = "0" ] && [ "$SEBAGIAN" = "0" ]; then
  echo
  echo "AMAN: belum ada data yang hanya dipahami kode baru (order CAMPURAN, item PKR, unit bertanda, revisi, pengiriman sebagian) -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  [ "$KATALOG_UBAH" = "0" ] || echo "Catatan: katalog item PKR pernah diubah Admin (${KATALOG_UBAH} kali) — tidak memengaruhi order; setelah rollback katalog itu tidak terlihat sampai kode baru dipasang lagi."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-pkr-multi-item-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Sudah ada data yang hanya dipahami kode baru (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) koreksi DATA terencana — batalkan Penjualan Karyawan terkait lewat pembatalan resmi (order/unit/job dibatalkan lewat jalur baku)."
echo "         Order CAMPURAN membuat kode lama GAGAL membaca tabel Order (enum tak dikenal): bila rollback tetap dipaksakan, order itu HARUS dibatalkan/dipindahkan lebih dulu,"
echo "         HANYA dengan backup terbaru dan persetujuan Owner. Guard ini tidak mengubah apa pun."
exit 1
