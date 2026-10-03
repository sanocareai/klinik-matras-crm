# Runbook — Gudang

**Tujuan:** menerima unit, menyerahkan bahan, menangani bahan kurang, menerima retur sisa, dan menerima barang jadi.
**Skenario latihan:** S1 (unit tiba) · S4 Bahan kurang · S7 Retur sisa · S5 (barang jadi).

## 0. Masuk & layar utama
1. Email + password dari pelatih → workspace **Warehouse & Inventory Control**.
2. Menu **Antrean Gudang** (`/warehouse/antrean-produksi`) — satu layar "yang perlu ditangani hari ini". Tab: **Semua · Unit Masuk · Bahan · Kekurangan · Retur Sisa · Barang Jadi**.
3. Menu terkait: **Penerimaan Unit** (konfirmasi unit tiba), **Pengambilan Bahan Produksi** (serah bahan — stok berkurang di sini), **Barang Rusak & Retur**.

## 1. Unit tiba (S1)
Tab **Unit Masuk** → unit **QA-PV2-U21** → **Periksa & Terima** (membuka menu **Penerimaan Unit**) → periksa kondisi → pilih **lokasi penerimaan** → terima. Setelah itu unit siap dikerjakan.
> Hanya **Gudang** yang bisa menerima di Penerimaan Unit. Production Lead / Operator juga punya tombol *Unit Tiba di Workshop* di Status Produksi — Owner/Admin tidak.

## 2. Serahkan bahan (S4/S1)
Tab **Bahan**: daftar permintaan bahan dari rencana (sudah **direservasi**). Serahkan lewat **Pengambilan Bahan Produksi** → *Pick*. Stok berkurang saat diserahkan. Saldo negatif ditolak sistem.

## 3. Bahan kurang (S4)
1. Unit **U26** memakai **Busa Langka** (stok sengaja 1, butuh 4). Reservasi **gagal** dengan pesan kekurangan bahan jelas.
2. Operator menekan *Menunggu Bahan Baku* → muncul di tab **Kekurangan** (merah, dengan nama bahan & qty).
3. Tambah stok lewat menu **Penerimaan Barang** (qty + catatan). Jangan "mengubah" stok tanpa dokumen.
4. Reservasi ulang → **serahkan bahan** (Pengambilan Bahan Produksi) → di tab **Kekurangan** tekan **Tandai Sudah Diserahkan**. Tanpa langkah terakhir ini Operator **tetap tertahan** (*Unit menunggu bahan baku dari Gudang*).
5. Beri tahu Operator Meja: tombolnya berubah menjadi **Lanjutkan Pekerjaan**, lalu **Lanjutkan**.
> **Bahan tambahan** untuk rework (S5): diminta Production Lead; serahkan dengan cara yang sama dan catat unitnya.

## 3b. Retur sisa (S7)
1. Unit **U29**: tahap 12 selesai, **Barang Jadi** menampilkan *"Terima retur sisa bahan (tab Retur Sisa) dulu."* — barang jadi **tertahan**.
2. Tab **Retur Sisa** → kartu retur → isi **jumlah diterima**. Jika berbeda dari yang dilaporkan → **catatan selisih wajib**.
3. Simpan. Setelah retur diterima, tab **Barang Jadi** → **Terima Barang Jadi** (pilih lokasi barang jadi).

## 4. Barang jadi
Tab **Barang Jadi** → periksa kondisi → terima ke lokasi barang jadi. Bila ada masalah → tolak dengan alasan; Production Lead menentukan tindak lanjut.

## 5. Larangan
- Jangan menerima barang jadi sebelum retur sisa selesai (sistem menahan).
- Jangan menyerahkan bahan di luar permintaan/rencana unit.
- Jangan menyesuaikan stok untuk "menutup" kekurangan tanpa penerimaan.

## 6. Bila ada pesan ini
| Pesan | Lakukan |
|---|---|
| *Stok tidak cukup: kode (butuh X, tersedia Y)* | Terima barang / minta Purchasing; jangan paksa |
| *Revisi berubah* | Muat ulang → ulangi |
| *Catatan selisih wajib* | Isi alasan selisih retur |
