# Checklist Test Manual — Klinik Matras Sales App v2.0.0

Dipakai tim (sales/admin) untuk uji coba APK sebelum dipakai di lapangan.
Centang tiap baris ✅/❌, kalau ❌ catat detail (device, langkah reproduksi,
screenshot kalau ada) dan laporkan ke Gilang/developer.

Install APK dari link yang dibagikan (lihat pesan rilis), pastikan sudah
uninstall versi lama dulu kalau ganti dari build development sebelumnya
(package name sama, tapi signing key APK profile beda dari dev client —
install bisa gagal "App not installed" kalau versi lama masih ada).

---

## 1. Login
- [ ] Buka app, muncul splash screen lalu layar Login (tanpa nyangkut lama di splash)
- [ ] Login dengan email+password sales — berhasil masuk ke Inbox
- [ ] Salah password → pesan error jelas, tidak crash
- [ ] Tutup app total (swipe dari recent apps) lalu buka lagi — tetap login (sesi tersimpan)

## 2. Inbox — filter, search, swipe
- [ ] Tab "Semua" tampil semua percakapan, badge angka di tiap tab sesuai
- [ ] Tap tab "Belum Dibaca" / "Terbuka" / "Pending" / "Selesai" / "Milik Saya" — list berubah sesuai
- [ ] Tap ikon cari, ketik nama/nomor pelanggan — hasil muncul (ada jeda kecil, bukan instan tiap huruf)
- [ ] Scroll ke bawah sampai banyak percakapan — scroll tetap mulus (tidak patah-patah)
- [ ] Swipe kanan 1 percakapan → tandai dibaca/belum dibaca (badge hilang/muncul + terasa getar halus)
- [ ] Swipe kiri 1 percakapan → sematkan/lepas sematan (percakapan pindah ke atas)
- [ ] Pull-to-refresh di paling atas list — muncul indikator refresh lalu selesai
- [ ] Matikan WiFi/data sebentar, buka app — muncul pesan/skeleton loading, bukan layar putih kosong; nyalakan lagi data → list otomatis termuat

## 3. Buka chat
- [ ] Tap 1 percakapan — masuk ke layar chat, riwayat pesan termuat (skeleton dulu sebentar, bukan spinner polos)
- [ ] Scroll ke atas sampai pesan lama — pesan lebih lama ikut termuat, posisi scroll tidak lompat-lompat
- [ ] Tap nama/avatar di header — bottom sheet info pelanggan terbuka

## 4. Kirim teks/foto/VN/dokumen
- [ ] Ketik pesan teks, tap kirim — bubble langsung muncul (instan, status "mengirim" sebentar) + getar halus saat tap kirim
- [ ] Tutup WiFi, kirim pesan teks — muncul banner "Menunggu koneksi...", pesan otomatis terkirim begitu koneksi kembali
- [ ] Tap "+" lampiran → pilih Foto dari galeri → preview muncul, isi caption, kirim — foto terkirim & tampil di bubble
- [ ] Tap "+" → Kamera → ambil foto langsung → kirim — sama seperti di atas
- [ ] Tap "+" → Dokumen → pilih file (PDF dll) → kirim — muncul sebagai bubble dokumen, tap bisa dibuka
- [ ] Tahan tombol mic → rekam suara → lepas → muncul preview player + tombol Kirim/Batal — kirim → muncul sebagai voice note, bisa diputar
- [ ] Tap foto di bubble chat — buka fullscreen, coba pinch-zoom & geser antar foto
- [ ] Tap video di bubble chat — terbuka & bisa diputar

## 5. Reply / forward
- [ ] Tekan lama (long-press) 1 bubble pesan — terasa getar halus + muncul menu Balas/Teruskan/Salin
- [ ] Pilih "Balas" — muncul preview quote di atas kolom ketik, kirim — bubble baru menampilkan kutipan pesan asli
- [ ] Tap kutipan itu di bubble baru — otomatis scroll & highlight (kuning sebentar) ke pesan aslinya
- [ ] Pilih "Teruskan" — modal cari percakapan tujuan muncul, pilih salah satu — pesan terkirim ke sana

## 6. Bottom sheet — edit pipeline + order
- [ ] Di bottom sheet info pelanggan: tap salah satu tahap pipeline (Lead/Qualified/dst) — berubah seketika (optimistic), badge warna berubah
- [ ] Edit nama pelanggan (tap ikon pensil) — simpan, nama di header ikut berubah
- [ ] Ubah Kondisi Pelanggan (Sakit/Tidak Sakit) dan Tipe Customer — tersimpan
- [ ] Tap "+ Order" — isi form order (pilih produk dari Galeri Produk ATAU ketik manual, qty, harga, catatan) — simpan — order baru muncul di list order
- [ ] Tambah catatan internal baru — muncul di list catatan dengan nama+waktu

## 7. Take over
- [ ] Buka percakapan yang masih "milik" sales lain — muncul banner "Ditangani oleh [nama]" + tombol "Ambil Alih"
- [ ] Tap "Ambil Alih" — muncul konfirmasi dulu, baru berpindah jadi milik kamu (banner hilang)
- [ ] Buka menu (⋮) di header chat → "Transfer ke Sales Lain" → pilih sales lain — percakapan berpindah

## 8. Push notification
- [ ] App di-background (tekan Home, jangan ditutup) → minta rekan kirim WA ke nomor customer test → notifikasi muncul dalam beberapa detik, tap → langsung masuk ke chat yang benar
- [ ] App ditutup total (swipe dari recent apps / force-stop) → kirim WA lagi → notifikasi tetap muncul, tap → app kebuka & langsung ke chat yang benar (bukan ke Inbox kosong)
- [ ] Saat app sedang dibuka di layar Inbox (bukan di chat itu) dan ada pesan masuk — muncul banner kecil di atas, tap → masuk ke chat itu
- [ ] Saat app sedang dibuka DI DALAM chat yang sama dengan pesan masuk — TIDAK muncul notifikasi dobel (cukup bubble baru muncul langsung di chat)

## 9. OTA update check
- [ ] Buka tab Profil → cari menu "Cek Update" / info versi app
- [ ] Kalau ada update OTA (JS-only, bukan versi native baru) — muncul prompt/proses update, app restart otomatis setelah selesai
- [ ] Kalau tidak ada update — muncul pesan "sudah versi terbaru" (tidak nyangkut loading)

## 10. Logout
- [ ] Tab Profil (atau ikon logout di Inbox) → Logout — kembali ke layar Login
- [ ] Login lagi dengan akun sales BERBEDA di device yang sama — data/chat sebelumnya tidak nyampur/bocor ke akun baru
- [ ] Notifikasi push akun lama tidak lagi masuk ke device ini setelah logout

---

## Catatan known limitation (bukan bug, sudah didokumentasikan)
- Jumlah member grup WhatsApp TIDAK ditampilkan di info grup (backend belum
  integrasi WAHA group-participants API) — cuma nama grup + jumlah media.
- Splash screen & app icon masih pakai asset sementara (belum final dari
  Gilang) — lihat bagian "Branding belum final" di bawah.

## Branding belum final ⚠️
`assets/icon.png` yang dipakai sebagai app icon DAN splash screen sekarang
masih berisi garis bantu desain (crosshair/lingkaran guide) yang kelihatan
belum final — kemungkinan file mentah/belum di-export bersih dari tool
desain. Perlu file icon + splash final dari Gilang sebelum rilis produksi
sesungguhnya ke semua sales (untuk testing internal sekarang tidak masalah).
