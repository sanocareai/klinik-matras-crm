# Rencana Produksi untuk ORDER NYATA — foto pickup, PIC, onboarding & penjadwalan

Branch `fix/rencana-produksi-order-asli`, dipotong dari **live aktual `836f68de`** (6 Okt 2026, dibaca dari container production — bukan dari memori). `836f68de` memuat
`f28e232d` (rilis gabungan), `d13896a3` dan `1a783034` (origin/main saat itu); semua rilis divisi lain (Finance/Inbox/Delivery) terbawa utuh karena cabang ini hanya menambah.
**Status: dipush, BELUM deploy. Tanpa migration. Tanpa perubahan flag/cohort.**

## 1. Akar masalah (dibuktikan pada data production, baca-saja)

Sensus unit nyata Diproses (order PROCESSING, unit RECEIVED/IN_PRODUCTION, bukan SPAM/staf): **16 unit**.

| # | Gejala live | Akar masalah | Bukti |
|---|---|---|---|
| 1 | Foto pickup ada di Delivery, kartu Rencana kosong | Resolver foto resmi (`resolveUnitPhoto`) HANYA mengambil foto dari **handoff custody INBOUND** — handoff hanya lahir untuk unit di cohort V2 saat pickup selesai. Order nyata di luar cohort tidak punya handoff, jadi tidak pernah punya foto di kartu walau Job pickup-nya berfoto. | 10 unit punya Job PICKUP selesai + foto (semuanya single-unit); **0** punya handoff custody → 0 foto tampil |
| 2 | "Belum bisa dijadwalkan" sementara Meja meminta seret | Backlog hanya menandai `schedulable` bila unit **di cohort reader DAN punya Run**. Production: cohort = 1 unit, Run = 1. 15 dari 16 unit Diproses tidak punya jalur sah ke jadwal; teks "+ Seret unit" di Meja statis dan tidak peduli ada-tidaknya kartu yang bisa diseret. | `punya_run_v2 = 1` dari 16; cohort writer = reader = 1 |
| 3 | Pilihan PIC kosong | (a) PIC hanya dari **registri operator** (`production_operators`) — satu baris per akun yang didaftarkan manual; production: 8 akun PRODUCTION_WORKER aktif, **hanya 1** terdaftar (2 PRODUCTION_LEAD: 0). (b) Loader frontend membekukan peran dari `localStorage` **saat modul diimpor**, memuat 4 endpoint dalam satu `Promise.all` dan **menelan semua galat** (`.catch(() => {})`) — satu kegagalan atau peran basi = daftar kosong tanpa penjelasan. API sendiri sehat: OWNER/ADMIN/PRODUCTION_LEAD 200 dengan 1 operator; PRODUCTION_WORKER 403 (benar). | probe baca-saja 4 endpoint per peran; sensus akun |

Catatan jujur: penyebab *persis* kosongnya PIC pada sesi live pengguna tidak bisa dipastikan dari sini (data production memuat 1 operator; API 200). Yang terbukti: jalur pemuatan rapuh dan
diam-diam, dan pilihan nyata memang hanya 1 orang dari 8 akun produksi. Keduanya diperbaiki; kosong kini SELALU disertai alasan + tindakan.

## 2. Perilaku baru

**Foto (resolver resmi, satu fungsi):** urutan atribusi `custody INBOUND → Job PICKUP milik unit sendiri (JobUnit) → unggahan manual → kosong`. Job pickup diatribusikan **hanya bila tepat satu JobUnit**
dan berfoto; job multi-unit **tidak pernah** diatribusikan — kartu menjelaskan ("dipakai bersama N unit — tidak bisa dipastikan unit mana pemiliknya"). Job terbaru menang; nama berkas tak aman ditolak.
Penjelasan foto kosong: `AMBIGUOUS` / `NO_PHOTO` (pickup tanpa foto bukti) / `NO_PICKUP`.

**Aksi berikutnya per kartu (server = otoritas, `GET /production-v2/backlog` → `item.rencana`):**
`SCHEDULE` (Run di cohort), `ONBOARD_SCHEDULE` (Jadwalkan membuka Run), `AWAIT_ACTIVATION` (menunggu keputusan Owner), `WAIT_PICKUP`, `EXCEPTION` (kode + alasan). Kartu yang belum eligible
**tidak** punya handle/instruksi seret; menampilkan "Langkah berikutnya". Ringkasan hitungan (`rencanaCounts`) tampil di panel backlog.

**Onboarding + penjadwalan ATOMIK — satu pintu untuk tombol Jadwalkan dan seret-lepas:** `POST /production-v2/plans { unitId, productionDate, stationCode, priority, workCenterId, operatorId, cornerOperatorId? }`
(+ `Idempotency-Key`). Dalam SATU transaksi: kunci unit + kepemilikan → validasi ulang kelayakan → buka Run → buat rencana → jadwalkan (kapasitas Meja dijaga server). Gagal di mana pun = tidak ada yang tertulis
(tidak ada Run yatim). Replay kunci sama = hasil sama tanpa baris tambahan; kunci sama + isi beda = 409. Run non-terminal yang sudah ada **dipakai ulang** (tidak ada Run ganda; index unik parsial
`production_runs_v2_active_unit_key` menjaga di DB). Perintah `runId` lama tidak berubah.

Jenis Run yang dibuka (jalur resmi yang sudah ada, tanpa origin/enum baru):

| Unit | Jalur | Run | Posisi fisik |
|---|---|---|---|
| BARU/SEWA tanpa pickup/custody/riwayat V1 (6 dari 16 di production) | `registerWorkshopBornRunInTx` (P5) | `WORKSHOP_BORN` ACTIVE | sudah di workshop (dibuat di sana) |
| LAYANAN dengan Job pickup selesai (10 dari 16) | `offerUnitCustody` INBOUND (P1–P2/P9A) | `PENDING_ARRIVAL` + handoff OFFERED ke pickup nyata | **belum tiba** sampai "Unit Tiba" |
| LAYANAN tanpa pickup tercatat | `openPendingArrivalIntakeV2InTx` | `PENDING_ARRIVAL`, tanpa handoff | belum tiba; kedatangan dikonfirmasi petugas (lokasi wajib) — penanda di `reason` fase INTAKE lewat `transitionPhases` |

**Status Diproses BUKAN bukti kedatangan fisik:** Run LAYANAN lahir `PENDING_ARRIVAL`, tidak ada tahap yang dimulai; gerbang "Unit Tiba di Workshop" tidak berubah.

**Pengecualian (kode, alasan, tidak ada Run lahir):** `UNIT_FINISHED` (Siap Kirim/Terkirim tidak masuk Rencana), `UNIT_CANCELLED`, `INTERNAL_OR_SPAM`, `ORDER_NOT_PROCESSING`, `HAS_V1_PROGRESS`
(stage log / tahap berjalan → riwayat dipetakan backfill resmi, bukan tombol), `PARTIAL_ACTIVATION` (hanya reader atau hanya writer), `RUN_OUTSIDE_COHORT` (Run lama custody/backfill di luar cohort), `WAIT_PICKUP`.

**PIC & workshop:** `GET /production-v2/planning/refs` (izin menjadwalkan) → workshop aktif, operator aktif (akun aktif), kandidat (akun PRODUCTION_WORKER aktif belum terdaftar), `problems[]`
(`NO_WORK_CENTER`, `NO_PIC_PROFILE`, `NO_PIC_ACCOUNT`, `ONLY_ONE_PIC`) + tautan `/bengkel/pengaturan?tab=operator|area-kerja`. Formulir menampilkan alasan + tautan dan, bagi yang berizin
(`production_operator:write`), tombol **Daftarkan sebagai PIC** (aksi eksplisit lewat endpoint operator yang sudah ada). Peran dibaca saat render; PIC/Gudang tidak memanggil endpoint ini (tanpa 403 konsol).
Papan basi (Meja penuh/revisi berubah): formulir memuat ulang papan dan pindah dari Meja yang kini penuh.

## 3. Aktivasi — keputusan Owner, mekanisme konkret

Cohort TIDAK pernah diperluas otomatis oleh rilis/UI/migration. Mekanisme:

1. **Daftar eligible + pengecualian** (baca-saja): panel *Lihat aktivasi & pengecualian* di Rencana Produksi (`GET /production-v2/planning/eligibility`), atau `node scripts/production-delivery-v2/activate-rencana-units.js` tanpa argumen.
2. **Dry-run** (bawaan): `… activate-rencana-units.js --unit-codes=A,B` menampilkan perubahan cohort tanpa menulis.
3. **Terapkan**: `RENCANA_BACKUP_OK=1 node scripts/production-delivery-v2/activate-rencana-units.js --unit-codes=A,B --apply` (di container backend, setelah backup DB).
   Pengaman: hanya unit eligible (pengecualian ditolak berikut alasannya; satu pengecualian menggagalkan seluruh batch); kedua flag harus SUDAH ON dengan cohort sah (flag MATI **tidak** dinyalakan);
   `--max` (bawaan 25); satu transaksi dengan kunci baris flag; reader & writer berubah bersama; cohort lama dipertahankan; sebelum/sesudah dicetak; `reason` flag tercatat.
4. **Batal**: `--deactivate --apply` hanya untuk unit **tanpa** Run aktif.

Setelah aktif, Run baru lahir hanya saat tombol Jadwalkan / seret ditekan. Unit teraktivasi tanpa Run tetap bisa dikerjakan lewat V1; begitu Run lahir, jalur V1 ditolak 409 `UNIT_V2_OWNED` (aturan kepemilikan yang sudah ada).

### Snapshot production 6 Okt 2026 (baca-saja; tanpa nama pelanggan)

Cohort sekarang: writer = reader = **1** unit. Kandidat Diproses/Pengambilan: 58 unit.

- **Eligible, menunggu aktivasi (15)** — LAYANAN dengan foto pickup single-unit (10): RES-28092026-176, RES-30092026-193, -194, -195, RES-02102026-009, -014, RES-03102026-017, -019, -020, RES-04102026-023;
  BARU lahir di workshop (5): NEW-01102026-005, -006, NEW-04102026-008, -009, NEW-05102026-010 (semua `-U1`).
- **Unit Diproses dengan Run lama di luar cohort (1)**: NEW-30082026-024-U1 (`RUN_OUTSIDE_COHORT`) — bukan tugas Rencana.
- **Pengecualian `ORDER_NOT_PROCESSING` (8)**: unit RECEIVED pada order berstatus Pengambilan/Menunggu (mis. order multi-unit yang unit saudaranya belum diambil) — tidak masuk Rencana sampai order Diproses.
- **`WAIT_PICKUP` (16)**: unit belum diambil. **`RUN_OUTSIDE_COHORT` (19 dari 58)**: Run lama hasil custody/backfill, di luar cakupan.
- Tidak ada order Diproses dengan foto pickup multi-unit saat ini; kasus itu diuji (ambigu → dijelaskan, tidak ditebak).

## 4. Konfigurasi production yang masih diperlukan

1. **Aktivasi cohort** oleh Owner untuk unit pilihan (prosedur §3) — tanpa ini kartu tampil "Menunggu aktivasi Owner".
2. **Operator/PIC**: daftarkan akun PRODUCTION_WORKER yang benar-benar bertugas di Meja/Corner (production: 8 akun aktif, 1 terdaftar) lewat tombol di formulir atau Pengaturan → Operator.
3. **Workshop (area kerja)** aktif: ada `Workshop Utama`.
4. **Lokasi workshop bawaan** (Pengaturan Admin) — dibutuhkan "Unit Tiba" satu-aksi untuk unit tanpa pickup tercatat (tanpa itu petugas memilih lokasi Receiving/WIP).
5. Rilis = kode saja (rebuild image backend + frontend dist); tanpa migration. Rollback = image sebelumnya (`836f68de`). Run/rencana yang sudah lahir tetap ada di DB; bentuk datanya sama dengan yang
   dihasilkan jalur custody/workshop yang sudah ada (Run `PENDING_ARRIVAL`/`WORKSHOP_BORN`, handoff OFFERED, plan PLANNED), tetapi **tidak diuji ulang dengan kode lama** — jangan rollback setelah unit nyata dijadwalkan tanpa memeriksa papan.

## 5. QA (image bersih `git archive` commit kode `73b72a64` → `sanss-staging-rencana`, DB baru, order nyata `QA-RN-*`, login lewat formulir)

- Backend unit **1023/1023** (13 baru di `productionRencana.test.js`), audit writer ×7 = 0 pelanggaran, frontend 643/643 (7 baru di `rencanaOrderNyata.test.js`).
- Integrasi baru `rencanaOrderNyata.integration.test.js` 11/11 di DB terisolasi: foto, akar #2/#3, onboarding atomik, kedatangan eksplisit, unit BARU lahir di workshop, kapasitas+rollback, pengecualian (progres V1 benar-benar ada),
  tanpa Run ganda (bersamaan), izin, skrip aktivasi.
- **Staging API 28/28; browser 52/52** (`qa-ui-result.json`): foto 6 single-unit tampil & tersaji (PNG sah), 3 unit multi-unit dijelaskan ambigu, PIC kosong → alasan + tautan → daftarkan dua akun → muncul;
  Jadwalkan (tanggal/Meja/PIC/prioritas) → Run PENDING_ARRIVAL + rencana PLANNED + handoff dari pickup nyata, reload tetap; aktivasi via skrip (dry-run tidak menulis, tanpa backup ditolak, pengecualian ditolak);
  seret **mouse** dan **sentuh** → formulir yang sama; ketukan di handle tidak memindahkan; fallback tombol; Meja 1 3/3 "penuh" → lepas ditolak jelas, DB tidak berubah; papan basi → 409 + pemulihan → ulang berhasil;
  kasur BARU → `WORKSHOP_BORN` "Sudah tiba"; HP 390px tanpa scroll horizontal; konsol tanpa galat selain 409 yang disengaja.

Tidak terbukti: perangkat fisik/layar sentuh nyata (hanya emulasi sentuh Chromium), login akun production sungguhan, foto driver production sungguhan (staging memakai PNG sintetis di jalur berkas yang sama).
