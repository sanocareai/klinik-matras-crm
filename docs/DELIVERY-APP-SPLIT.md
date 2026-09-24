# Pemisahan Sano Driver dan Sano Delivery Control

Status: fondasi + hardening selesai di branch `feat/delivery-control-app` (24 September 2026).
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

Hasil terakhir (24 September 2026, PostgreSQL uji terisolasi `km_dctl2_test`):

| Cek | Hasil |
|---|---|
| Backend unit | 613/613 |
| Paket shared | 29/29 |
| Delivery Control (konfigurasi, sumber UI) | 12/12 |
| Sano Driver (tes existing) | 30/30 |
| Integrasi terarah (pengajuan, biaya milik sendiri, PERLU_REVISI, gerbang Control, persetujuan, peran Finance, idempotensi, auth mobile, media, insentif) | 121/121 di run bersih + `expenseSubmission` 21/21 dijalankan ulang |
| Bundle Android | Driver lulus (bundle identik dengan sebelum perubahan: `index-2dfd9255…`), Control lulus |
| `git diff origin/main -- driver-mobile` | 0 baris |

Catatan jujur: run terarah yang bersih menampilkan 2 kegagalan di `expenseSubmission` (kegagalan satu hook
`Unable to start a transaction in the given time` dan efek berantainya) saat 2 suite tes sesi lain berjalan di
Postgres yang sama; file itu dijalankan ulang terpisah dan lulus 21/21 (satu run lain gagal 1 tes berbeda, lulus
saat diulang). Ini kontensi database lokal, bukan regresi. Tidak ada satu run tunggal 142/142.

Ringkasan cakupan:

- Unit: matriks izin (7 role), capabilities, `ownOnly`, paket shared, konfigurasi dua app, sumber UI.
- Integrasi (PostgreSQL nyata): gerbang Control; biaya milik sendiri (workspace, milik sendiri vs orang lain, relasi,
  field terlarang, endpoint Finance ditolak, idempotensi, paginasi, kebocoran data); PERLU_REVISI (semua transisi,
  pembeda tarik/batalkan, integrasi Finance setelah revisi, idempotensi paralel, audit lengkap); regresi pengajuan,
  persetujuan, peran Finance, idempotensi, auth mobile, media, insentif.
- Bundle Android: Driver dan Control keduanya lulus. Manifest hasil `expo prebuild`: Control tanpa izin lokasi.

## 8. Rilis dan rollback

Belum ada yang dirilis.

**Urutan rilis backend:** merge → deploy (migrasi otomatis lewat `prisma migrate deploy` saat container start).
Migrasi aditif; aplikasi lama tidak membaca kolom baru. Web `ArmadaPengajuanBiaya` belum punya label untuk
`PERLU_REVISI` (tampil sebagai teks status mentah) — status ini hanya muncul bila reviewer memakai
`minta-revisi` (hanya dari app Control), jadi aman sampai label web ditambahkan.

**Rollback:** `git revert` commit kode. Nilai enum Postgres tidak dihapus (tidak perlu; nilai yang tidak dipakai tidak berbahaya).
Bila ada baris berstatus PERLU_REVISI saat rollback, pemiliknya harus mengajukan ulang atau membatalkannya lewat
SQL; pemeriksaan: `SELECT count(*) FROM expense_submissions WHERE status='PERLU_REVISI'`.

**Sano Driver:** tidak berubah; jangan publish OTA dari branch ini.

**Sano Delivery Control (pertama kali):** `eas init` (project BARU, jangan memakai project ID Driver) → set
`EAS_PROJECT_ID` → `eas build -p android --profile preview` → uji akun Admin/Owner/Dispatcher (masuk) dan
Leader Driver/Driver/Helper (ditolak) → periksa manifest APK tanpa izin lokasi → baru `production`.
Kuota EAS saat ini habis.

## 9. Blocker dan keputusan tersisa

- Build EAS Control dan preview Driver belum bisa dibuat (kuota EAS, `eas init` belum dijalankan).
- Layar biaya **belum** dipasang di Sano Driver (sengaja, menunggu preview EAS). Izin server dan antrean draf offline
  sudah siap.
- Foto bukti: handler media (`financeMedia.js`) hanya mengizinkan pemilik `FinExpense`; bukti yang diunggah sebelum
  pengajuan belum tertaut FinExpense sehingga akun tanpa `finance:read` (Dispatcher, kelak Driver) belum bisa
  MENAMPILKAN kembali foto miliknya dari server. Perlu penyesuaian kecil di sisi media (area sesi Finance).
- Auto-approve (kebijakan Finance: BBM/tol/parkir ≤ Rp300.000) berlaku juga untuk pengajuan Driver bila kelak
  dipasang; bila tidak diinginkan, batasi di `config.js` (bukan di app).
- Label `PERLU_REVISI` di web `ArmadaPengajuanBiaya` (area sesi Pengajuan Biaya).
- `sumberDana` UANG_MUKA_OPERASIONAL belum tersedia di form Control (butuh pemilih uang muka).
- Aksi bayar dan verifikasi bukti belum ada di UI Control (tidak diminta; API dan izin sudah siap).
