# SANSS Produksi (production-mobile)

Aplikasi Android lantai produksi Klinik Matras — React Native + Expo (SDK 57), TypeScript, Expo Router.
Desain: kanvas "SANSS Production App" (gaya iOS: latar grouped, kartu membulat, warna tim & status).
Backend SANSS tetap **satu-satunya sumber kebenaran**; aplikasi memakai endpoint yang sama dengan Aplikasi Meja web & Andon TV.

## Status slice 1 (12 Nov 2026) — BACA-SAJA

| Tab | Untuk | Sumber |
|---|---|---|
| Kerja | PIC Meja/Corner (`unit:stage:write`) | `GET /production-v2/worker/:lane` + `GET /production/v1-worker-queue` |
| Papan | semua | `GET /production-v2/andon` (live per meja + "Butuh perhatian") |
| Target | Admin Produksi (`production_assignment:write`) | `GET /production-v2/andon?date=` per tanggal & meja |
| Media | semua | `GET /production-v2/runs/:runId/report` (foto & video Sebelum · Proses · Sesudah) |
| Detail unit | semua | `GET /production-v2/runs/:runId/card` |

"Live" = diambil ulang tiap 20 detik saat aplikasi di depan (sama dengan Andon TV web) + tarik-untuk-muat-ulang.

**Belum ada di slice ini:** mulai/jeda/selesai tahap, putusan QC, unggah foto/video dokumentasi, ubah urutan/PIC target,
notifikasi push. Semua itu tetap lewat SANSS Web sampai slice berikutnya.

## Login & keamanan

- Login `POST /api/mobile/auth/login` dengan `app: "production"` (refresh juga wajib membawa `app`).
- Server menolak akun tanpa akses produksi (`NOT_PRODUCTION_TEAM`). Token Produksi hanya menjangkau
  `/api/production*`, `/api/units`, `/api/mobile`, `/api/auth/me` — bukan jalur Finance.
- Tab yang tampil ditentukan `capabilities.production` dari server, bukan nama peran.

## Menjalankan

```bash
cd production-mobile
npm install
cp .env.example .env        # EXPO_PUBLIC_API_URL → backend lokal (emulator: http://10.0.2.2:4000/api)
npx expo start
```

## Pemeriksaan

```bash
npm run check   # tsc + eslint + jest
```

## Varian

| Varian | Paket | API |
|---|---|---|
| development | `com.sanomatrassehat.produksi.dev` | `http://10.0.2.2:4000/api` |
| preview | `com.sanomatrassehat.produksi.preview` | `https://app.sanomatrassehat.com/api` |
| production | `com.sanomatrassehat.produksi` | `https://app.sanomatrassehat.com/api` |

Sebelum build EAS pertama: `eas init` untuk proyek INI (jangan memakai projectId aplikasi lain), lalu isi `EAS_PROJECT_ID`
di profil `eas.json`. Push butuh `google-services.json` untuk paket `com.sanomatrassehat.produksi*`.

> **Catatan rilis:** aplikasi ini butuh perubahan backend di branch yang sama (`capabilities.js`, `mobileAuth.js`,
> `middleware/auth.js`, `mobileSession.js`). Backend harus dirilis dulu sebelum APK dipakai.
