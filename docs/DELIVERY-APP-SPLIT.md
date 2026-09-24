# Pemisahan Sano Driver dan Sano Delivery Control

Status: fondasi additive selesai di branch `feat/delivery-control-app` (24 September 2026).
Belum di-merge, belum di-deploy, belum ada build EAS. Sano Driver produksi tidak disentuh.

## 1. Arsitektur sebelumnya (hasil audit)

**Satu aplikasi untuk dua kelompok pengguna.** `driver-mobile/` adalah satu app Expo
(SDK 57, React Native 0.86.3), package `com.klinikmatras.drivermobile`, versionCode 6,
project EAS `0fd04b96-…`, channel `development/preview/production/apk`.

| Area | Kondisi |
|---|---|
| Auth | `POST /auth/login` (token web biasa, bukan `typ: "mobile"`). Sesi geser lewat header `X-Refreshed-Token`. |
| Role | `lib/roles.js`: ADMIN/DISPATCHER mendarat di `AdminHomeScreen` (dashboard baca-saja **di dalam app Driver**); DRIVER/HELPER/LEADER_DRIVER di `JobListScreen`. Ada nama role di kode klien. |
| Izin Android | Termasuk `ACCESS_BACKGROUND_LOCATION`, `FOREGROUND_SERVICE_LOCATION` (untuk tracking driver). |
| Offline | `lib/executionQueue.js` + `executionCore.js` (antrean aksi job: mulai, tiba, selesai, gagal, dengan kunci idempotensi). Teruji. |
| Tracking | `lib/backgroundTracking.js`, `hooks/useDriverTracking.js` (expo-location, expo-task-manager). |
| API client | `src/api.js` (278 baris): timeout, adopsi token, retry GET saja, upload lewat `expo-file-system`. |
| Struktur repo | Pola **folder aplikasi bersaudara**, tanpa npm workspaces: `mobile/` (Messenger), `driver-mobile/`, `finance-mobile/` (TS), `driver-app/` (Capacitor). Masing-masing punya `node_modules` dan EAS sendiri. |
| Backend | Satu backend/DB. Sumber kebenaran RBAC: `backend/src/services/capabilities.js` (klien tidak boleh menyalin peta role→izin). |

**Biaya armada di backend sudah ada.** Pengajuan Biaya Lintas Divisi (`ExpenseSubmission`,
workspace `DELIVERY`) sudah punya: relasi job/rute/kendaraan/driver/helper, odometer di
metadata, bukti foto berversi (`ExpenseSubmissionProof`), tabel audit
(`ExpenseSubmissionAudit`), idempotensi (middleware router), dan status yang mencerminkan
`FinExpense` (satu-satunya jalur menuju ledger Finance). Karena itu **tidak dibuat tabel,
endpoint, atau ledger baru**.

**Celah yang ditemukan** (perlu keputusan, tidak diubah diam-diam):

1. `DRIVER`/`HELPER`/`LEADER_DRIVER` **tidak punya** `finance:expense:submit`, jadi driver belum
   bisa mengajukan biaya lewat API. Yang punya: ADMIN, OWNER, DISPATCHER, SALES, PRODUCTION_LEAD,
   WAREHOUSE, FINANCE.
2. Status `PERLU_REVISI` **belum ada** di enum `ExpenseSubmissionStatus`. Ekuivalen saat ini:
   pemohon menarik pengajuan (`tarik`, hanya dari `MENUNGGU_PERSETUJUAN`), mengedit, lalu mengajukan ulang.
3. Verifikasi bukti membutuhkan `finance:admin` (route `verifikasi-bukti`).
4. App Driver produksi memuat dashboard admin (`AdminHomeScreen`); ini perilaku lama dan tidak diubah.

## 2. Struktur target

```
packages/delivery-shared/   @sano/delivery-shared  (JS murni, teruji node --test)
  src/api/client.js           klien API (timeout, retry GET, 401, X-Refreshed-Token, upload injeksi)
  src/session.js, rbac.js     sesi + gerbang capabilities (deliveryControlApp)
  src/biayaArmada/            domain, binding API, antrean draf offline
delivery-control/           Sano Delivery Control (Expo, com.klinikmatras.deliverycontrol)
driver-mobile/              Sano Driver (TIDAK berubah)
backend/                    satu backend; hanya menambah field capabilities
frontend/                   web tetap: Route Planner kompleks, aksi massal, master data,
                            pengaturan, rekonsiliasi, laporan, ekspor besar
```

## 3. Yang selesai

| Commit | Isi |
|---|---|
| `feat(delivery): paket shared` | `@sano/delivery-shared`, 24 tes. |
| `feat(backend): capabilities` | `deliveryControlApp` (dari izin `job:read` penuh) dan `deliveryExpense {submit, verify, approve, pay}`. Aditif, tanpa migrasi. 6 tes. |
| `feat(delivery-control): aplikasi` | App Expo terpisah: login + gerbang capabilities, Home modul, layar Biaya Armada (daftar per tahap). 5 tes konfigurasi. |

Fondasi Biaya Armada (di shared + endpoint existing):

- Input: kategori, nominal, kendaraan, rute/job, tanggal, catatan, foto struk, odometer opsional
  (field metadata datang dari `GET /finance/expense-submissions/config`, tidak disalin ke klien).
- Alur: DRAF → DIAJUKAN → DISETUJUI → DIBAYAR, atau DITOLAK/DIBATALKAN (`statusInfo`). PERLU_REVISI ditandai belum didukung.
- Izin dipisah: ajukan, verifikasi, setujui, bayar (`deliveryExpenseAbilities`).
- Idempotensi: semua aksi uang wajib `Idempotency-Key` (API binding menolak tanpa kunci).
- Draf offline Driver: `createOfflineDraftStore` (antrean per pengguna, kunci penyimpanan sendiri,
  kunci idempotensi dibuat sekali, sinkron bertahap create → foto → ajukan, tahan putus koneksi).
  Belum dipasang ke UI Driver.
- Audit/histori: memakai `ExpenseSubmissionAudit` dan `ExpenseSubmissionProof` berversi yang sudah ada.
- Finance: tidak ada ledger paralel; persetujuan/pembayaran lewat `/finance/expenses/:id/approve|reject|pay`.

## 4. Masih shared / duplikasi yang tercatat

Sengaja **belum** memindahkan modul Driver ke paket shared: mengubah Driver butuh
`metro.config.js` baru dan build EAS untuk membuktikan resolusi Metro di cloud (kuota EAS
sedang habis). Duplikasi sementara, dengan rencana migrasi:

| Di Driver | Padanan di shared | Rencana |
|---|---|---|
| `src/api.js` request/upload | `api/client.js` (perilaku sama, teruji) | Driver memakai shared setelah build preview Driver lulus |
| `src/lib/roles.js` | `rbac.js` (berbasis capabilities) | Driver tetap; Control tidak memakai nama role |
| `src/theme.js` | `delivery-control/src/theme.js` | Ekstrak ke paket UI bersama saat layar Admin bertambah |

## 5. Migrasi dan API

- Migrasi database: **tidak ada**.
- API: `GET /auth/me` dan login kini menyertakan `capabilities.deliveryControlApp` dan
  `capabilities.deliveryExpense` (field tambahan; field lama tidak berubah, ada tes kompatibilitas).
- Endpoint baru: tidak ada.

## 6. Test dan build

- `packages/delivery-shared`: 24/24.
- `delivery-control`: 5/5 (package ID, tanpa izin lokasi, EAS/channel terpisah, runtimeVersion).
- `backend` unit: 607/607 (601 lama + 6 baru).
- Manifest Android hasil `expo prebuild`: Control efektif hanya `INTERNET`, `READ/WRITE_EXTERNAL_STORAGE`, `SYSTEM_ALERT_WINDOW`, `VIBRATE`; izin lokasi, foreground service, dan `RECORD_AUDIO` dihapus eksplisit. Driver tetap memuat izin lokasi seperti sebelumnya.
- Bundle Metro Android: Driver (`expo export`) lulus, Control lulus.
- `git diff origin/main -- driver-mobile`: **0 baris**. Tes Driver 30/30.
- Integrasi backend terkait (biaya armada, auth/capabilities, peran Finance, persetujuan, idempotensi): lihat laporan sesi.

## 7. Rilis dan rollback

Belum ada yang dirilis.

**Backend (aditif):** rollback = `git revert` commit capabilities. Tanpa migrasi, tanpa efek pada Driver/Sales/Finance/Warehouse.

**Sano Driver:** tidak berubah; tidak ada yang perlu di-rollback. Jangan publish OTA dari branch ini.

**Sano Delivery Control (pertama kali):**
1. Merge branch (setelah tinjauan) dan deploy backend (capabilities).
2. Di `delivery-control/`: `eas init` (project BARU, jangan memakai project ID Driver), lalu set `EAS_PROJECT_ID`.
3. `eas build -p android --profile preview` (APK internal). Uji dengan akun Admin, Owner (harus masuk),
   Driver dan Helper (harus ditolak dengan pesan jelas).
4. Periksa manifest APK: tanpa izin lokasi.
5. Baru profile `production`. Update OTA lewat channel `control-production`.
Rollback Control: cabut distribusi APK/uninstall; tidak ada data lokal penting selain token.

## 8. Langkah UI Admin berikutnya

1. Detail pengajuan (bukti berversi, audit, tautan job/rute/kendaraan) + aksi tarik/batalkan.
2. Form input biaya (field dinamis dari config server, kamera struk, odometer opsional) memakai draf offline.
3. Antrean Finance: verifikasi bukti, setujui/tolak (alasan wajib), bayar (butuh rekening kas) sesuai `deliveryExpenseAbilities`.
4. Dashboard operasional, Driver, Tracking, Rute, Masalah, Performa, Histori/pencarian, Action Center
   (read-heavy, memakai endpoint `/armada/*` yang sudah ada).
5. Quick actions operasional terbatas (bukan Route Planner/aksi massal).
6. Setelah build preview Driver dibuktikan, migrasikan Driver ke `@sano/delivery-shared` (lihat bagian 4).

## 9. Keputusan yang dibutuhkan

- Beri driver/helper hak mengajukan biaya? Opsi A: tambah `finance:expense:submit` ke DRIVER/HELPER/LEADER_DRIVER
  (sederhana, sama pola divisi lain, tapi melebarkan izin Finance). Opsi B: izin baru khusus
  `delivery:expense:submit` yang hanya berlaku untuk workspace DELIVERY dan milik sendiri (lebih sempit, perlu ubah gerbang route).
- Tambah status `PERLU_REVISI` di backend (perlu koordinasi dengan sesi Pengajuan Biaya/Finance).
- LEADER_DRIVER ikut masuk Control karena punya `job:read` penuh. Batasi jika tidak diinginkan.
