#!/usr/bin/env bash
# GUARD ROLLBACK "PO Terintegrasi Finance–Gudang" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - faktur supplier dengan term_basis = 'TANGGAL_TIBA'  : jatuh tempo ada PER PENERIMAAN; kode lama membaca fin_supplier_bills.due_date (yang terawal) sebagai satu-satunya jatuh tempo
#                                                          dan tidak mengenal nilai dasar termin itu (aging/umur utang menyesatkan; penagihan ulang bisa salah);
#   - penerimaan dengan arrival_revision > 0 (kedatangan dicatat): kode lama membuka kembali jalur ganti status ke Tiba / isi jumlah datang langsung (tanpa PIC/catatan/riwayat);
#   - baris pengganti (replacement_for_line_id) dan pendamping (companion_qty): kode lama menghitung ulang "datang/ditolak" tanpa mengenal pengganti, sehingga batas PO bergeser;
#   - riwayat goods_receipt_events (append-only).
# Exit 0  = belum ada data baru -> rollback kode AMAN (perintah dicetak, TIDAK dijalankan).
# Exit 1  = ADA data baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau migrasi balik DATA terencana (backup + persetujuan Owner).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-po-terintegrasi.sh
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
TBL="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name='goods_receipt_events'" || true)"
[ "$TBL" = "1" ] || { echo "Tabel goods_receipt_events TIDAK ada: migrasi fitur ini belum terpasang -> rollback kode AMAN (tidak ada data baru)."; exit 0; }
FAKTUR="$(Q "select count(*) from fin_supplier_bills where term_basis = 'TANGGAL_TIBA'")" || gagal2 "query faktur gagal"
TIBA="$(Q "select count(*) from goods_receipts where arrival_revision > 0 or arrived_date is not null")" || gagal2 "query penerimaan gagal"
PENGGANTI="$(Q "select count(*) from goods_receipt_lines where replacement_for_line_id is not null")" || gagal2 "query pengganti gagal"
PENDAMPING="$(Q "select count(*) from goods_receipt_lines where companion_qty is not null")" || gagal2 "query pendamping gagal"
PO_PEND="$(Q "select count(*) from fin_purchase_order_lines where companion_unit is not null")" || gagal2 "query pendamping PO gagal"
RIWAYAT="$(Q "select count(*) from goods_receipt_events")" || gagal2 "query riwayat gagal"
for v in "$FAKTUR" "$TIBA" "$PENGGANTI" "$PENDAMPING" "$PO_PEND" "$RIWAYAT"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n' "$DIR"
printf '  faktur TANGGAL_TIBA ............ %s\n  penerimaan dgn kedatangan ..... %s\n  baris pengganti ............... %s\n  baris penerimaan berpendamping  %s\n  baris PO berpendamping ........ %s\n  riwayat kedatangan ............ %s\n' "$FAKTUR" "$TIBA" "$PENGGANTI" "$PENDAMPING" "$PO_PEND" "$RIWAYAT"
if [ "$FAKTUR" = "0" ] && [ "$TIBA" = "0" ] && [ "$PENGGANTI" = "0" ] && [ "$PENDAMPING" = "0" ] && [ "$PO_PEND" = "0" ] && [ "$RIWAYAT" = "0" ]; then
  echo
  echo "AMAN: belum ada data yang hanya dipahami kode baru -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-poti-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Sudah ada data yang hanya dipahami kode baru (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) migrasi balik DATA terencana — ubah term_basis faktur terkait ke 'TANGGAL_FAKTUR' dan hitung ulang due_date,"
echo "         kembalikan penerimaan ke status sebelum kedatangan — HANYA dengan backup terbaru dan persetujuan Owner. Guard ini tidak mengubah apa pun."
exit 1
