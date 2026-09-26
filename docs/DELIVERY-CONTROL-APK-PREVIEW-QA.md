# Sano Delivery Control — APK Preview & Checklist QA (Samsung S25 Ultra)

Status: seluruh modul aktif; APK QA lokal tersedia; build EAS **tertahan kuota** dan menunggu GO (lihat bagian 3). Diperbarui 27 September 2026.

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

Prasyarat: APK QA final terpasang (`adb install -r`); server produksi sudah memuat rilis Delivery Control ini (tanpa itu modul operasional
tidak muncul dan tombol Verifikasi bukti tidak ada). Akun uji: Admin, Owner, Dispatcher (bila ada), Driver, Helper, Leader Driver (bila ada).
Jangan membuat data produksi nyata kecuali disebut "boleh"; gunakan pengajuan uji kecil yang bisa dibatalkan.

**A. Login, RBAC, dan Beranda**
1. Login Admin → Beranda: hero ringkasan, kartu Biaya Armada, grid modul (Dashboard, Driver, Rute, Tracking, Masalah, Performa); TIDAK ada label "Segera".
2. Owner dan Dispatcher (bila ada) → masuk; modul mengikuti izin. Driver/Helper/Leader Driver → ditolak dengan pesan jelas.
3. Salah password → pesan galat; tutup app lalu buka → sesi Admin/Owner tetap. Logout memakai konfirmasi; login ulang normal.
4. Lonceng: membuka Biaya Armada (tab Perlu revisi bila ada). Angka Menunggu/Perlu revisi/Draf di hero cocok dengan daftar.

**B. Dashboard operasional**
5. Tanggal hari ini: total job, persen selesai, Selesai/Berjalan/Menunggu/Gagal masuk akal dibanding Route Planner web.
6. Navigasi tanggal (sebelumnya/berikutnya; berikutnya tidak bisa melewati hari ini bila dibatasi); ketuk tanggal → kembali ke hari ini.
7. Peringatan "job aktif belum punya driver" dan "job gagal menunggu dijadwalkan ulang" hanya muncul bila ada; ketuk membuka Masalah.
8. Daftar rute tanggal itu; ketuk membuka detail rute. Tarik untuk segarkan; offline → pesan galat + tombol Coba lagi.

**C. Driver/Helper**
9. Daftar kru (driver dan helper digabung; orang dengan dua peran tampil sekali). Pencarian nama bekerja.
10. Badge SIM/Freelance/Kurir eksternal sesuai data; status "bertugas hari ini" dan titik online sesuai rute hari ini.
11. Detail orang: riwayat rute (driver ATAU helper), progres stop per rute; ketuk membuka detail rute.

**D. Rute dan histori**
12. Rute per tanggal: kode, status (Draf/Terbit/Berjalan/Selesai/Dibatalkan), driver+helper, kendaraan, progres stop.
13. Detail rute: kru, kendaraan, waktu terbit/sinkron, daftar stop berurutan dengan status, jam kunjungan, alamat, alasan gagal.
14. "Buka di peta" membuka aplikasi peta HP; app Control TIDAK meminta izin lokasi.

**E. Tracking**
15. Hanya rute terbit/berjalan hari ini dan job menuju lokasi. Kartu: fase, progres stop, "berikutnya", umur posisi GPS.
16. Posisi > 15 menit diberi tanda sinyal lama; tanpa posisi tampil "Belum ada posisi GPS". "Buka di peta" bekerja. Diperbarui otomatis ±30 detik.
17. Tidak ada dialog izin lokasi sama sekali di seluruh app.

**F. Masalah dan jadwal ulang**
18. Tab "Perlu tindakan" (job gagal) dan "Sudah dijadwalkan ulang"; alasan gagal/jadwal ulang tampil.
19. Detail job gagal → form Jadwalkan ulang: tanggal baru (tidak boleh sebelum hari ini), jam, driver/helper/kendaraan (terisi dari penugasan lama), alasan wajib, konfirmasi pelanggan.
20. **Boleh uji satu kasus nyata bila ada job gagal yang memang perlu dijadwal ulang**; kirim dua kali cepat (double tap) → hanya satu jadwal ulang (Idempotency-Key). Job non-gagal: form tidak muncul.
21. Setelah sukses kembali ke daftar; job pindah ke tab jadwal ulang. Dispatcher/Admin/Owner saja yang melihat tombol.

**G. Performa dan insentif**
22. Periode Bulan ini / 7 hari / Bulan lalu; total estimasi, jumlah alamat, tarif ber-SIM/tanpa SIM; peringkat kru.
23. Bandingkan 2–3 orang dengan Insentif Driver & Helper di web (angka harus sama; app tidak menghitung sendiri). Freelance dan kurir eksternal tidak muncul.

**H. Biaya Armada — lifecycle penuh**
24. Ringkasan (Draf/Menunggu/Perlu Revisi/Disetujui) dan tab tahap; daftar padat, badge status, "Tambah Pengajuan".
25. Form: jenis biaya, nominal, tanggal, vendor, metadata BBM (liter/odometer), kendaraan/rute/job, catatan; validasi nominal kosong/negatif ditolak.
26. **Uang Muka**: pilih sumber dana "Uang muka operasional" → muncul pemilih uang muka aktif (saldo, pemilik). Tanpa uang muka aktif → pesan kosong; kirim tanpa memilih → galat "Pilih uang muka".
27. Foto struk: kamera hanya untuk struk; tolak izin kamera → pesan jelas, tidak crash. Foto tampil lewat signed URL; buka ulang setelah >10 menit → dimuat ulang/Coba lagi; foto milik orang lain tidak muncul.
28. Ajukan/tarik/batalkan/minta revisi (alasan wajib) sesuai capability; aksi hanya muncul sesuai izin & status.
29. **Verifikasi bukti** (finance:admin): tombol muncul hanya bila ada bukti belum diverifikasi dan Anda BUKAN pembuat dokumen Finance; setelah verifikasi, baris "Bukti Finance" berubah Terverifikasi dan tombol hilang.
30. **Bayar** (finance:post): tombol hanya untuk biaya berstatus Disetujui. Dialog: pilih rekening (saldo tampil), cara bayar Tunai/Transfer; Transfer wajib rekening bank + jenis biaya admin (Lainnya = isi nominal). Setelah bayar status Dibayar; klik dua kali cepat → tidak dobel.
31. Status pembayaran & timeline audit; baris Sumber dana, Uang muka, Bukti Finance, Dokumen Finance benar.

**I. Draf lokal dan offline**
32. Simpan draf lokal, tutup app, buka lagi → draf ada. Mode pesawat: buat draf/ajukan → antre; sambung kembali → terkirim tepat sekali.

**J. Tampilan, sesi, dan keamanan data**
33. Mode terang dan gelap konsisten di semua modul; layar kecil/rotasi tidak memotong konten; nav bawah tidak menutup isi.
34. Ganti akun (Admin → Owner) tidak menampilkan data akun sebelumnya; setelah logout tidak ada data tersisa.
35. Tidak ada crash/ANR; catat versi Android/One UI. Tidak ada teks Inggris atau label "Segera" tersisa.

**Blocker/keterbatasan yang diketahui:** Route Planner kompleks, aksi massal, master data, dan laporan tetap di web. Tracking hanya membaca posisi
yang dikirim app Driver. Layar biaya belum ada di Sano Driver (sengaja).
