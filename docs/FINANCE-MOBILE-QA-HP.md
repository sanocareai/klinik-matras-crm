# Checklist QA HP nyata — SANO Finance (APK preview) S0–S8

Versi aplikasi 0.2.0 · paket `com.sanomatrassehat.finance.preview` · disusun 21 Sep 2026.

## Aturan main (baca dulu)

1. **APK preview memakai API PRODUKSI.** Tidak ada staging. Semua perintah uang membuat jurnal sungguhan dan mengubah saldo Kas & Bank.
2. **Urutan aman:** (a) semua bagian *baca* dulu; (b) uji tulis hanya dengan dokumen kecil berketerangan **"UJI QA"**; (c) jangan uji aksi pada dokumen bisnis nyata yang belum Anda niatkan.
3. **Yang tidak membuat jurnal (aman diuji):** draf lokal di HP; "Simpan sebagai draf di server" pada Pengeluaran/Pembelian (baris DRAFT tanpa jurnal); membuka detail; pencarian/filter; app lock; offline; dark/light.
4. **Yang langsung membuat jurnal (hanya bila memang perlu):** Kasbon, Pemasukan Lain, Supplier→bayar tagihan, Bayar pengeluaran/pembelian, Persetujuan. Pembatalan (akun admin) membuat jurnal balik — tercatat di audit dan tidak menghapus apa pun.
5. Catat tiap temuan: layar, langkah, hasil, tangkapan layar, jam. Bandingkan angka layar dengan halaman web Finance untuk hal yang sama.
6. Uji dengan **akun sungguhan berperan berbeda** bila ada: Finance, Owner/Admin, Approver, Akuntan. Peran ditentukan server; jangan berharap sama.

Perangkat minimal: 1 HP Android modern + 1 HP lama/layar kecil bila ada. Catat tipe, versi Android, ukuran font sistem.

---

## S0–S1 Akses, sesi, keamanan

| # | Langkah | Hasil yang benar |
|---|---|---|
| 1 | Pasang APK, buka | Nama "SANO Finance (Preview)", ikon benar, tidak ada banner "Mode contoh" |
| 2 | Login akun Finance | Masuk; tab sesuai peran (Finance: Beranda, Transaksi, Persetujuan, Laporan, Lainnya) |
| 3 | Login dengan password salah | Pesan jelas, tidak ada detail teknis; setelah beberapa kali salah muncul batas percobaan |
| 4 | Login akun non-Finance (mis. Sales) | Ditolak dengan pesan tidak punya akses Finance |
| 5 | Atur PIN 6 digit + aktifkan biometrik | Berhasil; PIN salah beberapa kali → jeda/keluar sesuai aturan |
| 6 | Kunci aplikasi: kirim ke background 2+ menit, buka lagi | Diminta PIN/biometrik; isi layar tidak terlihat di task switcher |
| 7 | Background-resume < 2 menit | Langsung masuk tanpa PIN, data tetap |
| 8 | Aksi uang pertama setelah 2+ menit | Diminta step-up PIN/biometrik sebelum terkirim |
| 9 | Lainnya → Keamanan → "Hak akses Anda" | Daftar kemampuan sesuai peran akun |
| 10 | Keluar lalu login lagi | Sesi bersih; kunci draf/data lama tidak bocor ke akun lain |
| 11 | (Admin web) cabut sesi/nonaktifkan akun uji, lalu buka app | Keluar otomatis dengan pesan "sesi dicabut/akun nonaktif" |

## S2–S3 Beranda & laporan

| # | Langkah | Hasil yang benar |
|---|---|---|
| 12 | Beranda | Total Kas & Bank, saldo per rekening, laba rugi, umur piutang & utang, antrean tertunda tampil; "Diperbarui … WIB" |
| 13 | Bandingkan saldo per rekening dengan web Finance → Kas & Bank | **Sama persis** (saldo negatif tampil negatif, warna benar, tidak dipotong) |
| 14 | Ganti periode (bulan ini/lalu, kuartal, tahun) | Angka laba rugi berubah; kas/piutang/utang tidak ikut periode |
| 15 | "Sembunyikan angka" | Semua nominal tersamarkan di Beranda, detail, lampiran; kembali normal saat dimatikan |
| 16 | Laporan → Laba Rugi / Neraca / Arus Kas / Neraca Saldo / Umur Piutang / Umur Utang | Cocok dengan web; **Neraca seimbang** |
| 17 | Tarik untuk muat ulang | Data diperbarui; gagal jaringan menampilkan data lama + pesan |

## S4 Persetujuan

| # | Langkah | Hasil yang benar |
|---|---|---|
| 18 | Tab Persetujuan: Menunggu / Diproses / Disetujui / Ditolak | Jumlah per tab; lencana tab = jumlah menunggu |
| 19 | Buka dokumen: lampiran, riwayat, rincian | Foto tampil (tautan bertanda-tangan), riwayat berurutan |
| 20 | Dokumen pengeluaran ≥ ambang tanpa nota | Tombol Setujui **nonaktif** + alasan "wajib nota" |
| 21 | Setujui dokumen kecil bernota (hanya bila memang mau) | Step-up → sukses → status berpindah; saldo rekening berubah sesuai web |
| 22 | Tolak tanpa alasan | Tidak bisa dikirim; dengan alasan → tercatat di riwayat |
| 23 | Buat pengeluaran/pembelian/refund/tagihan (bagian S6–S8) lalu cek Persetujuan | Dokumen yang menunggu approval muncul di sini; pembuat tidak bisa menyetujui dokumennya sendiri (kecuali admin) |
| 24 | Dua perangkat memutuskan dokumen yang sama hampir bersamaan | Satu sukses, satu mendapat pesan "sudah diproses" |

## S5 Pembayaran pelanggan

| # | Langkah | Hasil yang benar |
|---|---|---|
| 25 | Transaksi → Pembayaran pelanggan: tab Menunggu / Terverifikasi / Ditolak | Jumlah & ringkasan periode dari server, tidak berubah saat pindah tab |
| 26 | Buka pembayaran: order, invoice, pelanggan, jenis (DP/cicilan/pelunasan), rekening, bukti | Gambar & PDF terbuka; tautan lama yang kedaluwarsa memberi opsi muat ulang |
| 27 | Verifikasi/tolak (hanya akun Finance; hanya kasus nyata) | Akun Owner/Approver/Akuntan **tidak** melihat tombol; alasan wajib untuk tolak; status order CRM ikut turun saat ditolak |

## S6 Pengeluaran, Pembelian, Kasbon, Pemasukan Lain

| # | Langkah | Hasil yang benar |
|---|---|---|
| 28 | Transaksi → Pengeluaran: tab, cari (`150.000` cocok nominal 150000), paginasi "Muat lebih banyak" | Angka cocok web; penutup "N … sudah semua" |
| 29 | Kolom/keterangan **"Nota wajib sebelum disetujui"** pada dokumen tanpa nota | Sama dengan yang tampil di web |
| 30 | Tombol **+** → Pengeluaran baru: kosongkan lalu Ajukan | Pesan kesalahan inline per kolom, tidak ada yang terkirim |
| 31 | Isi keyboard: field bawah tidak tertutup keyboard, tombol tetap terjangkau | Layar bergeser; tidak ada isi terpotong |
| 32 | Foto nota: Kamera & Galeri | Progres "Mengunggah…" → "Foto terunggah"; matikan data saat unggah → pesan + tombol coba lagi; isian form **tidak hilang** |
| 33 | Foto yang sama dipakai dokumen lain | Peringatan "sudah dipakai di …" |
| 34 | **Simpan sebagai draf di server** (UJI QA) | Baris DRAFT di tab Draf; tanpa jurnal; tombol "Ajukan untuk persetujuan" tersedia |
| 35 | **Simpan draf di HP**, tutup app, buka form lagi | Muncul "Ada draf tersimpan di HP"; Lanjutkan mengisi form; **tidak pernah terkirim sendiri** |
| 36 | Dobel-tap "Ajukan" | Hanya satu dokumen terbentuk |
| 37 | Matikan data tepat saat menekan Ajukan | Pesan "hasilnya belum pasti"; cek daftar dulu sebelum coba lagi (tidak ada dokumen ganda) |
| 38 | Bayar reimbursement disetujui (nyata saja) | Pilih rekening (saldo tampil); saldo negatif tetap boleh; status → Dibayar |
| 39 | Kasbon baru: pilihan karyawan | Hanya karyawan aktif; tanpa OWNER (Admin), Kurir Eksternal, akun nonaktif; rekening bersaldo tampil |
| 40 | Kasbon: potong dari gaji > sisa | Ditahan dengan pesan; sah → sisa berkurang, tidak menyentuh kas |
| 41 | Pemasukan Lain | Ada petunjuk "bukan pembayaran order"; akun penjualan/layanan/retur tidak ada di pilihan |
| 42 | Akun Approver | Tidak ada tombol tambah/FAB; membuka formulir ditolak |
| 43 | (Admin) Batalkan dokumen UJI QA dengan alasan | Jurnal dibalik, muncul di riwayat; alasan kosong ditolak |

## S7 Piutang & Refund

| # | Langkah | Hasil yang benar |
|---|---|---|
| 44 | Transaksi → Piutang | Sisa, jatuh tempo, umur (hari lewat), ember umur; order LUNAS di CRM tidak tampil |
| 45 | Bandingkan total piutang & umur dengan web Piutang & Refund | Sama |
| 46 | Detail piutang: invoice, pembayaran resmi | Pembayaran → buka di layar Pembayaran pelanggan (S5) |
| 47 | Atur alokasi (kasus nyata saja) | Total harus persis nominal pembayaran; indikator "Belum teralokasi"; simpan → status order dihitung ulang |
| 48 | Refund baru: cari order | Server menampilkan "bisa dikembalikan"; nominal lebih besar ditahan; sah → status Menunggu dan muncul di Persetujuan |

## S8 Supplier, Tagihan, Utang

| # | Langkah | Hasil yang benar |
|---|---|---|
| 49 | Supplier: daftar, detail | Sisa utang, termin, rekening bank, tagihan terbuka, pembayaran terakhir |
| 50 | Tagihan supplier: tab Belum lunas, "Lewat tempo saja" | Umur & jatuh tempo cocok dengan web Supplier & Utang |
| 51 | Tagihan baru | Wajib supplier & kategori biaya; jatuh tempo kosong mengikuti termin |
| 52 | Bayar tagihan sebagian lalu sisanya (nyata saja) | Nominal > sisa ditahan; status Dibayar sebagian → Lunas; rekening sumber tercatat |
| 53 | Pembayaran supplier: histori | Muncul; batal (admin) mengembalikan sisa utang |

## Lintas fitur

| # | Langkah | Hasil yang benar |
|---|---|---|
| 54 | **Offline:** mode pesawat lalu buka daftar & detail | Banner offline; tombol perintah nonaktif ("Butuh koneksi internet"); tidak ada antrean |
| 55 | Jaringan putus di tengah unggah/kirim | Pesan jelas; tidak ada dokumen ganda setelah jaringan kembali |
| 56 | **Token refresh:** biarkan app terbuka > 15 menit lalu buka daftar | Tetap masuk (refresh otomatis), tidak diminta login |
| 57 | **Izin berubah:** cabut izin akun uji di web, lalu coba aksi | Pesan "izin berubah", hak akses dimuat ulang |
| 58 | **Dark/light:** ganti tema di Lainnya | Semua layar terbaca, kontras baik, badge status jelas |
| 59 | **Font besar:** sistem 1,5× dan layar kecil | Tidak ada teks terpotong/bertumpuk; nominal panjang tidak merusak tata letak |
| 60 | **Background-resume** di tengah mengisi form | Isian tetap; setelah kunci PIN, kembali ke form yang sama |
| 61 | Tombol Kembali sistem & navigasi antar tab | Tidak keluar aplikasi tak sengaja; tidak ada layar kosong |
| 62 | Bagikan foto dari WhatsApp/galeri → SANO Finance | Sheet transaksi cepat terbuka; "Jadikan Pengeluaran/Pembelian" mengisi foto ke form |

### Wave 2 — Jurnal, Buku Besar, Rekonsiliasi, Laporan (baca-saja pada APK preview)

| # | Langkah | Hasil yang benar |
|---|---|---|
| 63 | Lainnya → **Jurnal**; ganti periode/status/sumber, cari nomor | Daftar mengikuti filter; jurnal tidak seimbang (bila ada) ditandai merah + banner |
| 64 | Buka satu jurnal → ketuk baris akun | Detail memuat debit/kredit, dokumen terkait, riwayat; ketukan baris membuka buku besar akun bulan itu |
| 65 | Lainnya → **Buku Besar** → pilih periode dan akun | Saldo awal, total, saldo akhir dan saldo berjalan sama dengan halaman Buku Besar di web untuk periode yang sama |
| 66 | Akun tanpa mutasi / periode "Tahun lalu" | Keadaan kosong yang jelas, bukan galat |
| 67 | Lainnya → **Rekonsiliasi** → buka satu | Saldo buku, saldo statement, selisih, jumlah belum cocok sama dengan web |
| 68 | **APK preview (baca-saja):** buka baris belum cocok | Tombol cocokkan/lepas nonaktif dengan teks "Build preview hanya untuk pengujian baca" |
| 69 | Tab **Laporan** → enam laporan, ganti periode | Angka sama dengan halaman laporan di web (periode sama); Neraca menampilkan laba/rugi tahun berjalan dan status seimbang/selisih |
| 70 | Ketuk baris akun di Neraca Saldo / piutang di Umur Piutang | Terbuka buku besar akun / detail piutang |
| 71 | **Bagikan ringkasan** | Sheet berbagi sistem berisi ringkasan angka yang sedang tampil |
| 72 | Mode pesawat lalu tarik untuk segarkan | Banner offline; data terakhir tetap tampil dengan penanda basi; tidak ada tombol yang mengirim |
| 73 | Font 1,5×, layar 360×640, gelap/terang | Tidak ada teks terpotong; nominal panjang dan negatif tampil utuh |

## Setelah QA — verifikasi di sisi server (oleh saya, read-only)

- Jurnal baru dari sesi QA (nomor, sumber, pembuat) sesuai daftar dokumen UJI QA Anda.
- Neraca tetap seimbang; saldo Kas & Bank hanya berubah karena transaksi QA yang Anda catat.
- Tidak ada dokumen ganda dari dobel-tap atau jaringan putus.

Laporkan hasil per nomor (lulus / gagal + tangkapan layar). Temuan gagal akan diperbaiki sebelum Wave 2.
