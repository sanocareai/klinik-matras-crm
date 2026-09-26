# Sano Delivery Control — APK Preview & Checklist QA (Samsung S25 Ultra)

Status: konfigurasi siap; build EAS **tertahan kuota** (lihat bagian 3). Dibuat 26 September 2026.

## 1. Identitas aplikasi (terpisah dari Sano Driver)

| Item | Sano Delivery Control | Sano Driver (tidak diubah) |
|---|---|---|
| Nama | Sano Delivery Control | Sano Driver |
| Application ID | `com.klinikmatras.deliverycontrol` | `com.klinikmatras.drivermobile` |
| Versi | 0.1.0 (versionCode 1, `appVersionSource: local`) | 1.0.0 (versionCode 6) |
| Project EAS | `@sanocare/sano-delivery-control` — `6a490ec2-167a-43e0-a964-e9797322ed4e` | `0fd04b96-1357-4fde-876b-db934dac6149` |
| Channel preview | `control-preview` (dibuat) | milik Driver |
| API | `https://app.sanomatrassehat.com` (bawaan `DEFAULT_SERVER`, produksi) | — |

Profile `preview` (`delivery-control/eas.json`): `distribution: internal`, `android.buildType: apk`, `channel: control-preview`.
Perintah: `cd delivery-control && eas build -p android --profile preview` (jangan memakai profile `production`).

## 2. Izin Android yang diharapkan (hasil `expo prebuild` lokal; verifikasi ulang pada APK setelah build)

- Ada: `INTERNET`, `VIBRATE`, `SYSTEM_ALERT_WINDOW` (dari React Native), `CAMERA` (expo-image-picker; hanya foto struk),
  `READ/WRITE_EXTERNAL_STORAGE` dibatasi `maxSdkVersion=32` (tidak berlaku di Android 13+ / S25 Ultra).
- **Dihapus dari manifest (`tools:node="remove"`)**: `ACCESS_FINE_LOCATION`, `ACCESS_COARSE_LOCATION`, `ACCESS_BACKGROUND_LOCATION`,
  `FOREGROUND_SERVICE`, `FOREGROUND_SERVICE_LOCATION`, `RECORD_AUDIO`.
- Verifikasi APK: `aapt dump badging app.apk | grep -E "package|uses-permission"` — tidak boleh ada izin lokasi/background location/mikrofon.

## 3. Blocker build (26 September 2026)

`eas build -p android --profile preview` berjalan sampai unggah + fingerprint, lalu ditolak EAS:
"This account has used its Android builds from the Free plan this month, which will reset in 4 days (on Thu Oct 01 2026)."
Akun `sanocare` (plan Free). Tidak memakai akun/project lain. Opsi: tunggu reset **1 Oktober 2026**, atau upgrade plan akun `sanocare`,
lalu jalankan perintah di atas (project, channel, dan keystore Android cloud sudah dibuat).

## 4. Checklist QA Samsung S25 Ultra (isi PASS/FAIL + catatan)

Prasyarat: APK preview terpasang; akun uji Admin, Owner, Dispatcher (bila ada), Driver, Helper, Leader Driver (bila ada); koneksi Wi-Fi/seluler.

**A. Login dan RBAC**
1. Login Admin → masuk beranda Control. 2. Logout → login Owner → masuk. 3. Dispatcher (bila ada) → masuk.
4. Driver → ditolak (tidak masuk beranda, pesan jelas). 5. Helper → ditolak. 6. Leader Driver (bila ada) → ditolak.
7. Salah password → pesan galat, tidak crash. 8. Tutup app total lalu buka → sesi tetap (Admin/Owner) atau kembali ke login (bila sesi habis).

**B. Biaya Armada**
9. Daftar: memuat, tarik-untuk-refresh, pagination, filter status termasuk PERLU_REVISI. 10. Detail: nominal, kategori, rute/kendaraan, timeline, alasan revisi (bila ada).
11. Buat pengajuan: nominal, kategori, rute, kendaraan, tanggal; validasi nominal kosong/negatif ditolak. 12. Nominal besar (>Rp300.000) tetap menunggu persetujuan.
13. Aksi sesuai capability (tombol hanya muncul bila diizinkan): ajukan, tarik, batalkan, minta revisi (finance:approve); alasan wajib untuk minta revisi/batalkan.
14. Status tak dikenal (bila ada) tampil aman tanpa aksi.

**C. Foto struk**
15. Kamera terbuka hanya untuk foto struk; izin kamera diminta saat pertama; tolak izin → pesan jelas, app tidak crash. 16. Tidak ada permintaan izin lokasi/mikrofon.
17. Foto tampil di detail lewat signed URL; buka ulang setelah >10 menit → dimuat ulang otomatis (atau tombol "Coba lagi"). 18. Foto pengajuan milik orang lain tidak dapat dibuka.

**D. Draf lokal dan offline**
19. Isi form lalu tutup app → draf tersimpan dan dapat dilanjutkan. 20. Mode pesawat: buat draf, ajukan → antre lokal, tidak hilang.
21. Sambungkan kembali → terkirim tepat sekali (tidak ganda; kunci idempotensi). 22. Bersihkan draf setelah terkirim.

**E. Tampilan dan sesi**
23. Mode gelap dan terang mengikuti sistem; kontras terbaca di keduanya. 24. Rotasi tidak dipakai (potret); keyboard tidak menutup field. 25. Logout → data sesi hilang; login ulang normal.

**F. Keamanan data**
26. Setelah logout, tidak ada data biaya/role sebelumnya terlihat. 27. Ganti akun (Admin → Owner) tidak menampilkan data akun sebelumnya. 28. Tidak ada crash/ANR selama seluruh skenario; catat versi Android dan One UI.

Blocker QA yang diketahui: layar biaya belum dipasang di Sano Driver (sengaja); sumber dana uang muka/bayar/verifikasi belum ada di UI Control.
