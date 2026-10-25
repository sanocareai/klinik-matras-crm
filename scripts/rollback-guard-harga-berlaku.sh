#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Harga Berlaku Bahan (HPP operasional)" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Kode lama TIDAK mengenal tabel material_harga_berlaku / stock_movement_biaya_operasional / biaya_operasional_penerapan: tidak membacanya dan tidak menulisnya. Tabel tetap ada (tidak dihapus) dan TIDAK memengaruhi stok, nilai Finance, atau jurnal.
#   Yang berbahaya setelah rollback kode adalah pekerjaan yang MASIH MENUNGGU dan menjadi tak terlihat: penerapan harga ke pemakaian lama berstatus DIAJUKAN (tidak ada lagi layar untuk menyetujui/menolaknya).
#   ATURAN (bila ragu, TOLAK):
#     - ketiga tabel belum ada            → LULUS (migrasi belum terpasang: tidak ada yang tersembunyi)
#     - hanya sebagian tabel ada          → TOLAK (keadaan tidak dikenal)
#     - ada penerapan DIAJUKAN            → TOLAK (exit 1): putuskan/batalkan dulu lewat layar baru
#     - selebihnya                        → boleh; hanya INFORMASI (jumlah harga berlaku, pemakaian terbeku, penerapan disetujui)
#   Exit: 0 = LULUS, 1 = DITOLAK (pesan memuat jumlah, contoh, alasan), 2 = guard sendiri gagal membaca (anggap DITOLAK). Guard ini tidak mengubah data apa pun (transaksi READ ONLY).
#   Catatan setelah rollback: pemakaian yang diposting selama kode lama berjalan TIDAK dibekukan harga operasionalnya (tampil "belum dibekukan" bila kode baru dipasang lagi; hanya bisa diberi harga lewat penerapan khusus).
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
# Seluruh pembacaan di dalam satu transaksi READ ONLY agar guard terbukti tidak dapat menulis.
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name in ('material_harga_berlaku','stock_movement_biaya_operasional','biaya_operasional_penerapan')")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: jumlah tabel rilis tidak terbaca ('$ADA'); anggap TIDAK aman."; exit 2; }
if [ "$ADA" = "0" ]; then echo "Harga Berlaku: tabel belum ada (migrasi belum terpasang); harga=0, biaya operasional=0, penerapan=0"; echo "GUARD LULUS: tidak ada yang bisa tersembunyi; rollback kode tidak berdampak."; exit 0; fi
[ "$ADA" = "3" ] || { echo "GUARD DITOLAK: hanya ${ADA} dari 3 tabel rilis ada (keadaan tidak dikenal). Jangan rollback; periksa dulu."; exit 1; }
NH="$(QR "select count(*) from material_harga_berlaku")"; NK="$(QR "select count(*) from material_harga_berlaku where jenis = 'KOREKSI'")"
NB="$(QR "select count(*) from stock_movement_biaya_operasional")"; NBD="$(QR "select count(*) from stock_movement_biaya_operasional where sumber = 'PENERAPAN_DISETUJUI'")"
NP="$(QR "select count(*) from biaya_operasional_penerapan")"; NPA="$(QR "select count(*) from biaya_operasional_penerapan where status = 'DIAJUKAN'")"
NASING="$(QR "select count(*) from biaya_operasional_penerapan where status not in ('DIAJUKAN','DISETUJUI','DITOLAK','DIBATALKAN')")"
for v in "$NH" "$NK" "$NB" "$NBD" "$NP" "$NPA" "$NASING"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan guard bukan angka ('$v'); anggap TIDAK aman."; exit 2; }; done
echo "Harga Berlaku: baris harga=${NH} (${NK} koreksi); pemakaian terbeku=${NB} (${NBD} lewat penerapan disetujui); penerapan=${NP} (${NPA} menunggu keputusan)"
echo "Data ini TIDAK memengaruhi stok, valuasi Finance, atau jurnal; hanya tampilan HPP operasional yang hilang dari layar bila kode di-rollback."
if [ "$NASING" != "0" ]; then echo "GUARD DITOLAK: ada status penerapan tidak dikenal (${NASING}); anggap TIDAK aman."; exit 1; fi
if [ "$NPA" != "0" ]; then
  echo "GUARD DITOLAK: ${NPA} pengajuan penerapan harga ke pemakaian lama masih MENUNGGU keputusan — akan tersembunyi bila kode di-rollback."
  echo "Contoh pengajuan (maks 10; bahan | jumlah pemakaian | diajukan):"
  QR "select m.code || ' | ' || p.preview_count::text || ' pemakaian | ' || to_char(p.requested_at,'YYYY-MM-DD HH24:MI') from biaya_operasional_penerapan p join materials m on m.id = p.material_id where p.status = 'DIAJUKAN' order by p.requested_at limit 10" | sed 's/^/  - /'
  echo "TINDAKAN: JANGAN rollback kode. Pulihkan dengan PERBAIKAN MAJU (kode baru tetap terpasang): Stok → bahan → 'Beri harga ke pemakaian lama' — setujui/tolak (orang selain pengaju) atau batalkan (pengaju); lalu jalankan guard lagi."
  exit 1
fi
echo "GUARD LULUS: tidak ada penerapan harga yang menunggu keputusan. Tabel dan riwayat TETAP ada (tidak dihapus) tetapi kode lama tidak membacanya; tidak memengaruhi stok, valuasi Finance, atau jurnal."
exit 0
