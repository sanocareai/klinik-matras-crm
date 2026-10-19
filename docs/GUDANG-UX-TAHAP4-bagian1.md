# UX Gudang Tahap 4 — Pusat Kerja Harian dan Penanganan Masalah

Branch `feat/gudang-ux-tahap4` (di atas Tahap 3 live `58cbc284`). **Belum deploy.** Tidak ada migrasi, tidak ada perubahan skema, tidak ada perubahan akuntansi. Semua endpoint baru **baca-saja**.

## 1. Audit UX saat ini (sebelum Tahap 4)

| Area | Keadaan sebelum | Masalah bagi petugas |
|---|---|---|
| Beranda Gudang | 5 kartu tugas dari `GET /inventory/beranda` (jumlah + 3 contoh, tautan ke daftar). | Tidak menjawab "dokumen mana, mengapa, tindakan apa, siapa berikutnya"; hanya 5 dari ±12 jenis pekerjaan; tidak ada selesai-terbaru, tidak ada pemisahan terlambat/tertahan; satu klik = pindah halaman daftar. |
| Detail dokumen | Penerimaan = jendela fokus (Tahap 3), PO = jendela lokal di Barang Akan Datang. **Pengeluaran Material, Transfer, Stock Opname, Restok, Barang Rusak, Retur, Penyesuaian = halaman terpisah** (`/…/:id`, tautan "Kembali"). Koreksi Gudang = akordeon di tab. Retur Supplier = Modal bersama Finance. | Tiga pola berbeda; membuka dokumen menghilangkan daftar (filter/gulir) dan riwayat Back tidak konsisten. |
| Masalah | Tidak ada tempat berisi masalah nyata: stok negatif, saldo belum diketahui, bahan belum dikelompokkan, batas minimum belum diatur, penerimaan tertahan, selisih transfer, dsb. tersebar di halaman masing-masing. | Petugas harus mencari sendiri; tidak jelas siapa pemilik tindakan dan seberapa luas dampaknya. |
| Pencarian | Hanya pencarian per daftar. | Tidak bisa mencari nomor GR/PO/MI/transfer/Stock Count/Koreksi dari satu tempat. |
| Komponen mati / tumpang tindih | `pages/Gudang.jsx` (563 baris, command center lama) tidak lagi diimpor siapa pun; `KoreksiDokumenTab` mode akordeon; rute detail terpisah. | Beban perawatan; lihat bagian 8. |
| Mobile | Detail halaman penuh, bilah aksi ikut bergulir. | Aksi utama tidak selalu terjangkau. |

**Volume data production (baca-saja, `SELECT` count dengan `default_transaction_read_only=on`, 19 Okt 2026):** goods_receipts 13 (COMPLETED 10, DRAFT 1, SCHEDULED 1, READY_FOR_PUTAWAY 1); stock_counts 1 (COMPLETED); material_issues, stock_transfers, warehouse_corrections, penyesuaian, restok, barang rusak, retur, retur supplier = 0; materials aktif 358 (nonaktif 15). Artinya produksi saat ini kecil — rancangan berbasis **kartu** dengan **pagination server (8 pertama + "Tampilkan lagi" 20 per halaman)** dipilih agar tetap benar pada 100+ dokumen (diuji, lihat bagian 6), bukan karena beban hari ini.

**Bentrok scope:** tidak menyentuh berkas Produksi/Delivery sesi lain (`feat/status-lintas-workspace`, 77 berkas Produksi/Delivery); satu-satunya titik temu adalah pembacaan antrean Produksi V2 yang hanya aktif bila `resolveProductionReaderState` ≠ OFF (inert di production). Tidak menyentuh pembersihan disk VPS (tidak ada operasi VPS selain baca).

## 2. Matriks antrean → alasan → aksi → pemilik

Setiap kartu memuat: nomor dokumen, supplier/unit/bahan terkait, umur (sejak dokumen terakhir diubah — **bukan SLA**), status, **alasan muncul** (teks dari server), **satu tindakan utama** (hanya bila pengguna berizin dan sah untuk status saat ini), **pemilik tindakan** dan **pemilik berikutnya**. Definisi tertulis ikut di respons (`definisi`) dan tampil di tombol "Definisi antrean ini".

| Antrean | Alasan muncul (contoh) | Tindakan utama (kode) | Pemilik → berikutnya |
|---|---|---|---|
| Dijadwalkan datang | "Draf belum dijadwalkan" / "Dijadwalkan datang <tgl>" / "Jadwal <tgl> sudah lewat N hari…" | Jadwalkan kedatangan (`JADWALKAN`) · Catat barang tiba (`CATAT_TIBA`/`TANDAI_TIBA`) | Gudang → Gudang |
| Barang tiba — perlu diperiksa | "Barang sudah tercatat tiba…" / "Pemeriksaan belum lengkap: N dari M item…" (+ "Pemeriksaan sebelumnya dibatalkan — hasil baru wajib") | Periksa barang / Lengkapi hasil pemeriksaan / Nyatakan siap masuk stok (`MAJUKAN`, `ISI_PEMERIKSAAN`) | Gudang → Gudang |
| Siap masuk stok | "Hasil pemeriksaan lengkap; stok bertambah saat Simpan ke Stok" / "…tidak ada jumlah baik — akan ditolak" | Simpan ke stok (`SIMPAN_KE_STOK`) | Gudang → Finance (bila ber-PO) |
| Permintaan bahan | status + "Dibutuhkan <tgl> (lewat N hari)" + kekurangan saldo per bahan | Setujui / Siapkan / Serahkan / Konfirmasi keluar | Gudang → Gudang (Produksi bila sumber produksi) |
| Transfer stok | status + selisih terbuka | Setujui / Tandai diambil / Kirim / Terima / Selesaikan selisih | Gudang |
| Stock Count | "Terjadwal <tgl>" / "Sedang dihitung" / "Menunggu tinjauan selisih" | Mulai hitung / Serahkan hitungan / Tinjau & selesaikan | Gudang; tinjauan: penyetuju ≠ penghitung |
| Koreksi & penyesuaian menunggu | "Menunggu keputusan penyetuju" / "Anda pemohon; keputusan harus dari penyetuju lain" | Putuskan / Posting — **hanya untuk penyetuju** | Owner/Finance; bagi non-penyetuju masuk "Menunggu workspace lain" |
| Restok, barang rusak, retur | status masing-masing | Setujui, Tandai dipesan, Periksa, Selesaikan, Terima | Gudang / penyetuju |
| Retur Supplier | "Draf — barang belum keluar" / "Barang sudah keluar; debit note belum dibuat" | Konfirmasi barang keluar | Gudang → Finance |
| Produksi V2 (bahan, unit masuk, barang jadi, kekurangan, sisa bahan) | dari antrean Gudang Produksi V2 | dibuka di Antrean Produksi (aksi inline di sana) | Gudang → Produksi/Delivery — **hanya dihitung bila pembaca V2 aktif; inert di production** |

### Definisi per antrean (sumber tabel, masuk, keluar, siapa boleh bertindak, dihitung per dokumen atau baris)

