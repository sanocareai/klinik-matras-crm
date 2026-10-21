#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Rencana Produksi — jadwal mingguan" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini (target = release live sebelumnya 661cf30f: Status Produksi + Penerimaan Workshop).
#   Rollback kode TIDAK menghapus tabel production_unit_schedules / production_unit_schedule_events, jadwal Admin, riwayat jadwal, Run/rencana Meja yang terbentuk dari aktivasi, maupun peristiwa aktivitas.
#   Kode lama tidak mengenal tabel baru dan TIDAK membacanya — tidak ada kode lama yang salah membaca data baru. Yang hilang setelah rollback hanya tampilan: kalender mingguan, antrean per tindakan, kartu jadwal, riwayat/undo jadwal Admin.
#   Konsekuensi yang perlu diketahui (informasi, bukan penolakan):
#     (1) unit yang SUDAH dijadwalkan Admin tampil "belum dijadwalkan" di layar lama (kode lama tidak membaca jadwal Admin); jadwalnya tetap tersimpan dan tampil lagi bila kode ini dipasang kembali.
#     (2) unit yang punya jadwal/riwayat tidak bisa dihapus lewat jalur hapus lama (FK RESTRICT; kode lama tidak tahu itu jejak) — hasilnya galat penolakan, bukan kehilangan data. Batalkan unit lewat status.
#     (3) rencana Meja + Run yang terbentuk dari aktivasi (jadwal Admin berstatus ADOPTED) adalah data Produksi V2 biasa dan tetap berlaku.
#   Guard ini TIDAK menolak: exit 0 = aman, dengan ringkasan jumlah data baru sebagai informasi. Exit 1 hanya bila tabel baru tidak ada (rilis belum terpasang).
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
[ "$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('production_unit_schedules','production_unit_schedule_events')")" = "2" ] || { echo "Tabel jadwal Admin tidak lengkap: migrasi belum terpasang; tidak ada yang perlu dijaga untuk rollback kode."; exit 1; }
JAD="$(Q "select count(*) from production_unit_schedules")"
AKTIF="$(Q "select count(*) from production_unit_schedules where status = 'ACTIVE'")"
ADOPT="$(Q "select count(*) from production_unit_schedules where status = 'ADOPTED'")"
KELUAR="$(Q "select count(*) from production_unit_schedules where status = 'CLEARED'")"
EV="$(Q "select count(*) from production_unit_schedule_events")"
for v in "$JAD" "$AKTIF" "$ADOPT" "$KELUAR" "$EV"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hitungan guard bukan angka ('$v')"; exit 2; }; done
echo "Jadwal Admin: jadwal Admin=${JAD} (${AKTIF} berlaku, ${ADOPT} diambil alih rencana Meja, ${KELUAR} dikeluarkan); riwayat jadwal=${EV}"
if [ "$JAD" != "0" ]; then
  echo "INFO: setelah rollback kode, ${JAD} jadwal dan ${EV} riwayat TETAP di database (tidak dihapus) tetapi tidak tampil sampai kode ini dipasang lagi; ${AKTIF} unit akan tampil 'belum dijadwalkan' di layar lama."
  echo "INFO: jangan menghapus tabel/baris jadwal (riwayat append-only). Unit berjejak tidak bisa dihapus lewat jalur lama (FK RESTRICT) — batalkan lewat status."
fi
echo "GUARD LULUS: rollback kode aman (kode lama tidak membaca tabel jadwal; tidak ada keadaan terbuka yang berbahaya bagi kode lama)."
exit 0
