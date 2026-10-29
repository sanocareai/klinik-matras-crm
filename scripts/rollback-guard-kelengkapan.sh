#!/usr/bin/env bash
# GUARD ROLLBACK KODE "Kelengkapan Order Produksi" (BACA-SAJA). Jalankan SEBELUM mengembalikan kode ke versi sebelum rilis ini.
#   PENILAIAN DAMPAK: kode lama (baseline sebelum rilis ini) TIDAK mengenal tabel unit_material_declarations — tidak membaca dan tidak menulisnya. Tabel tetap ada (tidak dihapus) dan TIDAK memengaruhi stok, Material Issue,
#   biaya, jurnal, harga, jadwal, Run, atau status unit/order. Dampak rollback hanya PENGLIHATAN: pernyataan "tanpa bahan baru" yang sudah tersimpan TIDAK TERLIHAT dan TIDAK DAPAT dicabut di kode lama,
#   dan penanda "pernyataan bertentangan dengan catatan bahan" tidak dihitung selama kode lama berjalan. Karena kode lama pun tidak punya penyaring kelengkapan, tidak ada data yang SALAH — hanya informasi yang
#   tertunda; dihitung ulang (read-time) begitu kode baru terpasang lagi. Karena itu guard ini TIDAK MEMBLOKIR (exit 0 bila terbaca), tetapi WAJIB: (a) mencetak jumlah + contoh, (b) mengekspor SNAPSHOT pernyataan aktif
#   ke berkas (GUARD_OUT_DIR, bawaan /tmp) supaya tidak ada yang hilang dari pandangan, (c) memperingatkan pernyataan yang bertentangan.
#   ATURAN:
#     - tabel belum ada                                  → LULUS (tidak ada yang tersembunyi)
#     - tabel ada, tanpa pernyataan aktif                → LULUS
#     - ada pernyataan aktif                             → LULUS DENGAN PERINGATAN (snapshot + jumlah + contoh; bertentangan disorot) — rollback rutin DIPERBOLEHKAN
#     - hitungan tidak terbaca / keadaan tidak dikenal   → DITOLAK (exit 2; bila ragu, TOLAK)
#   Exit: 0 = LULUS (dengan/ tanpa peringatan), 2 = guard sendiri gagal membaca (anggap DITOLAK). Guard ini tidak mengubah data apa pun (transaksi READ ONLY); satu-satunya tulisan adalah berkas snapshot di host.
set -Eeuo pipefail
PROJECT="klinik-matras"; DB_USER="klinik"; DB_NAME="${GUARD_DB:-klinik_matras}" # GUARD_DB hanya untuk rehearsal (DB sementara); tanpa itu = database production (baca-saja)
PERSIST="${HOME}/klinik-matras"; OUT_DIR="${GUARD_OUT_DIR:-/tmp}"
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
dcp() { ( cd "$DIR" && SANSS_PERSIST_ROOT="$PERSIST" docker compose -p "$PROJECT" -f docker-compose.yml -f docker-compose.release.yml "$@" ); }
Q() { dcp exec -T postgres psql -U "$DB_USER" -d "$DB_NAME" -v ON_ERROR_STOP=1 -X -At -q -c "$1" </dev/null; }
QR() { Q "BEGIN READ ONLY; $1; COMMIT;" | grep -v -E '^(BEGIN|COMMIT)$' || true; }
ADA="$(Q "select count(*) from information_schema.tables where table_schema='public' and table_name = 'unit_material_declarations'")"
[[ "$ADA" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: jumlah tabel rilis tidak terbaca ('$ADA'); anggap TIDAK aman."; exit 2; }
if [ "$ADA" = "0" ]; then echo "Kelengkapan Order Produksi: tabel belum ada (migrasi belum terpasang); pernyataan=0"; echo "GUARD LULUS: tidak ada yang bisa tersembunyi; rollback kode tidak berdampak."; exit 0; fi
NT="$(QR "select count(*) from unit_material_declarations")"
NA="$(QR "select count(*) from unit_material_declarations where status = 'ACTIVE'")"
NC="$(QR "select count(*) from unit_material_declarations where status = 'REVOKED'")"
NB="$(QR "select count(*) from unit_material_declarations d where d.status = 'ACTIVE' and (exists (select 1 from stock_movements s where s.unit_id = d.unit_id and s.type = 'ISSUE') or exists (select 1 from unit_provisional_usages p where p.unit_id = d.unit_id and p.status in ('PERLU_REKONSILIASI','DIREKONSILIASI')) or exists (select 1 from unit_component_reuse_entries c where c.unit_id = d.unit_id and c.outcome = 'REUSED' and c.kind in ('CREATED','CORRECTED')) or exists (select 1 from unit_usage_notes n where n.unit_id = d.unit_id and n.state <> 'TIDAK_DIHITUNG'))")"
for v in "$NT" "$NA" "$NC" "$NB"; do [[ "$v" =~ ^[0-9]+$ ]] || { echo "GUARD DITOLAK: hitungan guard bukan angka ('$v'); anggap TIDAK aman."; exit 2; }; done
[ "$((NA + NC))" = "$NT" ] || { echo "GUARD DITOLAK: ada status pernyataan tidak dikenal; anggap TIDAK aman."; exit 2; }
echo "Kelengkapan Order Produksi: pernyataan tercatat=${NT} (${NA} aktif, ${NC} dicabut; ${NB} aktif BERTENTANGAN dengan catatan bahan)"
echo "Data ini TIDAK memengaruhi stok, Material Issue, biaya, jurnal, harga, jadwal, Run, atau status; dampak rollback hanya penglihatan (lihat kepala skrip)."
if [ "$NA" = "0" ]; then echo "GUARD LULUS: tidak ada pernyataan aktif; rollback kode rutin diperbolehkan. Tabel tetap ada (tidak dihapus)."; exit 0; fi
SNAP="${OUT_DIR}/pernyataan-tanpa-bahan-aktif-$(date +%Y%m%d_%H%M%S).tsv"
QR "select d.declared_at::text || E'\t' || u.unit_code || E'\t' || replace(replace(d.reason, E'\t', ' '), E'\n', ' ') || E'\t' || d.declared_by from unit_material_declarations d join units u on u.id = d.unit_id where d.status = 'ACTIVE' order by d.declared_at" > "$SNAP" || { echo "GUARD DITOLAK: snapshot gagal ditulis"; exit 2; }
[ "$(grep -c . "$SNAP")" = "$NA" ] || { echo "GUARD DITOLAK: snapshot tidak lengkap ($(grep -c . "$SNAP") != ${NA})"; exit 2; }
echo "PERINGATAN: ada ${NA} pernyataan \"tanpa bahan baru\" AKTIF. Di kode lama pernyataan ini TIDAK TERLIHAT dan TIDAK DAPAT dicabut; dihitung ulang otomatis saat kode baru terpasang lagi."
[ "$NB" = "0" ] || echo "PERINGATAN: ${NB} pernyataan aktif BERTENTANGAN dengan catatan bahan (unit dinyatakan tanpa bahan, tetapi ada catatan). Periksa dan cabut setelah kode baru terpasang kembali."
echo "SNAPSHOT pernyataan aktif (tanggal | unit | alasan | pelaku): ${SNAP}"
echo "Contoh (maks 10; tanggal | unit | alasan):"
QR "select d.declared_at::text || ' | ' || u.unit_code || ' | ' || left(d.reason, 80) from unit_material_declarations d join units u on u.id = d.unit_id where d.status = 'ACTIVE' order by d.declared_at desc limit 10" | sed 's/^/  - /'
echo "GUARD LULUS DENGAN PERINGATAN: rollback kode rutin DIPERBOLEHKAN (tidak ada data yang salah); simpan snapshot di atas. Pemulihan penuh dari backup MENGHAPUS semua perubahan sesudah backup — hanya atas keputusan tertulis Owner."
exit 0
