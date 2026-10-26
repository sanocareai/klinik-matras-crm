#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Harga Berlaku Bahan (HPP operasional)" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   Kode lama TIDAK mengenal tabel material_harga_berlaku / stock_movement_biaya_operasional / biaya_operasional_penerapan: tidak membacanya dan tidak menulisnya. Tabel tetap ada (tidak dihapus) dan TIDAK memengaruhi stok, nilai Finance, atau jurnal.
#   Namun begitu fitur DIPAKAI, rollback kode bukan lagi langkah rutin: harga berlaku dan HPP operasional hilang dari layar, pengajuan penerapan yang menunggu menjadi tak terlihat, penanda kegagalan pembekuan tak lagi dapat ditemukan,
#   dan pemakaian yang diposting selama kode lama berjalan TIDAK dibekukan harganya (celah yang baru bisa ditambal lewat penerapan khusus dua orang).
#   ATURAN (bila ragu, TOLAK):
#     - ketiga tabel belum ada                                  → LULUS (migrasi belum terpasang: tidak ada yang tersembunyi)
#     - hanya sebagian tabel ada                                → TOLAK (keadaan tidak dikenal)
#     - ketiga tabel ada DAN SEMUANYA KOSONG                    → LULUS (migrasi terpasang tetapi fitur belum dipakai: tidak ada riwayat harga, snapshot biaya operasional, maupun penerapan)
#     - ADA riwayat harga, ATAU snapshot biaya operasional, ATAU penerapan (status apa pun) → TOLAK (exit 1): rollback rutin tidak diperbolehkan; pesan memuat jumlah, contoh, dan jalur pemulihan
#   Exit: 0 = LULUS, 1 = DITOLAK (pesan memuat jumlah, contoh, alasan, pemulihan), 2 = guard sendiri gagal membaca (anggap DITOLAK). Guard ini tidak mengubah data apa pun (transaksi READ ONLY).
#   Rollback tetap dimungkinkan HANYA sebagai keputusan tertulis Owner di luar skrip ini (pemulihan penuh dari backup menghapus semua perubahan sesudahnya) — guard ini tidak menyediakan pintasan.
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
if [ "$ADA" = "0" ]; then echo "Harga Berlaku: tabel belum ada (migrasi belum terpasang); harga=0, snapshot biaya operasional=0, penerapan=0"; echo "GUARD LULUS: tidak ada yang bisa tersembunyi; rollback kode tidak berdampak."; exit 0; fi
[ "$ADA" = "3" ] || { echo "GUARD DITOLAK: hanya ${ADA} dari 3 tabel rilis ada (keadaan tidak dikenal). Jangan rollback; periksa dulu."; exit 1; }
NH="$(QR "select count(*) from material_harga_berlaku")"; NK="$(QR "select count(*) from material_harga_berlaku where jenis = 'KOREKSI'")"
NB="$(QR "select count(*) from stock_movement_biaya_operasional")"; NBB="$(QR "select count(*) from stock_movement_biaya_operasional where sumber = 'BEKU_SAAT_POSTING'")"; NBD="$(QR "select count(*) from stock_movement_biaya_operasional where sumber = 'PENERAPAN_DISETUJUI'")"
NG="$(QR "select count(*) from stock_movement_biaya_operasional g where g.status = 'GAGAL_PEMBEKUAN' and not exists (select 1 from stock_movement_biaya_operasional b where b.movement_id = g.movement_id and b.status <> 'GAGAL_PEMBEKUAN' and b.created_at >= g.created_at)")"
NGT="$(QR "select count(*) from stock_movement_biaya_operasional where status = 'GAGAL_PEMBEKUAN'")"
NP="$(QR "select count(*) from biaya_operasional_penerapan")"; NPA="$(QR "select count(*) from biaya_operasional_penerapan where status = 'DIAJUKAN'")"
NASING="$(QR "select count(*) from biaya_operasional_penerapan where status not in ('DIAJUKAN','DISETUJUI','DITOLAK','DIBATALKAN')")"
for v in "$NH" "$NK" "$NB" "$NBB" "$NBD" "$NG" "$NGT" "$NP" "$NPA" "$NASING"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan guard bukan angka ('$v'); anggap TIDAK aman."; exit 2; }; done
echo "Harga Berlaku: riwayat harga=${NH} (${NK} koreksi); snapshot biaya operasional=${NB} (${NBB} dibekukan saat posting, ${NBD} lewat penerapan disetujui, ${NGT} penanda GAGAL_PEMBEKUAN, ${NG} di antaranya belum diperbaiki); penerapan=${NP} (${NPA} menunggu keputusan)"
echo "Data ini TIDAK memengaruhi stok, valuasi Finance, atau jurnal; yang berisiko pada rollback adalah hilangnya tampilan/penanda dan celah pembekuan harga (lihat kepala skrip)."
if [ "$NASING" != "0" ]; then echo "GUARD DITOLAK: ada status penerapan tidak dikenal (${NASING}); anggap TIDAK aman."; exit 1; fi
if [ "$NH" = "0" ] && [ "$NB" = "0" ] && [ "$NP" = "0" ]; then
  echo "GUARD LULUS: fitur belum dipakai — tidak ada riwayat harga, snapshot biaya operasional, maupun penerapan. Tabel tetap ada (tidak dihapus) tetapi kosong; rollback kode tidak menyembunyikan apa pun."
  exit 0
fi
echo "GUARD DITOLAK: rollback kode RUTIN TIDAK DIPERBOLEHKAN — fitur Harga Berlaku sudah berisi data:"
[ "$NH" != "0" ] && echo "  - riwayat harga berlaku: ${NH} baris (${NK} koreksi) — akan hilang dari layar; harga operasional tidak lagi dipakai/terlihat."
[ "$NB" != "0" ] && echo "  - snapshot biaya operasional per pemakaian: ${NB} baris — HPP operasional per order/unit hilang dari layar; pemakaian baru selama kode lama berjalan TIDAK dibekukan (celah)."
[ "$NG" != "0" ] && echo "  - ${NG} pemakaian dengan pembekuan harga GAGAL yang belum diperbaiki — penandanya menjadi tak terlihat."
[ "$NPA" != "0" ] && echo "  - ${NPA} pengajuan penerapan harga ke pemakaian lama masih MENUNGGU keputusan — tak terlihat dan tak bisa diputuskan."
[ "$NP" != "0" ] && [ "$NPA" = "0" ] && echo "  - ${NP} penerapan (sudah diputuskan) — riwayat keputusannya tidak lagi terlihat."
if [ "$NPA" != "0" ]; then
  echo "Contoh pengajuan menunggu (maks 10; bahan | jumlah pemakaian | diajukan):"
  QR "select m.code || ' | ' || p.preview_count::text || ' pemakaian | ' || to_char(p.requested_at,'YYYY-MM-DD HH24:MI') from biaya_operasional_penerapan p join materials m on m.id = p.material_id where p.status = 'DIAJUKAN' order by p.requested_at limit 10" | sed 's/^/  - /'
fi
if [ "$NG" != "0" ]; then
  echo "Contoh pembekuan gagal belum diperbaiki (maks 10; bahan | waktu dicatat | alasan):"
  QR "select m.code || ' | ' || to_char(g.created_at,'YYYY-MM-DD HH24:MI') || ' | ' || left(coalesce(g.gagal_alasan,''), 90) from stock_movement_biaya_operasional g join materials m on m.id = g.material_id where g.status = 'GAGAL_PEMBEKUAN' and not exists (select 1 from stock_movement_biaya_operasional b where b.movement_id = g.movement_id and b.status <> 'GAGAL_PEMBEKUAN' and b.created_at >= g.created_at) order by g.created_at limit 10" | sed 's/^/  - /'
fi
echo "PEMULIHAN (PERBAIKAN MAJU — kode baru TETAP terpasang):"
echo "  1. Perbaiki penyebab masalah dengan rilis perbaikan di atas kode baru (hotfix), bukan dengan membuang kode baru."
[ "$NPA" != "0" ] && echo "  2. Pengajuan menunggu: setujui/tolak (orang selain pengaju) atau batalkan (pengaju) lewat Stok → bahan → 'Beri harga ke pemakaian lama'."
[ "$NG" != "0" ] && echo "  3. Pembekuan gagal: daftar lewat GET /api/finance/biaya-bahan/harga-berlaku/gagal-pembekuan, perbaiki lewat penerapan khusus dua orang (kelompok 'belum dibekukan')."
echo "  4. Bila Owner tetap memutuskan rollback: itu keputusan tertulis di luar skrip ini; rollback kode saja tidak menghapus tabel, dan pemulihan penuh dari backup MENGHAPUS semua perubahan sesudah backup."
exit 1
