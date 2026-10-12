#!/usr/bin/env bash
# GUARD ROLLBACK "PIC lini Meja Bongkar / Corner & Finishing + tombol Kembali Aplikasi Meja/Corner" — BACA-SAJA.
# Menentukan apakah KODE boleh dikembalikan ke release sebelumnya dan MENJELASKAN apa yang berubah perilakunya.
# Data baru rilis ini HANYA kolom production_operators.work_lanes (TEXT[] NOT NULL DEFAULT '{}' + CHECK TABLE/CORNER). Kode lama tidak membacanya dan tidak menulisnya;
# INSERT operator oleh kode lama tidak menyebut kolom itu sehingga DEFAULT '{}' berlaku. Jadi TIDAK ada data yang tidak dipahami kode lama -> rollback kode aman (migrasi aditif dibiarkan terpasang).
# Yang BERUBAH perilakunya saat rollback (bukan kerusakan data):
#   - kode lama KEMBALI memakai PIC Meja sebagai PIC Corner bila PIC Corner kosong (dan antrean Corner menampilkan unit PIC Meja);
#   - kode lama tidak menyaring dropdown PIC berdasarkan lini (lini yang sudah dicentang Admin menjadi tidak aktif sampai rilis ini dipasang lagi);
#   - penugasan PIC Corner yang sudah ditetapkan tetap tersimpan dan dihormati kode lama.
# Exit 0 = rollback KODE diperbolehkan (perintah dicetak oleh log rilis, TIDAK dijalankan guard ini).
# Exit 2 = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-pic-lini-tombol-kembali.sh
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="$HOME/klinik-matras"
MIG="20261106090000_production_operator_work_lanes"
gagal2() { printf '\033[31mTIDAK DAPAT MEMASTIKAN: %s\033[0m\n' "$*" >&2; exit 2; }
command -v docker >/dev/null 2>&1 || gagal2 "perintah 'docker' tidak ada"
CID="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || gagal2 "harus tepat satu container backend berjalan"
DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
[ -d "$DIR" ] || gagal2 "release aktif tidak terbaca (${DIR})"
Q() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null ); }
TERPASANG="$(Q "select count(*) from _prisma_migrations where migration_name = '${MIG}' and finished_at is not null and rolled_back_at is null" || true)"
[[ "$TERPASANG" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$TERPASANG'"
printf 'Release aktif: %s\n' "$DIR"
if [ "$TERPASANG" != "1" ]; then
  echo "Migrasi ${MIG} belum terpasang: tidak ada data baru."
  echo "AMAN: rollback kode diperbolehkan."; exit 0
fi
KOLOM="$(Q "select count(*) from information_schema.columns where table_schema='public' and table_name='production_operators' and column_name='work_lanes'")" || gagal2 "query kolom gagal"
[ "$KOLOM" = "1" ] || gagal2 "migrasi tercatat terpasang tetapi kolom work_lanes tidak ada"
OP="$(Q "select count(*) from production_operators")" || gagal2 "query operator gagal"
OP_LINI="$(Q "select count(*) from production_operators where cardinality(work_lanes) > 0")" || gagal2 "query operator berlini gagal"
OP_MEJA="$(Q "select count(*) from production_operators where 'TABLE' = any(work_lanes)")" || gagal2 "query lini meja gagal"
OP_CORNER="$(Q "select count(*) from production_operators where 'CORNER' = any(work_lanes)")" || gagal2 "query lini corner gagal"
PLAN_CORNER="$(Q "select count(*) from production_run_plans_v2 where corner_operator_id is not null and status::text <> 'CANCELLED'")" || gagal2 "query PIC Corner rencana gagal"
for v in "$OP" "$OP_LINI" "$OP_MEJA" "$OP_CORNER" "$PLAN_CORNER"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf '  operator terdaftar ........................ %s\n  operator yang sudah dicentang lini ......... %s (Meja Bongkar: %s, Corner & Finishing: %s)\n  rencana aktif dengan PIC Corner eksplisit .. %s\n' "$OP" "$OP_LINI" "$OP_MEJA" "$OP_CORNER" "$PLAN_CORNER"
echo
echo "AMAN: tidak ada data yang hanya dipahami kode baru -> rollback KODE diperbolehkan (kolom work_lanes dibiarkan terpasang; kode lama mengabaikannya)."
echo "CATATAN PERILAKU: setelah rollback, PIC Corner kosong kembali memakai PIC Meja dan dropdown tidak lagi disaring per lini; centang lini Admin tetap tersimpan dan berlaku lagi bila rilis ini dipasang kembali."
echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-plc-<sha> (lihat log rilis)."
exit 0
