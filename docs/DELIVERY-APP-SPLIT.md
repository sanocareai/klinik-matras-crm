# Pemisahan Sano Driver dan Sano Delivery Control

Status: fondasi + hardening (putaran 2) selesai di branch `feat/delivery-control-app` (24 September 2026).
Belum di-merge, belum di-deploy, belum ada build EAS, belum ada OTA. Sano Driver produksi tidak disentuh
(`git diff origin/main -- driver-mobile` = 0 baris).

## 1. Arsitektur sebelumnya (hasil audit)

**Satu aplikasi untuk dua kelompok pengguna.** `driver-mobile/` adalah satu app Expo (SDK 57, React Native
0.86.3), package `com.klinikmatras.drivermobile`, versionCode 6, project EAS `0fd04b96-…`.

| Area | Kondisi |
|---|---|
| Auth | `POST /auth/login` (token web biasa, bukan `typ: "mobile"`). Sesi geser lewat `X-Refreshed-Token`. |
| Role | `lib/roles.js`: ADMIN/DISPATCHER mendarat di `AdminHomeScreen` (dashboard baca-saja **di dalam app Driver**); DRIVER/HELPER/LEADER_DRIVER di `JobListScreen`. |
| Izin Android | Termasuk `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` (tracking driver). |
| Offline | `lib/executionQueue.js` + `executionCore.js` (antrean aksi job dengan kunci idempotensi). Teruji. |
| API client | `src/api.js` (278 baris): timeout, adopsi token, retry GET saja, upload `expo-file-system`. |
| Struktur repo | Folder aplikasi bersaudara tanpa npm workspaces (`mobile/`, `driver-mobile/`, `finance-mobile/`). |
| Backend | Satu backend/DB. RBAC bersumber di `constants/permissions.js`; klien membaca `capabilities`. |

**Biaya armada di backend sudah ada.** Pengajuan Biaya Lintas Divisi (`ExpenseSubmission`, workspace
`DELIVERY`) sudah punya relasi job/rute/kendaraan/driver/helper, odometer di metadata, bukti foto berversi,
tabel audit, idempotensi, dan jalur ke Finance lewat `FinExpense`. Tidak dibuat tabel/endpoint/ledger paralel.

## 2. Overlap dengan branch lain (diperiksa 24 September 2026)

Referensi: `origin/main`, `origin/feat/delivery-control-app`, `origin/feat/delivery-control-tower`.

| Area | `delivery-control-app` (ini) | `delivery-control-tower` | Main sejak basis saya (`2aac2bc2`, `24d0cfc0`) | Overlap |
|---|---|---|---|---|
| Commit unik vs main | 10 (termasuk 1 merge main ke branch ini) | 1 (`5dec4787`, hanya `frontend/dist`) | 2 (Finance Edit & Koreksi) | — |
| Sumber (bukan dist) | `backend/`, `packages/`, `delivery-control/`, `docs/` | tidak ada. Sumbernya (`cefd50eb`, Kendali Rute) **sudah di main** | `backend/src/routes/finance*.js`, Finance UI, 1 migrasi (`finance_stepup_pin`) | tidak ada file yang sama |
| Endpoint | `/delivery-control/session`, `/expense-submissions/:id/minta-revisi` (baru) | `armada.js` `routeInclude` +`isOnline/onlineSince` (12 baris, sudah di main) | koreksi Finance | tidak beririsan |
| Schema | enum `ExpenseSubmissionStatus` + 3 kolom di `expense_submissions` | tidak ada | `finance_stepup_pin` | tabel berbeda; urutan migrasi terjaga |
| Permission | +3 permission baru | tidak ada | tidak ada | — |
| Kontrak Route/Job | tidak diubah | menambah field baca-saja di respons rute | — | kompatibel |

Branch control-tower tidak di-merge dan tidak disentuh. Main sudah digabung KE branch ini (tanpa force-push).

## 3. Struktur target

```
packages/delivery-shared/   @sano/delivery-shared  (JS murni, teruji node --test)
delivery-control/           Sano Delivery Control (Expo, com.klinikmatras.deliverycontrol)
driver-mobile/              Sano Driver (TIDAK berubah)
backend/                    satu backend; izin baru, gerbang Control, PERLU_REVISI
frontend/                   web tetap: Route Planner kompleks, aksi massal, master data,
                            pengaturan, rekonsiliasi, laporan, ekspor besar
```

## 4. Matriks izin final

Dihasilkan dari `ROLE_PERMISSIONS` aktual (Y = punya).

| Role | `delivery:control:access` | `delivery:expense:own:read` | `own:write` | `finance:expense:submit` | `finance:approve` | `finance:admin` (verifikasi bukti) | `finance:post` (bayar) | `job:read` |
|---|---|---|---|---|---|---|---|---|
| ADMIN | Y | - | - | Y | Y | Y | Y | Y |
| OWNER | Y | - | - | Y | Y | Y | Y | Y |
| DISPATCHER | Y | - | - | Y | - | - | - | Y |
| LEADER_DRIVER | **-** | Y | Y | - | - | - | - | Y |
| DRIVER | - | Y | Y | - | - | - | - | - |
| HELPER | - | Y | Y | - | - | - | - | - |
| FINANCE | - | - | - | Y | Y | - | Y | - |

- **Akses Control** tidak lagi diturunkan dari `job:read`. Penegakan di server: `GET /api/delivery-control/session`
  (403 tanpa izin). `capabilities.deliveryControlApp` hanya cermin untuk UI.
- **Biaya milik sendiri** (`delivery:expense:own:*`, pola `job:own:*`): hanya workspace DELIVERY, hanya milik sendiri,
  relasi job/rute/kendaraan harus terkait pengguna (job/rute: driver atau helper-nya; kendaraan: PIC atau dipakai
  rute/job pengguna; driver/helper: diri sendiri atau rekan satu job/rute). Ditolak: atas nama orang lain, uang muka,
  PIC, order, sumber dana selain talangan pribadi, list semua, uang-muka-aktif, duplicate-check, template, recent,
  koreksi metadata, dan semua aksi Finance (approve/reject/pay/cancel/koreksi/verifikasi). Semua mutation wajib
  `Idempotency-Key`; bukti foto hanya pada pengajuan sendiri yang masih DRAF/PERLU_REVISI. Otorisasi (403/404)
  diperiksa sebelum kunci idempotensi (428).
- Driver/Helper **tidak** diberi `finance:expense:submit`.

## 5. State machine final (Pengajuan Biaya)

| Dari | Aksi | Aktor | Ke | Catatan |
|---|---|---|---|---|
| (baru) | buat | pemilik | DRAFT | audit "Draf dibuat" |
| DRAFT | edit / unggah bukti | pemilik | DRAFT | audit `draft` / `bukti` |
| DRAFT | ajukan | pemilik | MENUNGGU_PERSETUJUAN (atau OTOMATIS_DISETUJUI bila kebijakan) | membuat/menautkan FinExpense |
| DRAFT | batalkan | pemilik | DIBATALKAN | |
| MENUNGGU_PERSETUJUAN | tarik | pemilik | DRAFT | `withdrawnAt`, tanpa alasan revisi |
| MENUNGGU_PERSETUJUAN | **minta revisi** | reviewer (`finance:approve`), bukan pemohon | **PERLU_REVISI** | alasan wajib (min 3); FinExpense → DRAFT, pengajuan lepas dari FinExpense; buku besar tidak tersentuh |
| MENUNGGU_PERSETUJUAN | setujui / tolak | reviewer | DISETUJUI / DITOLAK | via FinExpense (kontrak Finance tidak berubah) |
| PERLU_REVISI | edit / unggah bukti | pemilik | PERLU_REVISI | |
| PERLU_REVISI | ajukan ulang | pemilik | MENUNGGU_PERSETUJUAN | FinExpense BARU; audit "Diajukan ulang setelah revisi" |
| PERLU_REVISI | batalkan | pemilik | DIBATALKAN | |
| DISETUJUI | bayar | Finance | DIBAYAR | via FinExpense |
| MENUNGGU_PERSETUJUAN / DISETUJUI | (status final lain) | — | minta revisi ditolak 409 | hanya dari MENUNGGU_PERSETUJUAN |

Revisi dibedakan dari tarik/batalkan: pelaku (reviewer vs pemilik), alasan wajib, status (PERLU_REVISI vs DRAFT vs
DIBATALKAN), kolom `revision_*` dan baris audit tersendiri. Setiap mutation menulis `ExpenseSubmissionAudit`:
actor, waktu, alasan, status sebelum/sesudah.

## 5a. Otorisasi foto struk (media)

Handler media Finance yang sudah ada (`routes/financeMedia.js`, `bolehLihatBukti`) diperluas, TANPA storage atau endpoint baru dan TANPA melebarkan `finance:read`:

- Pemilik (`requestedBy`/`createdBy`) Pengajuan Biaya workspace **DELIVERY** boleh membaca foto bukti pada pengajuannya sendiri, termasuk sebelum
  pengajuan menjadi FinExpense. Syarat izin: `delivery:expense:own:read` atau izin pengajuan lama.
- Tidak berlaku untuk: pengajuan orang lain, workspace selain DELIVERY, media Finance/FinExpense yang bukan miliknya, bukti pembayaran pelanggan,
  atau daftar global. `finance:read` tetap satu-satunya jalan melihat semua.
- Mekanisme: header Bearer, atau URL bertanda-tangan (`POST /finance/media/sign`) berumur maksimal 10 menit. Nama berkas = hash isi (`<sha1>.jpg`);
  URL tidak memuat path penyimpanan. Tanda tangan kedaluwarsa, rusak, atau milik berkas lain ditolak 403.
- Penggantian bukti = unggah versi baru (tidak ada jalur hapus). Hanya pada pengajuan MILIK SENDIRI berstatus DRAF/PERLU_REVISI untuk akun own-only dan
  pemegang izin pengajuan lama tanpa hak Finance; staf Finance (`finance:post`/`finance:admin`) tetap boleh melampirkan kapan pun (perilaku lama).
- Delivery Control membuka foto lewat URL bertanda-tangan (ulang otomatis sekali bila kedaluwarsa, lalu tombol "Coba lagi").
- Catatan performa: pemeriksaan kepemilikan memakai satu query per foto pada `expense_submission_proofs` (tabel kecil; indeks `url` belum ditambahkan
  agar putaran ini tanpa migrasi baru).

## 5b. Kebijakan auto-approve (final)

Aturan lama (`config.js`, workspace DELIVERY): BBM/TOL/PARKIR dengan nominal <= Rp300.000 disetujui otomatis saat ajukan (audit `actorId` null).

- Pengajuan **mandiri** oleh akun own-only (Leader Driver, Driver, Helper; hanya `delivery:expense:own:*`) **tidak pernah** auto-approve: selalu
  MENUNGGU_PERSETUJUAN dan FinExpense-nya MENUNGGU_APPROVAL. Audit mencatat alasannya.
- Aktor diturunkan SERVER-SIDE dari izin (`ownOnly(user)`); tidak ada field klien (`source`, `autoApprove`, header) yang berpengaruh.
- Tidak berubah: Dispatcher, Admin, Owner, Finance, Sales, dan multi-role yang memegang jalur pengajuan lama; workspace tanpa kebijakan tidak pernah auto-approve.
- Tes: unit kebijakan + matriks integrasi 7 role x 4 kategori (BBM, TOL, PARKIR, SERVIS) x 3 nominal (250.000, 300.000, 300.001) = 84 sel (SALES ditolak 403 sejak C2.1, dites terpisah).

## 5c. Web: PERLU_REVISI

`ArmadaPengajuanBiaya.jsx`: label/badge "Perlu Revisi" (oranye), filter status, detail dengan alasan, reviewer, waktu, dan Riwayat Revisi (permintaan dan pengajuan
ulang); riwayat perubahan berupa kalimat Indonesia. Pemohon dapat Perbaiki/Ajukan Ulang/Batalkan saat PERLU_REVISI sesuai kontrak backend memakai API yang sudah
ada; web tidak memanggil `minta-revisi` dan tidak menambah mutation. Status yang tidak dikenal tampil "Status tidak dikenal (X)" tanpa aksi. Logika di
`features/armada/pengajuanBiayaStatus.js` (murni, teruji). `frontend/dist` tidak dibangun ulang di branch ini; bangun dari worktree bersih setelah merge.

## 5d. Stabilitas test integrasi (akar kontensi)

Diukur: `truncateAll()` men-TRUNCATE ~100 tabel SETIAP tes (12-17 detik di Postgres Docker; satu fsync per tabel) dan `testPrisma` memakai batas transaksi bawaan
Prisma (2 dtk menunggu koneksi, 5 dtk total). Saat mesin ramai, hook setup/cleanup gagal dengan P2028 "Unable to start a transaction in the given time" dan
menggagalkan tes berikutnya (efek berantai). Database tes bersama antar sesi memperburuk.

Perbaikan (bukan sekadar menaikkan timeout): (1) `truncateAll` hanya men-TRUNCATE tabel yang berisi (sekitar 3-5x lebih cepat; hasil tetap database kosong);
(2) `testPrisma` memakai `transactionOptions` yang sama dengan `src/db.js`; (3) `npm run test:integration` kini memakai `tests/integration/setup/runIsolated.js`:
database unik `km_it_<waktu>_<pid>_test` per run, `migrate deploy`, jalan serial, lalu `DROP` (hanya nama berpola aman yang dibuat proses itu; `KEEP_TEST_DB=1` untuk
investigasi). `test:integration:shared` mempertahankan cara lama. Audit statis 48 berkas: semua menutup server, memutus Prisma, memakai port efemeral; tidak
ditemukan handle atau koneksi bocor.

## 6. Migration dan API

**Migrasi (aditif, tidak destruktif):** `20260924110000_expense_submission_perlu_revisi` — 1 nilai enum
(`ALTER TYPE … ADD VALUE 'PERLU_REVISI'`), 3 kolom nullable (`revision_reason`, `revision_requested_by`,
`revision_requested_at`), 1 FK `ON DELETE SET NULL`. Tidak ada DROP/UPDATE data. Drift `prisma migrate diff`
untuk tabel pengajuan: nol.

**API baru:** `GET /api/delivery-control/session` (izin `delivery:control:access`),
`POST /api/finance/expense-submissions/:id/minta-revisi` (izin `finance:approve`, `Idempotency-Key` wajib).

**API diubah (aditif):** `GET /expense-submissions?limit&offset` (paginasi opsional; tanpa `limit` perilaku lama),
`?status=A,B` (daftar dipisah koma), detail memuat nama pelaku audit dan `revisionRequestedBy`; daftar berpaginasi
tidak membawa riwayat audit per baris; `config` untuk akun own-only tidak memuat ambang auto-approve;
`capabilities` menambah `deliveryControlApp`, `deliveryExpense{submit,verify,approve,requestRevision,pay}`,
`deliveryExpenseOwn{read,write}`. `/auth/me` dan login tetap kompatibel (ada tes).

## 7. Test dan build

Hasil terakhir (24 September 2026):

| Cek | Hasil |
|---|---|
| Backend unit | 622/622 |
| Paket shared | 29/29 |
| Delivery Control (konfigurasi, sumber UI) | 13/13 |
| Frontend web | 143/143 (termasuk 6 tes PERLU_REVISI) |
| Sano Driver (tes existing) | 30/30 |
| Integrasi penuh, run 1 (database unik, serial) | 535/535 lulus (0 gagal) |
| Integrasi penuh, run 2 (database unik baru, serial) | 535/535 lulus (0 gagal) |
| Bundle Android | Driver lulus (bundle identik dengan sebelum perubahan: `index-2dfd9255...`), Control lulus |
| Build Vite web (ke folder sementara) | lulus |
| Manifest Android (`expo prebuild`) | Control: INTERNET, penyimpanan, SYSTEM_ALERT_WINDOW, VIBRATE; izin lokasi, foreground service, RECORD_AUDIO dihapus. Driver: sama seperti sebelumnya |
| `git diff origin/main -- driver-mobile` | 0 baris |

Audit: RBAC (matriks + tes izin/kepemilikan), idempotensi (semua mutation own-only 428 tanpa kunci, replay dan paralel), N+1 (daftar berpaginasi memakai satu query
dengan include batch, tanpa audit per baris), kebocoran data (config own-only tanpa ambang auto-approve, media hanya milik sendiri, kolom internal tidak ikut di
`/delivery-control/session`), batas migrasi (satu migrasi aditif di putaran 1; putaran 2 tanpa migrasi baru).

## 8. Rilis dan rollback

Belum ada yang dirilis, dimigrasi di produksi, atau dibangun di EAS.

**Urutan rilis backend:** merge, lalu deploy (migrasi `20260924110000` otomatis lewat `prisma migrate deploy` saat container start; aditif). Setelah merge, bangun
`frontend/dist` dari worktree bersih di HEAD (bukan dari tree kotor) agar web memuat label PERLU_REVISI. Uji sebelum deploy: `npm run test:integration` (terisolasi).

**Rollback:** `git revert` commit kode (backend/web). Nilai enum Postgres tidak dihapus (tidak perlu). Bila ada baris PERLU_REVISI saat rollback:
`SELECT count(*) FROM expense_submissions WHERE status='PERLU_REVISI'`; pemiliknya mengajukan ulang atau membatalkannya. Izin baru (`delivery:*`) hilang bersama
revert kode; tidak ada data yang bergantung padanya.

**Sano Driver:** tidak berubah; jangan publish OTA dari branch ini.

**Sano Delivery Control (pertama kali):** `eas init` (project BARU, jangan memakai project ID Driver), set `EAS_PROJECT_ID`, lalu
`eas build -p android --profile preview`, QA perangkat (lihat bagian 9), periksa manifest APK tanpa izin lokasi, baru `production`.

## 9. Blocker dan keputusan tersisa

- **EAS/perangkat:** `eas init` Control belum dijalankan, kuota EAS habis, belum ada APK preview. QA perangkat yang belum bisa dilakukan: login Admin/Owner/Dispatcher
  vs Leader Driver/Driver/Helper, kamera struk, tampilan foto struk lewat URL bertanda-tangan di HP, draf lokal, mode gelap/terang, dan build release (Proguard).
- Layar biaya **belum** dipasang di Sano Driver (sengaja, menunggu preview EAS). Izin server, antrean draf offline, dan akses foto sudah siap.
- `sumberDana` UANG_MUKA_OPERASIONAL belum ada di form Control (butuh pemilih uang muka); aksi bayar dan verifikasi bukti belum ada di UI Control (API dan izin siap).
- Indeks `expense_submission_proofs(url)` bisa ditambahkan (migrasi aditif) bila tabel membesar.
- Ditutup putaran ini: akses foto struk pemilik, kebijakan auto-approve, label web PERLU_REVISI, stabilitas test integrasi.

## 10. Catatan pembersihan artefak

- `C:\tmp\km-final` (worktree sisa fase insentif) dihapus pada 24 September 2026 dengan **provenance yang tidak sepenuhnya kuat**: dasar identifikasi hanya nama folder,
  waktu pembuatan, dan konteks bahwa folder itu dibuat oleh proses ini; pemeriksaan isi (`backend/.env` dan `node_modules` hasil `npm ci`) tidak cocok dengan dugaan
  (kemungkinan sebagian sudah terhapus oleh `git worktree remove` yang gagal). Tidak ada pekerjaan yang hilang: worktree itu tidak terdaftar dan seluruh kerja sudah ter-commit di branch.
- Artefak sementara lain (`chk`, `chk2`, `chk3`, folder `*-export`, `fe-build-check`) dibuat dan dihapus oleh proses yang sama (junction dilepas dulu dengan `rmdir`,
  target diverifikasi utuh). Artefak lain di `C:\tmp` tanpa marker kepemilikan yang tegas TIDAK disentuh.

## 11. Temuan selama gate integrasi

- **Race idempotensi (kode, diperbaiki):** retry segera dengan kunci sama bisa mendapat 409 karena baris DONE disimpan setelah respons dikirim. Kini disimpan sebelum respons; tes regresi `idempotencyPersistBeforeResponse`.
- **P1001 "Can't reach database server" (infrastruktur):** satu run awal gagal 21 tes dalam satu berkas (proxy port Docker Desktop; Postgres tidak restart). Runner kini mengulang sekali HANYA berkas yang seluruh kegagalannya P1001; kegagalan lain tidak pernah diulang. Kedua run final lulus tanpa perlu ulang.
