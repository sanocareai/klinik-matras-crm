#!/usr/bin/env bash
# GUARD ROLLBACK "Nota Kredit / Keringanan order + refund kelebihan bayar" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - nota kredit (fin_order_credits): kode lama mengabaikannya, sehingga TAGIHAN order kembali dihitung kotor dan status bayar order yang memakai nota akan bergeser (LUNAS -> DP);
#   - jurnal bersumber NOTA_KREDIT_ORDER: nilai enum itu tidak dikenal Prisma kode lama — membaca baris jurnal tersebut (laporan, buku besar) dapat GAGAL karena enum tak dikenal.
# Jurnal refund yang bercabang (Dr Uang Muka + Dr Retur) tetap seimbang dan sah bagi kode lama; hanya "Koreksi Refund" atas refund itu akan diblokir kode lama dengan arahan (informasi, bukan penghalang).
# Exit 0  = belum ada data baru -> rollback KODE aman (migrasi aditif dibiarkan terpasang).
# Exit 1  = ADA data baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau koreksi DATA terencana (backup + persetujuan Owner).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-nota-kredit.sh
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="$HOME/klinik-matras"
MIG="20261108090000_order_nota_kredit"
gagal2() { printf '\033[31mTIDAK DAPAT MEMASTIKAN: %s\033[0m\n' "$*" >&2; exit 2; }
for c in docker; do command -v "$c" >/dev/null 2>&1 || gagal2 "perintah '$c' tidak ada"; done
CID="$(docker ps -q --filter "label=com.docker.compose.project=${PROJECT}" --filter "label=com.docker.compose.service=backend")"
[ "$(printf '%s\n' "$CID" | grep -c .)" = "1" ] || gagal2 "harus tepat satu container backend berjalan"
DIR="$(docker inspect -f '{{index .Config.Labels "com.docker.compose.project.working_dir"}}' "$CID")"
[ -d "$DIR" ] || gagal2 "release aktif tidak terbaca (${DIR})"
Q() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -X -At -q -c "$1" </dev/null ); }
TERPASANG="$(Q "select count(*) from _prisma_migrations where migration_name = '${MIG}' and finished_at is not null and rolled_back_at is null" || true)"
[[ "$TERPASANG" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$TERPASANG'"
if [ "$TERPASANG" != "1" ]; then
  printf 'Release aktif: %s\n' "$DIR"
  echo "Migrasi ${MIG} belum terpasang (tidak ada data baru)."
  echo "AMAN: rollback kode diperbolehkan."; exit 0
fi
TABEL="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name = 'fin_order_credits'")" || gagal2 "query tabel gagal"
[ "$TABEL" = "1" ] || gagal2 "migrasi tercatat terpasang tetapi tabel fin_order_credits tidak ada"
NOTA="$(Q "select count(*) from fin_order_credits")" || gagal2 "query nota kredit gagal"
NOTA_AKTIF="$(Q "select count(*) from fin_order_credits where status = 'AKTIF'")" || gagal2 "query nota aktif gagal"
JURNAL="$(Q "select count(*) from fin_journal_entries where source::text = 'NOTA_KREDIT_ORDER'")" || gagal2 "query jurnal nota kredit gagal"
CABANG="$(Q "select count(distinct e.id) from fin_journal_entries e join fin_journal_lines l on l.entry_id = e.id join fin_accounts a on a.id = l.account_id where e.source::text = 'REFUND' and e.status::text = 'POSTED' and l.debit > 0 and a.system_key in ('UANG_MUKA_PELANGGAN','PIUTANG_USAHA') and e.created_at >= (select finished_at from _prisma_migrations where migration_name = '${MIG}')")" || gagal2 "query jurnal refund bercabang gagal"
for v in "$NOTA" "$NOTA_AKTIF" "$JURNAL" "$CABANG"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n  nota kredit (semua) ........................ %s (aktif: %s)\n  jurnal bersumber NOTA_KREDIT_ORDER ......... %s\n  jurnal refund bercabang sesudah migrasi .... %s (informasi; sah bagi kode lama)\n' "$DIR" "$NOTA" "$NOTA_AKTIF" "$JURNAL" "$CABANG"
if [ "$NOTA" = "0" ] && [ "$JURNAL" = "0" ]; then
  echo
  echo "AMAN: belum ada nota kredit dan belum ada jurnal NOTA_KREDIT_ORDER -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  [ "$CABANG" = "0" ] || echo "Catatan: ${CABANG} jurnal refund bercabang (Dr Uang Muka/Piutang + Dr Retur) tetap seimbang; 'Koreksi Refund' atas refund itu akan diblokir kode lama dengan arahan Jurnal Umum."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-nota-kredit-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Sudah ada data yang hanya dipahami kode baru (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) batalkan nota kredit lewat aplikasi (jurnal dibalik, tidak dihapus) lalu periksa ulang guard; (3) koreksi DATA terencana dengan backup dan persetujuan Owner."
echo "         Guard ini tidak mengubah apa pun."
exit 1
