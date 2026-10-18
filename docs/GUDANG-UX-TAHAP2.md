# UX Gudang Tahap 2 — Pengeluaran Material & Transfer Stok (+ label Opname, Restok, Rusak & Retur)

Branch `feat/gudang-ux-tahap2` (dari baseline live `bcf8b770`, UX Tahap 1). **Belum dideploy.** Tanpa migrasi, tanpa perubahan dependensi, tanpa perubahan skema.
Persetujuan rilis Tahap 1 tidak berlaku untuk Tahap 2.

## Cakupan per menu

| Menu | Status Tahap 2 |
|---|---|
| Pengeluaran Material | **Selesai (halaman detail + daftar baru).** Alur 6 langkah, dampak stok, ketersediaan per item, jumlah keluar, lokasi sumber, riwayat, jalur koreksi, buat ulang tertaut. |
| Transfer Stok | **Selesai (halaman detail + daftar baru).** Kirim (saldo dikurangi) → Terima (selisih terlihat), riwayat, jalur koreksi, buat ulang tertaut. |
| Stock Opname | Label tab berbahasa Indonesia saja. Drawer lama tetap (belum didesain ulang). |
| Restok | Label tab Indonesia; kartu "Saran restok" memuat cakupan batas minimum (daftar kosong tidak lagi terbaca sebagai "stok aman"). Drawer lama tetap. |
| Barang Rusak & Retur | Label tab Indonesia saja. Tab/drawer lama tetap. |

Perbaikan lintas menu: filter tahap daftar **Penerimaan Barang (Tahap 1, sudah live)** tidak berfungsi di tab workspace — `setSearchParams` hanya mengubah URL, sedangkan tiap tab dirender dengan lokasi virtual. Diganti hook `useTahapFilter` (state lokal + `replaceActivePath`); berlaku untuk tiga daftar.

## Pengeluaran Material (MI)

Server mengirim `tampilan` (kode, label, tahap, pengaruh stok, penjelasan, aksi), `izin.tulis`, `ketersediaan` per baris, dan `jejak`. Layar tidak menebak status.

| Status | Pengaruh stok | Aksi |
|---|---|---|
| Draf | Belum | Ajukan persetujuan · Ubah data · Batalkan |
| Menunggu persetujuan | Belum | Setujui · Ubah data · Batalkan |
| Disetujui | Dicadangkan | Siap diambil · Ubah data · Batalkan |
| Siap diambil | Dicadangkan | Tandai sudah diambil · Simpan lokasi sumber · Ubah data · Batalkan |
| Sudah diambil | Dicadangkan | **Konfirmasi keluar** (panel dampak stok; jumlah keluar per item) · Simpan lokasi · Ubah data · Batalkan |
| Dikeluarkan | **Sudah berkurang** | Tidak ada. Salah input → kartu jalur koreksi resmi |
| Dibatalkan | Tidak | Buat permintaan baru dari dokumen ini (tertaut, dokumen lama tidak diubah) |
| Dikelola Produksi V2 | — | Tidak ada (milik alur Produksi) |

## Transfer Stok (ST)

| Status | Pengaruh stok | Aksi |
|---|---|---|
| Draf | Belum | Ajukan · Ubah catatan · Batalkan |
| Menunggu persetujuan | Belum | Setujui · Ubah catatan · Batalkan |
| Disetujui | Belum | Tandai sudah diambil · Ubah catatan · Batalkan |
| Sudah diambil | Belum | **Kirim barang** (saldo dikurangi) · Ubah catatan · Batalkan |
| Dalam perjalanan | **Saldo sudah dikurangi** | **Terima barang** saja (tidak bisa dibatalkan) |
| Selesai | Sudah | Tidak ada. Selisih diterima vs dikirim tampil; koreksi lewat jalur resmi |
| Dibatalkan | Tidak | Buat transfer baru dari dokumen ini (tertaut) |

Selisih jumlah diterima dari jumlah dikirim **tidak masuk saldo** (aturan lama, tidak diubah); sekarang dijelaskan sebelum konfirmasi.

## Aturan bisnis yang TIDAK diubah
Jumlah item tidak bisa diubah setelah dibuat (batalkan lalu buat baru); transfer hanya catatan yang bisa diubah; transisi maju satu langkah; siapa pun dengan izin tulis Gudang boleh menyetujui; issue/dispatch/receive satu-satunya penulis ledger.

## Perubahan kontrak API (perlu dicatat)
Retry/klik ganda pada `issue`, `dispatch`, `receive`, `cancel`, dan PATCH status yang sudah berlaku kini mengembalikan **200 + `ulang:true`** tanpa menulis ulang (sebelumnya 400). Invarian stok/valuasi/jurnal tetap diuji. Tiga tes lama yang mengunci kode 400 disesuaikan (`documentFlows`, `biayaBahanKonkurensi`, `biayaBahanUnit`). Endpoint baru: `POST /material-issues/:id/buat-ulang`, `POST /transfers/:id/buat-ulang` (alasan 3–300 karakter, idempoten).

## Keputusan yang dibutuhkan sebelum diterapkan (TIDAK dikerjakan)
1. **Ubah jumlah di Draf** — saat ini harus batal lalu buat ulang (kini dipermudah lewat "Buat ulang"). Mengizinkan ubah jumlah di Draf = perubahan aturan bisnis.
2. **Tarik kembali ke Draf** dari Menunggu persetujuan / Disetujui (transisi mundur; melepas cadangan stok).
3. **Pemisahan pemohon ≠ penyetuju** (kini siapa pun berizin tulis boleh menyetujui dokumen yang ia buat sendiri).
4. **Saldo per lokasi** — sistem hanya menyimpan saldo total per bahan. Lokasi sumber/tujuan di MI/ST adalah catatan, dan layar menyatakan itu. Saldo per lokasi butuh rancangan data tersendiri (skema).
5. **Batas minimum bahan** — Restok tidak punya saran untuk bahan tanpa batas minimum; Owner perlu memutuskan siapa mengisi dan kapan.

## Pekerjaan masih terbuka
Opname, Restok (permintaan), Barang Rusak & Retur belum dibuatkan halaman detail/aksi/dampak seperti MI/ST; `GoodsReceiptDetailDrawer.jsx` belum dihapus; belum diuji di perangkat fisik; skrip rilis Tahap 2 belum dibuat (berhenti sebelum deploy).

## Pengujian
- Backend integrasi baru `gudangUxTahap2.integration.test.js` (9 tes): tampilan/aksi per status, izin hanya-lihat, ketersediaan, idempotensi, buat ulang, dampak ledger, V2 tanpa aksi, pemakai lain `createMaterialIssue`.
- Frontend `gudangUxTahap2.test.js` (12 tes).
- QA browser interaktif (`pp/flows3.mjs`, DB terisolasi, bukan dokumen production): **138/138** pemeriksaan di 1440 px dan 390 px — alur penuh MI & ST, salah input, koreksi/batal/buat ulang, hak akses, refresh setelah tiap aksi, klik ganda, saldo & pergerakan di DB, daftar (tab berhitung, pencarian, kartu HP), tautan lama `?buka=`.
- Screenshot sebelum/sesudah: `C:\tmp\km-gudang-iso\qa\t2\ba\` (24 berkas) dan alur: `C:\tmp\km-gudang-iso\qa\t2\`.
