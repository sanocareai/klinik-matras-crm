#!/usr/bin/env bash
# GUARD ROLLBACK "Item Penjualan & Pemenuhan terpadu" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - baris penjualan terpadu (fin_penjualan_karyawan_items.fulfillment / category_id / ukuran): kode lama menganggap baris penjualan hanya nama+jumlah+harga dan MENGUBAH jumlah/nama lewat jalur
#     lama; penjaga DB (trigger tertunda) lalu menolak perubahan itu atau — bila terjadi di sisi operasional saja — menyimpangkan item operasional dari baris yang menjadi sumber tagihannya;
#   - item operasional bertaut (pkr_order_items.sale_item_id / component_seq): kode lama tidak memelihara tautan satu-baris-satu-sumber (jumlah x komponen, nama Set);
#   - revisi bersisi Finance (pkr_item_revisions.finance_before / finance_after): kode lama tidak menulis/menampilkan sisi Finance dari koreksi atomik.
# Exit 0  = kanonis BELUM dipakai -> rollback kode AMAN (perintah dicetak, TIDAK dijalankan).
# Exit 1  = kanonis SUDAH dipakai -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau koreksi DATA terencana (backup + persetujuan Owner; pembatalan PKR lewat jalur resmi).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-pkr-item-penjualan-pemenuhan.sh
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
KOLOM="$(Q "select count(*) from information_schema.columns where table_schema='public' and ((table_name='fin_penjualan_karyawan_items' and column_name='fulfillment') or (table_name='pkr_order_items' and column_name='sale_item_id') or (table_name='pkr_item_revisions' and column_name='finance_before'))" || true)"
[[ "$KOLOM" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$KOLOM'"
if [ "$KOLOM" != "3" ]; then
  printf 'Release aktif: %s\n' "$DIR"
  echo "Kolom kanonis (${KOLOM}/3) belum terpasang: migrasi Item Penjualan & Pemenuhan belum diterapkan (tidak ada data baru)."
  echo "AMAN: rollback kode diperbolehkan."; exit 0
fi
BARIS="$(Q "select count(*) from fin_penjualan_karyawan_items where fulfillment is not null or category_id is not null or product_id is not null or category_code is not null or category_name is not null or perlu_dikirim is not null or length_cm is not null or width_cm is not null or thickness_cm is not null or height_cm is not null or spec_notes is not null")" || gagal2 "query baris penjualan gagal"
TAUTAN="$(Q "select count(*) from pkr_order_items where sale_item_id is not null or component_seq is not null or component_qty is not null or fulfillment is not null")" || gagal2 "query item bertaut gagal"
TAUTAN_AKTIF="$(Q "select count(*) from pkr_order_items where sale_item_id is not null and removed_at is null")" || gagal2 "query item bertaut aktif gagal"
REVISI="$(Q "select count(*) from pkr_item_revisions where finance_before is not null or finance_after is not null")" || gagal2 "query revisi gagal"
PKR_TERPADU="$(Q "select count(distinct s.penjualan_id) from fin_penjualan_karyawan_items s where s.fulfillment is not null")" || gagal2 "query PKR terpadu gagal"
for v in "$BARIS" "$TAUTAN" "$TAUTAN_AKTIF" "$REVISI" "$PKR_TERPADU"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n  baris penjualan terpadu ........ %s (pada %s PKR)\n  item operasional bertaut ....... %s (aktif: %s)\n  revisi bersisi Finance ......... %s\n' "$DIR" "$BARIS" "$PKR_TERPADU" "$TAUTAN" "$TAUTAN_AKTIF" "$REVISI"
if [ "$BARIS" = "0" ] && [ "$TAUTAN" = "0" ] && [ "$REVISI" = "0" ]; then
  echo
  echo "AMAN: kanonis belum dipakai (tidak ada baris penjualan terpadu, item bertaut, atau revisi bersisi Finance) -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-pkr-item-terpadu-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Kanonis sudah dipakai (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) koreksi DATA terencana — batalkan Penjualan Karyawan terkait lewat pembatalan resmi (order/unit/job dibatalkan lewat jalur baku)."
echo "         Rollback kode yang dipaksakan membuat koreksi lewat kode lama menyimpangkan jumlah/nama item operasional dari baris penjualan; penjaga DB menolaknya (PKR_TAUTAN_*)."
echo "         HANYA dengan backup terbaru dan persetujuan Owner. Guard ini tidak mengubah apa pun."
exit 1
