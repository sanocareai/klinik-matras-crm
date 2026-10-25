#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Akuisisi — biaya iklan tingkat sumber" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Kode lama TIDAK mengenal tabel ad_source_spend_entries / ad_source_spend_revisions: tidak membaca dan tidak menulisnya. Tabel tetap ada (tidak dihapus) dan TIDAK memengaruhi pembayaran, jurnal, stok, label customer, maupun spend per Ad.
#   Berbeda dari antrean kerja, entri biaya tidak "menunggu tindakan": rollback tidak menyembunyikan pekerjaan yang mendesak. Yang hilang dari layar = KPI biaya per sumber. Karena itu guard ini TIDAK memblokir; ia melaporkan jumlah entri + revisi
#   dan mencetak perintah ekspor CSV supaya input manual tidak terlupakan.
#   Exit: 0 = boleh rollback (informasi dicetak), 2 = guard gagal membaca (anggap perlu diperiksa dulu). Seluruh pembacaan dalam transaksi READ ONLY.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('ad_source_spend_entries','ad_source_spend_revisions')")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD GAGAL: jumlah tabel rilis tidak terbaca ('$ADA'); periksa dulu."; exit 2; }
if [ "$ADA" = "0" ]; then echo "Biaya sumber: tabel belum ada (migrasi belum terpasang); entri=0"; echo "GUARD OK: rollback kode tidak berdampak."; exit 0; fi
[ "$ADA" = "2" ] || { echo "GUARD GAGAL: hanya ${ADA} dari 2 tabel rilis ada (keadaan tidak dikenal). Periksa dulu sebelum rollback."; exit 2; }
NE="$(QR "select count(*) from ad_source_spend_entries")"; NA="$(QR "select count(*) from ad_source_spend_entries where status = 'AKTIF'")"
NB="$(QR "select count(*) from ad_source_spend_entries where status = 'DIBATALKAN'")"; NR="$(QR "select count(*) from ad_source_spend_revisions")"
NO="$(QR "select count(*) from ad_source_spend_entries where status = 'AKTIF' and override_ad_detail")"
for v in "$NE" "$NA" "$NB" "$NR" "$NO"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD GAGAL: hitungan bukan angka ('$v'); periksa dulu."; exit 2; }; done
echo "Biaya sumber: entri=${NE} (aktif ${NA}, dibatalkan ${NB}; ${NO} aktif menggantikan detail Ad); revisi=${NR}"
if [ "$NE" != "0" ]; then
  echo "Per sumber (aktif; jumlah entri | total Rp | tanggal pertama–terakhir):"
  QR "select source_id || ' | ' || count(*)::text || ' | ' || sum(amount)::text || ' | ' || min(date_from)::text || ' – ' || max(date_to)::text from ad_source_spend_entries where status='AKTIF' group by source_id order by source_id" | sed 's/^/  - /'
  echo "Setelah rollback kode, entri ini TETAP TERSIMPAN tetapi tidak terlihat oleh kode lama (KPI biaya per sumber hilang dari layar). Simpan salinan CSV bila perlu (baca-saja):"
  echo "  cd ${DIR} && SANSS_PERSIST_ROOT=${PERSIST} docker compose -p ${PROJECT} -f docker-compose.yml -f docker-compose.release.yml exec -T postgres psql -U ${DB_USER} -d ${DB_NAME} -c \"\\copy (select id, source_id, kind, date_from, date_to, account_id, amount, override_ad_detail, status, reason, revision, updated_at from ad_source_spend_entries order by source_id, date_from) to STDOUT csv header\" > biaya-sumber-\$(date +%F).csv"
fi
echo "GUARD OK: rollback kode boleh; tabel & riwayat tetap ada; tidak memengaruhi pembayaran, jurnal, stok, atau spend per Ad."
exit 0
