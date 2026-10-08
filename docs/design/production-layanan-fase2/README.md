# Fase 2 Produksi — jalur LAYANAN: QC sebelum bongkar, lapisan awal, dokumentasi bongkar, uji fondasi awal

Cabang `feat/production-layanan-fase2-qc-bongkar` (dari `5fc4ceb4`). Belum deploy; tidak ada perubahan role/setting/cohort/data production; tidak ada akun production dibuat. **Hanya jalur LAYANAN non-adaptasi.** NEW/custom (BARU) dan SEWA tidak berubah; adaptasi tetap boleh melewati tahap dengan alasan.

## 1. Audit pemetaan tahap yang ada (tidak ada stage engine paralel)
Engine 12 tahap (`productionSteps.js`) menumpang di routing V1 (`routing_stages`). Pemetaan LAYANAN sebelum perubahan:

| Tahap | Stage routing | Isi bukti lama | Penulis |
|---|---|---|---|
| 1 Sebelum Bongkar | MULAI `pre_teardown_test` | foto/video + konfirmasi ukuran/kain | PIC Meja |
| 2 Uji Rasa Awal | SELESAI `pre_teardown_test` | **video** + catatan rasa awal | PIC Meja |
| 3 Hasil Bongkar | SELESAI `teardown` | foto + **centang jenis material lama** | PIC Meja |
| 4 Uji Fondasi Lama | SELESAI `foundation_test` | video + tinggi awal/ditekan + berat penguji (`dropCm` dihitung server) | PIC Meja |
| 5 Diagnosa | SELESAI `diagnosis` | teks | PIC Meja |

Kekurangan terhadap kebutuhan: uji awal ditulis PIC Meja (bukan PIC QC); berat penguji **terisi bawaan = berat customer** di form (bug di tahap 4/8, diperbaiki di slice 4); tidak ada kesesuaian keluhan, titik/metode, penurunan kasur utuh; lapisan awal hanya centang jenis material (tanpa urutan/ketebalan/kondisi/media per lapis); uji fondasi tanpa jenis fondasi/metode.

**Pemetaan setelah perubahan** (hanya LAYANAN, bukan adaptasi; tahap & stage routing sama, arti histori lama tidak diubah):
- **Tahap 2** — hasil uji ditulis PIC QC di Catatan Komponen seksi `WHOLE_TEST_BEFORE`. Meja menunggu ("Menunggu QC sebelum bongkar"), lalu **Lanjutkan** satu ketuk. Bukti tahap 2 hanya menaut `qcRef {section, version}`; foto/video PIC QC menjadi dasar penutupan stage routing (yang mewajibkan foto). Angka **tidak disalin** (satu sumber).
- **Tahap 3** — **lapisan awal** (seksi `LAYERS_BEFORE`, sudah ada sejak slice 3) wajib tercatat sebelum bongkar ditutup; dokumentasi foto/video bongkar tetap wajib; centang material lama menjadi opsional. Bukti menaut `layersRef`.
- **Tahap 4** — **uji fondasi awal** ditulis PIC QC (`FOUNDATION_TEST_BEFORE`); bukti menaut `qcRef`.
- Run lama / histori lama: baris bukti lama (feelNote, tinggi, material) **tidak diubah**; laporan membaca `measurement` lama bila tak ada catatan uji baru. Run yang sudah melewati tahap 2–4 saat deploy tidak terpengaruh.

## 2. Model data (satu sumber; reuse yang ada)
Catatan Komponen (`unit_component_entries_v2`, append-only, versi + alasan koreksi + idempotensi + konflik) diperluas, **tanpa tabel baru**:
- `WHOLE_TEST_BEFORE` (PIC QC): kesesuaian keluhan (4 pilihan), catatan keluhan, feel awal, **berat penguji aktual (wajib diketik; tidak pernah dari berat customer)**, titik/metode, **penurunan kasur utuh (cm; 0 sah)**, konfirmasi "PIC QC dalam frame", media ≥ 1 (foto/video).
- `FOUNDATION_TEST_BEFORE` (PIC QC): sistem fondasi, bahan (opsional), tinggi tanpa beban, tinggi dibebani, berat penguji aktual, titik/metode, media ≥ 1. **Penurunan = tanpa beban − dibebani dihitung SERVER** (nilai klien diabaikan); dibebani > tanpa beban ditolak. Contoh 25→15 = 10 cm. Tidak ada kategori "amblas" otomatis.
- `LAYERS_BEFORE`: kini mendukung **video** + tautan media per lapisan (`layerOrder`); **ringkasan total** dihitung dari ketebalan yang diketahui, "belum lengkap" bila ada yang kosong, "Belum dicatat" (bukan 0) bila tak ada.
- Aturan data: kosong = *Belum dicatat*; tiga pengukuran **tidak dijumlahkan**; `combinedEstimate` selalu `null` (belum ada pengukuran komponen dengan metode sepadan — tidak dikarang).
- Izin: seksi uji hanya `QC_WRITE`/`PRODUCTION_EXECUTE_ANY` (PIC QC; Admin/Owner/Lead sesuai izin yang sudah ada). Penugasan Meja, Dokumentasi, Sales, Gudang → 403. Seksi lama tetap `UNIT_STAGE_WRITE`/`PRODUCTION_DOCUMENTATION_WRITE`.
- Antrean PIC QC: `GET /component-notes/qc-queue` (unit yang `next.wait` = QC_BEFORE_PENDING/FOUNDATION_TEST_PENDING; hanya pemegang izin QC) — dibaca dari kartu Run, bukan antrean paralel.
- Pembaca yang sama: Meja, Corner, Dokumentasi, Unit 360, laporan + pesan Sales (satu endpoint `GET /component-notes/units/:id`; `salesContext` = keluhan/request/berat customer sebagai rujukan baca-saja).
- **Tidak menyentuh BOM, stok, reservasi, issue, retur** (audit statis + hitungan baris di tes integrasi). Racikan bahan dan QC setelah perakitan = fase berikutnya.

## 3. Migration
Satu migration baru: `20261021100000_production_component_qc_sections` — melebarkan CHECK `section` (+2 nilai). Aditif; tidak ada data diubah. (`DROP CONSTRAINT` hanya menggantikan CHECK identik berdaftar lebih lebar dalam satu transaksi; baris yang ada tetap valid.)
Terhadap baseline live terakhir yang diketahui (`86cb882f`): branch ini membawa **3** migration (2 dari slice NEW: `20261018100000`, `20261019100000`; + yang baru).
**Rehearsal gabungan** dari dump baseline staging (218 migrasi) → image kandidat bersih: `migrate deploy` 218 → **221**, replay "No pending", verifier riwayat OK, `prisma migrate diff` hanya drift lama bukan dari branch (`vehicle_services.id`). Sidik jari 191 tabel (jumlah + md5 isi) sebelum/sesudah: berubah **hanya** `_prisma_migrations` (+3), `routing_stages` (+1 `custom_build`; md5 berbeda karena UUID baris baru), dan 2 tabel baru kosong; 188 tabel lain identik. CHECK baru memuat 5 seksi. Data uji = staging, bukan salinan production.

## 4. Verifikasi
- Unit: backend **1051/1051**, frontend **689/689**. Tes baru: `productionPreTeardown.test.js` (9), `produksiLayananFase2.test.js` (7).
- Integrasi (HTTP + DB; 29 berkas produksi/rencana/unit): **292/292**, termasuk `productionPreTeardown.integration.test.js` (6): gerbang tahap, otorisasi 403, konteks Sales, berat penguji tak otomatis, versi/koreksi beralasan/idempotensi/konflik/tanpa-perubahan, lapisan + media video + total, penurunan fondasi server, laporan, adaptasi/SEWA/NEW tidak terkena. Tes lama yang memakai tahap 2–4 disesuaikan lewat helper resmi (bukan jalan pintas DB).
- **QA browser klik nyata** (image kandidat bersih dari arsip commit, staging terisolasi, login formulir): **46/46**, error konsol 0, HTTP ≥ 400 hanya 409 konflik versi yang sengaja dipicu. Cakupan: Meja tahap 1 → menunggu QC; PIC QC (antrean, konteks Sales, validasi UI, simpan, video diunggah); Lanjutkan; lapisan awal (belum lengkap → 10 cm, video tertaut Lapisan 1, diputar setelah reload); dokumentasi bongkar; uji fondasi (pratinjau 10 cm "dihitung sistem"; > tanpa beban ditolak); koreksi berversi + konflik + muat ulang (v1=4, v2=6 dari perangkat lain, v3=5); izin (Meja tak melihat tombol; API 403); adaptasi (Lewati tanpa uji/bukti palsu); NEW/custom (tanpa gerbang, tanpa catatan uji); laporan 390/1440 × terang/gelap.
- Screenshot di `screenshots/`; hasil mentah `qa-ui-result.json`.

### Temuan nyata dari QA (sudah diperbaiki)
1. Lembar formulir terpotong di Hub QC: induk `rounded-card` mendapat `backdrop-filter` dari CSS kaca sehingga `fixed` menjadi relatif ke induk. Portal ke `body` ditolak (drawer Unit 360/Radix menutup diri karena "klik di luar"); solusi: induk Hub QC bukan `rounded-card`, pembungkus Unit 360 memakai `kpi-glass-guard`.
2. Galat validasi lama bertahan walau isian sudah diperbaiki → dibersihkan saat isian berubah.
3. Tahap routing "Uji Sebelum Bongkar" mewajibkan foto: pada jalur gerbang media Meja kosong → ditutup memakai foto/video PIC QC yang sudah tersimpan.
4. Laporan memakai istilah "amblas N cm" dari bukti lama → diganti "penurunan N cm" (tidak menetapkan kategori dari angka).

## 5. Gap tersisa (jujur)
- Belum diuji di perangkat fisik/kamera HP; video diuji di Chrome headless dengan mp4 H.264 nyata (unggah ≤ 80 MB).
- **PIC QC bisnis = Risdi.** Identitas akun "Risdy" **belum diverifikasi** (production tidak dapat dibaca dari sesi ini); tidak ada akun/role production dibuat. QA memakai akun uji staging `qa-rn-qc@staging.invalid` (QC_LEAD, DB terisolasi). Admin/Owner/Lead memegang izin QC/eksekusi lintas-lini yang sudah ada — pembatasan hanya-Risdi butuh keputusan Owner.
- Panel di aplikasi Dokumentasi/Corner memakai komponen yang sama (dibaca dari satu endpoint) tetapi **tidak diklik-uji** terpisah di sesi ini; yang diklik-uji: Meja, Hub QC, Unit 360, laporan.
- Estimasi gabungan komponen: tidak diimplementasi (`null`) — menunggu keputusan metode yang sepadan.
- Unit LAYANAN yang **sedang aktif di tahap 2–4 saat deploy** akan menunggu catatan PIC QC (perubahan perilaku yang disengaja); perlu komunikasi ke Meja/PIC QC dan antrean PIC QC dipantau pada hari pertama.
- Baseline live tidak dapat dibaca ulang dari production; rehearsal memakai dump staging 218.
- Flag/cohort tidak diubah; unit di luar cohort Production V2 tidak mendapat fitur ini.

## 6. Pembaruan (Fase 3)
Gap §5 yang ditutup di `docs/design/production-layanan-fase3/`: gerbang QC kini dipin per Run baru (Run lama tidak terkena; penerapan eksplisit tercatat), izin QC per role dibuktikan HTTP, Aplikasi PIC QC mandiri `/produksi/qc`, panel Corner & Dokumentasi diklik-uji. Koreksi: izin QC dipegang ADMIN/OWNER/QC_LEAD (Production Lead **tidak** memegangnya).
