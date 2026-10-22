#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Rencana Produksi — jadwal mingguan" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini (target = release live sebelumnya 661cf30f: Status Produksi + Penerimaan Workshop).
#   Kode lama TIDAK mengenal tabel production_unit_schedules / production_unit_schedule_events: tidak membacanya dan tidak menulisnya.
#   Karena itu jadwal Admin yang masih BERLAKU (ACTIVE) menjadi berbahaya setelah rollback kode, walau tabelnya tetap ada:
#     (a) unit tampil "belum dijadwalkan" di layar lama padahal punya tanggal+meja di tabel baru (jadwal tersembunyi);
#     (b) kode lama bebas membuat rencana Meja (jadwal) KEDUA untuk unit itu dan tidak mengambil alih/menutup jadwal Admin → dua sumber kebenaran, kapasitas meja dihitung ganda saat kode baru dipasang lagi.
#   ATURAN (bila ragu, TOLAK):
#     - tabel jadwal belum ada            → LULUS (migrasi belum terpasang: tidak ada yang tersembunyi)
#     - hanya satu dari dua tabel ada     → TOLAK (keadaan tidak dikenal)
#     - ada jadwal ACTIVE                 → TOLAK (exit 1); selesaikan dulu lewat layar baru: jadwalkan ke Pelaksanaan Meja (jadwal berstatus ADOPTED) atau "Keluarkan dari jadwal" (CLEARED)
#     - ADOPTED, rencana Meja pengambil-alih ada, milik unit yang sama, TIDAK dibatalkan → boleh (jadwalnya sudah data Pelaksanaan Meja biasa yang dikenal kode lama)
#     - ADOPTED tetapi rencana Meja hilang/bukan milik unit itu/DIBATALKAN, atau status lain tak dikenal → TOLAK
#     - CLEARED                           → boleh (jadwal sudah dikeluarkan; tidak ada yang tersembunyi dan kode lama tidak dapat menggandakannya)
#   Exit: 0 = LULUS, 1 = DITOLAK (pesan memuat jumlah, contoh unit terdampak, alasan), 2 = guard sendiri gagal membaca (anggap DITOLAK).
#   Bila DITOLAK: jangan rollback kode. Pemulihan yang benar = PERBAIKAN MAJU (kode baru tetap terpasang) sampai semua jadwal Admin aktif diselesaikan, baru jalankan guard lagi. Guard ini tidak mengubah data apa pun.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
# Seluruh pembacaan di dalam satu transaksi READ ONLY agar guard terbukti tidak dapat menulis.
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('production_unit_schedules','production_unit_schedule_events')")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: jumlah tabel jadwal tidak terbaca ('$ADA'); anggap TIDAK aman."; exit 2; }
if [ "$ADA" = "0" ]; then echo "Jadwal Admin: tabel belum ada (migrasi belum terpasang); jadwal Admin=0"; echo "GUARD LULUS: tidak ada jadwal Admin yang bisa tersembunyi; rollback kode tidak berdampak pada jadwal."; exit 0; fi
[ "$ADA" = "2" ] || { echo "GUARD DITOLAK: hanya ${ADA} dari 2 tabel jadwal ada (keadaan tidak dikenal). Jangan rollback; periksa dulu."; exit 1; }
JAD="$(QR "select count(*) from production_unit_schedules")"
AKTIF="$(QR "select count(*) from production_unit_schedules where status = 'ACTIVE'")"
ADOPT="$(QR "select count(*) from production_unit_schedules where status = 'ADOPTED'")"
KELUAR="$(QR "select count(*) from production_unit_schedules where status = 'CLEARED'")"
EV="$(QR "select count(*) from production_unit_schedule_events")"
for v in "$JAD" "$AKTIF" "$ADOPT" "$KELUAR" "$EV"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan guard bukan angka ('$v'); anggap TIDAK aman."; exit 2; }; done
echo "Jadwal Admin: jadwal Admin=${JAD} (${AKTIF} berlaku, ${ADOPT} diambil alih rencana Meja, ${KELUAR} dikeluarkan); riwayat jadwal=${EV}"
# Baris yang MENGHALANGI rollback: ACTIVE; ADOPTED tanpa rencana Meja sah; status tak dikenal. Rencana Meja sah = ada, milik unit yang sama (lewat Run), bukan CANCELLED.
BLOK_SQL="from production_unit_schedules s join units u on u.id = s.unit_id
  left join production_run_plans_v2 p on p.id = s.adopted_plan_id left join production_runs_v2 r on r.id = p.run_id
  where s.status = 'ACTIVE'
     or (s.status = 'ADOPTED' and (s.adopted_plan_id is null or p.id is null or r.unit_id is distinct from s.unit_id or p.status = 'CANCELLED'))
     or s.status not in ('ACTIVE','ADOPTED','CLEARED')"
NBLOK="$(QR "select count(*) $BLOK_SQL")"
[[ "$NBLOK" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan penghalang tidak terbaca ('$NBLOK'); anggap TIDAK aman."; exit 2; }
if [ "$NBLOK" != "0" ]; then
  echo "GUARD DITOLAK: ${NBLOK} jadwal Admin menghalangi rollback kode (${AKTIF} masih berlaku)."
  echo "Contoh unit terdampak (maks 10; kode unit | status | tanggal | meja | alasan):"
  QR "select u.unit_code || ' | ' || s.status || ' | ' || to_char(s.production_date,'YYYY-MM-DD') || ' | ' || coalesce(s.station_code,'-') || ' | ' ||
        case when s.status = 'ACTIVE' then 'jadwal Admin berlaku: tersembunyi di layar lama dan kode lama dapat membuat rencana Meja kedua'
             when s.status = 'ADOPTED' and s.adopted_plan_id is null then 'diambil alih tetapi rencana Meja tidak tercatat'
             when s.status = 'ADOPTED' and p.id is null then 'diambil alih tetapi rencana Meja tidak ditemukan'
             when s.status = 'ADOPTED' and r.unit_id is distinct from s.unit_id then 'rencana Meja pengambil-alih bukan milik unit ini'
             when s.status = 'ADOPTED' and p.status = 'CANCELLED' then 'rencana Meja pengambil-alih sudah DIBATALKAN: unit tanpa jadwal yang jelas'
             else 'status jadwal tidak dikenal' end
      $BLOK_SQL order by s.production_date, u.unit_code limit 10" | sed 's/^/  - /'
  echo "ALASAN: kode lama tidak membaca jadwal Admin; setelah rollback jadwal-jadwal ini tersembunyi dan bisa digandakan oleh rencana Meja baru."
  echo "TINDAKAN: JANGAN rollback kode. Pulihkan dengan PERBAIKAN MAJU (kode baru tetap terpasang): di layar Rencana Produksi jadwalkan unit ke Pelaksanaan Meja atau pilih 'Keluarkan dari jadwal', lalu jalankan guard ini lagi."
  exit 1
fi
echo "GUARD LULUS: tidak ada jadwal Admin berlaku; ${ADOPT} jadwal sudah menjadi rencana Pelaksanaan Meja yang sah (dikenal kode lama) dan ${KELUAR} sudah dikeluarkan. Tabel dan riwayat jadwal TETAP ada (tidak dihapus) tetapi kode lama tidak membacanya."
exit 0
