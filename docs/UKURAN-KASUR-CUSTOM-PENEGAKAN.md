# Ukuran Kasur Custom — tahap 2 (mobile, PDF invoice, penegakan server)

## Ringkasan
- Aplikasi mobile (form order + kartu order) memakai kontrak backend yang sama dengan web: `Order.notes` JSON `ukuranLebarCm`/`ukuranPanjangCm`, validasi 30–400 cm, maksimal satu desimal, teks "145 × 205 cm (Custom)". Salinan formatter ada di `backend/src/lib/ukuranKasur.js`, `frontend/src/utils/ukuranKasur.js`, `mobile/src/utils/ukuranKasur.js`; tes paritas: `backend/tests/ukuranKasur.test.js`.
- PDF invoice mencetak satu baris kecil `Ukuran: …` di bawah item pertama tiap order (invoice gabungan: ukuran tiap order). Tinggi baris menyesuaikan; invoice panjang tetap berpindah halaman dengan header tabel diulang.
- Penegakan server (Lebar/Panjang wajib) **default MATI**.

## Penegakan server
Pengaturan Finance (`PATCH /api/finance/settings`, izin FINANCE_ADMIN): `ukuran_custom_wajib` = `true`/`false`. Saat dinyalakan, `ukuran_custom_wajib_sejak` terisi otomatis (waktu penyalaan).

Saat AKTIF:
- **Buat order** dengan "Ukuran Custom": Lebar dan Panjang wajib (klien tanpa angka ditolak 400).
- **Edit order legacy** (custom tanpa angka) yang **tidak mengubah ukuran**: tetap diizinkan (mis. ubah keluhan/alamat).
- **Memilih ulang / mengubah menjadi Custom**: angka wajib. (Standar → Custom tanpa angka ditolak; custom berangka → custom tanpa angka ditolak.)
- **Kesiapan order** (`orderReadiness`): "Lebar dan Panjang ukuran custom belum diisi" hanya menahan order yang **dibuat sejak** tanggal penyalaan. 39 order legacy tidak pernah ditahan.

Saat MATI (default): perilaku tahap 1 — klien lama tetap bisa membuat/mengubah order custom tanpa angka (tampil "belum diisi").

## Kapan aman dinyalakan
Hanya setelah SEMUA perangkat sales yang dipakai aktif menjalankan mobile ≥ update OTA tahap 2 (runtime 3.3.0). Bukti yang dibutuhkan sebelum menyalakan:
1. Update OTA tercatat di branch `preview` (`eas update:list --branch preview`) dan manifes runtime 3.3.0 mengembalikan update itu.
2. Perangkat sales terverifikasi menjalankan update tersebut (Pengaturan aplikasi → "Cek Update", atau order custom uji dari mobile menghasilkan `ukuranLebarCm` di `Order.notes`).
3. Tidak ada perangkat yang masih memakai build lama di bawah runtime 3.3.0 (build 3.2.x dan lebih lama tidak menerima OTA ini — perlu APK baru).
Mematikan kembali: set `ukuran_custom_wajib` = `false` (tidak ada data yang berubah).

## Runtime OTA
`app.json`: `runtimeVersion.policy = appVersion`, `version = 3.3.0` (build terpasang vc22, channel `preview`). Perubahan mobile murni JavaScript (tanpa dependensi/config native baru; `version`/`versionCode` tidak dinaikkan), sehingga OTA cukup dan **tidak perlu build native**. Rollback OTA: `eas update:republish` group sebelumnya di branch `preview`.
