#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Koreksi Dokumen Gudang" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum Koreksi Gudang.
#   Rollback kode TIDAK menghapus tabel warehouse_corrections, 2 kolom pada stock_movements, koreksi POSTED, maupun pergerakan pembalik: riwayat koreksi tetap utuh dan saldo ledger (SUM(qty)) tetap benar.
#   Yang hilang setelah rollback hanya UI dan API koreksi. Kode lama tidak mengenal koreksi, jadi koreksi yang MENUNGGU persetujuan (PENDING_APPROVAL) akan menjadi permintaan yatim:
#   guard menolak (exit 1) selama ada koreksi PENDING_APPROVAL — setujui/tolak/batalkan dulu lewat Barang Rusak, Retur & Penyesuaian → Koreksi Dokumen.
#   Exit 0 = aman (tidak ada yang menunggu); ringkasan koreksi POSTED/REJECTED/CANCELLED dan pergerakan pembalik dicetak sebagai informasi.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
[ "$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name='warehouse_corrections'")" = "1" ] || { echo "Tabel warehouse_corrections tidak ada: migrasi Koreksi Gudang belum terpasang — rollback kode tidak berkaitan dengan koreksi."; exit 0; }
PENDING="$(Q "select count(*) from warehouse_corrections where status = 'PENDING_APPROVAL'")"
POSTED="$(Q "select count(*) from warehouse_corrections where status = 'POSTED'")"
SELESAI_LAIN="$(Q "select count(*) from warehouse_corrections where status in ('REJECTED','CANCELLED')")"
PEMBALIK="$(Q "select count(*) from stock_movements where correction_id is not null")"
for v in "$PENDING" "$POSTED" "$SELESAI_LAIN" "$PEMBALIK"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hitungan guard bukan angka ('$v')"; exit 2; }; done
echo "Koreksi: menunggu=${PENDING}, diposting=${POSTED}, ditolak/dibatalkan=${SELESAI_LAIN}; pergerakan pembalik bertaut=${PEMBALIK}"
if [ "$PENDING" != "0" ]; then
  Q "select correction_number||' | '||doc_number||' | '||kind||' | diajukan '||to_char(requested_at,'YYYY-MM-DD HH24:MI') from warehouse_corrections where status = 'PENDING_APPROVAL' order by requested_at" | sed 's/^/   menunggu: /'
  echo "GUARD MENOLAK: ada ${PENDING} koreksi menunggu persetujuan. Setujui/tolak/batalkan dulu (Barang Rusak, Retur & Penyesuaian → Koreksi Dokumen), lalu jalankan guard ini lagi."
  exit 1
fi
if [ "$POSTED" != "0" ] || [ "$PEMBALIK" != "0" ]; then
  echo "INFO: ${POSTED} koreksi diposting dan ${PEMBALIK} pergerakan pembalik TETAP di database setelah rollback kode (tidak dihapus; saldo ledger tetap benar)."
  echo "INFO: setelah rollback tidak ada UI/API untuk mengajukan, menyetujui, atau melihat koreksi sampai kode koreksi dipasang lagi. Jangan menghapus tabel/kolom koreksi."
fi
echo "GUARD LULUS: tidak ada koreksi menunggu persetujuan; rollback kode aman (riwayat koreksi tidak dihapus)."
exit 0
