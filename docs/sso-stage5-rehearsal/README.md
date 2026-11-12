# Rehearsal staging SSO Task & Meeting (D-200, Tahap 5)

Skrip di folder ini menjalankan rehearsal staging END-TO-END untuk integrasi
SSO SANSS↔HUB: build produksi kedua sisi, reverse proxy TLS lokal (sertifikat
self-signed), database staging terisolasi (bukan dev/production), dan smoke
browser sungguhan (Playwright, bukan HTTP-level saja) — mencakup OWNER/ADMIN,
SALES ditolak, state/replay, cookie Secure/HttpOnly/SameSite, logout/revoke,
kill switch terhadap sesi aktif, dan satu alur penuh meeting → keputusan →
action item → task → refresh.

**TIDAK ADA rahasia tertanam** — setiap token/secret (`HUB_SERVICE_TOKEN`,
`JWT_SECRET`, `AUTH_SECRET`, `TOKEN_ENCRYPTION_KEY`) dibuat acak setiap kali
skrip dijalankan (`run-apps.mjs`).

**Tidak pernah menyentuh database/kredensial production atau VPS production**
— semua database staging dibuat dengan nama yang HARUS mengandung kata
`staging`, pada server Postgres LOKAL (docker), dengan guard yang menolak
host selain loopback. Database `production`/dev tidak pernah dipakai.

## Prasyarat

- Checkout **SANO-HUB** di mesin yang sama. Lokasi bawaan: `C:\Users\rudya\SANO-HUB` —
  kalau beda, set `STAGE5_HUB_DIR` (lihat di bawah).
- Docker Desktop jalan (reverse proxy nginx + Postgres kedua sisi lewat docker compose).
- Sertifikat self-signed di-generate otomatis oleh `setup-proxy.mjs` (`openssl` harus ada di PATH).
- `npx playwright install chromium` sudah pernah dijalankan sekali di lingkungan Node yang dipakai
  (Playwright sendiri harus ada sebagai dependency — jalankan lewat lingkungan Node mana pun yang
  sudah `npm install playwright`, folder ini sengaja TIDAK membawa `node_modules/playwright` sendiri
  supaya tidak menambah dependency permanen ke salah satu repo aplikasi).
- Build HUB standalone (`.next/standalone`) sudah ada dan **menyertakan** `.next/standalone/.next/static`
  (lihat catatan di bawah — ini langkah manual Next.js standalone yang sering terlewat).

## Cara pakai

```bash
# 1. Siapkan reverse proxy TLS (idempoten, aman diulang)
node setup-proxy.mjs up

# 2. Jalankan rehearsal penuh (bookend OFF -> ON -> Playwright -> OFF -> ringkasan)
node rehearsal.mjs

# 3. (opsional) matikan proxy setelah selesai
node setup-proxy.mjs down
```

`rehearsal.mjs` MENCAKUP provisioning database staging (create+migrate+seed) —
tidak perlu langkah terpisah. Database staging **dibiarkan hidup** setelah
skrip selesai (supaya bisa diperiksa manual); jalankan
`node backend-scripts... staging-db.mjs drop` di masing-masing repo (lihat
`scripts/stage5-rehearsal/staging-db.mjs` di SANSS dan di HUB) untuk membersihkannya,
atau biarkan — `rehearsal.mjs` idempoten dan aman dijalankan ulang kapan saja
(re-seed mengembalikan baseline, termasuk membalikkan efek skenario revoke
dari run sebelumnya).

## Variabel lingkungan (semua opsional, lihat default di `run-apps.mjs`)

| Variabel | Default | Arti |
|---|---|---|
| `STAGE5_HUB_DIR` | `C:\Users\rudya\SANO-HUB` | Lokasi checkout SANO-HUB |
| `STAGE5_SANSS_DIR` | (dihitung relatif — folder `backend/` repo ini) | Lokasi backend SANSS |
| `STAGE5_SANSS_PORT` / `STAGE5_HUB_PORT` | `41800` / `31800` | Port backend LANGSUNG (internal, loopback) |
| `STAGE5_SANSS_PUBLIC` / `STAGE5_HUB_PUBLIC` | `https://localhost:8443` / `:9443` | Origin publik lewat proxy TLS |
| `STAGE5_SANSS_DB` | `klinik_matras_staging_s5` (localhost:5432) | Database staging SANSS |
| `STAGE5_HUB_DB` | `sano_hub_staging_s5` (127.0.0.1:5434) | Database staging HUB |

## Hal penting yang DITEMUKAN rehearsal ini (bukan cuma dites)

Dua bug produksi nyata ditemukan dan diperbaiki lewat rehearsal browser
sungguhan ini (tidak kelihatan dari tes HTTP-level Tahap 4):

1. **`HubLaunch.jsx` (SANSS)** — `useSearchParams()` membaca location VIRTUAL
   milik sistem tab dalam-app (`TabsContext.jsx`, D-144), yang SENGAJA hanya
   menyimpan `pathname` (membuang query string) — bukan `window.location`
   sungguhan. Setiap navigasi penuh ke `/hub/launch?state_hash=...` kehilangan
   query-nya begitu melewati lapisan tab. Diperbaiki: baca
   `window.location.search` langsung. Lihat commit `7afcf19e`.
2. **`frontend/dist` basi** — bundle yang di-commit mendahului seluruh
   frontend Tahap 4 (`HubLaunch.jsx`, kartu Portal) — fitur ini belum pernah
   benar-benar ada di browser nyata sebelum rehearsal ini. Lihat commit `ac106e23`.

Dua hal INFRASTRUKTUR (bukan bug aplikasi, khusus rehearsal lokal ini):

3. Next.js **standalone build HUB butuh `.next/static` disalin manual** ke
   `.next/standalone/.next/static` (langkah resmi Next.js yang mudah terlewat)
   — tanpa ini, semua chunk JS 404 dan halaman terlihat benar tapi TIDAK
   interaktif (klik tidak berbuat apa-apa, tanpa error yang jelas di layar).
4. **nginx `X-Forwarded-Host` harus `$http_host` (dengan port), bukan `$host`**
   (yang membuang port) — Next.js Server Actions (HUB) membandingkan header
   ini dengan `Origin` APA ADANYA dan menolak permintaan (500) kalau tidak
   cocok persis. Sudah benar di `setup-proxy.mjs`.
