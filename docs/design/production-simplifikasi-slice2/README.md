# Simplifikasi Production — Slice 2 (flow adaptasi) — matriks perubahan, gerbang, bukti QA

Branch `feat/production-simplification-slice2` (dari `c97e4b65`). **Commit + push saja: tanpa deploy, tanpa migration ke production, tanpa perubahan flag/cohort/data produksi.**

Bukti QA dihasilkan dari browser nyata (puppeteer, klik UI) + HTTP nyata terhadap **staging terisolasi QA-PV2** (data sintetis ber-prefix `QA-PV2`; bukan production) pada **image kandidat bersih** yang dibangun dari `git archive HEAD backend` (image akhir = commit `4553c7f6`; migration slice 2 diterapkan sebagai upgrade pada DB staging yang sudah berisi data slice 1).

> **Keselarasan visual dengan mockup: BELUM TERVERIFIKASI.** Mockup acuan tidak tersedia di repositori maupun sesi ini; tampilan mengikuti brief tertulis dan token DS yang ada. Screenshot = bahan review, bukan bukti kesesuaian mockup.
> Belum diuji dengan login production nyata, perangkat fisik (S25), atau unggah foto dari kamera ponsel (unggah di QA lewat input berkas).

## Ringkasan perilaku (keputusan Owner → implementasi)

| # | Permintaan | Implementasi | Bukti |
|---|---|---|---|
| 1 | **Unit Tiba di Workshop** satu aksi, tanpa pilihan lokasi | `POST /production-v2/units/:id/confirm-arrival` tanpa `locationId`; lokasi = **lokasi workshop bawaan** dari Pengaturan Admin (Receiving/WIP aktif, divalidasi tiap pemakaian). Belum dikonfigurasi/tidak valid → 409 `WORKSHOP_DEFAULT_LOCATION_NOT_CONFIGURED/INVALID` dengan pesan untuk Admin; **tidak** memilih lokasi acak, **tidak** memalsukan tiba. Modal pilih-lokasi dihapus. | integrasi A; UI S2-05b (4 varian), S2-06b |
| 2 | Diagnosis **tanpa layanan teknis** | Operator tidak memilih layanan. Layanan diturunkan dari **pemetaan kanonis** `price_items.production_service_id` (Sales→produksi) atau layanan historis unit. Belum dipetakan → 409 `DIAGNOSIS_SERVICE_MAPPING_NEEDED` (`needs: ADMIN_CONFIGURATION`, pesan menunjuk Pengaturan Produksi › Alur Kerja); **tidak ditebak dari nama**; draf tetap tersimpan. `recommendedServiceId` klien lama tetap diterima. | integrasi B; HTTP staging 9/9; UI S2-30, S2-31, S2-32 |
| 3 | **Lewati Tahap** (PIC/role berizin) | `POST /production-v2/runs/:id/steps/:n/skip`: bukti `SKIPPED` (actor, waktu, alasan **"Adaptasi sistem"**, catatan opsional), **tanpa media/hasil uji**, ledger operasi `SKIPPED`. Hanya run berkebijakan adaptasi; berurutan; tidak bisa pada tahap yang sedang berjalan/ditunda. Progres = **dikerjakan / dilewati / tersisa**. | integrasi D; UI S2-12, S2-13; DB |
| 4 | **QC & penerimaan barang jadi tidak wajib** + **Selesaikan Produksi** | Di gerbang QC, Meja **lanjut ke Corner** (tahap 9) tanpa putusan QC; gerbang dicatat **"tidak dilakukan"** (bukan PASS/WAIVED). Setelah tahap tuntas, `GET …/finish-preview` (pratinjau tahap tersisa, retur wajib, penghalang) + `POST …/finish {confirm:true}`: tahap tersisa dicatat SKIPPED, fase QC/HANDOFF `NOT_APPLICABLE`, run `COMPLETED` oleh **custody service** (pemilik tunggal), unit `READY_FOR_DELIVERY` lewat handoff Delivery yang ada (**satu job**). Tidak ada QualityInspection, tidak ada custody ACCEPTED, tidak ada foto/hasil palsu. Boleh ditutup **PIC Meja atau PIC Corner** yang ditugaskan. | integrasi C, C2, F, I; UI S2-14…S2-18, S2-40, S2-41 |
| 5 | Satu aksi **Lanjutkan** atomik + **Tunda** 4 alasan di papan | `POST /production-v2/units/:id/resume-work` (idempoten, `expectedRevision`, kunci unit→run) untuk pekerjaan papan **dan** luar papan (V1). Tunda: Menunggu bahan (→ laporan kekurangan ke Gudang) / Menunggu arahan / Kendala pengerjaan / Lainnya (**keterangan wajib**), tersimpan di `delay_kind/delay_note`. "Menunggu bahan" **tidak bisa dibuka** sebelum masalah bahan selesai (hanya Gudang/Admin). | integrasi G, L; UI S2-19…S2-22 |
| 6 | Stok, issue, waste, retur, izin, kepemilikan, drift guard **tidak dilemahkan** | Retur sisa bahan tetap **wajib** sebelum selesai: Selesaikan membuka antrean retur dan berhenti (`completed:false`, alasan jelas) sampai Gudang menerima (stok RETURN tepat sekali). Selesaikan tidak menulis stok. Run tertutup hanya oleh custody service; audit penulis berbasis **kepemilikan** (bukan allowlist). | integrasi E, H, I; unit ownership; UI S2-17, S2-18 |
| 7 | **Kebijakan adaptasi per run**; histori tidak berubah | `production_runs_v2.adaptation_policy` (NULL = proses lengkap). Default untuk run **baru** dari Pengaturan (`adaptation_default_policy`); run lama tidak berubah otomatis. Menerapkan pada run berjalan = aksi eksplisit Lead/Admin/Owner di Unit 360 **dengan konfirmasi**; tahap/bukti yang ada tidak diubah. KPI/laporan/ekspor membedakan *Proses lengkap · Adaptasi (semua tahap dikerjakan) · Adaptasi (tahap dilewati)* dan QC *Tidak dilakukan*; tahap dilewati tidak dihitung sebagai pekerjaan/QC lulus. | integrasi C, F, J; UI S2-23…S2-27; KPI QA |
| 8 | Pengaturan Admin | Tab **Pengaturan Produksi › Alur Kerja**: lokasi workshop bawaan, mode adaptasi untuk run baru, tabel pemetaan Layanan Sales → layanan produksi. Menulis hanya **ADMIN/OWNER** (`PRODUCTION_SETTINGS_WRITE`); Production Lead hanya melihat. Perubahan tercatat di aktivitas. | integrasi K; UI S2-02…S2-07, S2-31, S2-32 |

## Migration (aditif, belum dijalankan di production)

`backend/prisma/migrations/20261016100000_production_adaptation_slice2/migration.sql` — **tanpa DROP/UPDATE/DELETE/TRUNCATE**; baris lama tidak berubah:

1. `production_runs_v2.adaptation_policy VARCHAR(40)` (nullable; NULL = perilaku lama).
2. `production_operation_runs_v2.delay_kind VARCHAR(20), delay_note TEXT` (nullable).
3. `CREATE TABLE production_settings (key PK, value JSONB, updated_by_id, created_at, updated_at)`.

**Rehearsal pada DB terisolasi** (`node scripts/production-delivery-v2/slice2-migration-rehearsal.js`, DB unik `km_it_*_test` dihapus di akhir): **12/12** — *clean* (`migrate deploy` dari nol, kolom/tabel ada, `migrate status` up-to-date, objek slice 2 tidak muncul di diff drift) dan *upgrade* (semua migration kecuali slice 2 → isi data produksi-like → deploy slice 2: jumlah baris + sidik tabel lama **identik**, kolom baru NULL, `production_settings` kosong, kebijakan dapat ditulis; **rollback DROP dijalankan pada salinan dan data lama tetap utuh**). Drift lama non-slice-2 (mis. default `activity_events.id`) sudah ada sebelumnya dan tidak diubah.

## Batas rollback

* **Belum ada deploy** — membatalkan = tidak men-deploy / revert commit; production tidak tersentuh.
* **Setelah (nanti) deploy:** kode lama mengabaikan 3 objek aditif (nullable), rute baru hilang. `DROP` 3 objek (teruji di rehearsal) membuang: kebijakan adaptasi per run, alasan tunda pekerjaan papan, dan setelan Admin (lokasi bawaan, default adaptasi). Data lama utuh.
* **Tidak dapat/tidak patut dibatalkan setelah dipakai:** bukti `SKIPPED` + ledger `SKIPPED`, catatan "QC tidak dilakukan", run yang sudah `COMPLETED`/unit `READY_FOR_DELIVERY` lewat adaptasi, retur/stok yang sudah diterima Gudang, job Delivery yang sudah ada — semuanya catatan bisnis yang benar, bukan data sementara.
* **Run adaptasi yang masih berjalan saat rollback kode** (gerbang QC sudah dicatat "tidak dilakukan" tetapi belum ditutup): kode lama tidak mengenal kebijakan itu — selesaikan dulu lewat Selesaikan Produksi sebelum rollback, atau tangani manual oleh Production Lead.

## Matriks gerbang — sebelum / sesudah

| Gerbang | Sebelum (`c97e4b65`) | Sesudah (`4553c7f6`) |
|---|---|---|
| Backend unit (`npm test`) | 978/978 | **986/986** |
| Frontend (`node --test tests/*.test.js`) | 611/611 | **623/623** |
| Integrasi slice 2 (HTTP nyata, DB terisolasi) | — (baru) | **13/13** (A…L + C2) |
| Integrasi regresi production/custody/V1 (24 berkas, satu DB terisolasi, berkas berjalan paralel) | lulus pada slice 1 | **235/236** — 1 gagal = interferensi flag global antar berkas paralel (`productionCommandCenter` “reader OFF” membaca `COHORT` dari berkas lain); **lulus 7/7 saat dijalankan sendiri**. Bukan regresi kode. |
| Audit penulis berbasis kepemilikan (dalam unit) | lulus | **lulus** — penutup run (`COMPLETED`) 2→3 pemilik dengan asersi kepemilikan; `production_settings`, `production_service_id`, `delayKind`, skip-engine, `completeAdaptationRunInTx` masing-masing dikunci ke pemilik tunggal |
| Rehearsal migration clean + upgrade | — | **12/12** |
| `git diff --check` | bersih | **bersih** |
| QA browser/HTTP staging | slice 1: API 39/39, UI 71/71 | lihat tabel QA di bawah |

## Hasil QA staging (image kandidat bersih)

| Rangkaian | Hasil | Catatan |
|---|---|---|
| Fase 1 — Pengaturan Alur Kerja + Unit Tiba (UI) | 34/37 | 3 asersi gagal = **kesalahan skrip uji**: staging belum punya price item Sales (tabel pemetaan kosong) dan klik mengenai kartu lain. Diulang & lulus di fase 3/4. |
| Fase 2 — A (gerbang QC → Corner, UI) | 21/21 | image `2a6de96c` |
| Fase 2 — B (Lewati Tahap, UI) | 19/19 (4 varian × 4 + 3 alur) | percobaan pertama pada unit dengan operasi aktif gagal **sesuai desain** (Lewati tidak ditawarkan saat tahap berjalan) → diarahkan ke unit lain; DB-check skrip error SQL (`jsonb`) lalu dijalankan terpisah |
| Fase 2 — B (DB SKIPPED, izin 6 peran, urutan, tanpa kunci, revisi usang, replay, serentak) + KPI | 20/21 | 1 asersi memakai regex salah; diverifikasi ulang (KPI2: 2/3 — temuan label KPI #5 → diperbaiki, lalu fase 5) |
| Fase 2 — C…H (Selesaikan Produksi, retur, Tunda/Lanjutkan, Unit 360, laporan, izin) | **102/102** | image `beace08a` |
| Diagnosis tanpa layanan teknis (HTTP staging) | **9/9** | 409 → Admin memetakan → 201, `resolvedBy: MAPPING` |
| Fase 3 — diagnosis UI, pemetaan UI (4 varian), Unit Tiba sukses | **39/39** | |
| Fase 4 — butuh konfigurasi (error Unit Tiba) 4 varian + pemulihan | **19/19** | |
| Fase 5 — PIC Corner menutup produksi (UI, 4 varian) + KPI | 25/29 + 1/1 | 4 gagal = filter teks uji menghapus baris ber-prefix `QA-PV2`; panel terbukti di screenshot dan **diulang dengan teks mentah (lulus)** |

**Temuan QA yang menjadi perbaikan produk (semua sudah dikunci tes):**
1. PIC **Corner** ditolak saat Selesaikan Produksi (otorisasi hanya PIC Meja) → boleh PIC Meja *atau* PIC Corner (integrasi C2).
2. **Laporan run** memperlakukan bukti SKIPPED sebagai pekerjaan (PIC/finishing/“siap”, pesan Sales berisi `undefined`) → bukti SKIPPED dipisah; laporan memuat *tahap dilewati*, *QC tidak dilakukan*, *Gudang tidak diwajibkan*, status “SIAP KIRIM (mode adaptasi)”.
3. Peringatan “Diagnosa selesai — BOM belum dibuat” muncul pada diagnosa yang **dilewati** → diabaikan untuk bukti SKIPPED.
4. Penerapan adaptasi pada run berjalan hanya satu klik → kini **dua langkah** dengan konfirmasi.
5. Label KPI “Adaptasi (tahap dilewati)” dipakai juga untuk run tanpa tahap dilewati → dibedakan dengan “Adaptasi (semua tahap dikerjakan)”.
6. Setelah Selesaikan Produksi, layar langsung “Pekerjaan tidak lagi di antrean Anda” → kini panel hasil “Produksi selesai · Unit Siap Kirim · QC tidak dilakukan”.

## Keputusan desain & keterbatasan (perlu perhatian Owner)

* **Kebijakan melekat saat run lahir.** Unit yang sudah ditawarkan/menunggu tiba *sebelum* mode adaptasi diaktifkan tetap berproses lengkap; Lead/Admin dapat menerapkannya per unit lewat Unit 360 (konfirmasi eksplisit).
* **Tahap yang sedang berjalan/ditunda tidak bisa dilewati dan memblokir Selesaikan Produksi** (alasan jelas: “selesaikan atau lanjutkan dulu”) — mencegah pekerjaan nyata tercatat sebagai dilewati.
* **Retur sisa bahan memblokir penutupan** sampai Gudang menerima (sesuai “jangan melewatinya diam-diam”).
* Mode Latihan: setiap tombol kirim baru (lewati/selesaikan/tunda/terapkan) bertanda `data-mutates` sehingga disimulasikan — diuji lewat teks sumber, tidak diuji di browser.
* Alur UI wizard diagnosis untuk layanan **belum dipetakan** diuji lewat HTTP (staging + integrasi) dan render pesan (`friendlyError`); klik-tembus wizard hingga 409 tidak diotomasi.
* Unggah foto QA lewat input berkas; kamera perangkat tidak diuji.
* `frontend/dist` **tidak** di-commit (dibuild ulang hanya untuk QA, lalu dipulihkan).

## Daftar screenshot (`*.png` di folder ini; varian: `390`/`1440` × `light`/`dark`)

| Berkas | Isi |
|---|---|
| `S2-02…S2-04`, `S2-05` (1440-light) | Pengaturan › Alur Kerja: belum dikonfigurasi → lokasi tersimpan → mode adaptasi aktif; Production Lead hanya-lihat |
| `S2-07-pengaturan-alur-kerja-*` | Alur Kerja 390 light/dark + 1440 dark |
| `S2-31-pengaturan-alur-kerja-pemetaan-*` (4 varian), `S2-32` | Tabel pemetaan Layanan Sales → layanan produksi; layanan belum dipetakan |
| `S2-05b-unit-tiba-butuh-konfigurasi-*` (4 varian) | Unit Tiba satu aksi: pesan kebutuhan konfigurasi untuk Admin |
| `S2-06b-unit-tiba-sukses-390-light` | Unit Tiba sukses (lokasi bawaan) |
| `S2-30-diagnosis-tanpa-layanan-teknis-*` (4 varian) | Wizard Diagnosis tanpa pilihan layanan teknis |
| `S2-10-meja-adaptasi-gerbang-qc-*` (4 varian), `S2-11` | Gerbang QC → “Kirim ke Corner” (QC tidak dilakukan); unggah foto tahap 9 |
| `S2-12-lewati-tahap-sheet-*` (4 varian), `S2-13` | Lembar Lewati Tahap; progres sesudah dilewati |
| `S2-14-selesaikan-produksi-pratinjau-*` (4 varian), `S2-15`, `S2-16` | Pratinjau tahap tersisa + konfirmasi eksplisit; setelah selesai |
| `S2-17-selesaikan-produksi-retur-wajib-*` (4 varian), `S2-18` | Retur sisa bahan wajib; menunggu retur (tidak selesai diam-diam) |
| `S2-19-tunda-pekerjaan-sheet-*` (4 varian), `S2-20…S2-22` | Tunda 4 alasan; Menunggu bahan; Tertunda — kendala; setelah Lanjutkan |
| `S2-23-unit360-run-lama-*` (4 varian), `S2-24`, `S2-25` | Unit 360 run lama: terapkan adaptasi (konfirmasi) → aktif |
| `S2-26`, `S2-26a`, `S2-27` | Unit 360 & laporan run adaptasi (dilewati, QC tidak dilakukan, Gudang tidak diwajibkan) |
| `S2-40-corner-siap-selesaikan-*`, `S2-41-corner-produksi-selesai-*` (4 varian) | PIC Corner: Selesaikan Produksi → panel hasil |
