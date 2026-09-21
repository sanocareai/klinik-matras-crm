# SANO Finance Mobile 1.0.0 — Catatan Rilis, Rencana Rilis, dan Rollback

Status: **kandidat rilis internal** — menunggu persetujuan owner atas build final. Tidak ada publikasi publik (Play Store) sebelum persetujuan itu.

## 1. Catatan rilis (untuk tim)

**SANO Finance 1.0.0** adalah aplikasi Android untuk tim Finance Klinik Matras. Data selalu diambil dari server SANSS; aplikasi tidak menghitung saldo, laba, atau status sendiri.

**Yang bisa dilakukan**
- **Beranda:** posisi kas & bank, laba rugi ringkas, umur piutang dan utang, pekerjaan yang menunggu.
- **Persetujuan:** setujui/tolak pengeluaran, pembelian, tagihan supplier, dan refund (dengan PIN/biometrik).
- **Pembayaran pelanggan:** verifikasi atau tolak pembayaran.
- **Transaksi:** pengeluaran, pembelian, kasbon, pemasukan lain, piutang, refund, supplier dan tagihan, pembayaran supplier — daftar, detail, buat, ajukan, bayar, potong gaji kasbon, batalkan (admin), lampirkan foto nota.
- **Akuntansi (baca):** jurnal, buku besar per akun, rekonsiliasi bank (cocokkan/lepas baris koran).
- **Laporan:** laba rugi, neraca, arus kas, neraca saldo, umur piutang, umur utang; bagikan ringkasan.
- **Keamanan:** PIN + biometrik, kunci otomatis, layar tidak bisa ditangkap, sesi per perangkat, keluar dari semua perangkat.
- **Notifikasi:** siap dan **belum aktif** di 1.0 (lihat §4).

**Hanya di web (tidak ada di aplikasi):** jurnal manual, pembalikan/koreksi jurnal, tutup/buka periode, koreksi saldo, impor statement bank, abaikan baris koran dan selesaikan rekonsiliasi, data belum lengkap, tinjau bukti, invoice, ekspor CSV/PDF, perbandingan periode.

**Catatan penting:** tidak ada antrean offline — perintah keuangan butuh koneksi dan tidak pernah dikirim otomatis saat sambungan pulih. Build **preview** selalu **baca-saja** ("Build preview hanya untuk pengujian baca"); build **production** mengikuti izin dari server.

## 2. Varian build

| Profil EAS | Paket | Kanal | Data | Perintah uang |
|---|---|---|---|---|
| `development` | `com.sanomatrassehat.finance.dev` | development | server contoh | ya (data contoh) |
| `preview` (APK) | `….finance.preview` | preview | API produksi | **nonaktif (baca-saja)** |
| `production-apk` (APK tim) | `com.sanomatrassehat.finance` | production | API produksi | sesuai izin server |
| `production` (AAB) | `com.sanomatrassehat.finance` | production | API produksi | sesuai izin server |

`runtimeVersion` memakai kebijakan **appVersion** (bukan fingerprint): fingerprint terbukti gagal di build cloud karena hash lokal Windows berbeda dari builder (20 Sep 2026). Konsekuensinya sama untuk OTA — pembaruan OTA hanya sampai ke build dengan `version` yang sama; **wajib menaikkan `version` bila kode native/dependensi native/`app.config.ts` berubah**.

## 3. Cara membuat dan mendistribusikan (oleh owner/pengelola EAS)

```
cd finance-mobile
# APK internal untuk tim (channel production)
EAS_PROJECT_ID=ac46e42b-2ac5-4fb3-a515-ebaf40c4c3e2 eas build --platform android --profile production-apk
# AAB untuk Play Store (setelah owner menyetujui)
EAS_PROJECT_ID=ac46e42b-2ac5-4fb3-a515-ebaf40c4c3e2 eas build --platform android --profile production
# Pembaruan JS-only ke channel production (hanya runtime 1.0.0 yang cocok)
EAS_PROJECT_ID=ac46e42b-2ac5-4fb3-a515-ebaf40c4c3e2 eas update --channel production --message "…"
```
Keystore production dibuat/disimpan oleh EAS (`eas credentials`) — pembuatan pertama butuh sesi interaktif oleh pemilik akun Expo. Keystore tidak ada di repo (`*.jks`, `*.keystore` diabaikan git).

## 4. Notifikasi push: siap, flag OFF

- Backend: `FINANCE_PUSH_ENABLED` tidak diset ⇒ tidak ada satu pun push yang keluar (diuji). Pemicu terpasang untuk approval baru/putusan, pembayaran ditolak, transaksi sensitif, dan job pengingat 08:00 WIB (piutang & tagihan jatuh tempo, pembayaran menunggu).
- Aplikasi: `EXPO_PUBLIC_PUSH_ENABLED` tidak diset ⇒ tidak ada izin diminta, tidak ada token, tidak ada listener; menu Notifikasi tersembunyi.
- **Mengaktifkan nanti (tanpa mengulang S12):** (1) buat proyek Firebase untuk paket `com.sanomatrassehat.finance`, unduh `google-services.json` (letakkan sebagai secret file EAS `GOOGLE_SERVICES_JSON`), unggah kunci FCM V1 ke EAS; (2) build ulang dengan `EXPO_PUBLIC_PUSH_ENABLED=true` (memasukkan kembali izin `POST_NOTIFICATIONS`; naikkan `version` karena manifest native berubah); (3) di server set `FINANCE_PUSH_ENABLED=true` lalu `docker compose up -d backend`. Pengguna memberi izin sendiri lewat Lainnya → Notifikasi.

## 5. Rollback plan

| Situasi | Tindakan | Waktu |
|---|---|---|
| Bug JS di 1.0.0 setelah OTA | `eas update:rollback --channel production` (atau publish ulang commit sebelumnya) | menit |
| Bug native/APK 1.0.0 | Distribusikan ulang APK/AAB versi stabil sebelumnya (build lama tetap tersimpan di EAS); naikkan `minVersionCode` di server hanya bila ingin memaksa pembaruan | jam |
| Backend bermasalah setelah deploy | `git revert` commit di `main` → `git pull` + `docker compose up -d --build backend` di VPS. Migrasi `mobile_notification_prefs` bersifat aditif (tabel baru), aman dibiarkan bila backend digulung balik | menit |
| Push bermasalah/berisik | Hapus/kosongkan `FINANCE_PUSH_ENABLED` di server dan restart backend — seluruh pengiriman berhenti tanpa mengubah aplikasi | menit |
| Perangkat hilang/dicuri | Pengguna dicabut sesinya: `POST /api/mobile/auth/sessions/revoke-user` (admin) atau Keamanan → keluar dari perangkat lain; token push perangkat itu ikut terhapus | menit |
| Kesalahan pencatatan uang | Bukan rollback aplikasi: koreksi hanya lewat jurnal resmi/pembatalan admin (kebijakan akurasi Finance). Aplikasi tidak punya jalur koreksi saldo | — |

Pemeriksaan pasca-rilis (read-only): Neraca seimbang di tanggal uji, saldo Kas & Bank tidak berubah tanpa transaksi, tidak ada jurnal tak terencana sejak deploy.
