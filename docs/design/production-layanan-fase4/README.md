# Fase 4 Produksi — jalur LAYANAN: perakitan fondasi & lapisan → uji hasil → serah ke gerbang QC

Cabang `feat/production-layanan-fase4-rakit-uji-corner`, dari `021dcf47` (Fase 3 final). **Belum deploy**; tidak ada perubahan akun/flag/cohort/data production; production tidak dibaca. Hanya jalur LAYANAN; NEW/custom (BARU) dan SEWA tidak berubah.

Mockup (6 layar mobile 390 + desktop 1440 QC & Unit 360, terang/gelap, state kosong/menunggu/tidak sebanding/perlu perbaikan/sesuai, angka **contoh ilustrasi**) dan peta layar: `mockups/`, `screenshots-mockup/`, `peta-layar.md`. Screenshot implementasi nyata: `screenshots/`.

## 1. Pemetaan ke engine tahap (tanpa stage engine/sumber data paralel)
Tahap 6–8 pada routing LAYANAN yang sudah ada; gerbang baru hanya pada Run berkebijakan **`QC_GATE_V2`**.

| Tahap | Pelaku | Aksi | Sumber data |
|---|---|---|---|
| 6 Fondasi Baru | PIC Meja | merakit fondasi, kirim bukti (video + penjelasan; bahan dari PIC Bahan bila ditugaskan) | bukti P8 (tidak berubah) |
| (gerbang) | **PIC QC** | **uji fondasi baru**: tinggi tanpa beban, dibebani, berat penguji aktual, titik/metode, foto/video, catatan; **penurunan dihitung server** | Catatan Komponen `FOUNDATION_TEST_AFTER` |
| 7 Lapisan Baru | PIC Meja | hasil aktual susunan (Catatan Komponen › Sesudah pengerjaan, bisa "Isi dari racikan rencana"), lalu bukti lapisan (menaut `afterRef`) | `AFTER` (+ alasan perbedaan) |
| (gerbang) | **PIC QC** | **uji kasur jadi**: feel, kesesuaian keluhan awal, berat penguji aktual, metode, penurunan kasur utuh, foto/video | `WHOLE_TEST_AFTER` |
| 8 | PIC Meja | satu ketuk **"Lanjutkan ke Gerbang QC"** (bukti menaut `qcRef`, tanpa menyalin angka) | bukti P8 |
| Gerbang QC | PIC QC | putusan SESUAI / GAGAL lewat command QC P6 yang ada; GAGAL → jalur rework yang ada | `quality_inspections_v2` |

- Gerbang berbasis **waktu**: uji fondasi baru harus lebih baru dari bukti tahap 6 terakhir; hasil aktual harus lebih baru dari uji fondasi baru **dan** dari putusan QC gagal terakhir; uji kasur jadi harus lebih baru dari bukti tahap 7 terakhir dan putusan gagal terakhir. Maka **rework memaksa catatan baru** (catatan lama tidak dipakai; riwayat berversi tetap utuh).
- **Run lama tidak terkunci:** `qc_gate_policy_version` NULL (Run sebelum Fase 2) dan `QC_GATE_V1` (Run Fase 2/3) **tidak** kena gerbang perakitan (jalur modul lama persis, termasuk uji tekstur Meja). Run baru dipin `QC_GATE_V2`. V1/NULL → V2 hanya lewat `POST /runs/:id/qc-gate {version:"QC_GATE_V2", reason, expectedRevision}` (eksplisit, beralasan, tercatat; tidak pernah diturunkan).
- **Adaptasi** (tahap dilewati jujur, tanpa hasil uji/media palsu), **SEWA**, **BARU/custom**: tidak terkena gerbang (dijaga kondisi `!adaptasi`, kategori LAYANAN, jalur non-BUILD).
- **QC PASS** pada Run V2 LAYANAN menuntut uji kasur jadi putaran itu (`QC_FINISHED_TEST_REQUIRED`) — pertahanan berlapis; FAIL/WAIVED tidak diblokir.

## 2. Perbedaan dari rencana & kesebandingan
- **Rencana ↔ hasil aktual berdampingan** (bahan, urutan atas→bawah, ketebalan per lapisan, total tinggi yang diketahui, dipertahankan/diperbaiki/diganti) di Meja, QC, Dokumentasi, Unit 360, laporan.
- Hasil aktual yang **berbeda** dari `PLAN_RACIKAN` (tindakan/bahan/ketebalan/lapisan tambahan-hilang) **wajib `deviationNote`** (server: 422 `COMPONENT_DEVIATION_REASON_REQUIRED`; UI: peringatan + kolom alasan). Bagian yang belum diisi tidak dihitung beda. Dicatat sebagai bagian revisi berversi; **rencana tidak ditimpa**.
- **Kesebandingan uji** (server = klien, diuji paritas): "sebanding" **hanya** bila PIC QC menandai "titik & metode sama dengan uji awal" **dan** berat penguji aktual berselisih ≤ 2 kg. Bila sebanding: teks selisih ("8 cm lebih sedikit"). Bila tidak: **kedua angka tampil + alasan ("berat penguji berbeda (awal 75 kg, baru 60 kg)"), tanpa selisih**. Penurunan kasur utuh dan fondasi **tidak dijumlahkan**; tanpa label "amblas" otomatis; `combinedEstimate` selalu `null`.
- **Ringkasan perjalanan** `JourneySummary` ("Kondisi awal → racikan → hasil akhir", satu sumber; kosong = "Belum dicatat") di panel Catatan Komponen (Meja/Corner/Dokumentasi/Unit 360), formulir PIC QC, laporan, dan **pesan Sales** (`assemblyMessageLines`).

## 3. Efek bahan (audit)
Rakit, uji, hasil aktual, serah ke QC, rework **tidak menulis** stok/BOM/reservasi/issue/retur (pembaca/penulis Catatan Komponen diaudit statis; hitungan baris di tes dan SQL QA: `3|3|3|3|0 → 3|3|3|3|0`). Stok keluar tepat sekali oleh Gudang (3 ISSUE); BOM 3 bahan tertaut ke plan unit; diserahkan = BOM. PIC Bahan tetap mencatat pemakaian, Gudang tetap pemilik serah/retur. Pembaca bukti tahap 6/7 untuk putusan QC lewat **satu pintu** (`productionStepCommandService.loadAssemblyGateFactsForRun`), mengikuti audit pembaca bukti.

## 4. Izin
Uji fondasi baru & uji kasur jadi = seksi QC (hanya `QC_WRITE`/`PRODUCTION_EXECUTE_ANY` → QC_LEAD/ADMIN/OWNER; Meja/Lead/Driver 403, diuji HTTP). Hasil aktual (`AFTER`) tetap izin komponen yang ada (Meja/Corner/Lead/Dokumentasi/QC); izin tidak diperluas.

## 5. Migration & benturan sesi lain
- **Baru:** `20261025100000_production_component_assembly_tests` — melebarkan CHECK `section` (+`FOUNDATION_TEST_AFTER`, `WHOLE_TEST_AFTER`). Aditif; tanpa data diubah. **Tidak ada migration kolom baru** (V2 memakai kolom `qc_gate_policy_version` yang sama; nilai baru `QC_GATE_V2`).
- **Rehearsal** (image kandidat bersih): staging 223 → **224** (hanya `_prisma_migrations` yang berubah di sidik jari 191 tabel); replay "No pending"; verifier riwayat OK; **upgrade dari dump baseline 221 → 224** OK; **clean install** → 224 OK; satu kolom `qc_gate_policy_version` (tanpa kolom ganda). `prisma migrate diff` masih menampilkan drift lama (default UUID dst.), tidak ada dari branch ini.
- **Benturan `QC_GATE_DEFAULT` vs `QC_GATE_V1`/`V2` & `20261022100000`:** worktree utama `KM_SANSS-rencana-final` sekarang bersih di `7467d73d` — perubahan belum-commit sesi lain yang saya audit sebelumnya (setting `QC_GATE_DEFAULT`, migration `20261023100000_material_density_thickness`) **sudah tidak ada di tree itu**; saya tidak menyentuh/menimpa apa pun. Nama migration kanonis `20261022100000_production_qc_gate_policy` (sudah terapan di DB QA lokal `qa_rencana` dan `klinik_matras_test`) dipertahankan sejak finalisasi Fase 3; tidak ada `QC_GATE_DEFAULT` di branch ini (kebijakan dipin konstan pada Run baru). Bila sesi lain menghidupkan kembali `QC_GATE_DEFAULT`, ia harus memilih nilai `V2` (bukan `V1`) dan tidak boleh menambah migration kolom yang sama; migration `…material_density_thickness` tetap terbuka (kolom density/thickness katalog belum dipakai).

## 6. Verifikasi (proporsional, bukan full suite)
- **Unit penuh:** backend **1065/1065**, frontend **710/710** pada kode final (tes baru: `productionAssembly.test.js` backend 6, `produksiAssembly.test.js` frontend 7).
- **Integrasi terarah (HTTP+DB):** `productionExperience` **10/10** (termasuk 3 tes Fase 4: alur lengkap V2; QC gagal → rework → catatan baru wajib → QC sesuai; Run NULL/V1 tidak terkunci + penerapan eksplisit V1→V2 + SEWA); regresi langsung: `productionAdaptationSlice2`, `productionReturnQueueReorder`, `productionQcFinishedGoods`, `productionComponentNotes`, `productionQcPermissionMatrix`, `productionBuildTrack`, `productionPlanning` lulus; `productionPreTeardown` **9/9** setelah satu fixture Fase 3 disesuaikan (AFTER yang berbeda dari rencana kini butuh alasan — perubahan kontrak yang disengaja). Run terarah pertama: 93/94 (1 tes Fase 3 itu); diperbaiki lalu 9/9.
- **Tes lama yang disesuaikan secara sengaja:** tes yang menjalankan tahap 7–8 jalur lama (uji tekstur Meja) pada LAYANAN kini menyematkan Run ke V1 (`acceptedUnit` default V1) agar tetap menguji jalur lama; gerbang perakitan diuji di tes Fase 4.
- **QA browser klik nyata** (Chrome headless, login formulir; image backend+frontend dari arsip commit bersih; staging terisolasi; DB diverifikasi silang) — `qa-ui-result.json`, `screenshots/`: **A 34/35** (Meja → PIC QC 390 gelap → koreksi/konflik QC 1440 terang → Meja hasil aktual/konflik/bukti lapisan → PIC QC uji kasur jadi 1440 terang), **B 26/30** (QC gagal → rework → uji ulang → SESUAI + audit bahan + Unit 360/laporan), **C 12/12** (Unit 360 & laporan 390/1440 × terang/gelap, jalan ulang). **Kegagalan tercatat (semuanya asersi skrip, bukan produk):** A1.2 (regex huruf kecil vs teks "TIDAK dijumlahkan"; diverifikasi ulang pada unit G2: lulus); B7 ×4 di jalan pertama (regex "Sesuai keluhan" vs badge huruf besar "SESUAI KELUHAN"; diperbaiki dan jalan ulang: 12/12).
  Dicakup: uji fondasi baru **tidak sebanding** (60 vs 75 kg) dan **koreksi → sebanding**, konflik versi (QC dan Meja), koreksi beralasan, alasan perbedaan dari rencana, QC GAGAL → rework, uji ulang, tanpa stok baru.
  Konsol error/HTTP ≥ 400 hanya yang disengaja (409 konflik versi).
  **Replay idempoten** diuji di HTTP (integrasi), tidak diklik di UI.
- **Tidak dijalankan:** full suite integrasi; perangkat fisik/kamera HP; regresi lintas modul lain di luar yang tercantum; tampilan pesan Sales di UI (tombol laporan nonaktif sampai produksi selesai — diuji unit dan integrasi).

## 7. Gap sebelum Fase 5 (Corner)
- **Putusan QC SESUAI/GAGAL di Aplikasi PIC QC hanya tautan** ke Hub QC yang sudah ada (belum formulir putusan di aplikasi); halaman Hub QC tidak dirancang ulang.
- **Bahan rework tidak dibatasi kumulatif:** bukti tahap 7 ulang memvalidasi per-bukti terhadap yang diserahkan, bukan total (perilaku lama). Bahan tambahan untuk rework seharusnya lewat `requestReworkMaterial` (Gudang) — belum ada UI di aplikasi Meja/PIC Bahan.
- Run dengan **layanan satu modul** (hanya fondasi): gerbang perakitan hanya memasang di tahap lapisan (7); untuk jalur satu modul alur tahap 6 tetap lama.
- Rework yang kembali ke **tahap fondasi** (bukan lapisan) menuntut uji fondasi baru ulang secara otomatis (diuji logika/waktu), tetapi QA klik hanya mencakup rework tahap lapisan.
- Ambang kesebandingan berat (±2 kg) adalah keputusan teknis saya — perlu konfirmasi Owner/PIC QC.
- Perangkat fisik (S25/kamera) belum diuji; baseline live tidak dibaca (rehearsal memakai dump staging 221 + staging 223).
- Penerapan gerbang V2 ke Run berjalan hanya via API (belum ada tombol UI).
- Mockup tidak punya akses desain referensi; visual mengikuti token aplikasi lantai yang ada.
