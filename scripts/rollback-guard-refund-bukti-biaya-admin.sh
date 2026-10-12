#!/usr/bin/env bash
# GUARD ROLLBACK "Koreksi Refund — bukti transfer + biaya admin" — BACA-SAJA. Menentukan apakah KODE boleh dikembalikan ke release sebelumnya.
# Kode lama TIDAK memahami data yang dilahirkan fitur ini:
#   - bukti transfer refund (fin_refund_evidences) dan relasi eksplisit dokumen <-> bukti (fin_refund_evidence_links): kode lama tidak menampilkannya, tidak memeliharanya saat koreksi
#     (dokumen pengganti dibuat TANPA relasi bukti — bukti yang sudah dilampirkan terputus dari versi terbaru) dan tidak menyajikan berkasnya;
#   - nomor referensi transfer (fin_refunds.transfer_reference): kode lama tidak membawanya ke dokumen pengganti;
#   - koreksi refund ber-biaya-admin yang dibuat SESUDAH migrasi ini terpasang: dibuat lewat alur baru (pemeriksaan biaya admin ganda + konfirmasi Admin + revisi optimistis); kode lama
#     menyalin biaya admin tanpa pemeriksaan itu, sehingga koreksi berikutnya lewat kode lama dapat mencatat biaya dua kali.
# Exit 0  = belum ada data baru -> rollback KODE aman (perintah dicetak, TIDAK dijalankan).
# Exit 1  = ADA data baru -> JANGAN rollback ke kode lama. Pilih perbaiki-maju, atau koreksi DATA terencana (backup + persetujuan Owner).
# Exit 2  = guard tidak bisa memastikan (container/DB tidak terbaca) -> anggap TIDAK AMAN.
#   bash scripts/rollback-guard-refund-bukti-biaya-admin.sh
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="klinik_matras"
PERSIST="$HOME/klinik-matras"
MIG="20261105090000_refund_bukti_biaya_admin"
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
TABEL="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('fin_refund_evidences','fin_refund_evidence_links')")" || gagal2 "query tabel gagal"
[ "$TABEL" = "2" ] || gagal2 "migrasi tercatat terpasang tetapi tabel bukti refund tidak lengkap (${TABEL}/2)"
BUKTI="$(Q "select count(*) from fin_refund_evidences")" || gagal2 "query bukti gagal"
BUKTI_PAKAI="$(Q "select count(*) from fin_refund_evidences where status = 'DIGUNAKAN'")" || gagal2 "query bukti dipakai gagal"
TAUTAN="$(Q "select count(*) from fin_refund_evidence_links")" || gagal2 "query tautan gagal"
REFERENSI="$(Q "select count(*) from fin_refunds where transfer_reference is not null")" || gagal2 "query referensi gagal"
KOREKSI_FEE="$(Q "select count(*) from fin_refunds r where r.replaces_refund_id is not null and r.transfer_fee_amount > 0 and r.created_at >= (select finished_at from _prisma_migrations where migration_name = '${MIG}')")" || gagal2 "query koreksi ber-biaya-admin gagal"
for v in "$BUKTI" "$BUKTI_PAKAI" "$TAUTAN" "$REFERENSI" "$KOREKSI_FEE"; do [[ "$v" =~ ^[0-9]+$ ]] || gagal2 "hasil query bukan angka: '$v'"; done
printf 'Release aktif: %s\n  bukti transfer refund (semua) ......... %s (dipakai dokumen: %s)\n  relasi dokumen <-> bukti ............... %s\n  refund ber-nomor referensi transfer .... %s\n  koreksi ber-biaya-admin sesudah migrasi  %s\n' "$DIR" "$BUKTI" "$BUKTI_PAKAI" "$TAUTAN" "$REFERENSI" "$KOREKSI_FEE"
if [ "$BUKTI" = "0" ] && [ "$TAUTAN" = "0" ] && [ "$REFERENSI" = "0" ] && [ "$KOREKSI_FEE" = "0" ]; then
  echo
  echo "AMAN: belum ada data yang hanya dipahami kode baru (bukti, relasi bukti, referensi transfer, koreksi ber-biaya-admin) -> rollback KODE diperbolehkan (migrasi aditif dibiarkan terpasang)."
  echo "Perintah (jalankan manual, TIDAK dijalankan guard ini): ganti ke release sebelumnya + tag image rollback-pre-refund-bukti-<sha> (lihat log rilis)."
  exit 0
fi
echo
printf '\033[31mJANGAN ROLLBACK KE KODE LAMA.\033[0m Sudah ada data yang hanya dipahami kode baru (angka > 0 di atas).\n'
echo "Pilihan: (1) perbaiki-maju di kode baru; (2) koreksi DATA terencana dengan backup terbaru dan persetujuan Owner."
echo "         Bukti transfer yang sudah terunggah TIDAK boleh dihapus (trigger DB menolak); berkasnya ada di folder data/refund-bukti pada root persisten."
echo "         Guard ini tidak mengubah apa pun."
exit 1
