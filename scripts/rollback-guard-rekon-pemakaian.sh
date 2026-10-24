#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Rekonsiliasi pemakaian historis" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini (target: 693b8c52).
# Membedakan tiga keadaan:
#   exit 0  = KOSONG   : keempat tabel baru 0 baris, tak ada koreksi pemakaian (UNIT_USAGE), tak ada penyesuaian ber-asal. Rollback kode TIDAK meninggalkan apa pun.
#   exit 10 = ADA DATA : sudah ada impor/catatan/koreksi/posting, tetapi TIDAK ada keadaan terbuka yang berbahaya. Rollback kode aman; data TETAP di database (tidak dihapus), tidak tampil di UI lama.
#                        Pergerakan stok hasil posting adalah transaksi ledger biasa dan TETAP berlaku (saldo tidak berubah oleh rollback). JANGAN menghapus tabel/baris (riwayat append-only).
#   exit 20 = TERBUKA  : ada koreksi pemakaian (UNIT_USAGE) berstatus PENDING_APPROVAL. Kode lama menampilkan baris warehouse_corrections tanpa mengenal jenis UNIT_USAGE dan tidak bisa menyetujuinya dengan benar.
#                        Selesaikan dulu (setujui/tolak/batalkan lewat kode baru) lalu jalankan guard lagi. Guard menolak (exit 20) — bukan berarti ada yang rusak.
#   exit 1  = tabel baru tidak ada (kode/migrasi rilis ini belum terpasang → tidak ada yang perlu di-rollback)       exit 2 = hitungan guard bukan angka (jangan lanjut).
# Informasi tambahan (tidak mengubah exit): catatan SIAP_POSTING (antrean posting tidak kosong), penyesuaian ber-asal yang belum diposting (alur lama tetap memprosesnya normal; asal diabaikan kode lama).
# Pemakaian: di release dir aktif: bash scripts/rollback-guard-rekon-pemakaian.sh     Rehearsal/uji: GUARD_PSQL="<perintah psql ke DB sementara>" bash scripts/rollback-guard-rekon-pemakaian.sh
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}"
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
# Semua kueri dalam transaksi READ ONLY (guard tidak mungkin menulis).
Q() {
  local sql="begin read only; $1; commit;"
  if [ -n "${GUARD_PSQL:-}" ]; then printf '%s\n' "$sql" | ${GUARD_PSQL} -v ON_ERROR_STOP=1 -X -At -q
  else printf '%s\n' "$sql" | dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q; fi
}
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('usage_import_batches','unit_usage_notes','unit_usage_note_events','fin_stock_movement_valuation_corrections')")"
if [ "$ADA" != "4" ]; then echo "Tabel rekonsiliasi pemakaian tidak lengkap (${ADA}/4): kode/migrasi rilis ini belum terpasang — tidak ada yang perlu di-rollback."; exit 1; fi
n() { local v; v="$(Q "$1")"; [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hitungan guard bukan angka ('$v') untuk: $1" >&2; exit 2; }; printf '%s' "$v"; }
BATCH="$(n "select count(*) from usage_import_batches")"
NOTE_EXCEL="$(n "select count(*) from unit_usage_notes where origin = 'EXCEL'")"
NOTE_LEDGER="$(n "select count(*) from unit_usage_notes where origin = 'LEDGER'")"
EVENT="$(n "select count(*) from unit_usage_note_events")"
SIAP="$(n "select count(*) from unit_usage_notes where state = 'SIAP_POSTING'")"
DIPOSTING="$(n "select count(*) from unit_usage_notes where state = 'DIPOSTING'")"
POSTING_MV="$(n "select count(distinct stock_movement_id) from unit_usage_notes where link_kind = 'POSTING_HISTORIS'")"
KOR_PEMAKAIAN="$(n "select count(*) from warehouse_corrections where doc_type = 'UNIT_USAGE'")"
KOR_PENDING="$(n "select count(*) from warehouse_corrections where doc_type = 'UNIT_USAGE' and status = 'PENDING_APPROVAL'")"
KOR_POSTED="$(n "select count(*) from warehouse_corrections where doc_type = 'UNIT_USAGE' and status = 'POSTED'")"
KOR_HARGA="$(n "select count(*) from fin_stock_movement_valuation_corrections")"
ADJ_ASAL="$(n "select count(*) from stock_adjustment_requests where origin_type is not null")"
ADJ_ASAL_BELUM="$(n "select count(*) from stock_adjustment_requests where origin_type is not null and status in ('DRAFT','WAITING_APPROVAL','APPROVED')")"
ADJ_ASAL_POSTED="$(n "select count(*) from stock_adjustment_requests where origin_type is not null and status = 'POSTED'")"
echo "Rekonsiliasi pemakaian: batch impor=${BATCH}; catatan Excel=${NOTE_EXCEL}, LEDGER=${NOTE_LEDGER}; peristiwa=${EVENT}; siap-posting=${SIAP}; diposting=${DIPOSTING} (pergerakan stok=${POSTING_MV})"
echo "                        koreksi pemakaian=${KOR_PEMAKAIAN} (menunggu=${KOR_PENDING}, diterapkan=${KOR_POSTED}); koreksi harga=${KOR_HARGA}; penyesuaian ber-asal=${ADJ_ASAL} (belum diposting=${ADJ_ASAL_BELUM}, diposting=${ADJ_ASAL_POSTED})"
if [ "$KOR_PENDING" != "0" ]; then
  echo "KEADAAN: TERBUKA — ${KOR_PENDING} koreksi pemakaian (UNIT_USAGE) masih MENUNGGU persetujuan."
  echo "GUARD MENOLAK (exit 20): kode lama tidak mengenal jenis UNIT_USAGE; selesaikan (setujui/tolak/batalkan) lewat kode baru sebelum rollback, lalu jalankan guard lagi. Data tidak diubah oleh guard."
  exit 20
fi
TOTAL=$(( BATCH + NOTE_EXCEL + NOTE_LEDGER + EVENT + KOR_PEMAKAIAN + KOR_HARGA + ADJ_ASAL ))
if [ "$TOTAL" = "0" ]; then
  echo "KEADAAN: KOSONG — belum ada impor, catatan, koreksi, posting, atau penyesuaian ber-asal."
  echo "GUARD LULUS (exit 0): rollback kode aman dan TIDAK meninggalkan apa pun (tabel baru tetap ada, kosong, tak dibaca kode lama; migrasi tidak perlu dibalik)."
  exit 0
fi
echo "KEADAAN: ADA DATA — rollback kode tetap aman, tetapi data berikut TETAP di database dan tidak tampil di UI lama sampai kode ini dipasang lagi:"
[ "$NOTE_EXCEL$NOTE_LEDGER" != "00" ] && echo "  • ${NOTE_EXCEL} catatan Excel + ${NOTE_LEDGER} catatan LEDGER (+ ${EVENT} peristiwa); nilai asli tidak berubah."
[ "$DIPOSTING" != "0" ] && echo "  • ${DIPOSTING} catatan sudah DIPOSTING menjadi ${POSTING_MV} pergerakan stok: transaksi ledger biasa, TETAP berlaku (saldo tidak berubah oleh rollback)."
[ "$KOR_POSTED" != "0" ] && echo "  • ${KOR_POSTED} koreksi pemakaian sudah diterapkan (pergerakan pembalik bertaut): TETAP berlaku; baris koreksinya tampil di daftar Koreksi Gudang lama sebagai jenis tak dikenal (status final, tak bisa diproses)."
[ "$KOR_HARGA" != "0" ] && echo "  • ${KOR_HARGA} koreksi harga (append-only): nilai asli valuasi tidak diubah; jejak koreksi tidak tampil di UI lama."
[ "$ADJ_ASAL" != "0" ] && echo "  • ${ADJ_ASAL} penyesuaian stok ber-asal (diposting=${ADJ_ASAL_POSTED}, belum=${ADJ_ASAL_BELUM}): kode lama memprosesnya normal dan mengabaikan asal."
[ "$SIAP" != "0" ] && echo "  • ${SIAP} catatan SIAP_POSTING (antrean posting tidak kosong): tidak ada yang diposting oleh rollback; tetap menunggu persetujuan posting terpisah."
echo "GUARD LULUS DENGAN CATATAN (exit 10): rollback kode aman. JANGAN menghapus tabel/baris rekonsiliasi (riwayat append-only); pasang kode ini lagi untuk melihatnya."
exit 10
