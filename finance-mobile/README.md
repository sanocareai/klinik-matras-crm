# SANO Finance (finance-mobile)

Aplikasi Android **Finance & Accounting** Klinik Matras — React Native + Expo (SDK 57), TypeScript, Expo Router.
Backend & ledger SANSS tetap **satu-satunya sumber kebenaran**: aplikasi hanya mengirim perintah dan menampilkan hasil resmi server.

- Rencana produk lengkap: [`docs/PRD_FINANCE_ANDROID.md`](../docs/PRD_FINANCE_ANDROID.md)
- Backend untuk aplikasi ini (sesi, idempotency, push, foto nota): [`docs/FINANCE-MOBILE-BACKEND.md`](../docs/FINANCE-MOBILE-BACKEND.md)
- Referensi visual: [`docs/references/finance-mobile/`](../docs/references/finance-mobile/)

> **Status scaffold (19 Sep 2026):** navigasi lima tab, design system "Biru Kaca", API client, sesi aman, dan EAS sudah siap.
> Layar memakai **data contoh** (`EXPO_PUBLIC_USE_MOCKS=true`, hanya di varian development). Hanya `GET /finance/dashboard`
> yang tersambung ke server; transaksi/persetujuan/laporan menampilkan "Segera hadir" pada build non-contoh sampai slice S3–S10.

## Menjalankan

```bash
cd finance-mobile
npm install                 # .npmrc memakai legacy-peer-deps (konflik peer opsional react-dom dari expo-router)
cp .env.example .env        # mode contoh: tanpa backend, login menerima isian apa pun

npx expo start              # Expo Go (mode contoh). Share-dari-WhatsApp otomatis nonaktif di Expo Go.
npx expo start --dev-client # setelah punya development build (lihat EAS di bawah) — fitur native penuh
```

Menyambung ke backend lokal: jalankan backend (`cd backend && npm run dev`, port 4000), set di `.env`:

```
EXPO_PUBLIC_USE_MOCKS=false
EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api     # emulator Android; HP fisik: http://<IP-LAN-komputer>:4000/api
```

Login memakai akun SANSS yang punya akses Finance (role `FINANCE`/`OWNER`/`ADMIN`); akun lain ditolak dengan pesan "Aplikasi ini untuk tim Finance".

## Pemeriksaan kualitas

```bash
npm run typecheck    # tsc --noEmit (strict)
npm run lint         # ESLint (termasuk larangan Number/parseFloat/toFixed untuk uang)
npm test             # Jest: uang, normalisasi API, client (refresh single-flight, Idempotency-Key), PIN, tier glass, tanggal WIB
npx expo-doctor      # 21 pemeriksaan proyek Expo
npm run check        # typecheck + lint + test
```

## Varian & lingkungan

`APP_VARIANT` (diatur per profil `eas.json`) menentukan paket, nama, dan kanal — ketiganya bisa terpasang bersamaan di satu HP.

| Varian | Paket Android | Kanal EAS Update | API | Data contoh |
|---|---|---|---|---|
| development | `com.sanomatrassehat.finance.dev` | `development` | `http://10.0.2.2:4000/api` | ya |
| preview | `com.sanomatrassehat.finance.preview` | `preview` | `https://app.sanomatrassehat.com/api` | tidak |
| production | `com.sanomatrassehat.finance` | `production` | `https://app.sanomatrassehat.com/api` | **tidak pernah** |

`runtimeVersion` = kebijakan **`fingerprint`**: OTA hanya sampai ke build yang native-nya identik (aman dari ketidakcocokan native).

## APK preview (checkpoint 21 Sep 2026)

Profil `preview` menghasilkan **APK internal** dengan paket `com.sanomatrassehat.finance.preview` (nama "SANO Finance (Preview)"): terpasang **berdampingan** dengan build produksi, tidak menyentuh kanal `production`, tidak memakai ID aplikasi lain (`com.sanomatrassehat.salesapp`, `com.klinikmatras.drivermobile`). HTTPS wajib (tanpa cleartext), mode contoh mati, izin mikrofon/lokasi diblokir, Firebase/push dan deep link **tidak diaktifkan** (`google-services.json` tidak ada; pendaftaran push gagal diam-diam).

> **Peringatan data:** APK preview memakai API **produksi** (`https://app.sanomatrassehat.com/api`) — tidak ada staging. Perintah uang dari APK ini membuat jurnal SUNGGUHAN. Lakukan QA baca-saja dulu; untuk uji tulis pakai dokumen kecil bertanda "UJI QA" (lihat `docs/FINANCE-MOBILE-QA-HP.md`).

Langkah owner (butuh login Expo — tidak bisa dilakukan otomatis):

```bash
cd finance-mobile
npm i -g eas-cli           # sudah ada versi 24.x? cukup: eas --version
eas login
eas init                   # proyek EAS BARU "sano-finance"; catat projectId yang tampil
# Pastikan pemilik proyek = akun/organisasi Expo Anda. app.config.ts memakai EAS_OWNER (bawaan "sanocare"); ganti bila nama akun Expo berbeda.
```

Setelah `projectId` tersedia, kirim ke saya (atau isi sendiri) di `eas.json` → `build.*.env.EAS_PROJECT_ID` (bukan rahasia), commit hanya berkas konfigurasi itu, lalu:

```bash
eas build --platform android --profile preview
```

Hasilnya tautan unduh APK (± 15–25 menit di cloud). Lakukan cek lokal sebelum build: `npm run check`, `npx expo-doctor`, `npx expo export --platform android`.

## EAS Build & Update

Butuh akun Expo (organisasi `sanocare`). Sekali saja:

```bash
npm i -g eas-cli
eas login
eas init                    # membuat proyek EAS baru → salin projectId ke .env / eas.json env: EAS_PROJECT_ID
```

> Jangan memakai `projectId` app lain (`mobile/` dan `driver-mobile/` punya proyek EAS sendiri).

```bash
# Build (butuh EAS_PROJECT_ID terisi)
eas build --platform android --profile development      # dev client (APK)
eas build --platform android --profile preview          # APK uji tim
eas build --platform android --profile production-apk   # APK rilis (sideload terkontrol)
eas build --platform android --profile production       # AAB (Play Store, opsional)

# OTA update (JS/aset saja; native berubah ⇒ build baru)
eas update --channel preview    --message "ringkas perubahan"
eas update --channel production --message "ringkas perubahan"
eas update:rollback             # tarik update bermasalah
```

Alur rilis yang disarankan: PR → `npm run check` → `eas update --channel preview` → uji Natasha/Owner → `eas update --channel production`.

## Struktur

```
app/                  Expo Router: login, (tabs) 5 tab, aksi-cepat (FAB), persetujuan/[id], laporan/[jenis], +native-intent
src/design/           token "Biru Kaca", tier glass, GlassCard, MoneyText, StatusBadge, Sheet, chart, tema
src/api/              apiClient (refresh single-flight, Idempotency-Key), normalize (uang = string desimal), tipe, endpoint
src/auth/             sesi (SecureStore), PIN (PBKDF2, lokal), registrasi push
src/lib/              money (string desimal), tanggal WIB, teks Bahasa Indonesia, env
src/hooks/            hook data (contoh vs server), status jaringan
src/mocks/            data contoh realistis (bukan angka asli)
```

## Aturan yang tidak boleh dilanggar

1. **Uang = string desimal** (`"1234567.89"`). Tidak ada `Number`/`parseFloat`/`toFixed` pada uang (ESLint menegakkan). Respons server dibaca dengan `lossless-json`.
2. Klien **tidak menghitung** saldo, laba, umur piutang, jurnal, alokasi. Total resmi dari server.
3. **Tidak ada posting offline / antrean transaksi.** Setelah command sukses, data diambil ulang dari server. Semua command membawa `Idempotency-Key`.
4. Token hanya di `expo-secure-store`. Build produksi menghapus `console.*` dan memblokir screenshot (`FLAG_SECURE`).
5. Semua teks UI Bahasa Indonesia sehari-hari (`src/lib/strings.ts`).

## Keamanan & RBAC (S2) — QA manual

Mode contoh (development): pilih peran lewat isi email di layar login — `owner@…`, `akuntan@…`, `approver@…`, `tanpaakses@…`, selain itu = Finance. Kata sandi bebas.

| # | Skenario | Hasil yang benar |
|---|---|---|
| 1 | Login pertama | Wajib buat PIN 6 digit (tidak bisa dilewati); PIN "111111"/"123456" ditolak; lalu tawaran biometrik (boleh dilewati) |
| 2 | Tutup lalu buka app | Selalu minta PIN/biometrik |
| 3 | Ke background < 2 mnt lalu kembali | Langsung terbuka. > 2 mnt → layar kunci. Recents menampilkan layar tertutup |
| 4 | Lainnya → Keamanan → ubah batas kunci | Pilihan Langsung/30 dtk/1/2/5 mnt; bertahan setelah app ditutup |
| 5 | PIN salah 5× / 8× / 10× | Jeda 30 dtk / 5 mnt / data dihapus + kembali ke login; tutup-buka app tidak mereset hitungan |
| 6 | Biometrik gagal 3× | Kembali ke PIN, tidak terkunci di luar |
| 7 | Ubah PIN | PIN lama → baru → ulangi; PIN lama tak lagi berlaku |
| 8 | Setujui pengajuan (aksi sensitif) | Bila unlock terakhir > 2 mnt, diminta PIN/biometrik dulu |
| 9 | Peran akuntan | Tanpa tab Persetujuan, tanpa aksi Verifikasi |
| 10 | Peran approver | Tanpa tombol + (FAB) dan tanpa aksi cepat |
| 11 | Peran owner | Tanpa aksi cepat tulis; hanya baca/setujui |
| 12 | tanpaakses@ | Ditolak: "Akun ini tidak punya akses Finance" |
| 13 | Mode pesawat di layar login | Banner offline, tombol Masuk nonaktif |
| 14 | Keluar akun | Konfirmasi; token, PIN, dan pengaturan kunci terhapus; sesi dicabut di server |

## Beranda (S3) — skenario uji & QA

Skenario data contoh dipilih dengan tanda `+` di email (mode contoh): `finance+kosong@`, `+parsial`, `+panjang` (angka 14 digit + nama panjang), `+negatif`, `+lambat` (5 dtk), `+galat` (500), `+offline`, `+sesi` (401), `+basi` (muat pertama sukses, tarik-untuk-muat gagal). Bisa digabung dengan peran: `owner+panjang@x`.

Menjalankan di emulator dengan API dev: `EXPO_PUBLIC_USE_MOCKS=false EXPO_PUBLIC_API_URL=http://10.0.2.2:4000/api npx expo start --dev-client --clear` (build native: `npx expo run:android` dari path pendek, mis. `C:m` — path proyek yang panjang membuat ninja/CMake gagal di Windows).

| # | Skenario | Hasil yang benar |
|---|---|---|
| 1 | Beranda terisi | Hero kas, saldo per rekening, pekerjaan tertunda, laba rugi, piutang, utang, kesehatan pembukuan, jurnal |
| 2 | Ganti periode | Chip → sheet → data lama redup sebentar, lalu laba rugi periode baru; kas/piutang/utang tetap "posisi saat ini" |
| 3 | Tarik ke bawah | Muat ulang; "Diperbarui" segar |
| 4 | Mode pesawat | Banner "Tidak ada koneksi internet"; data terakhir tetap tampil |
| 5 | Layar 360×640dp + font 1.5 (gelap) | Tidak ada teks terpotong; nominal panjang mengecil satu baris |
| 6 | Latar belakang < 2 mnt / > 2 mnt | Langsung terbuka / layar kunci |
| 7 | Peran approver / akuntan / owner | Tanpa FAB & aksi cepat / tanpa tab Persetujuan & Verifikasi / tanpa aksi cepat tulis |

## Persetujuan (S4) — skenario uji & QA

Tambahan skenario mode contoh: `+konflik` (dokumen sudah diputuskan orang lain ⇒ 409), `+izin` (izin dicabut ⇒ 403), `+putus` (jaringan putus tepat saat mengirim ⇒ hasil tidak pasti, kunci idempotensi dipakai ulang). Persona: `approver@` (tab awal), `finance@`, `owner@`, `akuntan@` (baca saja), `tanpaakses@`. Data contoh: 29 menunggu, 2 diproses, 2 disetujui, 1 ditolak.

Keyboard nyata di emulator: set `hw.keyboard=no` pada AVD (Gboard tampil). Perhatikan: mengubah `wm size/density` atau `font_scale` saat app berjalan membuat teks terpotong sementara — **selalu force-stop dan buka ulang app** sebelum menilai tata letak.

| # | Skenario | Hasil yang benar |
|---|---|---|
| 1 | Daftar, 4 tab, badge | Menunggu terlama dahulu; badge tab = jumlah server |
| 2 | Cari (keyboard nyata), filter jenis/periode/pemohon | Debounce 400 ms; sheet filter; jumlah filter aktif tampil |
| 3 | Detail | Rincian, lampiran (kosong/foto), riwayat; tombol dari `aksi` server |
| 4 | Tolak: alasan kosong / < 3 huruf | Tombol nonaktif, petunjuk tampil |
| 5 | Tolak dengan keyboard | Sheet naik di atas keyboard; sheet menutup sebelum layar PIN; status "Ditolak" + alasan dimuat ulang dari server |
| 6 | Setujui | Sheet konfirmasi ⇒ PIN ⇒ status resmi dari server |
| 7 | Double-tap / request paralel | Satu kiriman; yang kedua 409 ⇒ "Sudah diputuskan oleh …" |
| 8 | Sembunyikan nominal | Nominal, keterangan, vendor, lampiran tersamarkan |
| 9 | 360×640dp + font 1.5, gelap | Tidak ada teks terpotong, tidak ada overlap |

## Transaksi S6–S8 — QA

Tab Transaksi = pintu ke Pengeluaran, Pembelian, Kasbon, Pemasukan Lain, Piutang, Refund, Tagihan supplier, Supplier, Pembayaran supplier (+ Pembayaran pelanggan S5). Tombol "+" pada kartu / FAB membuka formulir; tombol hanya ada bila capability mengizinkan. Aksi di detail (ajukan, bayar, potong gaji, lampirkan nota, ubah, batalkan, atur alokasi) muncul sesuai `aksi` dari server; yang tidak tersedia menampilkan alasannya. Mode contoh: peran lewat email (`finance@`, `owner@` = admin, `akuntan@`, `approver@`), skenario `+konflik`, `+izin`, `+putus`, `+offline`, `+galat`, `+kosong`, `+panjang`, `+negatif`, `+lambat`. Draf "di HP" hanya isian teks dan tidak pernah terkirim otomatis. Dokumen yang menunggu approval juga ada di tab Persetujuan (S4).

## Pembayaran pelanggan (S5) — QA

Buka dari tab Transaksi → chip "Pembayaran", menu Lainnya → "Pembayaran pelanggan", atau kartu "Pembayaran belum diverifikasi" di Beranda. Lencana tab Transaksi = jumlah menunggu dari server. Mode contoh: 22 menunggu (8 kasus khusus: DP, cicilan, pelunasan tunai saat pengiriman, tanpa bukti, kelebihan bayar, kemungkinan ganda, alokasi dua order, nominal & nama sangat panjang), 3 terverifikasi, 2 ditolak. Skenario `+konflik`, `+izin`, `+putus`, `+offline`, `+galat`, `+sesi`, `+basi`, `+kosong`, `+lambat` berlaku juga di sini.

API development nyata (tanpa mencemari DB dev): buat DB uji (`klinik_matras_test`, di-truncate oleh tes integrasi), isi user berlabel per peran + pembayaran lewat `POST /orders/:id/payments` (jalur produksi), jalankan backend kedua `DATABASE_URL=…klinik_matras_test PORT=4100 node --env-file=.env src/index.js`, lalu `EXPO_PUBLIC_USE_MOCKS=false EXPO_PUBLIC_API_URL=http://10.0.2.2:4100/api npx expo start --dev-client --clear`. **Jangan menjalankan tes backend saat QA nyata berjalan** (tes membersihkan DB uji dan mencabut sesi).

| # | Skenario | Hasil yang benar |
|---|---|---|
| 1 | Daftar 3 tab + ringkasan periode | Jumlah & nominal dari server; ringkasan tidak berubah saat pindah tab |
| 2 | Cari (keyboard nyata), filter cara bayar/rekening/periode, muat lebih banyak | Debounce 400 ms; kursor tanpa duplikat |
| 3 | Detail | Order, invoice, pelanggan, jenis, cara bayar, rekening, pencatat, "Tidak tercatat di sistem" (referensi/pengirim/catatan), tagihan, alokasi, jurnal, bukti (gambar dalam app; PDF dibuka di penampil perangkat), riwayat |
| 4 | Verifikasi | Konfirmasi ⇒ PIN ⇒ status resmi dari server; tombol hilang |
| 5 | Tolak: alasan kosong/pendek | Tombol nonaktif; alasan yang sudah ditulis tidak hilang bila PIN dibatalkan |
| 6 | Diverifikasi Finance lain saat layar terbuka | 409: "sudah diverifikasi oleh …" + status dimuat ulang, tanpa retry otomatis |
| 7 | Owner/Approver/Akuntan | Bisa membaca; tombol nonaktif + alasan server |
| 8 | Offline | Tombol nonaktif; tidak ada perintah dikirim/diantre |
| 9 | 360×640dp, font 1.5, gelap | Tidak ada teks terpotong; label & rekening membungkus |

## Blocker yang tersisa (butuh tindakan manusia / akun)

1. **Proyek EAS belum dibuat** — jalankan `eas login` + `eas init`, isi `EAS_PROJECT_ID`. Tanpa itu OTA (`expo-updates`) nonaktif dan `eas build` belum bisa.
2. **Push Android** — buat/daftarkan aplikasi Android (`com.sanomatrassehat.finance*`) di Firebase, simpan `google-services.json` (di-gitignore; di EAS pakai secret file `GOOGLE_SERVICES_JSON`), lalu unggah kunci **FCM V1** ke EAS (`eas credentials`). Server: `FINANCE_PUSH_ENABLED=true` (lihat `docs/FINANCE-MOBILE-BACKEND.md`).
3. **Belum dijalankan di perangkat/emulator** — scaffold divalidasi lewat `tsc`, ESLint, Jest, `expo-doctor`, bundling Metro (`expo export`) dan `expo prebuild` (manifest, izin, share-target). Uji visual pertama butuh development build.
4. **Fitur belum dikerjakan** (slice PRD): cache snapshot terenkripsi, formulir transaksi + kompres/unggah foto (S6), notifikasi & pemicunya (S11), pelaporan galat (Sentry, keputusan S12).
5. **Gap backend** yang masih terbuka (PRD §17): tren bulanan (G-09), audit trail (G-05), cursor pagination (G-16).
