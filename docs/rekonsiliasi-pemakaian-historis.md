# Rekonsiliasi Pemakaian Historis (Sep–Okt 2026) — rancangan bertahap

Status: **kandidat di branch `feat/rekon-pemakaian-historis` (belum deploy, belum menyentuh production)**. Dibangun di atas `693b8c52` (UX Bahan katalog, juga belum deploy) yang berdiri di atas live `fa6beb86`.

## 1. Keputusan Owner yang dipenuhi
| Keputusan | Pemenuhan |
|---|---|
| CSV Admin Sales = sumber catatan historis; nilai asli disimpan, jangan "diperbaiki" otomatis | `unit_usage_notes.raw_*` dikunci trigger DB; angka janggal hanya diberi penanda. LEM `1,5 KG` pada bahan `CAN` → penanda `SATUAN_BEDA_MASTER` "kg atau kemasan? Tidak dikonversi otomatis" (tanpa ×13). |
| Semua order yang punya baris bahan harus tampil di Produksi; jangan gandakan 254 ISSUE | Setiap baris → satu catatan; yang sama dengan ISSUE lama ditautkan (`TERCATAT_DI_STOK`, tanpa movement baru). Tampil di Bahan, Ringkasan, Riwayat, daftar, Excel. |
| Alur koreksi mudah: pemakaian per order, saldo bahan, harga — terpisah, berjejak | Koreksi catatan · koreksi pemakaian per order (efek stok) · koreksi saldo (Stock Adjustment + `saldoBaru`) · koreksi harga (tabel sendiri). Semua: sebelum–sesudah, alasan, pelaku, waktu, tautan ke asal. Tidak ada yang menimpa. |
| "Perlu dicek" + catatan singkat; bahan baru boleh jadi master tanpa stok; komponen lama terpisah | Penanda BLOK/INFO dengan teks + tindakan. Master baru tidak menambah stok; nama persis dipetakan otomatis saat evaluasi ulang; "belum ada catatan stok" ≠ saldo nol. Komponen lama (`KILOAN`, `LAMA`) → `BUKAN_STOK`. |
| HPP per order parsial bila belum pasti | `bacaJejakUnit` menambah gap `CATATAN_BELUM_JADI_STOK`, `PEMAKAIAN_PERLU_DICEK`, `JURNAL_PERLU_PENYESUAIAN`; `ringkasan.parsial`; Detail Order Produksi menampilkan "HPP bahan PARSIAL" + gap. |

## 2. Audit jalur data Gudang–Produksi (live `fa6beb86`)
* Ledger: `stock_movements` (`postStockMovement`: kunci bahan, invarian saldo ≥ 0). Pergerakan bertaut `unit_id` **langsung tampil** di Bahan/Ringkasan/Riwayat/daftar/Excel Order Produksi (`ambilPemakaianAktual`, `productionOrderList`, `productionOrderExport`).
* 254 ISSUE September (impor `createMany`): bertaut unit (254/254, 34 unit DELIVERED) → tampil; **pelaku kosong, 0 valuasi, 0 jurnal**.
* Jalur resmi `POST /units/:id/materials`: cap waktu = sekarang (tak bisa historis) + otomatis jurnal HPP.
* Unit 360 (`production-v2`) hanya melayani unit kohort V2 → tidak relevan untuk order September/Oktober.
* Koreksi yang sudah ada: `warehouse_corrections` (hanya GR; pemohon ≠ penyetuju), Stock Adjustment (review-gated; satu-langkah ditutup), `unit_provisional_usages` (menolak unit DELIVERED dan bahan berstok → tidak cocok untuk data ini).
* Branch lain: hanya `fix/ux-bahan-drawer-pemakaian` (693b8c52) menyentuh berkas yang sama (`bahan/*`, `unitProvisionalUsageService`) → kandidat ini ditumpuk di atasnya; branch lain hanya menyentuh `schema.prisma` (migrasi berbeda, tidak bentrok). Perubahan pada berkas bersama dibuat **aditif**.

## 3. Fase
| Fase | Isi | Status kandidat |
|---|---|---|
| 1 Catatan | tabel `unit_usage_notes` (+ batch, peristiwa), impor idempoten, klasifikasi, tampil di Produksi, laporan | selesai + diuji |
| 2 Koreksi | koreksi catatan/konfirmasi/kecualikan · koreksi pemakaian (UNIT_USAGE) · koreksi saldo (origin + saldoBaru) · koreksi harga | selesai (backend + UI catatan/pemakaian) + diuji; UI koreksi harga & antrean persetujuan belum |
| 3 Posting terpadu | `postingPemakaianHistoris`: rencana berhash → persetujuan → satu transaksi per order, tanggal historis, valuasi beku, idempoten | selesai + diuji (belum dijalankan di production) |
| 4 HPP | gap parsial per unit; koreksi harga terpisah | selesai (read-model); jurnal HPP historis = keputusan Finance |
| 5 Rilis | skrip rilis bergerbang (`release-rekon-pemakaian.sh`; kode+skema saja), UI persetujuan koreksi pemakaian + koreksi saldo "saldo yang benar" | skrip + rehearsal selesai; menunggu persetujuan Owner dan 693b8c52 live |

## 4. Model data (migrasi `20261228090000_catatan_pemakaian_historis`, aditif)
`usage_import_batches` · `unit_usage_notes` · `unit_usage_note_events` (append-only) · `fin_stock_movement_valuation_corrections` (append-only) · kolom `origin_type/origin_id` di `stock_adjustment_requests` · pagar `warehouse_corrections.doc_type` + `UNIT_USAGE`.
Keadaan catatan: `TERCATAT_DI_STOK` · `PERLU_DICEK` · `SIAP_POSTING` · `DIPOSTING` · `BUKAN_STOK` · `TIDAK_DIHITUNG` · `DIKOREKSI`.
Invarian: nilai asli tak berubah; catatan tak dihapus; setiap perubahan ada peristiwa; catatan **tidak** mengubah status kerja dan **tidak** dijumlahkan ke "Pemakaian aktual".

## 5. Runbook
1. `node scripts/import-pemakaian-historis.js <csv>` (dry-run) → baca ringkasan.
2. `... --apply` → catatan tampil di Produksi; ulang = nol perubahan.
3. `node scripts/laporan-rekonsiliasi-pemakaian.js --keluar=... ` → kejanggalan per bahan/order, dampak stok & HPP.
4. Tindak lanjut lewat UI: koreksi catatan, konfirmasi baris berulang, kecualikan salinan ganda, ajukan koreksi pemakaian (disetujui orang lain), koreksi saldo (Stock Adjustment), buat master bahan baru (tanpa stok).
5. `GET /api/production/posting-historis/rencana` → hash → Owner menyetujui → `POST .../jalankan {hashDisetujui, rujukan}` (izin `inventory:adjustment_approve`). `jurnalHPP` default **mati**.
6. Pasca-posting: kueri baca-saja di `docs`/lampiran rilis (jumlah movement, tanpa duplikat, tanpa saldo negatif baru, valuasi beku, pelaku terisi, status unit tak berubah).
Rollback/pemulihan: lihat §10. Ringkas: rollback kode rutin hanya sah bila tabel rekonsiliasi KOSONG; begitu ada catatan/koreksi/posting kode lama menyembunyikannya, jadi rollback rutin DITOLAK dan pemulihannya perbaikan maju atau keputusan pemulihan khusus. Posting yang sudah terjadi dikoreksi dengan **koreksi pemakaian** (pembalik bertaut asal), bukan dihapus.

## 6. Keputusan terbuka
* Jurnal HPP historis (tanggal Sep–Okt) atau cukup valuasi beku.
* Harga: 319 dari 384 transaksi siap-posting **tanpa harga perolehan** di ledger (persediaan awal belum diposting) → HPP parsial sampai ada harga (koreksi harga manual atau cutover persediaan).
* Faktor satuan (kecuali LEM 13 kg/CAN yang terbukti) dan pemetaan nama bahan — lihat laporan.

## 7. Rilis KODE dipisah dari tindakan DATA
| Tahap | Isi | Persetujuan |
|---|---|---|
| **R1. Rilis kode + skema** | `scripts/release-rekon-pemakaian.sh` (bergerbang, dibangkitkan oleh `scripts/gen-release-rekon-pemakaian.cjs`): memasang kode + 1 migrasi aditif (4 tabel baru KOSONG, 2 kolom nullable, 1 pagar CHECK diperlonggar satu hal). **Tidak** mengimpor CSV, **tidak** memposting 384 transaksi, **tidak** menulis jurnal. Selesai dengan antrean kosong; smoke membuktikan tabel baru 0 baris dan rencana posting 0 transaksi. | Persetujuan rilis (SHA + baseline) |
| **R2. Impor catatan** | `backend/scripts/import-pemakaian-historis.js` (dry-run → `--apply`) pada CSV final: menambah catatan "Perlu dicek"/"sudah di stok" TANPA efek stok. | Persetujuan terpisah, setelah R1 live dan terverifikasi |
| **R3. Posting** | `GET /posting-historis/rencana` → hash → Owner menyetujui → `POST /posting-historis/jalankan`. `jurnalHPP` mati. | Persetujuan terpisah (hash + rujukan Owner) + jawaban Finance atas harga/jurnal |

Prasyarat R1: rilis UX Bahan katalog (`693b8c52`, migrasi `20261227090000`) harus **sudah live** — skrip dibangkitkan dengan baseline itu dan berhenti bila release aktif bukan baseline-nya. Rollback R1: hanya lewat `scripts/rollback-rekon-pemakaian.sh` (guard baca-saja; hanya exit 0 = tabel kosong yang lolos) — lihat §10.

Bukti yang dipakai sebelum meminta persetujuan R1: gerbang sumber lulus pada server (`--preflight-only`, baca-saja; berhenti tepat di gerbang prasyarat karena live masih `fa6beb86`); rehearsal pada **restore backup production terbaru (23 Okt 19:45 WIB)** dengan baseline 693b8c52 disimulasikan: 267 → 268 migrasi, skema/fungsi/isi 253 tabel lama identik, 30 kelompok sidik jari beku identik, tanpa drift `schema.prisma` pada objek rilis, `migrate deploy` kedua = no-op, antrean posting kosong, jalur tulis (impor mini → posting → koreksi → koreksi harga) lulus pada salinan; smoke baca-saja lulus (0 gagal).

## 8. Rekonsiliasi angka sumber (CSV → catatan → tampilan)
**Baris:** 2.668 rekord setelah header − 12 baris pengisi `#N/A` (tanpa nomor order, baris CSV 2.660–2.671) = **2.656** baris ber-order → **2.656 catatan Excel** (1:1) = 83 berjumlah 0 (disimpan, tidak ditampilkan sebagai pemakaian) + **2.573 positif** (tampil). **+ 29 catatan LEDGER** = **2.685** catatan di tabel. Catatan LEDGER **bukan pemakaian Excel baru**: itu penanda untuk 29 ISSUE lama yang tidak punya pasangan di Excel (18 baris di 3 order yang tidak ada di Excel — 093, 094, 160 — dan 11 baris di 11 order yang ada di Excel tetapi bahan/varian tertukar). Pergerakan stoknya sendiri tidak disentuh.

**Order:** rekap memuat **304** order; **303** punya baris di sheet Pemakaian Bahan (NEW-14092026-013 tidak punya satu pun baris — celah di Excel, ada di sistem); di antara 303 itu **RES-03092026-018 hanya punya satu baris berjumlah 0** → **302 order dengan baris positif**. Audit sebelumnya menyebut 303 karena menghitung order dengan baris apa pun; layar Produksi menampilkan 302 untuk 2.573 baris positif.

**254 ISSUE lama:** 225 berpasangan dengan baris Excel pada unit + bahan yang sama (tertaut bila jumlah sama, "Perlu dicek" bila beda — tidak digandakan) dan **29 tanpa pasangan = kategori LEDGER tersendiri**. Rincian lengkap: `Rekonsiliasi-Angka-Sumber-20261024.xlsx`.

## 9. Pertanyaan Finance
Lihat `Pertanyaan-Finance-Biaya-Bahan-Historis-20261024.md`: 319 posting tanpa harga perolehan (42 bahan, 191 order) dan 254 ISSUE lama tanpa valuasi/jurnal/pelaku — pilihan perlakuan beserta dampaknya. Harga tidak diisi dan jurnal HPP historis tidak dibuat sebelum ada jawaban.

## 10. Rollback dan pemulihan
**Mengapa rollback tidak selalu aman.** Kode lama tidak mengenal tabel rekonsiliasi. Begitu tabel itu berisi sesuatu, kode lama *menyembunyikannya*: label "Perlu dicek", label "HPP bahan PARSIAL", catatan historis, koreksi pemakaian/saldo/harga beserta riwayatnya tidak tampil, sehingga pemakaian dan biaya bahan sebuah unit bisa tampak lengkap padahal tidak. Pergerakan stok hasil posting tetap berlaku di ledger (saldo tidak kembali oleh rollback). Maka rollback kode "rutin" hanya sah bila **tidak ada** yang akan tersembunyi.

**Guard (baca-saja)** `scripts/rollback-guard-rekon-pemakaian.sh` — transaksi `READ ONLY` (mode `--uji-baca-saja` membuktikan PostgreSQL menolak tulis). Pemanggil WAJIB menolak setiap exit selain 0:

| Exit | Keadaan | Arti |
|---|---|---|
| **0** | KOSONG: 4 tabel baru 0 baris, tak ada koreksi pemakaian, tak ada penyesuaian ber-asal | Rollback rutin **boleh** (tak ada yang tersembunyi). Migrasi tidak dibalik. |
| **10** | ADA DATA: catatan/impor/koreksi/posting/penyesuaian ber-asal | **DITOLAK.** Kode lama menyembunyikan data itu. |
| **20** | Ada koreksi pemakaian menunggu persetujuan (selain data lain) | **DITOLAK.** Kode lama tidak bisa menyetujuinya dengan benar. |
| 1 | Tabel baru tidak lengkap (kode/migrasi belum terpasang) | Ditolak: rollback kode ini tidak berlaku. |
| 2 | Hitungan bukan angka | Ditolak: jangan lanjut. |

**Pemanggil resmi** `scripts/rollback-rekon-pemakaian.sh <release-sebelumnya> <tag-image> [--jalankan]`: menjalankan guard dan keluar **30** (ditolak, tanpa menjalankan apa pun) untuk semua exit guard selain 0; default hanya mencetak rencana; `--jalankan` memeriksa guard sekali lagi tepat sebelum memasang image lama. Fase 8 skrip rilis juga berhenti (`die`) bila guard bukan 0 tepat sesudah rilis. Skrip rilis tidak lagi menyuruh `docker tag` manual.

**Pemulihan bila sudah ada data (guard 10/20)** — bukan rollback rutin:
1. **Perbaikan maju**: pasang versi perbaikan dari kode ini (data tetap tampil dan dikoreksi lewat jalur resmi: koreksi catatan, koreksi pemakaian pembalik bertaut asal, koreksi harga).
2. **Keputusan pemulihan khusus** oleh Owner + Finance + Gudang *setelah dampak data dinilai* (laporan guard memuat jumlah catatan, pergerakan stok hasil posting, koreksi, dan penyesuaian ber-asal), dengan prosedur tertulis tersendiri.
Dalam kedua kasus: jangan menghapus tabel/baris (riwayat append-only) dan jangan memasang kode lama diam-diam.

**Bukti pada rehearsal (salinan restore backup nyata, terikat SHA):** kosong → guard 0 dan pemanggil memberi rencana; ada catatan + posting + koreksi menunggu → guard 20 dan pemanggil 30; koreksi menunggu diselesaikan (catatan/posting tetap ada) → guard 10 dan pemanggil 30. Sidik jari SELURUH salinan (semua tabel) dihitung sebelum dan sesudah setiap guard/pemanggil dan harus identik.

## Evaluasi keadaan catatan: global, atomik, terserialisasi (perbaikan 25 Okt 2026)

**Cacat (ditemukan saat rehearsal posting 24 Okt):** setelah `jalankanPosting`, evaluasi ulang hanya mengklasifikasi catatan unit yang baru diposting. Saldo bahan dibagi ke SEMUA catatan siap secara berurutan (tanggal, order, bahan), jadi catatan unit lain yang berebut bahan yang sama hilang dari hitungan dan sisa catatan tampak cukup stoknya → **SIAP_POSTING palsu** (5 catatan; rencana berikutnya 384 trx, yang benar 379). Evaluasi juga berjalan di luar transaksi posting/koreksi sehingga ada jeda keadaan yang terbaca pengguna.

**Aturan sekarang:**
1. `evaluasiUlang` SELALU mengklasifikasi seluruh catatan Excel + ledger (parameter `unitIds` diterima tetapi tidak membatasi hitungan).
2. Semua penulis keadaan catatan (posting, koreksi catatan, konfirmasi, kecualikan, setujui koreksi pemakaian, evaluasi manual) mengambil kunci advisory `kunciEvaluasiCatatan(tx)` PERTAMA, lalu kunci baris — urutan seragam, tanpa deadlock.
3. Evaluasi berjalan DI DALAM transaksi penulis yang sama → keadaan yang terlihat setelah commit sudah benar (titik tetap).
4. `jalankanPosting` menyegarkan keadaan di dalam kunci SEBELUM memeriksa catatan (fail-closed: catatan yang tidak lagi siap gugur) dan sesudah posting.
5. `periksaKeadaanCatatan(tx)` = audit baca-saja (`berubah` harus 0). Untuk tes/rehearsal/smoke; panggil di transaksi RepeatableRead.
Evaluasi global manual (`POST …/evaluasi-ulang`) tetap ada tetapi bukan lagi bagian dari prosedur normal.

**Batas yang jujur:** penulis di luar modul ini (penerimaan GR, pengeluaran stok biasa) tidak memanggil evaluasi; keadaan catatan bisa tertinggal sampai evaluasi berikutnya, tetapi posting tetap aman: ia menyegarkan keadaan di dalam kunci (catatan yang tidak lagi siap gugur, fail-closed) lalu menyimpan keadaan yang benar lewat evaluasi tersendiri, dan `postStockMovement` menolak saldo negatif.

Tes: `tests/integration/evaluasiCatatanAtomik.integration.test.js` (E0–E8; E1/E3/E4/E5/E6 gagal pada kode lama; E8 = pasokan terpakai di luar modul → posting gugur lalu keadaan disembuhkan). Rilis kode-saja: `scripts/release-evaluasi-catatan.sh` (dibangkitkan oleh `scripts/gen-release-evaluasi-catatan.cjs`).

### Tahap 2 (25 Okt 2026): keadaan EFEKTIF untuk pembaca + posting batch di latar

**Celah yang ditutup:** penulis di luar modul catatan (GR resmi, pengeluaran stok biasa — semuanya lewat `postStockMovement`) mengubah saldo tanpa memanggil evaluasi, sehingga catatan lain yang memakai bahan sama bisa tampil SIAP_POSTING basi.

**Aturan:**
1. Setiap PEMBACA (tampilan Produksi `ambilCatatanHistoris`, `ringkasCatatanUnits`, `rencanakanPosting`, ekspor Excel Order Produksi, jejak biaya bahan, laporan rekonsiliasi) memakai **keadaan efektif** = klasifikasi terhadap ledger SEKARANG (`keadaanEfektif` / `terapkanKeadaanEfektif`). Mesin posting memakai rencana yang sama, jadi UI dan mesin selalu konsisten.
2. Biaya: cap ledger ±5 ms per pembacaan; klasifikasi ulang (±0,35 dtk pada 2.761 catatan) hanya bila cap berubah, satu kali untuk semua pembaca serentak (single-flight). Penulis GR/pengeluaran biasa TIDAK disentuh (nol tambahan kunci).
3. Bila efektif ≠ tersimpan, **penyegaran latar** menyimpan keadaan yang benar (`evaluasiUlang` bermutex dari klien Prisma, tidak pernah di dalam transaksi pembaca). `tungguPenyegaran()` untuk tes.
4. Cache pemetaan bahan (nama→bahan, kunci = tanda katalog) menurunkan evaluasi dari ±1,3 dtk menjadi ±0,3 dtk.

**Posting besar di latar** (`services/postingBatchLatar.js`; tanpa tabel baru — peristiwa append-only di `activity_events`, entityType `posting_historis_batch`):
- `POST /api/production/posting-historis/batch` {hashDisetujui, rujukan, unitIds?} → **202** + status; `GET …/batch/:id` = progres (unit selesai/total, trx diposting, gagal+kode, status MENUNGGU/BERJALAN/TERPUTUS/DIHENTIKAN/SELESAI/SELESAI_SEBAGIAN); `POST …/batch/:id/lanjut`; `POST …/batch/:id/hentikan`.
- **Idempoten:** id batch = hash rencana yang disetujui; hash sama → batch yang sama (juga setelah selesai). Eksekusi per unit lewat `postingSatuUnit` (satu transaksi per order, kunci evaluasi, fail-closed); unit yang sudah diposting hanya ditautkan.
- **Kelanjutan:** pekerja memegang sewa 90 dtk (diperbarui tiap unit); proses mati → sewa kedaluwarsa → `pulihkanBatch` saat boot (15 dtk setelah start, hanya bila job latar menyala) atau `POST …/lanjut`.
- Rencana unit dibandingkan dengan salinan yang disetujui sebelum diposting; bergeser → unit itu gugur `RENCANA_BERUBAH` (batch berlanjut → SELESAI_SEBAGIAN). Jurnal HPP tidak dibuat kecuali diminta eksplisit saat mengajukan.
- Posting SATU order tetap sinkron: `POST …/posting-historis/jalankan` dengan `unitIds` (rencana: `GET …/rencana?unitIds=`).
