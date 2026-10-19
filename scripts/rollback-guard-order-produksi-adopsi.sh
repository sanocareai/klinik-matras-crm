#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Order Produksi adopsi Admin" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Rollback kode TIDAK menghapus tabel production_unit_work_progress / production_unit_material_plans / production_unit_material_plan_revisions, catatan status kerja manual, rencana bahan, maupun pergerakan stok
#   hasil pemakaian aktual (itu transaksi stok resmi biasa; saldo ledger SUM(qty) tetap benar). Kode lama tidak mengenal tabel baru dan TIDAK membacanya — tidak ada kode lama yang salah membaca data baru.
#   Yang hilang setelah rollback hanya tampilan: status kerja manual dan rencana bahan tidak terlihat lagi; Sales/Delivery tidak pernah terpengaruh (catatan manual tidak mengubah status order).
#   Satu perbedaan perilaku: unit yang punya catatan/rencana tidak bisa dihapus lewat jalur hapus lama (FK RESTRICT; kode lama tidak tahu itu jejak) — hasilnya galat penolakan, bukan kehilangan data. Batalkan unit lewat status.
#   Guard ini TIDAK menolak (tidak ada keadaan terbuka yang berbahaya bagi kode lama, tidak seperti sesi/antrean): exit 0 = aman, dengan ringkasan jumlah data baru sebagai informasi. Exit 1 hanya bila tabel baru tidak ada.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
[ "$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('production_unit_work_progress','production_unit_material_plans','production_unit_material_plan_revisions')")" = "3" ] || { echo "Tabel adopsi Admin tidak lengkap: migrasi belum terpasang; tidak ada yang perlu dijaga untuk rollback kode."; exit 1; }
PROG="$(Q "select count(*) from production_unit_work_progress")"
UNIT_PROG="$(Q "select count(distinct unit_id) from production_unit_work_progress")"
PLAN="$(Q "select count(*) from production_unit_material_plans")"
REV="$(Q "select count(*) from production_unit_material_plan_revisions")"
KUNCI="$(Q "select count(*) from v2_commands where domain = 'PRODUCTION_V1' and command_type = 'UNIT_MATERIAL_USAGE_V1'")"
for v in "$PROG" "$UNIT_PROG" "$PLAN" "$REV" "$KUNCI"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "STOP: hitungan guard bukan angka ('$v')"; exit 2; }; done
echo "Adopsi Admin: catatan status kerja=${PROG} (${UNIT_PROG} unit); rencana bahan=${PLAN} unit, revisi=${REV}; pencatatan pemakaian bahan beridempotensi=${KUNCI}"
if [ "$PROG" != "0" ] || [ "$PLAN" != "0" ]; then
  echo "INFO: setelah rollback kode, ${PROG} catatan status kerja dan ${PLAN} rencana bahan TETAP di database (tidak dihapus) tetapi tidak tampil sampai kode ini dipasang lagi."
  echo "INFO: pergerakan stok pemakaian aktual adalah transaksi stok biasa dan TETAP berlaku (saldo tidak berubah oleh rollback). Jangan menghapus tabel/baris adopsi (riwayat append-only)."
fi
echo "GUARD LULUS: rollback kode aman (kode lama tidak membaca tabel adopsi; tidak ada keadaan terbuka yang berbahaya)."
exit 0
