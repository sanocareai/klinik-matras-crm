# UX Gudang Tahap 2 — Pengeluaran Material, Transfer Stok, Stock Opname, Restok, Barang Rusak & Retur

Branch `feat/gudang-ux-tahap2` (dari baseline live `bcf8b770`, UX Tahap 1). **Belum dideploy.** Tanpa migrasi, tanpa perubahan skema, tanpa perubahan dependensi.
Persetujuan rilis Tahap 1 tidak berlaku untuk Tahap 2.

## Cakupan per menu

| Menu | Bentuk |
|---|---|
| Pengeluaran Material | Halaman detail + daftar. Ubah isi Draf, tarik kembali / kembalikan untuk revisi, dampak stok, ketersediaan, buat ulang tertaut, jalur koreksi. |
| Transfer Stok | Halaman detail + daftar. Ubah isi Draf, kembalikan untuk revisi, kirim → terima, **selisih**: penyebab wajib, perjalanan saldo, penyelesaian. |
| Stock Opname | Halaman detail + daftar (menggantikan drawer). Aturan pemisahan tugas dan tanda pergerakan sesi tidak diubah; hanya dijelaskan dan aksi disaring sesuai hak akun. |
| Restok | Halaman detail + daftar. Saran restok jujur (cakupan batas minimum). Tautan penerimaan hanya untuk penerimaan yang memuat bahan. Restok tidak pernah menulis stok. |
| Barang Rusak · Retur · Penyesuaian | Halaman detail + daftar per sub-tab. Pilihan penyelesaian memuat dampak stoknya; Setujui hanya untuk penyetuju yang bukan pemohon. |

Pola bersama: server mengirim `tampilan` (label, tahap, pengaruh stok, penjelasan, aksi), `izin`, `jejak`; layar hanya menampilkan. Komponen: `AksiDokumen` (panel inline dengan ringkasan dampak), `KartuDokumen`, `DaftarSederhana`, `JejakDokumen`, `KartuJalurKoreksi`.

## Keputusan produk yang diterapkan

1. **Draf boleh diubah** (bahan, jumlah, catatan; transfer juga lokasi): `PUT .../isi` dalam satu transaksi — kunci dokumen, cek revisi, validasi ulang (bahan ada/aktif, aturan unit/perlengkapan, lokasi), ganti baris, catat jejak, hitung ulang ketersediaan. Stok kurang tidak memblokir Draf (diperingatkan); pencadangan baru terjadi saat disetujui.
2. **Tarik kembali / kembalikan untuk revisi** (`POST .../kembalikan`): Menunggu persetujuan, Disetujui, Siap diambil, Sudah diambil (MI) / Sudah diambil (ST) → Draf **selama belum dikeluarkan/dikirim**. Persetujuan lama gugur (approvedBy/At dikosongkan; tetap di riwayat), pencadangan stok dilepas (dihitung dari status). Dokumen yang sudah memengaruhi stok (Dikeluarkan, Dalam perjalanan, Selesai) tidak bisa dikembalikan.
3. **Tanpa penyetuju kedua untuk transaksi rutin.** Aturan izin lama dipertahankan: siapa pun berizin tulis Gudang boleh menyetujui MI/ST, termasuk pembuatnya. Halaman menyatakannya (panel Setujui: "Anda juga pemohon…; belum ada penyetuju kedua untuk transaksi rutin") dan `izin.pemohonSama` tersedia. Pemohon ≠ penyetuju tetap berlaku untuk Penyesuaian Stok, Koreksi Gudang, dan selisih Opname.
4. **Saldo per lokasi** tetap pekerjaan desain data tersendiri; layar menyatakan lokasi hanya catatan.
5. **Batas minimum**: diisi petugas berwenang lewat Ubah Item di Stok & Lokasi (izin tulis Gudang); kosong = "belum diatur", tanpa angka buatan. Restok menjelaskan cakupannya dan menautkan ke pengaturan.

## Retry, konflik, dan satu kali efek
- `ulang:true` hanya untuk **pengulangan yang sama dan hasilnya sesuai**: issue/receive dibandingkan jumlah per baris dengan yang sudah dibukukan (receive 9 lalu 10 = **409 KONFLIK_PAYLOAD**, tanpa efek); cancel dibandingkan alasan; PATCH status hanya bila status sudah berlaku dan tidak ada perubahan lain; ubah isi hanya bila isi sama.
- **Revisi** (`updatedAt`, dikirim sebagai `revisi`): aksi ubah/maju/batal/kembalikan dari tampilan basi → **409 REVISI_BASI**; halaman dimuat ulang dan pesan tetap terlihat. Ubah isi mewajibkan revisi.
- Izin tetap diperiksa lebih dulu (hanya-lihat = 403 pada semua jalur, termasuk retry). Semua jalur memakai kunci baris dokumen (`lockRowForUpdate`); diuji paralel: receive berbeda serentak → satu menang, receive/issue sama serentak → satu efek, penyelesaian selisih serentak → satu menang, kembalikan vs setujui serentak → konsisten.

## Selisih transfer (dispatch → receive)
Aturan lama tidak diubah: kirim mengurangi saldo sebesar jumlah dikirim, terima menambah sebesar jumlah diterima, sehingga kekurangan sudah hilang dari saldo total. Yang ditambahkan:
- **Penyebab wajib** saat jumlah diterima ≠ dikirim (kurang maupun lebih); tercatat di riwayat.
- Kartu **Perjalanan saldo**: saldo sebelum kirim → dalam perjalanan (−dikirim) → sesudah terima (+diterima, +ditemukan) → saldo sekarang. Sebelum kirim dihitung dari ledger sebelum pergerakan kirim.
- Kartu **Selisih**: dikirim, diterima, kurang, sisa belum diselesaikan, riwayat penyelesaian. Transfer berlabel "Selesai — ada selisih belum diselesaikan" (juga di daftar).
- **Selesaikan selisih** (`POST .../selisih`, kunci permintaan idempoten): **Ditemukan** → satu pergerakan TRANSFER positif di tujuan; **Susut/hilang/rusak** → pengakuan tercatat tanpa pergerakan stok. Jumlah ≤ sisa; bertahap boleh. Tersimpan sebagai peristiwa aktivitas (tanpa skema).
- **Bukan pemakaian produksi**: tidak ada ISSUE, tidak ada unit, tidak ada HPP/jurnal; diuji. Kelebihan diterima tidak membuka aksi (koreksi lewat jalur resmi).
- Keterbatasan: kerugian susut/hilang **belum dijurnal otomatis** (keputusan Finance); Barang Rusak → Dibuang **tidak** dipakai untuk selisih karena akan mengurangi saldo dua kali.

## Perubahan kontrak API
Retry `issue`/`dispatch`/`receive`/`cancel` yang sama → 200 + `ulang:true` (dulu 400) tanpa menulis ulang; payload berbeda → 409. Tiga tes lama disesuaikan (`documentFlows`, `biayaBahanKonkurensi`, `biayaBahanUnit`). Receive berselisih tanpa `alasanSelisih` → 400. Endpoint baru: `POST/PUT` ubah isi, kembalikan, selisih, buat-ulang; GET Opname/Restok/Rusak/Retur/Penyesuaian menambah `tampilan`/`izin`/`jejak`.

## Perbaikan cacat yang ditemukan
- Filter tahap daftar Penerimaan (Tahap 1, **sudah live**) tidak berfungsi di tab workspace: `setSearchParams` tidak sampai ke halaman (lokasi virtual). Diganti `useTahapFilter` + `replaceActivePath`; diverifikasi di tab workspace nyata (termasuk muat ulang).
- Pesan konflik hilang bila dokumen sudah selesai (komponen aksi ikut hilang) — kini tetap terlihat.
- `updatedAt` tidak naik pada perubahan baris saja → diset eksplisit (token revisi).

## Pekerjaan masih terbuka
Belum diuji di perangkat fisik; `GoodsReceiptDetailDrawer.jsx` belum dihapus; kerugian susut/hilang belum dijurnal; saldo per lokasi; skrip rilis Tahap 2 belum dibuat (berhenti sebelum deploy).

## Pengujian
Backend integrasi `gudangUxTahap2`, `gudangUxTahap2Revisi`, `gudangUxTahap2Lain`; frontend `gudangUxTahap2.test.js`; QA browser `pp/flows3.mjs` (MI/ST) dan `pp/flows4.mjs` (perilaku baru) di 1440 px dan 390 px dengan DB terisolasi. Screenshot: `C:\tmp\km-gudang-iso\qa\t2\` dan `qa\t2b\`.
