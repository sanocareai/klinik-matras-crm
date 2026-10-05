# Simplifikasi Production — Slice 3 — Catatan Komponen kanonis per unit (Sebelum → Sesudah)

Branch `feat/production-simplification-slice3` (dari `4b40053a`). **Commit + push saja: tanpa deploy, tanpa migration ke production, tanpa perubahan flag/cohort/data produksi.**

Bukti QA: browser nyata (puppeteer, klik UI) + HTTP nyata pada **staging terisolasi QA-PV2** (data sintetis `QA-PV2`), **image kandidat bersih** dari `git archive` commit `0923a3d4` (backend) + build frontend commit yang sama; migration slice 3 diterapkan sebagai upgrade pada DB staging yang sudah berisi slice 1–2.

> **Keselarasan visual dengan mockup: BELUM TERVERIFIKASI** (mockup tidak tersedia). Belum diuji login production, perangkat fisik, atau kamera ponsel (foto QA lewat input berkas).

## Apa yang ditambahkan

Satu catatan komponen per unit, tiga seksi (masing-masing punya versi sendiri):

| Seksi | Isi |
|---|---|
| **Lapisan sebelum dibongkar** | daftar lapisan berurutan (atas→bawah): jenis/bahan (Katalog / **Bahan manual** / **Tidak diketahui**), ketebalan (opsional), kondisi (boleh *Tidak diketahui*), catatan, foto. Atau “lapisan tidak diketahui” sebagai satu pernyataan. |
| **Fondasi sebelum dibongkar** | jenis/sistem fondasi (per bonnell, pocket spring, busa fondasi, papan/kayu, lainnya, *Tidak diketahui*), bahan (opsional), kondisi, catatan, foto. |
| **Sesudah pengerjaan** | fondasi + tiap lapisan: **dipertahankan / diperbaiki / diganti**, komponen hasil akhir (katalog/manual/tidak diketahui), merujuk lapisan lama bila urutan berubah, catatan, foto. |

**Satu data, banyak layar (tanpa input ulang):** komponen `ComponentNotesPanel` yang sama dipasang di Aplikasi Meja & Corner (detail pekerjaan, tepat setelah Progres), Aplikasi Dokumentasi (detail unit), Unit 360 (tab Dokumentasi), dan laporan (before–after) membaca **satu endpoint** `GET /api/production-v2/component-notes/units/:unitId`. Form muncul sesuai tahap: tahap 1–5 (bongkar/uji/diagnosis) menyorot *Sebelum*, tahap 6+ (pengerjaan pengganti) menyorot *Sesudah* — **tidak pernah menjadi syarat tahap** (flow adaptasi tetap sederhana; terbukti Selesaikan Produksi berhasil tanpa catatan komponen).

**Ringkasan “Sebelum → Sesudah”** dibangun server (`buildComparison`): baris Fondasi + tiap Lapisan, lencana *Tetap digunakan / Diperbaiki / Diganti*, daftar “Tetap digunakan”, dan **celah “belum dicatat” disebut jelas** (tidak dikarang). Laporan run + pesan Sales memuat blok yang sama (“KOMPONEN SEBELUM → SESUDAH”).

## Aturan yang dijaga

* **Informasi saja.** Catatan tidak memotong stok dan **bukan** BOM, pemakaian, maupun retur. Bahan katalog hanya **tautan** (`materialId` + snapshot kode/nama/satuan diisi server; nama dari klien dibuang). Diuji: stok, reservasi, issue, retur, BOM, kekurangan bahan, fase, operasi, status unit/run **identik** sebelum/sesudah rangkaian catatan + dokumentasi.
* **Actor/waktu/revisi** pada tiap versi; **koreksi = versi baru** dengan alasan wajib (≥3 huruf), baris lama tidak pernah diubah (append-only; FK `ON DELETE RESTRICT`). Isi identik dengan versi terkini → tidak ada baris baru (`unchanged`).
* **Replay:** `Idempotency-Key` + hash isi lewat `v2_commands` (isi beda = 409). **Konflik paralel:** baris unit dikunci, `expectedVersion` per seksi → yang kalah 409 `COMPONENT_VERSION_CONFLICT` (UI: pesan jelas + “Muat versi terbaru”, penyimpanan tidak menimpa).
* **Tahap dilewati (SKIPPED):** tetap boleh didokumentasikan, tetapi tidak menghasilkan before/after palsu; bukti SKIPPED lama tidak berubah; histori lama tidak disentuh (tabel baru kosong saat upgrade, tanpa backfill).
* **Izin:** tulis + unggah foto = `UNIT_STAGE_WRITE` (Meja/Corner/Lead/QC/Admin) **atau** `PRODUCTION_DOCUMENTATION_WRITE` (Dokumentasi), di balik writer cohort fail-closed (non-cohort 503). Baca = `UNIT_READ`/`INVENTORY_READ` + reader cohort (non-cohort 404). Sales/Gudang/Driver tidak menulis/mengunggah/melihat katalog (403); saran bahan hanya untuk penulis. Tanpa harga/stok di payload.
* **Foto:** unggah ke store bukti yang sama (magic byte, ≤15 MB, nama = sha1), hanya gambar, maks 8 per catatan; foto milik unit lain ditolak (409 `COMPONENT_MEDIA_OTHER_UNIT`).
* **Saran dari bahan terpakai** (tahap 6/7): hanya mengisi formulir *Sesudah* (bisa diubah, tidak tersimpan sendiri; abaikan bukti SKIPPED).

## Migration (aditif, belum dijalankan di production)

`backend/prisma/migrations/20261017100000_production_component_notes_slice3/migration.sql` — **satu tabel baru** `unit_component_entries_v2` (+ indeks unik `(unit_id, section, version)`, indeks `(unit_id, created_at)`, FK ke `units` RESTRICT, CHECK seksi ∈ {LAYERS_BEFORE, FOUNDATION_BEFORE, AFTER} dan versi ≥ 1). Tanpa DROP/UPDATE/DELETE; tidak mengubah tabel lain.

**Rehearsal pada DB terisolasi** (`node scripts/production-delivery-v2/slice3-migration-rehearsal.js`): **14/14** — *clean* (tabel ada+kosong, kolom lengkap, `migrate status` up-to-date, tidak ada drift baru) dan *upgrade* (semua migration kecuali slice 3 → data produksi-like → deploy slice 3: sidik tabel lama identik, tabel baru kosong, kendala unik/CHECK/FK/RESTRICT ditegakkan). DROP tabel pada salinan = **bukti teknis saja, bukan prosedur production**.

## Rollback

Prosedur production = **rollback aplikasi saja; migration dipertahankan** (tabel baru tidak dibaca/ditulis kode lama dan tidak mengikat data lama). Catatan komponen yang sudah tersimpan tetap ada untuk roll-forward; kode lama hanya tidak menampilkannya (rute `component-notes` 404). Catatan = informasi, jadi tidak ada stok/lifecycle yang perlu dipulihkan. Tidak ada kompatibilitas-lama yang perlu dijaga seperti pada slice 2 (tidak ada status/lifecycle baru).

## Gerbang

| Gerbang | Sebelum (`4b40053a`) | Sesudah (`0923a3d4`) |
|---|---|---|
| Backend unit (`npm test`) | 986/986 | **995/995** (+9 domain komponen; audit pembaca bukti diperluas) |
| Frontend (`node --test`) | 623/623 | **631/631** (+8) |
| Integrasi slice 3 (HTTP nyata, DB terisolasi) | — | **10/10** (A…J) |
| Integrasi regresi production/custody/V1 (25 berkas, serial, satu DB) | 236/236 | **246/246**, 0 gagal (236 lama + 10 baru) |
| Rehearsal migration clean + upgrade | — | **14/14** |
| Audit pembaca/penulis bukti | lulus | **lulus** — Catatan Komponen = *tinjauan bersyarat* (filter `DOC_` wajib, SQL hanya kolom `media`, tidak menulis lifecycle/stok/BOM/retur/jurnal), diuji dengan mutasi sumber (bukan sekadar allowlist). Penulis tabel baru dikunci ke `productionComponentNoteService`. |
| `git diff --check` | bersih | **bersih** |
| Build | — | frontend dibangun **sekali** (satu `vite build`, disalin ke `dist` staging; `frontend/dist` tidak di-commit) |

## Hasil QA staging

| Rangkaian | Hasil |
|---|---|
| HTTP (43 pemeriksaan): multi-unit, katalog/manual/tidak diketahui, foto, Sesudah + perbandingan, koreksi + histori, isi identik, replay, kunci beda isi, konflik paralel (2 penulis, 3 koreksi), izin 8 peran, stok/lifecycle identik, tahap dilewati, validasi | **43/43** |
| UI fungsi (39): Meja (form Lapisan+Fondasi sebelum, katalog/manual/tidak diketahui, foto, simpan), konflik versi dari Lead, Corner membaca data Meja + saran + Sesudah, Dokumentasi koreksi + riwayat, Unit 360, laporan + pesan Sales, unit tahap-dilewati tanpa hasil palsu, Selesaikan Produksi tanpa catatan | **39/39** |
| UI tampilan (20): panel Meja, form koreksi, Corner, laporan — 390 & 1440 × light & dark, tanpa scroll horizontal, tanpa istilah teknis | **20/20** |

**Temuan QA → perbaikan (dikunci tes):** (1) foto uji berulang bertabrakan sebagai “dipakai unit lain” (sha1 isi sama) — masalah data uji, bukan produk; (2) label fondasi hasil mencetak “Tidak diketahui · bahan” saat bahan sudah jelas → sistem “Tidak diketahui” tidak dicetak bila bahan ada; (3) panel komponen tertimbun di bawah Bahan pada Meja/Corner → dipindah tepat setelah Progres; (4) audit pembaca bukti menandai layanan baru (benar) → ditinjau bersyarat, bukan sekadar masuk allowlist.

## Keputusan & keterbatasan

* Seksi dicatat per **unit** (bukan per run) agar tetap satu catatan bila unit punya lebih dari satu run; `run_id` disimpan sebagai konteks.
* Catatan **tidak** menjadi syarat tahap/selesai/QC; “Tidak diketahui” disediakan agar operator tidak menebak.
* Mode Latihan: tombol simpan bertanda `data-mutates`; bila dataset latihan tak memuat catatan komponen, panel disembunyikan (diuji teks, tidak di browser).
* Lapisan hasil akhir yang merujuk lapisan lama dengan urutan berbeda diatur lewat pilihan “Merujuk lapisan lama”; lapisan lama yang tak dirujuk ditampilkan “Tidak tercatat di hasil akhir” (bukan diasumsikan dibuang).
* Belum (di luar permintaan): dataset Mode Latihan untuk catatan komponen dan kolom komponen di ekspor KPI.

## Screenshot (`S3-*.png`; varian `390`/`1440` × `light`/`dark`)

| Berkas | Isi |
|---|---|
| `S3-01` | Meja: Catatan Komponen kosong (semua “Belum dicatat”) + sorotan tahap |
| `S3-02`, `S3-03` | Formulir Lapisan sebelum (katalog / Bahan manual / Tidak diketahui + foto) dan Fondasi sebelum |
| `S3-04` | Meja: ringkasan Sebelum setelah disimpan (Sesudah “belum dicatat”) |
| `S3-05` | Konflik versi (Lead mengoreksi saat Meja membuka form): pesan + “Muat versi terbaru” |
| `S3-06`, `S3-07` | Formulir Sesudah (saran bahan terpakai) dan ringkasan Sebelum → Sesudah di Corner |
| `S3-08`, `S3-09` | Aplikasi Dokumentasi: panel, koreksi bereferensi foto + riwayat v1 digantikan |
| `S3-10` | Unit 360 — Catatan Komponen |
| `S3-11`, `S3-12` | Laporan before–after; laporan unit tahap-dilewati tanpa catatan (tidak ada hasil palsu) |
| `S3-20…S3-23` (4 varian) | Panel Meja, form koreksi, Corner, laporan before–after — light/dark × 390/1440 |
