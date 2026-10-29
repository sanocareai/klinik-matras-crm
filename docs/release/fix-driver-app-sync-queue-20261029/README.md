# Laporan Pra-OTA — Perbaikan Driver App (lanjutan audit 29 Okt 2026)

Status: **BELUM di-OTA/publish ke channel manapun.** Menunggu GO eksplisit
owner. Tidak ada data/queue production yang diubah selama implementasi
dan QA (lihat §6).

## 1. Branch dan SHA final

- Branch: `fix/driver-app-sync-queue-20261029`
- Dibuat di atas: `origin/main` @ `fa6beb86` (masih tip `main` saat laporan
  ini dibuat — dicek ulang via `git fetch origin main` sebelum commit)
- Commit final: `67c0a9c284028d4c9286f980bda7cd502c1e7fb6`
- Sudah di-push ke origin, **belum** di-merge ke `main`.
- Audit sumber (tidak diubah): branch `docs/audit-driver-queue-blank-20261029`,
  file `docs/release/audit-driver-queue-blank-20261029/README.md`.

## 2. Daftar file berubah

```
driver-mobile/src/components/JobCard.js          | diubah
driver-mobile/src/components/RouteStartCard.js   | diubah
driver-mobile/src/context/ExecutionSyncContext.js| diubah
driver-mobile/src/hooks/useMyJobs.js             | ditulis ulang
driver-mobile/src/lib/executionCore.js           | diubah
driver-mobile/src/lib/executionCore.test.js      | diubah (+3 tes)
driver-mobile/src/lib/executionQueue.js          | diubah
driver-mobile/src/lib/executionQueue.test.js     | diubah (+7 tes, 1 tes lama ditulis ulang)
driver-mobile/src/lib/myJobsSelect.js            | BARU
driver-mobile/src/lib/myJobsSelect.test.js       | BARU (7 tes)
```
10 file, +806/-124 baris. **Tidak ada migrasi database, tidak ada
perubahan backend/endpoint** — murni client driver-mobile.

### Ringkasan per target

1. **route-start / checklist** (`executionCore.js`, `executionQueue.js`):
   `CHECKLIST_BELUM_LENGKAP` (409) sekarang diklasifikasikan `"retry"`
   (bukan `"reconcile"` generik) — item route-start MENCOBA ULANG mutasi
   aslinya tiap kembali ke foreground/jeda backoff, TIDAK blocked
   permanen. `reconcileItem` juga membersihkan route-start yang sudah moot
   (semua job di rute itu sudah diproses lewat jalur lain) walau
   `Route.status` masih `PUBLISHED`.
2. **blank/spinner tab Aktif** (`hooks/useMyJobs.js` + `lib/myJobsSelect.js`
   baru): logika seleksi hasil diekstrak jadi fungsi murni. Cache job yang
   masih valid tidak lagi dibuang ke `undefined` hanya karena ADA error
   (config ATAU job query); fullscreen spinner hanya mungkin SEBELUM data
   pernah ada sama sekali — config query yang gagal permanen (settled ke
   error) tidak lagi bisa memicu spinner selamanya.
3. **Status antrean & aksi "Kirim Ulang"/"Batalkan"** (`executionCore.js`:
   `pendingStatusInfo`, `discardConfirmText`; `executionQueue.js`:
   `attemptSend`, `retryBlockedExecution`, `syncState` baru `RETRYING`;
   `ExecutionSyncContext.js`: `retryItem`, `retryAll`; UI di `JobCard.js` &
   `RouteStartCard.js`). Bedakan pending/retrying/blocked dengan pesan
   SERVER ASLI (bukan teks generik); "Kirim Ulang" per-item benar-benar
   mengirim ulang mutasi (bukan cuma GET reconciliation); "Batalkan" selalu
   lewat `Alert.alert` konfirmasi yang menyebut aksi dan memperingatkan
   foto/POD yang belum terkirim akan hilang.

## 3. Hasil seluruh test

### Unit test (`npm test` — `node --test "src/**/*.test.js"`, dijalankan
di worktree bersih `C:\tmp\driver-sync-fix\driver-mobile` setelah `npm
install` fresh)

```
ℹ tests 74
ℹ suites 0
ℹ pass 74
ℹ fail 0
```

Termasuk `src/sintaksSemuaBerkas.test.js` (parse SELURUH berkas JS/JSX di
`src/`, termasuk `JobCard.js` & `RouteStartCard.js` yang diedit) — lolos,
jadi tidak ada kesalahan sintaks JSX yang baru ketahuan saat build.

Rincian regresi baru yang menguji 7 skenario yang diminta (target 4):

| # | Skenario | File | Status |
|---|---|---|---|
| 1 | Checklist belum lengkap → route tetap PUBLISHED → queue tidak blocked permanen | `executionQueue.test.js` | ✔ |
| 2 | Checklist kemudian lengkap → retry route-start berhasil | `executionQueue.test.js` | ✔ |
| 3 | Seluruh job sudah diproses → stale route-start otomatis dibersihkan | `executionQueue.test.js` (+ kontra-kasus: masih ada job ASSIGNED → TIDAK dibersihkan) | ✔ |
| 4 | Refetch gagal + cache tersedia → job tetap tampil | `myJobsSelect.test.js` | ✔ |
| 5 | Reader-config gagal → tidak spinner permanen | `myJobsSelect.test.js` | ✔ |
| 6 | Error tanpa cache → error state (bukan spinner), tombol coba lagi tetap bisa jalan (`refetch` tidak diubah) | `myJobsSelect.test.js` | ✔ |
| 7 | Blocked item menampilkan pesan server yang sebenarnya | `executionCore.test.js` (`pendingStatusInfo`) | ✔ |

Tambahan di luar 7 poin minimum: "Kirim Ulang" benar-benar mengirim ulang
mutasi (bukan cuma GET) dengan 3 varian (`retryBlockedExecution` sukses,
gagal lagi, dan sudah resolved lewat reconcile tanpa resend) — 3 tes di
`executionQueue.test.js`; `discardConfirmText` dengan/tanpa foto — 1 tes di
`executionCore.test.js`.

**Catatan jujur:** satu tes LAMA (`executionQueue.test.js`, sebelumnya
berjudul "409 gerbang Checklist Persiapan Perjalanan ... -> blocked
dengan lastErrorCode terpreservasi") men-assert PERILAKU BUG LAMA
(blocked permanen) secara eksplisit — tes itu GAGAL begitu fix
diterapkan, karena tes itu sendiri adalah dokumentasi tertulis dari bug
yang sedang diperbaiki. Ditulis ulang jadi
`"checklist belum lengkap saat route-start -> tetap PENDING (retry
otomatis), TIDAK blocked permanen"` yang men-assert perilaku BENAR.

### Integration test terkait route-start/checklist/snapshot

Tidak ada file test terpisah berjudul "integration" di `driver-mobile/`
untuk area ini — logika route-start/checklist/snapshot V1+V2 SUDAH diuji
end-to-end lewat `executionQueue.test.js` (pakai `createExecutionQueue`
dengan API/storage/fs palsu, bukan mock parsial) dan `driverV2Sync.test.js`
(7 tes, semua lolos, tidak disentuh task ini). Backend
(`POST /routes/:id/start`, gerbang `CHECKLIST_BELUM_LENGKAP`) **tidak
diubah** di task ini — scope task ini murni client driver-mobile sesuai
instruksi.

### `expo export --platform android`

```
Android Bundled 27719ms index.js (3182 modules)
Exported: <scratch>/expo-export-check (dibuang setelah verifikasi)
```
Berhasil tanpa error. Mengonfirmasi bundle Android bisa dikompilasi dari
kode hasil fix (termasuk kedua file komponen yang diedit).

### QA emulator (online, offline→online, background↔foreground, timeout)

**TIDAK dilakukan secara interaktif di sesi ini — dilaporkan jujur, bukan
diklaim selesai.** Alasan: emulator Android (`Pixel_8`) tersedia di
environment tapi tidak sedang berjalan, dan mensimulasikan skenario ini
secara bermakna butuh login sebagai akun driver nyata di tab Aktif —
persis constraint yang sama dengan audit 29 Okt 2026 sebelumnya (klasifier
keamanan Claude Code menolak permintaan meng-otentikasi sebagai identitas
Difa yang sebenarnya; prinsip yang sama berlaku untuk akun driver
production manapun). Tidak ada akun driver staging/QA yang siap pakai
untuk modul armada/my-jobs di repo ini (skrip QA staging yang ada,
`backend/scripts/staging/qaPv2Seed.js`, untuk modul Production, bukan
Delivery/Armada).

**Yang SUDAH memverifikasi perilaku yang sama secara otomatis** (lihat
tabel §3 di atas): ketujuh skenario inti sudah dibuktikan di level logika
murni lewat `node --test` (yang notabene adalah mesin state EXACT yang
sama yang jalan di HP — `createExecutionQueue`/`selectMyJobsState` tidak
punya cabang kode terpisah untuk "mode test"). Yang BELUM terbukti: UI
benar-benar merender teks/tombol yang baru (`pendingStatusInfo`,
"Kirim Ulang", dialog konfirmasi) secara visual, dan interaksi OS nyata
(airplane mode, app background/foreground, request timeout jaringan
sungguhan) belum diamati di layar fisik/emulator.

**Rekomendasi sebelum GO:** lakukan QA manual di emulator/HP fisik
memakai akun driver TEST (bukan akun driver production manapun) pada APK
build `preview` yang memuat SHA `67c0a9c2`, menjalankan keempat skenario
OS nyata di atas, sebelum atau sesaat setelah publish ke `preview` —
sesuai permintaan "Jangan publish ke preview sebelum saya memberikan GO."

## 4. Mapping EAS build profile → channel

Dari `driver-mobile/eas.json` (tidak diubah task ini):

| Build profile | Channel | Catatan |
|---|---|---|
| `development` | `development` | dev client |
| `preview` | `preview` | **channel yang dibaca APK terpasang di seluruh armada, termasuk Difa** (dikonfirmasi audit 29 Okt 2026) |
| `production` | `production` | tidak dipakai APK manapun yang diketahui saat ini |
| `apk` | `apk` | distribusi internal, build APK polos |

## 5. runtimeVersion APK Difa & channel tujuan

- `app.json` → `runtimeVersion.policy = "appVersion"`, `version = "1.0.0"`
  — **tidak berubah** antara commit live channel `preview` (`40c8210d`)
  dan branch fix ini (`67c0a9c2`). Artinya runtimeVersion APK Difa (dan
  seluruh armada `preview`) = `"1.0.0"`, SAMA dengan runtimeVersion yang
  akan dibawa publish OTA dari branch ini — **update ini AKAN terbaca**
  oleh APK yang sudah terpasang (tidak perlu build APK baru).
- **Channel tujuan yang benar: `preview`.** Bukan `production` — ini
  persis kesalahan yang menyebabkan fix 10 Oktober tidak pernah sampai ke
  device manapun (lihat audit §kesimpulan provenance). Wajib jalankan
  `eas channel:list` sesaat sebelum publish untuk konfirmasi ulang channel
  mana yang benar-benar dibaca APK terpasang, sebelum publish — bukan
  mengandalkan nama profil semata.
- **Belum ada publish ke channel manapun** dari branch ini. Tidak ada
  publish ke `production`. Tidak ada publish ke `preview` tanpa GO.

## 6. Prosedur rollback

Rollback di level OTA (setelah publish, bila GO sudah diberikan dan
publish sudah terjadi): `eas update:republish` ke group OTA preview
sebelumnya (`72f9694b-161b-4097-8b12-059aef066bab`, commit `40c8210d`) —
**TAPI** group itu masih membawa bug lama (blank/spinner + checklist
blocked permanen), jadi rollback itu cuma mengembalikan ke status
quo-ante, bukan ke kondisi "aman". Tidak ada migrasi database di task
ini, jadi tidak ada langkah rollback skema.

Rollback di level kode: branch `fix/driver-app-sync-queue-20261029` belum
di-merge ke `main` — menghapus/mengabaikan branch ini (tanpa merge) sudah
cukup untuk membatalkan seluruhnya di level repo; tidak ada state server
yang perlu dibalik karena backend tidak diubah.

## 7. Prosedur pemulihan aman untuk queue Difa

Item queue Difa yang stuck ("1 aksi menunggu konfirmasi server") akan
otomatis membaik SETELAH publish ke `preview` disetujui dan APK Difa
sinkron (app dibuka ulang / kembali ke foreground), **tanpa tindakan
manual**, lewat salah satu dari dua jalur:
- Kalau checklist Bukti Kelengkapan rute itu SUDAH Difa lengkapi sejak
  saat audit: retry otomatis (flush) akan langsung sukses mengirim
  route-start begitu kode baru aktif.
- Kalau SEMUA job di rute itu sudah selesai diproses (lewat device lain
  atau sudah usang): `reconcileOne`/flush otomatis akan membersihkan item
  itu sebagai moot, tanpa mengirim mutasi apa pun.

**Tidak direkomendasikan** melakukan apa pun secara manual ke queue Difa
sebelum publish disetujui — khususnya JANGAN menyuruh Difa logout/reinstall
/clear data atau membatalkan antrean secara manual, karena:
(a) itu akan MEMBUANG item route-start yang justru akan terselesaikan
sendiri begitu fix aktif, dan (b) sesuai constraint task ini, tidak ada
tindakan yang mengubah data/queue production diperbolehkan selama
implementasi & QA. Begitu publish `preview` disetujui dan dikonfirmasi
diterima APK Difa (`eas update:view` atau cek log device), queue akan
beres sendiri lewat mekanisme flush otomatis di atas — tidak perlu
intervensi database/manual apa pun.

## 8. Yang menunggu keputusan Anda

- [ ] **GO untuk publish OTA ke channel `preview`** (bukan `production`) —
      belum dilakukan.
- [ ] Opsional: QA manual di emulator/HP fisik dengan akun driver TEST
      sebelum/seiring publish (lihat §3, "QA emulator").
- [ ] Opsional: merge `fix/driver-app-sync-queue-20261029` ke `main` —
      belum dilakukan, aman dilakukan kapan saja karena tidak mengubah
      backend/skema.
