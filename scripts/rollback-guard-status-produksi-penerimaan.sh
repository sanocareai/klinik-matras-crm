#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Status Produksi + Penerimaan Workshop" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini (target = release live sebelumnya c332fcad: Order Produksi adopsi Admin).
#   Rollback kode TIDAK menghapus tabel unit_workshop_receipts / unit_workshop_receipt_corrections, catatan penerimaan, koreksi, serah-terima yang terbentuk dari penerimaan, maupun peristiwa outbox/aktivitas.
#   Kode lama tidak mengenal tabel baru dan TIDAK membacanya — tidak ada kode lama yang salah membaca data baru. Yang hilang setelah rollback hanya tampilan: Daftar kerja/Ruang Kerja Unit, kartu penerimaan + koreksi, antrean "Menunggu dicatat diterima".
#   Konsekuensi yang perlu diketahui (informasi, bukan penolakan):
#     (1) unit yang SUDAH dicatat diterima akan kembali tampil "Pengambilan / belum diterima workshop" di layar lama (kode lama tidak membaca penerimaan); catatannya tetap tersimpan.
#     (2) unit yang punya catatan penerimaan tidak bisa dihapus lewat jalur hapus lama (FK RESTRICT; kode lama tidak tahu itu jejak) — hasilnya galat penolakan, bukan kehilangan data. Batalkan unit lewat status.
#     (3) serah-terima (custody) + Run yang terbentuk dari penerimaan saat aktivasi V2 adalah data Produksi V2 biasa dan tetap berlaku.
#   Guard ini TIDAK menolak: exit 0 = aman, dengan ringkasan jumlah data baru sebagai informasi. Exit 1 hanya bila tabel baru tidak ada (rilis belum terpasang).
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
[ "$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('unit_workshop_receipts','unit_workshop_receipt_corrections')")" = "2" ] || { echo "Tabel penerimaan workshop tidak lengkap: migrasi belum terpasang; tidak ada yang perlu dijaga untuk rollback kode."; exit 1; }
REC="$(Q "select count(*) from unit_workshop_receipts")"
UNIT_REC="$(Q "select count(distinct unit_id) from unit_workshop_receipts")"
KOR="$(Q "select count(*) from unit_workshop_receipt_corrections")"
BATAL="$(Q "select count(*) from unit_workshop_receipt_corrections where kind = 'NOT_RECEIVED'")"
AKTIF="$(Q "select count(*) from unit_workshop_receipts r where not exists (select 1 from unit_workshop_receipt_corrections c where c.receipt_id = r.id and c.kind = 'NOT_RECEIVED')")"
SERAH="$(Q "select count(*) from domain_outbox where event_type = 'warehouse.custody.accepted' and payload ? 'fromWorkshopReceiptId'")"
for v in "$REC" "$UNIT_REC" "$KOR" "$BATAL" "$AKTIF" "$SERAH"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hitungan guard bukan angka ('$v')"; exit 2; }; done
echo "Penerimaan workshop: penerimaan workshop=${REC} (${UNIT_REC} unit; ${AKTIF} masih berlaku); koreksi=${KOR} (${BATAL} 'belum diterima'); serah-terima yang memakai penerimaan=${SERAH}"
if [ "$REC" != "0" ]; then
  echo "INFO: setelah rollback kode, ${REC} catatan penerimaan dan ${KOR} koreksi TETAP di database (tidak dihapus) tetapi tidak tampil sampai kode ini dipasang lagi; ${AKTIF} unit akan tampil 'belum diterima' di layar lama."
  echo "INFO: jangan menghapus tabel/baris penerimaan (riwayat append-only). Unit berjejak tidak bisa dihapus lewat jalur lama (FK RESTRICT) — batalkan lewat status."
fi
echo "GUARD LULUS: rollback kode aman (kode lama tidak membaca tabel penerimaan; tidak ada keadaan terbuka yang berbahaya bagi kode lama)."
exit 0
