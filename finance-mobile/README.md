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

## Blocker yang tersisa (butuh tindakan manusia / akun)

1. **Proyek EAS belum dibuat** — jalankan `eas login` + `eas init`, isi `EAS_PROJECT_ID`. Tanpa itu OTA (`expo-updates`) nonaktif dan `eas build` belum bisa.
2. **Push Android** — buat/daftarkan aplikasi Android (`com.sanomatrassehat.finance*`) di Firebase, simpan `google-services.json` (di-gitignore; di EAS pakai secret file `GOOGLE_SERVICES_JSON`), lalu unggah kunci **FCM V1** ke EAS (`eas credentials`). Server: `FINANCE_PUSH_ENABLED=true` (lihat `docs/FINANCE-MOBILE-BACKEND.md`).
3. **Belum dijalankan di perangkat/emulator** — scaffold divalidasi lewat `tsc`, ESLint, Jest, `expo-doctor`, bundling Metro (`expo export`) dan `expo prebuild` (manifest, izin, share-target). Uji visual pertama butuh development build.
4. **Fitur belum dikerjakan** (slice PRD): layar kunci PIN/biometrik (S2), cache snapshot terenkripsi, formulir transaksi + kompres/unggah foto (S6), keputusan approval nyata (S4), notifikasi & pemicunya (S11), pelaporan galat (Sentry, keputusan S12).
5. **Gap backend** yang masih terbuka (PRD §17): inbox approval gabungan (G-06), tren bulanan (G-09), audit trail (G-05), role Accountant/Approver (G-15), cursor pagination (G-16).
