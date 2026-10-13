# Migrasi format lama Penjualan Karyawan (PKR) → format terpadu — desain aditif

Status: **DESAIN, belum diimplementasi** (13 Okt 2026). Tidak ada perubahan skema dan tidak ada perintah migrasi di rilis ini. Dokumen ini menjawab:
"bila perlu migrasi format, buat desain aditif dan jalur migrasi eksplisit, jangan menebak."

## 1. Keadaan sekarang (data produksi, baca-saja, 13 Okt 2026)

| Format | Arti | Jumlah PKR aktif | Ber-pembayaran |
|---|---|---|---|
| `TERPADU` | Baris penjualan memuat pemenuhan (kategori/produk, ukuran, spesifikasi, dikirim/diambil) | 0 | – |
| `LAMA_ORDER_ITEM` | Order punya daftar item produksi, tetapi baris penjualan tanpa data pemenuhan | 0 | – |
| `LAMA_TANPA_ITEM` | Satu baris penjualan + satu spesifikasi untuk seluruh unit (mis. PKR-11102026-005: 1 baris × 3, 3 unit) | **2** | 2 |
| tanpa order CRM | Dicatat sebelum sinkronisasi order | 18 | 2 |

Seluruh data nyata saat ini berformat lama atau belum punya order. Jalur terpadu (koreksi jumlah/harga per baris) baru teruji di tes, belum di data nyata.

## 2. Apa yang terkunci di format lama dan kenapa

* **Jumlah unit dan harga per baris**: `koreksi-baris` membutuhkan `fin_penjualan_karyawan_items.fulfillment` terisi untuk tahu baris itu melahirkan unit apa.
  Pada format lama jumlah unit adalah isian tersendiri saat order dibuat (`jumlahUnit`), **tidak diturunkan dari qty baris** — hubungan baris ↔ unit tidak tercatat dan
  tidak boleh ditebak (satu PKR bisa memuat "Kasur ×3" dan "Bantal ×2"; hanya yang pertama melahirkan unit).
* **Tambah/hapus item**: format lama tidak punya daftar item.
* Yang **bisa** dikoreksi (rilis ini, `POST /:id/koreksi-order`): alamat, kota, tanggal kirim, catatan permintaan customer, serta merk/ukuran/dikirim-diambil (format lama).
  Setelah produksi berjalan field berisiko dikunci server dengan alasan; setelah pengiriman berjalan alamat/kota/tanggal dikunci.
* Semua batasan itu ditampilkan di layar (menu "Koreksi data order & batasan") dari satu sumber: `GET /:id/kemampuan-koreksi`.

## 3. Prinsip migrasi

1. **Aditif**: tidak ada tabel/kolom baru yang dibutuhkan. Kolom pemenuhan di `fin_penjualan_karyawan_items` (`category_id`, `product_id`, `fulfillment`, `perlu_dikirim`,
   `length_cm`…) dan tabel `pkr_order_items` sudah ada dan nullable; migrasi hanya **mengisi** yang kosong.
2. **Tidak menyentuh uang**: `quantity`, `unit_price`, `name`, `total`, jurnal, dan pembayaran tidak berubah. Tidak ada jurnal baru. Bukti: sidik jari tabel uang identik sebelum/sesudah.
3. **Tidak menebak**: pemetaan baris penjualan → kategori/produk katalog → unit dipilih **eksplisit oleh Finance** per dokumen; sistem hanya mengusulkan nilai dari data yang ada
   (merk/ukuran unit, catatan order) dan menandainya "usulan".
4. **Per dokumen, bukan massal**: tidak ada backfill otomatis. Dua kandidat nyata dikerjakan satu per satu.
5. **Atomik, idempoten, optimistis**: satu transaksi; `expectedRevision` (token yang sama dengan koreksi lain); `Idempotency-Key`; kunci baris PKR → order → unit.

## 4. Jalur migrasi eksplisit (rancangan perintah)

`POST /api/finance/penjualan-karyawan/:id/migrasi-format/pratinjau` dan `POST …/migrasi-format` (izin `finance:post`; alasan wajib ≥ 5 karakter).

Masukan, per baris penjualan lama:

```json
{
  "expectedRevision": 0,
  "baris": [
    { "barisId": "<fin_penjualan_karyawan_items.id>", "pemenuhan": "PRODUKSI_BARU", "kategoriId": "<pkr_item_categories.id>", "produkId": null,
      "perluDikirim": true, "panjang": 200, "lebar": 120, "tebal": null, "tinggi": null, "spesifikasi": "…",
      "unitIds": ["<unit U1>", "<unit U2>", "<unit U3>"] }
  ]
}
```

Pemeriksaan server (pratinjau memakai fungsi yang sama dengan penerapan, tanpa menulis):

* PKR `AKTIF`, order ada, format `LAMA_TANPA_ITEM`/`LAMA_ORDER_ITEM`; belum pernah dimigrasi.
* Setiap unit aktif order **habis terpetakan tepat satu kali**; jumlah unit terpetakan = `quantity × komponen` baris (jika baris menghasilkan unit). Baris yang bukan produksi
  (`AMBIL_STOK`, `TANPA_OPERASIONAL`) tidak punya unit.
* Kategori/produk aktif di katalog; rute produksi unit **tidak berubah** (migrasi tidak mengganti rute, `productLine`/`productType` unit dibiarkan; selisih dengan katalog hanya diperingatkan).
* Boleh dilakukan walau produksi berjalan (metadata murni), **kecuali** ada koreksi paralel (revisi berubah) atau order dibatalkan.

Efek (satu transaksi):

1. `UPDATE fin_penjualan_karyawan_items` — hanya kolom pemenuhan yang `NULL` (guard: tidak menimpa nilai tak-NULL).
2. `INSERT pkr_order_items` + tautan unit (item operasional untuk unit yang SUDAH ada; tidak ada unit baru).
3. Cerminan `Order.notes.pkrItems` dari tabel (satu sumber).
4. Buku revisi `pkr_item_revisions` (`kind='DIKOREKSI'`, `impact.jenis='MIGRASI_FORMAT'`, before/after) + audit di PKR dan Order.

Trigger penjaga yang sudah ada (jumlah/nama baris penjualan = item operasional; `pkr_order_items_tautan_chk`) menjadi pengaman terakhir.

## 5. Rollout dan rollback

* **Rehearsal**: skrip rilis memulihkan backup ke DB sementara, menjalankan migrasi pada dua kandidat, dan membandingkan sidik jari tabel uang (identik) serta jumlah unit/job/jurnal.
* **Rollback**: migrasi tidak destruktif — nilai sebelum tersimpan di buku revisi. Pembalikan hanya diizinkan bila belum ada koreksi lanjutan (revisi terakhir = revisi migrasi);
  selain itu jalur resmi tetap batalkan + catat ulang.
* **Tanpa migrasi**: seluruh fungsi rilis ini tetap bekerja untuk format lama (koreksi data order, pembatalan, tampilan batasan).

## 6. Keputusan Owner yang dibutuhkan sebelum implementasi

1. Apakah dua PKR lama ber-DP itu perlu dimigrasi, atau cukup dibiarkan (data order sudah benar) dan hanya diperbaiki lewat batalkan + catat ulang bila ada kesalahan?
2. Siapa yang memilih kategori/produk katalog untuk dokumen lama (Finance atau Kepala Produksi)?
3. Bila qty baris ≠ jumlah unit pada dokumen lama: apakah selisih dianggap salah catat (dikoreksi) atau memang berbeda (mis. baris non-produksi)?

## 7. Yang sengaja TIDAK dirancang

* Backfill massal otomatis atau migrasi tanpa pilihan Finance.
* Mengubah qty/harga baris lama lewat jalur terpadu tanpa pemetaan (akan membuat jurnal dan unit menyimpang dari data nyata).
* Mengubah jumlah unit format lama secara terpisah dari nilai penjualan (membuat Order dan uang tidak lagi sepadan tanpa terlihat).
