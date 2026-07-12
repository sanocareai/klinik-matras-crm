# Checklist Testing Sano Chat v2.0

Dipakai tim (sales/admin) untuk uji coba APK sebelum dipakai di lapangan.
Centang tiap baris ✅/❌, kalau ❌ catat detail (device, langkah reproduksi,
screenshot kalau ada) dan laporkan ke Gilang/developer.

Install APK dari link yang dibagikan, pastikan sudah uninstall versi lama
dulu kalau sebelumnya pakai build development client (package name sama,
tapi signing key APK profile beda dari dev client — install bisa gagal
"App not installed" kalau versi lama masih ada).

---

## Auth & Navigasi
- [ ] Buka app → splash screen → layar Login (tidak nyangkut lama di splash)
- [ ] Login dengan email+password — berhasil masuk ke tab Home
- [ ] Salah password → pesan error jelas, tidak crash
- [ ] Tutup app total (swipe dari recent apps) lalu buka lagi — tetap login (sesi tersimpan)
- [ ] 4 tab bar di bawah tampil dan berfungsi: **Home**, **Chats**, **Pelanggan**, **Profil**
- [ ] Pindah antar tab tidak kehilangan state (mis. filter Inbox tetap kepilih saat balik dari tab lain)

## Inbox
- [ ] Tab "Semua" tampil semua percakapan, badge angka tiap filter sesuai
- [ ] Filter **Belum Dibaca** — hanya percakapan dengan pesan masuk belum dibaca yang tampil
- [ ] Filter Terbuka / Pending / Selesai / Milik Saya — list berubah sesuai
- [ ] Tap ikon cari, ketik nama/nomor pelanggan — hasil muncul (ada jeda kecil, bukan re-render tiap huruf)
- [ ] Scroll list panjang tetap mulus (tidak patah-patah)
- [ ] Swipe kanan 1 percakapan → tandai dibaca/belum dibaca (badge berubah + getar halus)
- [ ] Swipe kiri 1 percakapan → sematkan/lepas sematan (percakapan pindah ke atas)
- [ ] Badge unread di ikon tab Chats sesuai jumlah total belum dibaca
- [ ] Pull-to-refresh di paling atas list — indikator refresh muncul lalu selesai
- [ ] Matikan koneksi sebentar, buka app — muncul skeleton loading (bukan layar putih kosong); nyalakan lagi → list otomatis termuat

## Chat
- [ ] Kirim pesan teks — bubble langsung muncul (optimistic, status "mengirim" sebentar), getar halus saat tap kirim
- [ ] Kirim foto (galeri & kamera) dengan caption — terkirim & tampil di bubble
- [ ] Kirim video — terkirim, thumbnail + tombol play tampil di bubble
- [ ] Kirim dokumen (PDF dll) — tampil sebagai bubble dokumen, tap bisa dibuka
- [ ] Tahan tombol mic, rekam voice note, lepas — muncul preview player + tombol Kirim/Batal, kirim → tampil sebagai voice note, bisa diputar
- [ ] Terima pesan foto/video/dokumen/voice note dari customer — tampil benar semua
- [ ] Terima **sticker** — tampil sebagai gambar stiker (bukan bubble teks placeholder)
- [ ] Terima **lokasi** (share location WA) — tampil sebagai card lokasi
- [ ] Terima **kontak** (share contact WA) — tampil sebagai card kontak
- [ ] Terima **poll** (polling WA) — tampil sebagai card dengan daftar opsi
- [ ] Kirim 1 pesan, tunggu beberapa detik — ceklis berubah 1 (terkirim) → 2 (diterima) → 3 biru (dibaca)
- [ ] Swipe bubble ke samping (bukan tekan lama) — muncul ikon reply, lepas → preview quote muncul di composer
- [ ] Kirim pesan dari quote itu — bubble baru menampilkan kutipan pesan asli
- [ ] Tap kutipan pesan itu di bubble → otomatis scroll & highlight (kuning sebentar) ke pesan aslinya
- [ ] Tekan lama bubble → menu aksi muncul, pilih Teruskan → modal pilih percakapan tujuan → pesan terkirim ke sana
- [ ] Edit pesan sendiri (dalam 15 menit sejak kirim) — bubble tampil isi baru + label "diedit"
- [ ] Hapus pesan sendiri ("Hapus untuk Semua", dalam batas waktu) — bubble berubah jadi "Pesan ini telah dihapus"
- [ ] Buka percakapan grup — bisa kirim balasan, nama pengirim tampil di atas tiap bubble inbound
- [ ] Buka keyboard saat mengetik balasan — composer & bubble terakhir tetap terlihat di atas keyboard (tidak ketutup)

## Customer & Order
- [ ] Tap nama/avatar di header chat — bottom sheet info pelanggan terbuka
- [ ] Tap salah satu tahap pipeline (Lead/Qualified/Quoted/Won/Lost) di bottom sheet — berubah seketika (optimistic), badge warna berubah
- [ ] Edit nama pelanggan, Kondisi Pelanggan (Sakit/Tidak Sakit), dan Tipe Customer — tersimpan
- [ ] Tap "+ Order" — isi form order lengkap (kategori Layanan/Sewa/Baru, merk & ukuran kasur, add-on layanan + harga, keluhan customer, berat badan per orang) — simpan — order baru muncul di list
- [ ] Tambah catatan internal — muncul di list catatan dengan nama penulis + waktu
- [ ] Foto profil WhatsApp pelanggan tampil di header chat & bottom sheet (kalau privasi WA pelanggan mengizinkan — kalau tidak, fallback avatar inisial berwarna, ini normal bukan bug)

## Home & Pelanggan
- [ ] Tab Home: card "Target Tim Bulan Ini" tampil progress bar (khusus role ADMIN) atau target pribadi (role SALES)
- [ ] Tab Home: "Progress per Sales" — tiap sales tampil nilai tercapai vs target bulanan
- [ ] Tab Home: "Performa Sales" (chat ditangani + conversion) — SALES cuma lihat baris sendiri, ADMIN lihat semua
- [ ] Tab Pelanggan: list pelanggan dengan chip filter pipeline stage
- [ ] Tab Pelanggan: toggle ke tampilan "Pipeline Board" (kanban) — kolom per stage tampil
- [ ] Di Pipeline Board, tekan lama 1 card pelanggan → pindahkan ke kolom stage lain — tersimpan
- [ ] Filter "Sales" (dropdown/pill) — pilih sales tertentu, list/board cuma tampil pelanggan miliknya (role ADMIN saja yang bisa ganti-ganti, role SALES otomatis terkunci ke diri sendiri)

## Tanya Sano
- [ ] FAB "Tanya Sano" (ikon sparkle) muncul di tab Home
- [ ] Tap FAB → sheet chat AI terbuka, bisa kirim pertanyaan
- [ ] Jawaban Sano tampil dengan formatting markdown yang benar (bold, list bernomor/bullet, bukan tanda `**`/`-` mentah)

## Profil
- [ ] Tap foto profil sendiri → pilih dari galeri → foto baru tersimpan & tampil
- [ ] Toggle "Aktifkan notifikasi" — bisa dinyalakan/dimatikan, tersimpan
- [ ] Menu "Cek Update" — kalau ada update OTA, muncul prompt & app restart otomatis setelah selesai; kalau tidak ada, muncul pesan "sudah versi terbaru" (tidak nyangkut loading)
- [ ] Logout — kembali ke layar Login
- [ ] Login lagi dengan akun berbeda di device yang sama — data/chat akun sebelumnya tidak nyampur/bocor ke akun baru

## Push Notification (SEPARATE — test di HP fisik, bukan emulator)
- [ ] Buka Profil, pastikan toggle notifikasi aktif — token FCM berhasil terdaftar (tidak ada error saat login/buka app)
- [ ] App di-background (tekan Home, jangan ditutup) → rekan kirim WA ke nomor customer test → notifikasi muncul dalam beberapa detik, tap → langsung masuk ke chat yang benar
- [ ] App ditutup total (swipe dari recent apps / force-stop) → kirim WA lagi → notifikasi tetap muncul, tap → app terbuka & langsung ke chat yang benar (bukan ke Home/Inbox kosong)
- [ ] Saat app terbuka tapi TIDAK sedang di chat itu — pesan masuk tetap memicu notifikasi/badge
- [ ] Saat app terbuka DAN sedang DI DALAM chat yang sama dengan pesan masuk — TIDAK muncul notifikasi dobel (cukup bubble baru langsung tampil di chat)
- [ ] Setelah logout, notifikasi push akun lama tidak lagi masuk ke device ini

---

## Catatan known limitation (bukan bug, sudah didokumentasikan)
- Pencarian di dalam 1 percakapan ("in-chat search") baru ada di versi web
  CRM, belum ada di mobile — bukan bug, cuma belum dikerjakan.
- Jumlah member grup WhatsApp TIDAK ditampilkan di info grup (backend belum
  integrasi WAHA group-participants API) — cuma nama grup + jumlah media.
- Preferensi notifikasi (master toggle + jam aktif) di Profil masih
  tersimpan lokal — belum ada endpoint backend, jadi tidak sinkron lintas
  device kalau sales pakai lebih dari 1 HP.
