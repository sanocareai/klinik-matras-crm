# Uji perangkat fisik & rencana OTA — manifest barang + checklist muat (driver-mobile, delivery-control)

Server + web sudah LIVE (rilis `fe253367`, 14 Okt 2026). Aplikasi RN **belum** menerima kode manifest; OTA **belum diterbitkan**. Gerbang muat tetap **MATI** (`DELIVERY_UNIT_CONFIRM_REQUIRED` kosong).

## 1. Fakta EAS (dibaca langsung dengan `eas build:list` / `eas channel:list`, 14 Okt 2026)

| App | Build terpasang | Channel build | Update terakhir di channel |
|---|---|---|---|
| driver-mobile | APK versi 1.0.0 (versionCode 2–6), **profil `preview`** → channel **`preview`**; runtime `1.0.0` | `preview` | `preview`: 7 Okt (Pembayaran: driver tidak lagi mencatat); `production`: 10 Okt (Fix antrean Mulai Perjalanan) |
| delivery-control | APK 0.1.0 (versionCode 2, 1 Okt), profil `preview` → channel **`control-preview`**; runtime `0.1.0` | `control-preview` | satu grup update |

**Perbedaan dengan rencana semula ("production" dan "control-production"):** APK yang beredar dibangun dengan profil `preview`, jadi HP mengikuti channel **`preview`** (driver-mobile) dan **`control-preview`** (delivery-control). Channel `production` / `control-production` hanya berlaku bagi build profil `production` (belum ada APK-nya). Menerbitkan OTA ke `production` tidak akan sampai ke HP yang sekarang dipakai.
Catatan: channel `production` driver-mobile memang berisi satu update (10 Okt) — jangan diandalkan sebelum ada perangkat yang terbukti membaca channel itu. **Langkah 0 di bawah wajib** sebelum menerbitkan.

## 2. Gerbang versi (cek sebelum terbit)
1. `runtimeVersion` = `appVersion` (policy). OTA hanya menjangkau HP dengan versi app SAMA: driver-mobile `1.0.0`, delivery-control `0.1.0`. **Jangan mengubah `version` di `app.json`/`app.config.js`** pada commit OTA — itu memutus OTA ke seluruh APK terpasang (butuh APK baru).
2. Perubahan harus JS-only (tanpa modul native baru). Rilis ini hanya JS/komponen: aman.
3. Server harus sudah memuat endpoint baru (✓ live) — kode RN baru memanggil `POST /armada/jobs/:id/unit-load` dan `GET /armada/unit-load/config`.
4. Terbit dari commit yang SUDAH di `main` (bukan dari branch kerja).

## 3. Langkah 0 — pastikan channel di perangkat uji
Di HP uji (driver-mobile): buka Akun → versi/"Pembaruan" (atau `Updates.channel` bila ditampilkan). Bila tidak terlihat: `eas build:list --platform android` (profil `preview`) lalu cocokkan versionCode di HP dengan build tersebut. Catat channel terbaca di laporan rilis.

## 4. Uji perangkat fisik (SEBELUM OTA ke semua driver)
Cara aman: terbitkan OTA ke **branch/channel uji terpisah** bila ada APK uji, atau terbitkan ke channel nyata lalu uji di HP pemilik DULU sebelum driver lain membuka app (OTA diambil saat app dibuka; batasi dengan mengumumkan "jangan buka app sampai diuji").
Alternatif tanpa risiko: `eas build --profile preview` baru memakai commit `main`, pasang ke satu HP uji (butuh versionCode baru → itu APK baru, bukan OTA).

Skenario (HP Android sungguhan; gunakan job uji/QA di lingkungan non-produksi atau job milik Admin yang sengaja disiapkan — jangan ubah data Indra):
1. **Kartu job**: tampil `1 stop • 3 unit • 1 jenis produk`, `3× Kasur Sorong 3in1 Custom — 100 × 200 cm`, `U1 U2 U3`, "Sumber: Penjualan Karyawan — dijual oleh Kemal", "PIC lead: …" (bukan "Sales").
2. **Checklist muat (gerbang MATI)**: "Barang dimuat 0/3 unit"; ketuk U1 → 1/3; "Semua dimuat" → 3/3. Tombol Selesai tetap bisa walau 0/3 (gerbang mati).
3. **Offline**: matikan data; ketuk U1,U2 → label "…(menunggu sinkron)"; nyalakan data → terkirim; buka server: `job_unit_loads` 2 baris; ketuk ulang → tetap 2 (idempoten).
4. **Persiapan Perjalanan**: manifest per stop tampil.
5. **delivery-control**: Detail rute & detail masalah menampilkan manifest dan "Barang dimuat x/y" (hanya baca).
6. **Mode `capable` (hanya setelah poin 1–5 lulus, di server uji/produksi dengan koordinasi)**: unit 2/3 → tombol Tandai Selesai nonaktif dengan pesan; isi alasan ≥5 huruf → bisa selesai; periksa audit `UNIT_LOAD_EXCEPTION` tepat 1.

## 5. Rencana terbit OTA (belum dijalankan)
```
cd driver-mobile   && npm ci && npx eas-cli update --branch preview         --environment preview --platform android --message "manifest barang + checklist muat unit"
cd delivery-control && npm ci && npx eas-cli update --branch control-preview --environment preview --platform android --message "manifest barang di detail rute"
```
(Ganti branch/channel sesuai Langkah 0.) Catat `update id` + `group id` untuk rollback: `npx eas-cli update:rollback` / republish update sebelumnya (driver-mobile `preview` terakhir: grup 7 Okt).
Urutan: (1) OTA terbit → (2) uji HP pemilik → (3) umumkan ke driver → (4) pantau 2–3 hari → (5) server mode `capable` → (6) pantau `UNIT_LOAD_LEGACY_CLIENT` = 0 → (7) `strict`.
