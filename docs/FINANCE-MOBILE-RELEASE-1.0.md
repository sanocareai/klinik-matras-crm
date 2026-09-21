# SANO Finance Mobile 1.0.0 — Catatan Rilis, Rencana Rilis, dan Rollback

Status: **`APPROVED FOR INTERNAL USE — OWNER ACCEPTANCE`** (1.0.0, 21 Sep 2026).

Dasar: persetujuan langsung Owner (21 Sep 2026). **Fakta pengujian yang disampaikan Owner: tidak ada yang diperinci** — Owner tidak menyampaikan model perangkat, role, durasi, transaksi, atau hasil TalkBack, sehingga dokumen ini **tidak mencatatnya**. Bukti pengujian yang tercatat hanyalah yang dilakukan pengembang (tes otomatis, smoke test emulator, pemeriksaan produksi baca-saja) sebagaimana ditulis di `FINANCE-MOBILE-HARDENING-S12.md`.

Batas rilis: distribusi **hanya** ke pengguna internal Finance/Owner yang berwenang. **AAB tidak dipublikasikan ke publik. EAS Update production tidak dipublikasikan** (tidak ada perubahan JS setelah build). **Push notification tetap OFF.**

**Validasi pasca-rilis yang MASIH TERBUKA (bukan blocker rollout internal):** (1) uji Android lama (mis. RAM rendah) — **wajib selesai sebelum distribusi diperluas ke seluruh tim**; (2) penggunaan operasional tiga hari kerja; (3) audit TalkBack; (4) sesi pemakaian panjang (30 menit+) di perangkat fisik; (5) uji HP fisik lain di luar yang dipakai Owner (tidak dirinci); (6) jaringan lambat pada API nyata; (7) pilot 2 minggu.

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

## 1a. Artefak 1.0.0 (dibuat 21 Sep 2026, commit 8a9a4248)

**Tag rilis:** `finance-mobile-v1.0.0` (annotated) → commit `8a9a4248ca244767e98a1546af0275623ee2f7bc` — commit persis yang dibangun EAS untuk APK (build 2) dan AAB (build 3) (`gitCommitHash` kedua build diverifikasi sama). Commit sesudahnya (`1eb9773b`, `6c619e30`, dan commit penutupan ini) hanya dokumen/skrip; tidak ada perubahan pada `finance-mobile/` atau `backend/src` setelah source build.

**Checksum SHA-256** (dihitung dari berkas yang diunduh dari tautan di bawah; APK identik byte-per-byte dengan yang dipasang di emulator):

| Berkas | Ukuran | SHA-256 |
|---|---|---|
| APK build 2 | 96.774.692 B | `265a2ccb9178d845377ff96bdab686be1a2a8b648e9fb4a4d5ec19953d14e03f` |
| AAB build 3 | 69.293.033 B | `bb79865335f5b555e961abdae337225236dd0561e399533b1b951c3151d8c320` |

Verifikasi sebelum memasang: `sha256sum finance-1.0.0-b2.apk` (Windows: `certutil -hashfile <berkas> SHA256`) harus sama dengan nilai di atas.


| Artefak | Build ID | Versi / build | Tautan |
|---|---|---|---|
| APK internal tim (`production-apk`, channel production) | `b66adce0-97cc-4da8-91ad-5dba59af7f4b` | 1.0.0 / 2 | https://expo.dev/artifacts/eas/Ke0Wcmvk7_lQ7DgXYN4H59fYDMwuOAxzMF-nkUSdc0Y.apk |
| AAB Play Store (`production`, channel production) | `90cabfce-8746-4c6b-92f7-a22be1f8bb53` | 1.0.0 / 3 | https://expo.dev/artifacts/eas/5_3JlktBkpHFqHqRmGTnJH7SBSh5KtDUKjaiu3Jtj5g.aab |
| EAS Update channel production | — | runtime 1.0.0 | **TIDAK dipublikasikan** (tidak ada perubahan JS setelah build; keputusan penutupan rilis) |

Smoke test APK 1.0.0 di emulator Pixel 8: terpasang, terbuka (4,0 dtk cold, emulator), layar masuk "SANO Finance 1.0.0 · production", tanpa crash, tanpa flag ALLOW_BACKUP, izin: INTERNET, ACCESS_NETWORK_STATE, ACCESS_WIFI_STATE, CAMERA, USE_BIOMETRIC, USE_FINGERPRINT, VIBRATE, WAKE_LOCK, DETECT_SCREEN_CAPTURE, ACCESS_LOCAL_NETWORK (tetap ada meski diblokir di konfigurasi — datang dari pustaka jaringan; tidak berbahaya, dicatat). Belum diuji di HP fisik.

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

## 6. Monitoring pasca-rilis (tiga hari kerja pertama)

Jalankan `backend/scripts/pilot-snapshot.mjs` (read-only) **sebelum distribusi** dan **setiap akhir hari** selama tiga hari kerja pertama (cara: `docs/FINANCE-MOBILE-PILOT-1.0.md` §5). Baseline sebelum distribusi: `docs/pilot/baseline-distribusi-20260921.json` (21 Sep 2026 02:09 UTC; pembandingan terhadap baseline awal = LULUS, nol jurnal baru, selisih saldo nol).

**Hentikan penggunaan dan rollback (§5)** bila: Neraca tidak seimbang; jurnal ganda; saldo berubah tanpa jurnal; JV-19092026-372 berubah; atau akun 2-1600 tersentuh tanpa keputusan bisnis. **Catat**: crash, error login, gagal posting, duplicate command, masalah lampiran, izin, dan ketidaksesuaian mobile vs web. **P0/P1 → versi 1.0.1 dengan build baru; P2/P3 → backlog v1.1.**

Pemeriksaan pasca-rilis (read-only): Neraca seimbang di tanggal uji, saldo Kas & Bank tidak berubah tanpa transaksi, tidak ada jurnal tak terencana sejak deploy.
