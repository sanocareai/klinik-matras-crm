# Impor catatan historis ke production — prosedur bergerbang (HANYA catatan)

Status: **disiapkan, BELUM dijalankan di production.** Persetujuan impor diberikan terpisah setelah daftar final direview. Live saat disusun: `df00edb6` (268 migrasi, tabel rekonsiliasi kosong).
Cakupan: memuat **catatan** (`unit_usage_notes` + peristiwa + 1 batch) dari dua CSV Admin Sales. **Di luar cakupan:** posting 384 transaksi, pengeluaran stok, koreksi saldo, valuasi, jurnal HPP. Impor tidak menulis `stock_movements`, `fin_*`, material issue, atau penyesuaian — dibuktikan pada salinan (sidik jari sebelum–sesudah).

## 1. Yang dibekukan
| Berkas | sha256 |
|---|---|
| `Rekapitulasi Pemakaian Bahan SANO - 2026.xlsx - Pemakaian Bahan.csv` (595.600 byte) | `0230e650a0c4c8de631247bfef01c47c7fa533f12fb534e9eea840fef6b00d62` |
| `… - Rekapitulasi Order.csv` (92.452 byte; hanya untuk analisis, tidak diimpor) | `26295f1603da3cdd9f670129b5463ee8f4b924f0fb3b6927d452438db9e7f57a` |
| `manifest-final.json` (hitungan, hash rencana, hash keadaan akhir, daftar order/kegagalan) | lihat `SHA256SUMS` |
| `scripts/lib/impor-terkelola-pemakaian-historis.mjs` (alat; tidak ada di image live — disalin ke container sebagai berkas, **tanpa deploy**; byte diverifikasi sendiri) | lihat `SHA256SUMS` |
Kunci idempoten tiap baris = hash isi baris + urutan kemunculan. Berkas yang sama = nol perubahan.

## 2. Hitungan yang harus cocok (bukti pada data production terbaru 24 Okt)
2.668 rekord − 12 baris pengisi `#N/A` = **2.656 catatan Excel** (83 berjumlah nol + 2.573 positif) + **29 referensi ISSUE lama** (catatan LEDGER, kategori terpisah) = **2.685**. Order: 304 di rekap → 303 berbaris → **302 tampil** (RES-03092026-018 hanya baris nol). 254 ISSUE lama = 225 berpasangan dengan baris Excel + 29 tanpa pasangan; **0 pergerakan stok baru**.
Keadaan hasil: PERLU_DICEK 2.098 · SIAP_POSTING 386 (klasifikasi saja, tidak diposting) · TERCATAT_DI_STOK 73 · TIDAK_DIHITUNG 83 · BUKAN_STOK 16 (komponen lama) · LEDGER PERLU_DICEK 29.

## 3. Langkah (tiap langkah baca-saja kecuali **terapkan**)
**Aktor audit** = akun **ADMIN** aktif yang menjalankan impor (email + id harus cocok; gerbang menolak akun non-Admin, nonaktif, atau id berbeda). Peristiwa mencatat sumber "**Excel Admin Sales yang dikonfirmasi Owner**" dan **tidak** mengatasnamakan PIC pemakaian historis (PIC hanya tersimpan sebagai nilai asli baris).
**Byte alat**: alat dijalankan DARI BERKAS (bukan stdin) di dalam container; ia menghitung sha256 dirinya sendiri dan menolak menulis bila ≠ `--sha-alat` ≠ `manifest.alat.sha256`. Hash yang sama tercetak di setiap mode (`ALAT_SHA256 …`) pada uji salinan dan pada eksekusi production.
```
R=~/releases/klinik-matras/df00edb6; cd $R; I=~/impor-pemakaian        # berisi 4 berkas beku + SHA256SUMS
( cd $I && sha256sum -c SHA256SUMS )                                   # semua OK, atau BERHENTI
DC() { SANSS_PERSIST_ROOT=$HOME/klinik-matras docker compose -p klinik-matras -f docker-compose.yml -f docker-compose.release.yml "$@"; }
CID=$(DC ps -q backend); DC exec -T backend mkdir -p /tmp/impor/alat /tmp/impor/uji
for f in pemakaian-bahan.csv rekapitulasi-order.csv manifest-final.json; do docker cp $I/$f $CID:/tmp/impor/$f; done
docker cp $I/impor-terkelola-pemakaian-historis.mjs $CID:/tmp/impor/alat/
DC exec -T backend sha256sum /tmp/impor/alat/impor-terkelola-pemakaian-historis.mjs   # = hash alat di SHA256SUMS
RUN() { DC exec -T backend node /tmp/impor/alat/impor-terkelola-pemakaian-historis.mjs "$@"; }
# TERAPKAN dijalankan di latar (nohup) supaya SSH yang putus tidak mematikan proses; log di $I/terapkan.log
RUNBG() { nohup bash -c "SANSS_PERSIST_ROOT=$HOME/klinik-matras docker compose -p klinik-matras -f docker-compose.yml -f docker-compose.release.yml exec -T backend node /tmp/impor/alat/impor-terkelola-pemakaian-historis.mjs $*" > $I/terapkan.log 2>&1 < /dev/null & }
A="--csv=/tmp/impor/pemakaian-bahan.csv --rekap=/tmp/impor/rekapitulasi-order.csv --manifest=/tmp/impor/manifest-final.json"
AK="--aktor-email=<email-admin> --aktor-id=<id-admin>"; SA="--sha-alat=<sha256-alat>"
```
1. **Cek ulang live**: release aktif = `df00edb6`, 268 migrasi, `bash scripts/rollback-guard-rekon-pemakaian.sh` → exit 0 (KOSONG), tidak ada deploy lain.
2. **Pratinjau pada production** (baca-saja): `RUN --mode=pratinjau --csv=… --rekap=… --keluar=/tmp/impor/pratinjau-prod.json` → `hashRencana` HARUS = hash di manifest yang direview. Berbeda = data bergeser → berhenti, tinjau ulang, persetujuan baru.
3. **Sebelum** (baca-saja): `RUN --mode=sebelum $A --potret=/tmp/impor/potret-sebelum.json` → semua PASS. Salin potret keluar: `docker cp $CID:/tmp/impor/potret-sebelum.json $I/`.
4. **Terapkan** (SATU-SATUNYA langkah menulis; hanya setelah persetujuan impor): `RUNBG --mode=terapkan $A --potret=/tmp/impor/potret-sebelum.json --hash-disetujui=<hash rencana> $SA $AK; tail -f $I/terapkan.log`.
   Gerbang menolak (exit 3, **tidak menulis apa pun**) bila: sha256 CSV ≠ manifest · hash disetujui kosong/salah · tabel rekonsiliasi tidak kosong · potret tidak ada · byte alat ≠ yang disetujui · aktor bukan Admin aktif yang disetujui · hash rencana yang dihitung ulang dari production ≠ manifest · hitungan ≠ 2.656 + 29. Lalu **satu transaksi** (±15 dtk pada salinan) membuat batch + 2.685 catatan + peristiwa, disusul evaluasi ulang idempoten.
5. **Sesudah** (baca-saja): `RUN --mode=sesudah $A --potret=/tmp/impor/potret-sebelum.json $AK` → semua PASS: 1 batch (sha256 = CSV, dibuat aktor), 2.656 + 29, hash keadaan akhir = yang direview, semua peristiwa atas akun aktor dan menyebut sumber, tidak ada nama PIC di peristiwa, nilai asli = baris CSV, tidak ada DIPOSTING/koreksi/pergerakan baru, sidik jari pergerakan/valuasi/jurnal/koreksi/penyesuaian/material issue/bahan **identik**, 254 ISSUE utuh, impor ulang = 0 perubahan.
6. Guard: `bash scripts/rollback-guard-rekon-pemakaian.sh` → **exit 10** (ADA DATA: rollback rutin DITOLAK — itu keadaan yang diharapkan sesudah impor).
7. Smoke baca-saja Produksi/Gudang (daftar Order Produksi 200; panel unit menampilkan catatan; ekspor Excel memuat sheet "Catatan Historis"; rencana posting menunjukkan **384 SIAP_POSTING tanpa diposting**).

## 4. Bila koneksi/proses terputus — pemulihan MAJU
**Langkah pertama SELALU** `RUN --mode=status --manifest=/tmp/impor/manifest-final.json` (baca-saja; exit 0 = KOSONG, 10 = PENUH, 20 = lain). **Jangan menjalankan `terapkan` lagi sebelum status dibaca.**
| Status | Arti | Langkah |
|---|---|---|
| **KOSONG** (exit 0) | Transaksi tidak ter-commit (gerbang menolak, koneksi putus di tengah transaksi, timeout 120 dtk, proses dimatikan, server restart): PostgreSQL membatalkan SELURUH transaksi — 0 batch, 0 catatan, 0 peristiwa (**diuji**: koneksi dimatikan paksa di tengah INSERT) | Jalankan `--mode=sebelum` (harus PASS), lalu **ulangi** `terapkan` dengan argumen yang sama → hasil identik (hash akhir sama; diuji). Jika gerbang menolak karena data bergeser: pratinjau ulang → persetujuan baru. |
| **PENUH** (exit 10) | Transaksi ter-commit (2.656 + 29, 1 batch), tetapi proses terputus sebelum/di tengah evaluasi ulang atau sebelum `sesudah` (**diuji** dengan menghentikan proses tepat setelah commit) | **Jangan** `terapkan` (gerbang menolak: tabel tidak kosong). Jalankan `RUN --mode=lanjut $A $SA $AK` (hanya evaluasi ulang idempoten; menolak bila byte/aktor salah) lalu `--mode=sesudah`. |
| **SEBAGIAN/LAIN** (exit 20) | Tidak terduga (transaksi satu-kesatuan seharusnya tidak sebagian) | **STOP.** Jangan ubah apa pun; laporkan hitungan yang tercetak. |
| `sesudah` ada FAIL | Catatan ada | **Jangan** menghapus/rollback. Catatan append-only (trigger menolak ubah/hapus nilai asli dan hapus baris) dan **tidak mengubah stok**; dampak terbatas pada tampilan Produksi. Laporkan FAIL; perbaikan lewat jalur resmi (koreksi catatan/kecualikan), perbaikan maju kode, atau keputusan pemulihan khusus. |
Koneksi SSH terputus saat `terapkan` berjalan: karena dijalankan lewat `RUNBG` (nohup) proses tetap berjalan; **tunggu ≥ 3 menit** (transaksi ±15 dtk, batas 120 dtk), baca `$I/terapkan.log`, lalu jalankan `status` — hasilnya KOSONG atau PENUH.

## 5. Rollback setelah ada catatan
Begitu tabel berisi, `scripts/rollback-guard-rekon-pemakaian.sh` menjawab **exit 10 (ADA DATA)** dan `scripts/rollback-rekon-pemakaian.sh` **menolak** (exit 30): kode lama menyembunyikan "Perlu dicek", HPP PARSIAL, dan koreksi, sehingga pemakaian dan biaya bahan tampak lebih lengkap daripada kenyataan. Rollback kode rutin hanya sah selama tabel kosong. Pemulihan = **perbaikan maju** atau **keputusan pemulihan khusus** (Owner + Finance + Gudang) setelah dampak data dinilai. Karena itu rollback kode **harus dipertimbangkan sebelum** persetujuan impor, bukan sesudahnya.

## 6. Yang TIDAK dilakukan prosedur ini
Posting 384 transaksi · pengeluaran stok · koreksi saldo/pemakaian/harga · jurnal HPP · pembuatan master bahan · perubahan status unit/order. Catatan "Perlu dicek" (2.098), bahan belum di katalog (334 baris, 33 nama), dan 29 referensi ISSUE lama tetap menunggu keputusan manusia lewat UI.
