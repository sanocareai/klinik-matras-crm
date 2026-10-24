# Impor catatan historis ke production — prosedur bergerbang (HANYA catatan)

Status: **disiapkan, BELUM dijalankan di production.** Persetujuan impor diberikan terpisah setelah daftar final direview. Live saat disusun: `df00edb6` (268 migrasi, tabel rekonsiliasi kosong).
Cakupan: memuat **catatan** (`unit_usage_notes` + peristiwa + 1 batch) dari dua CSV Admin Sales. **Di luar cakupan:** posting 384 transaksi, pengeluaran stok, koreksi saldo, valuasi, jurnal HPP. Impor tidak menulis `stock_movements`, `fin_*`, material issue, atau penyesuaian — dibuktikan pada salinan (sidik jari sebelum–sesudah).

## 1. Yang dibekukan
| Berkas | sha256 |
|---|---|
| `Rekapitulasi Pemakaian Bahan SANO - 2026.xlsx - Pemakaian Bahan.csv` (595.600 byte) | `0230e650a0c4c8de631247bfef01c47c7fa533f12fb534e9eea840fef6b00d62` |
| `… - Rekapitulasi Order.csv` (92.452 byte; hanya untuk analisis, tidak diimpor) | `26295f1603da3cdd9f670129b5463ee8f4b924f0fb3b6927d452438db9e7f57a` |
| `manifest-final.json` (hitungan, hash rencana, hash keadaan akhir, daftar order/kegagalan) | lihat `SHA256SUMS` |
| `scripts/lib/impor-terkelola-pemakaian-historis.mjs` (alat; dijalankan lewat stdin, **tanpa deploy**) | lihat `SHA256SUMS` |
Kunci idempoten tiap baris = hash isi baris + urutan kemunculan. Berkas yang sama = nol perubahan.

## 2. Hitungan yang harus cocok (bukti pada data production terbaru 24 Okt)
2.668 rekord − 12 baris pengisi `#N/A` = **2.656 catatan Excel** (83 berjumlah nol + 2.573 positif) + **29 referensi ISSUE lama** (catatan LEDGER, kategori terpisah) = **2.685**. Order: 304 di rekap → 303 berbaris → **302 tampil** (RES-03092026-018 hanya baris nol). 254 ISSUE lama = 225 berpasangan dengan baris Excel + 29 tanpa pasangan; **0 pergerakan stok baru**.
Keadaan hasil: PERLU_DICEK 2.098 · SIAP_POSTING 386 (klasifikasi saja, tidak diposting) · TERCATAT_DI_STOK 73 · TIDAK_DIHITUNG 83 · BUKAN_STOK 16 (komponen lama) · LEDGER PERLU_DICEK 29.

## 3. Langkah (tiap langkah baca-saja kecuali **terapkan**)
Semua dijalankan di VPS dari release dir aktif; berkas masukan disalin ke container (hilang saat container dibuat ulang), alat dialirkan lewat stdin:
```
R=~/releases/klinik-matras/df00edb6; cd $R
DC() { SANSS_PERSIST_ROOT=$HOME/klinik-matras docker compose -p klinik-matras -f docker-compose.yml -f docker-compose.release.yml "$@"; }
W=scripts/lib/impor-terkelola-pemakaian-historis.mjs          # (dari repo; sha256 sesuai SHA256SUMS)
CID=$(DC ps -q backend); DC exec -T backend mkdir -p /tmp/impor
for f in pemakaian-bahan.csv rekapitulasi-order.csv manifest-final.json; do docker cp ~/impor-pemakaian/$f $CID:/tmp/impor/$f; done   # periksa sha256sum dulu
RUN() { DC exec -T backend node --input-type=module - "$@" < $W; }
A="--csv=/tmp/impor/pemakaian-bahan.csv --rekap=/tmp/impor/rekapitulasi-order.csv"
```
1. **Cek ulang live**: release aktif = `df00edb6`, 268 migrasi, `bash scripts/rollback-guard-rekon-pemakaian.sh` → exit 0 (KOSONG), tidak ada deploy lain.
2. **Pratinjau pada production** (baca-saja): `RUN --mode=pratinjau $A --keluar=/tmp/impor/pratinjau-prod.json` → `hashRencana` HARUS = hash di manifest yang direview. Berbeda = data bergeser → berhenti, tinjau ulang, persetujuan baru.
3. **Sebelum** (baca-saja): `RUN --mode=sebelum $A --potret=/tmp/impor/potret-sebelum.json` → semua PASS (268 migrasi, tabel KOSONG, 254 ISSUE lama, tanpa posting). Salin potret keluar: `docker cp $CID:/tmp/impor/potret-sebelum.json ~/impor-pemakaian/`.
4. **Terapkan** (SATU-SATUNYA langkah menulis; hanya setelah persetujuan impor): `RUN --mode=terapkan $A --manifest=/tmp/impor/manifest-final.json --potret=/tmp/impor/potret-sebelum.json --hash-disetujui=<hash dari persetujuan> --aktor-email=<admin>`.
   Gerbang menolak (exit 3, **tidak menulis apa pun**) bila: sha256 CSV ≠ manifest · hash disetujui kosong/salah · tabel rekonsiliasi tidak kosong · potret tidak ada · hash rencana yang dihitung ulang dari production ≠ manifest · hitungan ≠ 2.656 + 29. Lalu **satu transaksi** (±14 dtk pada salinan) membuat batch + 2.685 catatan + peristiwa, disusul evaluasi ulang idempoten.
5. **Sesudah** (baca-saja): `RUN --mode=sesudah $A --manifest=/tmp/impor/manifest-final.json --potret=/tmp/impor/potret-sebelum.json` → semua PASS: 1 batch (sha256 = CSV), 2.656 + 29, hash keadaan akhir = yang direview, setiap catatan punya peristiwa, nilai asli = baris CSV, tidak ada DIPOSTING/koreksi/pergerakan baru, sidik jari pergerakan/valuasi/jurnal/koreksi/penyesuaian/material issue/bahan **identik**, 254 ISSUE utuh, impor ulang = 0 perubahan.
6. Smoke baca-saja Produksi/Gudang (daftar Order Produksi 200; panel unit menampilkan catatan; ekspor Excel memuat sheet "Catatan Historis"; rencana posting menunjukkan **384 SIAP_POSTING tanpa diposting**).

## 4. Bila impor berhenti di tengah — pemulihan MAJU
| Berhenti di | Keadaan data | Langkah |
|---|---|---|
| Gerbang (exit 3) | Tidak ada yang ditulis | Periksa FAIL yang tercetak; bila data bergeser ulangi pratinjau → persetujuan baru. |
| Di tengah transaksi (koneksi putus, timeout 120 dtk, proses dimatikan, server restart) | PostgreSQL membatalkan SELURUH transaksi: 0 batch, 0 catatan, 0 peristiwa (**diuji**: koneksi dimatikan paksa di tengah INSERT) | Jalankan `--mode=sebelum` (harus PASS, tabel kosong), lalu **ulangi** `terapkan` dengan argumen yang sama → hasil identik (hash akhir sama; diuji). |
| Sesudah transaksi commit, sebelum/di tengah evaluasi ulang | Catatan sudah ada; evaluasi ulang tidak lengkap | `terapkan` menolak (tabel tidak kosong) — memang disengaja. Jalankan `RUN --mode=lanjut --csv=… ` (hanya evaluasi ulang idempoten) lalu `--mode=sesudah`. |
| `sesudah` ada FAIL | Catatan ada | **Jangan** menghapus/rollback. Catatan append-only (trigger menolak ubah/hapus nilai asli dan hapus baris) dan **tidak mengubah stok**, jadi dampak terbatas pada tampilan Produksi. Laporkan FAIL; perbaikan lewat jalur resmi (koreksi catatan/kecualikan) atau perbaikan maju kode, atau keputusan pemulihan khusus. |

## 5. Rollback setelah ada catatan
Begitu tabel berisi, `scripts/rollback-guard-rekon-pemakaian.sh` menjawab **exit 10 (ADA DATA)** dan `scripts/rollback-rekon-pemakaian.sh` **menolak** (exit 30): kode lama menyembunyikan "Perlu dicek", HPP PARSIAL, dan koreksi, sehingga pemakaian dan biaya bahan tampak lebih lengkap daripada kenyataan. Rollback kode rutin hanya sah selama tabel kosong. Pemulihan = **perbaikan maju** atau **keputusan pemulihan khusus** (Owner + Finance + Gudang) setelah dampak data dinilai. Karena itu rollback kode **harus dipertimbangkan sebelum** persetujuan impor, bukan sesudahnya.

## 6. Yang TIDAK dilakukan prosedur ini
Posting 384 transaksi · pengeluaran stok · koreksi saldo/pemakaian/harga · jurnal HPP · pembuatan master bahan · perubahan status unit/order. Catatan "Perlu dicek" (2.098), bahan belum di katalog (334 baris, 33 nama), dan 29 referensi ISSUE lama tetap menunggu keputusan manusia lewat UI.
