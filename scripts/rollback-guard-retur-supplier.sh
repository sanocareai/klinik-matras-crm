#!/usr/bin/env bash
# GUARD ROLLBACK "Retur Supplier & Debit Note" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - retur supplier dengan barang sudah keluar (KELUAR/SELESAI): stok sudah berkurang lewat pergerakan SUPPLIER_RETURN dan jurnal RETUR_SUPPLIER;
#   - debit note (menunggu/disetujui) dan saldo kredit supplier + pemakaiannya: sisa utang faktur = nilai − pembayaran − credit_applied; kode lama menghitung sisa TANPA credit_applied
#     (aging/umur utang/pelunasan/pembayaran menjadi salah) dan tidak mengenal saldo kredit;
#   - pergerakan stok bertipe SUPPLIER_RETURN dan jurnal bersumber RETUR_SUPPLIER / DEBIT_NOTE_SUPPLIER — BAHKAN yang sudah dibatalkan (pasangan pembalik tetap ada): Prisma di kode lama
#     tidak mengenal nilai enum itu dan GAGAL membaca barisnya (daftar stok/buku besar bisa error 500);
#   - rata-rata harga bahan: kode baru mengurangkan barang yang diretur dari penerimaan asalnya; kode lama tidak.
# Exit 0  = belum ada data baru -> rollback kode AMAN (perintah dicetak, TIDAK dijalankan).
# Exit 1  = ADA data baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau koreksi DATA terencana (backup + persetujuan Owner).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-retur-supplier.sh
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
TBL="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name='supplier_returns'" || true)"
[ "$TBL" = "1" ] || { echo "Tabel supplier_returns TIDAK ada: migrasi fitur ini belum terpasang -> rollback kode AMAN (tidak ada data baru)."; exit 0; }
RETUR_KELUAR="$(Q "select count(*) from supplier_returns where status in ('KELUAR','SELESAI')")" || gagal2 "query retur keluar gagal"
RETUR_DRAF="$(Q "select count(*) from supplier_returns where status = 'DRAFT'")" || gagal2 "query retur draf gagal"
DN="$(Q "select count(*) from fin_supplier_debit_notes where status in ('MENUNGGU','DISETUJUI')")" || gagal2 "query debit note gagal"
KREDIT="$(Q "select count(*) from fin_supplier_credits where status = 'AKTIF'")" || gagal2 "query saldo kredit gagal"
PEMAKAIAN="$(Q "select count(*) from fin_supplier_credit_applications where status = 'AKTIF'")" || gagal2 "query pemakaian kredit gagal"
FAKTUR="$(Q "select count(*) from fin_supplier_bills where credit_applied <> 0")" || gagal2 "query faktur berkredit gagal"
GERAKAN="$(Q "select count(*) from stock_movements where type::text = 'SUPPLIER_RETURN'")" || gagal2 "query pergerakan stok gagal"
JURNAL="$(Q "select count(*) from fin_journal_entries where source::text in ('RETUR_SUPPLIER','DEBIT_NOTE_SUPPLIER')")" || gagal2 "query jurnal gagal"
SEMUA_DOK="$(Q "select (select count(*) from supplier_returns) + (select count(*) from fin_supplier_debit_notes) + (select count(*) from fin_supplier_credits) + (select count(*) from fin_supplier_credit_applications)")" || gagal2 "query dokumen gagal"
for v in "$RETUR_KELUAR" "$RETUR_DRAF" "$DN" "$KREDIT" "$PEMAKAIAN" "$FAKTUR" "$GERAKAN" "$JURNAL" "$SEMUA_DOK"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n' "$DIR"
printf '  retur barang sudah keluar ..... %s\n  retur draf (info) ............. %s\n  debit note menunggu/disetujui . %s\n  saldo kredit aktif ............ %s\n  pemakaian saldo kredit aktif .. %s\n  faktur dengan credit_applied .. %s\n  pergerakan SUPPLIER_RETURN .... %s (termasuk yang dibatalkan)\n  jurnal retur/debit note ....... %s (termasuk yang dibalik)\n  seluruh dokumen retur (info) .. %s\n' "$RETUR_KELUAR" "$RETUR_DRAF" "$DN" "$KREDIT" "$PEMAKAIAN" "$FAKTUR" "$GERAKAN" "$JURNAL" "$SEMUA_DOK"
if [ "$RETUR_KELUAR" = "0" ] && [ "$DN" = "0" ] && [ "$KREDIT" = "0" ] && [ "$PEMAKAIAN" = "0" ] && [ "$FAKTUR" = "0" ] && [ "$GERAKAN" = "0" ] && [ "$JURNAL" = "0" ]; then
  echo
  echo "AMAN: belum ada data yang hanya dipahami kode baru -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  [ "$RETUR_DRAF" = "0" ] || echo "Catatan: ada ${RETUR_DRAF} retur DRAF — tidak memengaruhi stok/jurnal; setelah rollback draf itu tidak terlihat sampai kode baru dipasang lagi."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-retur-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Sudah ada data yang hanya dipahami kode baru (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) koreksi DATA terencana lewat aplikasi — batalkan pemakaian saldo kredit, debit note, lalu retur (Gudang)."
echo "         Pergerakan SUPPLIER_RETURN dan jurnal pembalik tetap ada sebagai riwayat, sehingga kode lama tetap tidak aman membacanya;"
echo "         jalur ini HANYA dengan backup terbaru dan persetujuan Owner. Guard ini tidak mengubah apa pun."
exit 1
