# Finance Mobile — Audit Hardening S12 (21 Sep 2026)

Status rilis: **`APPROVED FOR INTERNAL USE — OWNER ACCEPTANCE`** (21 Sep 2026). Dasar penerimaan: persetujuan langsung Owner (21 Sep 2026). **Fakta pengujian yang disampaikan Owner: tidak ada yang diperinci** — Owner tidak menyampaikan model perangkat, role, durasi, transaksi, atau hasil TalkBack, sehingga dokumen ini **tidak mencatatnya**. Bukti pengujian yang tercatat hanyalah yang dilakukan pengembang (tes otomatis, smoke test emulator, pemeriksaan produksi baca-saja) sebagaimana ditulis di `FINANCE-MOBILE-HARDENING-S12.md`.

**Validasi pasca-rilis yang MASIH TERBUKA (bukan blocker rollout internal):** (1) uji Android lama (mis. RAM rendah) — **wajib selesai sebelum distribusi diperluas ke seluruh tim**; (2) penggunaan operasional tiga hari kerja; (3) audit TalkBack; (4) sesi pemakaian panjang (30 menit+) di perangkat fisik; (5) uji HP fisik lain di luar yang dipakai Owner (tidak dirinci); (6) jaringan lambat pada API nyata; (7) pilot 2 minggu.

Cakupan audit: seluruh S0–S11. Bukti = tes otomatis yang menjalankan perilaku itu (nama berkas), pemeriksaan artefak build, atau pengamatan di emulator. **Tidak ada transaksi QA di produksi; tidak ada tebak-kredensial produksi.** Pemeriksaan produksi hanya baca (Neraca, saldo, JV-19092026-372, akun 2-1600).

## 1. Matriks audit

| Area | Hasil | Bukti |
|---|---|---|
| Autentikasi & refresh rotation | ✔ Refresh token berotasi; pemakaian ulang token lama mencabut sesi; token baru disimpan **sebelum** dipakai | backend `mobileAuth` integrasi; mobile `client.test.ts`, `session.test.ts` |
| Revoke | ✔ Cabut satu perangkat / semua sesi pengguna; token push ikut terhapus | `financePush` (logout), `mobileAuth` |
| App lock | ✔ PIN + biometrik, kunci otomatis, layar tutup saat background, step-up untuk command uang; tautan notifikasi tidak melompati kunci (ditahan sampai terbuka) | `lock.test.ts`, `persetujuan.ui.test.tsx`, `notifikasi.test.tsx` |
| Capability | ✔ Semua menu/aksi digerakkan capability dan `aksi.boleh` dari server; tanpa hardcode role; peran diuji: OWNER, FINANCE, ACCOUNTANT, APPROVER, tanpa akses | `rbac.test.ts`, `*.ui.test.tsx` |
| Idempotency | ✔ Satu Idempotency-Key per niat; 428 bila hilang; double-tap satu kiriman | `transaksi.ui`, `buku.ui`, `financeTransaksi`/`financeBuku` integrasi |
| Row lock / konkurensi | ✔ Bayar/batal/kasbon/pembayaran supplier/pencocokan bank diserialkan; keputusan ganda → 409 | integrasi finance (253 tes serial) |
| Offline | ✔ Tidak ada posting/antrean offline; tombol command nonaktif dengan penjelasan; bacaan tetap tampil dengan penanda basi | `*.ui.test.tsx` (offline), emulator: banner "Tidak ada koneksi internet" |
| Media aman | ✔ Bukti/nota lewat URL bertanda-tangan berumur pendek di luar `/api`; foto diunggah dengan nama hash | `financeMedia`, `financePembayaran` integrasi |
| Masking | ✔ "Sembunyikan angka"; `TeksSensitif`; FLAG_SECURE (screenshot/Recents) di preview & production | `beranda.ui.test.tsx`, emulator (tangkapan layar APK release = hitam, disengaja) |
| Error handling | ✔ Loading/kosong/parsial/error/offline/coba lagi/sesi habis/izin berubah di semua layar | `*.ui.test.tsx` |
| Audit trail | ✔ Riwayat dari audit server; pencocokan bank, keputusan, pembatalan tercatat | `financeBuku`, `financeTransaksi` |
| Decimal string | ✔ Tidak ada `Number/parseFloat` pada uang (ESLint) ; aritmetika BigInt sen; laporan/saldo/laba dihitung server | eslint, `money.test.ts`, kontrak nyata `*.kontrak.test.ts` |
| Session expiry | ✔ 401 → refresh sekali → keluar bersih ke login dengan alasan | `client.test.ts`, `session.test.ts` |
| Read-only preview | ✔ Profil `preview` (API produksi) `EXPO_PUBLIC_READ_ONLY=true`: semua tombol uang nonaktif + jalur command menolak sebelum step-up. Pengaman salah-ketuk, **bukan** keamanan backend | `bacasaja.test.tsx` |
| Production mengikuti server | ✔ Tanpa flag read-only; command resmi jalan sesuai `aksi.boleh`/capability | seluruh tes UI (ENV tanpa readOnly) |
| Log | ✔ Hanya `log.warn` tanpa payload; `redact()` untuk kunci sensitif; `console.*` dibuang di build produksi (bundle: 0 `console.log`); backend pemicu push hanya mencatat `err.message` | pindai bundle, `log.ts` |
| Izin Android | ✔ Dipangkas: READ_APP_BADGE, SYSTEM_ALERT_WINDOW (non-dev), RECORD_AUDIO, lokasi, WRITE_EXTERNAL_STORAGE diblokir; POST_NOTIFICATIONS & RECEIVE_BOOT_COMPLETED diblokir selama push off. Tersisa: ACCESS_LOCAL_NETWORK (dibawa pustaka jaringan, tidak bisa dihapus lewat blockedPermissions), INTERNET, ACCESS_NETWORK_STATE, CAMERA (foto nota), USE_BIOMETRIC/USE_FINGERPRINT, VIBRATE, WAKE_LOCK, DETECT_SCREEN_CAPTURE, ACCESS_WIFI_STATE | `dumpsys package` pada APK #4, `app.config.ts` |
| allowBackup | ✔ `false` (flag ALLOW_BACKUP tidak ada pada APK) | `dumpsys package` |
| HTTPS | ✔ Preview/production: `usesCleartextTraffic=false` + klien menolak baseUrl non-HTTPS (`HTTPS_WAJIB`) sebelum ada permintaan | `client.test.ts` |
| Signing | ◐ Keystore dikelola EAS (tidak di repo). Keystore production dibuat pemilik EAS pada build production pertama | eas.json, `.gitignore` |
| Proguard/minify | ✔ `enableProguardInReleaseBuilds` + `enableShrinkResourcesInReleaseBuilds`; Hermes | `app.config.ts` |
| Secret di bundle | ✔ Bundle production dipindai: tidak ada private key, `AIza`, JWT, `sk_live`, URL dev (`10.0.2.2`), token; hanya `https://app.sanomatrassehat.com/api` | pindai `.hbc` |

## 2. Hasil QA perangkat (emulator Android — **bukan HP fisik**)

Perangkat: emulator Pixel 8 (AVD `Pixel_8`, akselerasi perangkat lunak). APK: **build #4 preview** `01585587-1e40-48fc-8628-6c76097a82fc` (0.2.0, build 5). Build #3 tidak dipakai.

| Uji | Hasil |
|---|---|
| Pasang APK, buka | Berhasil; layar masuk "Masuk ke SANO Finance", versi "0.2.0 · preview" |
| Cold start (3×, force-stop) | 3,17 / 3,05 / 2,62 dtk (emulator perangkat lunak — lebih lambat dari HP nyata) |
| Warm start | 2,4 dtk (pertama), 0,1 dtk (dari Home) |
| Crash | 0 `FATAL EXCEPTION` dari aplikasi (3 crash yang tercatat berasal dari alat uji `uiautomator`, bukan aplikasi) |
| Memori | APK release ±90 MB PSS saat di layar masuk |
| Tangkapan layar | Hitam pada build release (FLAG_SECURE) — sesuai desain |
| Izin & backup | Sesuai §1 |
| Alur aplikasi penuh (mode contoh, build development): login owner, buat PIN, Beranda, Lainnya, offline, gelap, font 1,5× | Beranda/Lainnya/Login terbaca baik; tanpa teks "Segera hadir"; offline menampilkan banner; font 1,5× & gelap tidak merusak tata letak (nominal panjang muat) |
| **Tidak dilakukan** | Login ke API produksi (tanpa kredensial QA resmi; tidak menebak), transaksi QA di produksi, uji jaringan lambat pada API nyata, sesi 30 menit, HP fisik, TalkBack, deep link dari push nyata (butuh Firebase) |

Catatan temuan: di font 1,5× tombol gear alat-dev Expo menutupi banner "Mode contoh" — hanya di build development. Pada build release alat itu tidak ada.

## 3. Temuan dan status

| # | Temuan | Tingkat | Status |
|---|---|---|---|
| 1 | Push diminta izin saat startup (tidak kontekstual) | P1 | **Diperbaiki** — izin hanya dari layar Notifikasi; flag off ⇒ tidak ada |
| 2 | Menu "Segera hadir" (7 item) dan "(segera hadir)" di aksi cepat | P1 | **Diperbaiki** — dihapus / diarahkan ke layar nyata atau kartu "Hanya di web" |
| 3 | Klien tidak memaksa HTTPS di kode (hanya manifest) | P2 | **Diperbaiki** — `wajibHttps` |
| 4 | Izin manifest berlebih (READ_APP_BADGE, POST_NOTIFICATIONS/BOOT saat push off) | P2 | **Diperbaiki** — diblokir (terverifikasi pada APK 1.0.0); ACCESS_LOCAL_NETWORK tetap ada, dicatat |
| 5 | Deep link putusan memakai skema yang tidak punya rute (`sanofinance://{jenis}/{id}`) | P2 | **Diperbaiki** — `data.path` + daftar putih |
| 6 | `runtimeVersion` fingerprint tidak dipakai (gagal di build cloud) | — | Dicatat: memakai `appVersion`; OTA terbatas ke `version` sama. Kebijakan setara dan lebih ketat |
| 7 | Uji Android lama, tiga hari operasional, TalkBack, sesi panjang, HP fisik lain, jaringan lambat pada API nyata, pilot 2 minggu | P2 | **Terbuka — validasi pasca-release**, bukan blocker rollout internal. Uji Android lama wajib sebelum distribusi diperluas ke seluruh tim; sisanya sebelum publikasi publik |

Tidak ada P0/P1 terbuka. Tidak ada tes gagal.

## 4. Verifikasi produksi (baca-saja)

Neraca seimbang di 31 Agustus dan 17–21 September; JV-19092026-372 tidak berubah; akun 2-1600 tidak tersentuh; saldo Kas & Bank tidak berubah oleh pekerjaan ini. Jurnal baru sejak deploy sebelumnya berasal dari operasi bisnis normal (pengakuan pendapatan otomatis), bukan dari QA.
