# 📱 Klinik Matras CRM — Aplikasi Mobile (Android)

Aplikasi companion untuk tim sales, gaya WhatsApp, terhubung langsung ke
backend CRM yang sama dengan versi web (`https://app.sanomatrassehat.com`).
Diinstall langsung lewat file APK — **tidak lewat Play Store**.

## Fitur

- Login dengan akun CRM yang sama (email + password, JWT), sesi tersimpan
- Daftar percakapan gaya WhatsApp: tab Semua/Terbuka/Pending/Selesai,
  search, badge unread, pin 📌, badge sales pemegang lead, peringatan
  "Belum dibalas 1j+"
- Chat window: bubble hijau/putih, pemisah tanggal, foto inline, nama
  pengirim di pesan grup, quote/reply & forward terlihat
- Kirim pesan **teks** dan **media** (foto/video galeri 🖼️, kamera 📷,
  dokumen 📄) — teks di kolom pesan ikut jadi caption
- ⚡ Template balasan cepat (dari menu Template di CRM web)
- Menu ⋮ di chat: ubah status (Terbuka/Pending/Selesai) + 🙋 Ambil Alih lead
- 🔔 **Push notification** saat ada pesan WhatsApp masuk (via Firebase/FCM) —
  ketuk notifikasi langsung buka chat-nya. Pesan grup internal sengaja
  TIDAK di-push supaya tidak berisik
- Info Pelanggan: pipeline stage, kota, tags, sales person, riwayat order
  (status, nilai, layanan, keluhan, komplain), tambah catatan internal
- Grup WhatsApp internal read-only (mengikuti aturan backend)

## Menjalankan saat development

```bash
cd mobile
npm install
npx expo start
```

Scan QR dengan aplikasi **Expo Go** di HP Android (satu WiFi dengan laptop).
Untuk test dengan backend lokal: di layar login, ketuk "Ubah alamat server"
→ isi `http://IP_LAPTOP:4000`.

⚠️ **Push notification TIDAK jalan di Expo Go** — hanya di APK hasil build.
Fitur lain tetap bisa dites di Expo Go.

## Build APK (untuk dibagikan ke tim)

```bash
npm install -g eas-cli
eas login                      # akun Expo gratis (expo.dev)
cd mobile
eas build --platform android --profile apk
```

Tunggu ±10-20 menit, EAS kasih link download `.apk`. Bagikan ke tim
(WA/GDrive) → di HP buka file APK → izinkan "install dari sumber tidak
dikenal" → install.

### ⚠️ Satu langkah WAJIB supaya push notification jalan (sekali saja)

`google-services.json` (sudah ada di folder ini) hanya konfigurasi sisi
aplikasi. Server Expo juga perlu **kunci service account Firebase** untuk
mengirim notifikasi (FCM V1):

1. Buka [Firebase Console](https://console.firebase.google.com) → project
   **sano-sales-app** → ⚙️ Project settings → tab **Service accounts**
2. Klik **Generate new private key** → download file JSON
3. Jalankan `eas credentials` → pilih **Android** → **Google Service
   Account** → **Manage your Google Service Account Key for Push
   Notifications (FCM V1)** → **Set up** → pilih file JSON tadi

Tanpa langkah ini, app tetap jalan normal tapi notifikasi tidak masuk.

### Deploy backend (sekali, karena ada endpoint + tabel baru)

Ikuti workflow deploy biasa (seksi 12 CLAUDE.md), plus migration:

```bash
ssh ubuntu@43.133.152.6
cd ~/klinik-matras && git pull
docker compose up -d --build backend
docker compose exec backend npx prisma migrate deploy   # tabel PushToken baru
```

**Update versi APK baru:** naikkan `versionCode` di `app.json`, build
ulang, bagikan APK baru (install menimpa yang lama, login tetap tersimpan).

## Arsitektur push notification

```
WhatsApp → WAHA → webhook backend → simpan Message
                        └→ POST https://exp.host (Expo Push API)
                              └→ FCM → HP tim (semua device terdaftar)
```

Backend tidak butuh kredensial Firebase — cukup Expo Push Token tiap device
(tersimpan di tabel `PushToken`, didaftarkan otomatis saat login, dihapus
saat logout / device tidak aktif).

## Catatan

- Package Android: `com.sanomatrassehat.salesapp` (HARUS sama dengan yang
  terdaftar di Firebase — jangan diubah sembarangan).
- App ini tidak menyentuh WAHA langsung — semua lewat backend Express.
