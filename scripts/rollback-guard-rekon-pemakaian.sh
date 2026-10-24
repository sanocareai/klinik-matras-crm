#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Rekonsiliasi pemakaian historis" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini (target: 693b8c52). Pemanggil WAJIB memperlakukan SETIAP exit selain 0 sebagai PENOLAKAN.
#
# Prinsip: kode lama TIDAK mengenal tabel rekonsiliasi. Begitu tabel itu berisi sesuatu, kode lama MENYEMBUNYIKAN data tersebut: catatan "Perlu dicek", label "HPP bahan PARSIAL", koreksi pemakaian/saldo/harga beserta riwayatnya
# tidak tampil lagi, sehingga pemakaian dan biaya bahan unit bisa tampak lengkap padahal tidak. Pergerakan stok hasil posting tetap berlaku di ledger. Karena itu "rollback rutin" HANYA sah bila tidak ada data apa pun.
#
#   exit 0  = KOSONG   : empat tabel baru 0 baris, tak ada koreksi pemakaian (UNIT_USAGE), tak ada penyesuaian ber-asal. Rollback kode rutin BOLEH (tidak ada yang tersembunyi/tertinggal).
#   exit 10 = DITOLAK, ADA DATA : sudah ada catatan/impor/koreksi/posting. Rollback rutin DITOLAK. Pemulihan = PERBAIKAN MAJU (pasang versi perbaikan dari kode ini) atau KEPUTUSAN PEMULIHAN KHUSUS
#                        (Owner + Finance + Gudang) setelah dampak data dinilai. Jangan menghapus tabel/baris (riwayat append-only).
#   exit 20 = DITOLAK, TERBUKA  : ada koreksi pemakaian (UNIT_USAGE) berstatus PENDING_APPROVAL (juga mencakup 'ada data'). Selesaikan lewat kode baru (setujui/tolak/batalkan) lalu nilai ulang; tetap bukan rollback rutin bila data ada.
#   exit 1  = DITOLAK, tabel baru tidak lengkap (kode/migrasi rilis ini belum terpasang → rollback kode ini tidak berlaku).   exit 2 = DITOLAK, hitungan guard bukan angka.   exit 3 = guard tidak baca-saja (hanya --uji-baca-saja).
# Mode --uji-baca-saja: membuktikan transaksi guard menolak tulis (UPDATE tanpa baris dicoba; harus ditolak oleh PostgreSQL) lalu keluar (exit 0 = terbukti baca-saja).
# Pemakaian: di release dir aktif: bash scripts/rollback-guard-rekon-pemakaian.sh     Rehearsal/uji: GUARD_PSQL="<perintah psql ke DB sementara>" bash scripts/rollback-guard-rekon-pemakaian.sh
# Pemanggil resmi: scripts/rollback-rekon-pemakaian.sh (menolak semua exit selain 0).
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
if [ "${1:-}" = "--uji-baca-saja" ]; then
  if Q "update _prisma_migrations set checksum = checksum where false" >/dev/null 2>&1; then echo "GAGAL: transaksi guard MENERIMA UPDATE — bukan baca-saja"; exit 3; fi
  echo "BACA-SAJA TERBUKTI: transaksi guard menolak UPDATE (read only)."; exit 0
fi
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('usage_import_batches','unit_usage_notes','unit_usage_note_events','fin_stock_movement_valuation_corrections')")"
if [ "$ADA" != "4" ]; then echo "ROLLBACK RUTIN DITOLAK (exit 1): tabel rekonsiliasi pemakaian tidak lengkap (${ADA}/4) — kode/migrasi rilis ini belum terpasang, rollback kode ini tidak berlaku."; exit 1; fi
n() { local v; v="$(Q "$1")"; [[ "$v" =~ ^[0-9]+$ ]] || { echo "ROLLBACK RUTIN DITOLAK (exit 2): hitungan guard bukan angka ('$v') untuk: $1" >&2; exit 2; }; printf '%s' "$v"; }
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
TOTAL=$(( BATCH + NOTE_EXCEL + NOTE_LEDGER + EVENT + KOR_PEMAKAIAN + KOR_HARGA + ADJ_ASAL ))
if [ "$TOTAL" = "0" ]; then
  echo "KEADAAN: KOSONG — belum ada impor, catatan, koreksi, posting, atau penyesuaian ber-asal."
  echo "GUARD LULUS (exit 0): rollback kode rutin BOLEH — tidak ada data yang akan tersembunyi atau tertinggal (tabel baru tetap ada, kosong, tak dibaca kode lama; migrasi tidak perlu dibalik)."
  exit 0
fi
# Dari sini SELALU ditolak.
echo "KEADAAN: ADA DATA — kode lama akan MENYEMBUNYIKAN data berikut (tidak dihapus, tetapi tidak tampil di UI lama):"
[ "$NOTE_EXCEL$NOTE_LEDGER" != "00" ] && echo "  • ${NOTE_EXCEL} catatan Excel + ${NOTE_LEDGER} catatan LEDGER (+ ${EVENT} peristiwa): label \"Perlu dicek\" dan nilai asli hilang dari layar; pemakaian bahan unit tampak lebih lengkap daripada kenyataan."
[ "$DIPOSTING" != "0" ] && echo "  • ${DIPOSTING} catatan sudah DIPOSTING menjadi ${POSTING_MV} pergerakan stok: transaksi ledger biasa, TETAP berlaku (saldo tidak kembali oleh rollback); asal dan tanggal historisnya tidak dijelaskan lagi di UI."
[ "$KOR_POSTED" != "0" ] && echo "  • ${KOR_POSTED} koreksi pemakaian sudah diterapkan (pergerakan pembalik bertaut): TETAP berlaku; baris koreksinya tampil di daftar Koreksi Gudang lama sebagai jenis tak dikenal."
[ "$KOR_PENDING" != "0" ] && echo "  • ${KOR_PENDING} koreksi pemakaian MENUNGGU persetujuan: kode lama tidak mengenal jenis UNIT_USAGE dan tidak bisa menyetujuinya dengan benar."
[ "$KOR_HARGA" != "0" ] && echo "  • ${KOR_HARGA} koreksi harga (append-only): jejak koreksi tidak tampil; label HPP PARSIAL hilang sehingga biaya bahan bisa tampak final."
[ "$ADJ_ASAL" != "0" ] && echo "  • ${ADJ_ASAL} penyesuaian stok ber-asal (diposting=${ADJ_ASAL_POSTED}, belum=${ADJ_ASAL_BELUM}): kode lama memprosesnya normal tetapi tidak lagi menunjukkan asalnya."
[ "$SIAP" != "0" ] && echo "  • ${SIAP} catatan SIAP_POSTING (antrean posting tidak kosong)."
echo "PEMULIHAN: bukan rollback rutin. Pilihan: (1) PERBAIKAN MAJU — pasang versi perbaikan dari kode ini; (2) KEPUTUSAN PEMULIHAN KHUSUS oleh Owner + Finance + Gudang setelah dampak data dinilai (mis. koreksi pemakaian pembalik, koreksi catatan, atau prosedur tertulis tersendiri)."
echo "JANGAN menghapus tabel/baris rekonsiliasi (riwayat append-only) dan JANGAN memasang kode lama diam-diam. Guard tidak mengubah data."
if [ "$KOR_PENDING" != "0" ]; then
  echo "ROLLBACK RUTIN DITOLAK (exit 20): ada koreksi pemakaian menunggu persetujuan (dan data lain bila terdaftar di atas). Selesaikan lewat kode baru, lalu nilai ulang."
  exit 20
fi
echo "ROLLBACK RUTIN DITOLAK (exit 10): tabel rekonsiliasi sudah berisi data."
exit 10
