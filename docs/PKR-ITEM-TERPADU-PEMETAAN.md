# Item Penjualan & Pemenuhan terpadu — peta tabel, sumber nilai, dan invarian (Okt 2026)

Dokumen audit untuk rilis `feat/pkr-item-penjualan-pemenuhan`. Satu baris item penjualan adalah **sumber kanonis** harga dan pekerjaan; semua yang lain turunan atau cermin.
Kode tes yang mengunci tiap invarian ada di bagian 7.

## 1. Prinsip

1. **Satu baris, dua pembaca.** `fin_penjualan_karyawan_items` memuat harga *dan* spesifikasi pekerjaan. Finance membaca harga; Order CRM/Produksi/Delivery membaca spesifikasi.
2. **Uang hanya di Finance.** Tidak ada kolom uang di tabel operasional (item order, unit, job, pengiriman sebagian). Order CRM PKR selalu `value = 0`.
3. **Tidak ada dokumen uang kedua.** Tidak ada `Payment`, `Invoice`, `OrderItem` (harga CRM), pengakuan pendapatan, atau jurnal operasional dari order PKR.
4. **Hanya harga yang boleh berubah setelah diproses.** Jumlah/ukuran/spesifikasi/dikirim/hapus diblokir begitu unit mulai diproses (`ITEM_TERKUNCI`).
5. **Data lama tidak disentuh.** Migrasi aditif, kolom baru `NULL` = "data lama"; tidak ada backfill.

## 2. Peta tabel → kolom → peran

| Tabel | Kolom | Peran | Sumber nilai | Dibaca oleh |
|---|---|---|---|---|
| `fin_penjualan_karyawan_items` | `quantity`, `unit_price` | **KANONIS uang** | input Finance (catat / Koreksi baris) | Finance (UI, jurnal, laporan) |
| | `name`, `fulfillment`, `category_id/code/name`, `product_id`, `perlu_dikirim`, `length/width/thickness/height_cm`, `spec_notes` | **KANONIS pekerjaan** | input Finance (baris yang sama) | Finance; disalin ke item operasional |
| `fin_penjualan_karyawan` | `total` | turunan | Σ `quantity × unit_price` baris (dihitung server saat catat & koreksi) | Finance |
| `fin_journal_entries/lines` | sumber `PENJUALAN_KARYAWAN` (kunci `PENJUALAN_KARYAWAN:<id>[:v<n>]`) | turunan | `total` (Dr Piutang Karyawan / Cr Pendapatan Penjualan Karyawan) | Finance |
| `Order` (CRM) | `value` | **selalu 0** | tidak ada nilai uang; `category` CAMPURAN/BARU/LAYANAN diturunkan dari item | CRM, Produksi, Delivery |
| | `notes.pkrItems`, `notes.pkrNonProduksi` | cermin operasional | cermin item aktif & item stok/tanpa operasional **tanpa harga** | CRM (baca), Produksi |
| `pkr_order_items` | `sale_item_id`, `component_seq`, `component_qty` | tautan | satu komponen per baris (Set → 1..n) | Produksi, Delivery |
| | `qty`, `product_name`, `bundle_name`, dimensi, `perlu_dikirim`, `fulfillment` | cermin (diverifikasi trigger) | `qty = quantity × component_qty`; nama = nama baris | Produksi, Delivery |
| `units`, `pkr_order_item_units` | `work_category/product_line/product_type`, tautan unit↔item | turunan | kategori/rute efektif per item | Produksi, Delivery |
| `jobs`, `job_units` | job DELIVERY/PICKUP | turunan | unit siap & `perlu_dikirim`; satu job gabungan | Delivery |
| `pkr_item_revisions` | `before_items/after_items/impact` (operasional) | audit operasional **tanpa uang** | diff item | Produksi/CRM (baca) |
| | `finance_before/finance_after` | audit Finance | nama/jumlah/harga/total sebelum–sesudah | **hanya endpoint Finance** |
| `pkr_pengiriman_sebagian` | alasan, unit | audit | aksi kirim sebagian | Delivery |

Kolom uang pada tabel operasional: tidak ada (satu-satunya yang cocok pola nama uang adalah `jobs.external_courier_cost`, biaya kurir eksternal yang sudah ada sebelum fitur ini; dikunci eksplisit di tes peta nilai).

## 3. Siapa menghitung apa — tepat sekali

| Besaran | Dihitung di | Berapa kali | Catatan |
|---|---|---|---|
| Total PKR | `penjualanKaryawanTerpadu.js` / `penjualanKaryawanKoreksiBaris.js` dari baris yang sama | sekali per transaksi | `fin_penjualan_karyawan.total` = Σ baris (dites SQL) |
| Piutang | jurnal `PENJUALAN_KARYAWAN` | **satu** jurnal berlaku per PKR | koreksi nilai = jurnal asli **dibalik** + jurnal pengganti `:v<n>` (net = total) |
| Nilai Order CRM | tidak dihitung | – | `value = 0`; tidak ada `OrderItem` |
| Jumlah unit | `quantity × Σ component_qty` per baris | sekali (lahirkan) / diselaraskan atomik (koreksi) | dijaga trigger DB |
| Set Kasur | satu harga induk di satu baris | – | komponen Kasur/Divan/Sandaran tidak punya nilai penjualan; tidak ada baris anak |
| Pengakuan pendapatan | `postRevenueRecognition` melewati order PKR (`reason: penjualan_karyawan`) | 0 | pendapatan sudah diakui jurnal PKR |

## 4. Alur

- **Catat**: satu `POST` → baris Finance + jurnal + (bila ada pekerjaan) Order CRM `value=0` + item operasional + unit, satu transaksi. Idempotency-Key: replay = satu PKR; isi beda dengan kunci sama = 422.
- **Koreksi baris** (`POST …/koreksi-baris`): Finance + item operasional + unit + jurnal (balik+ganti) dalam **satu** transaksi; `expectedRevision` optimistis, `Idempotency-Key` wajib, alasan wajib; pratinjau memakai fungsi hitung yang sama dan tidak menulis. Satu penulis menang bila paralel.
- **Cara pemenuhan tidak bisa diubah di tempat**: hapus item lalu tambah item baru dalam satu permintaan (atomik).
- **Batal PKR**: jurnal aktif dibalik (net piutang 0), order/unit dibatalkan lewat jalur baku.

## 5. Siapa melihat harga

Harga dan total hanya di endpoint Finance yang dijaga izin Finance/Admin/Owner. Produksi, Gudang, Delivery, CRM/Sales tidak menerimanya di API mana pun:
sapuan 577 URL GET × 8 peran non-Finance (Production Lead/Worker, QC Lead, Warehouse, Dispatcher, Driver, Helper, Sales) pada data berharga unik tidak menemukan satu pun kemunculan angka harga/total;
export Finance (seluruh modul registri) menolak peran operasional (401/403). Ledger revisi menyimpan uang **hanya** di `finance_*`.

## 6. Penjaga

- **DB**: 7 CHECK bernama (pemenuhan valid; baris lama polos; pekerjaan butuh kategori; stok tidak "dikirim"; dimensi > 0; tautan butuh komponen), unik `(sale_item_id, component_seq)`, trigger **tertunda ke akhir transaksi** yang menolak jumlah/nama item operasional menyimpang dari baris penjualan, trigger `BEFORE DELETE` yang menolak menghapus baris yang masih punya item aktif.
- **Aplikasi**: input ganda ditolak (`INPUT_GANDA`), pemenuhan wajib (`PEMENUHAN_WAJIB`), pintu CRM lama (pembayaran, invoice, status bayar, item/harga, batal langsung) menolak order PKR.
- **Progres Produksi** yang mengunci jumlah/ukuran/hapus: status unit bukan `AWAITING_PICKUP/RECEIVED`, `currentStageId` terisi, ada `unit_stage_logs`, atau ada Run V2 tak dibatalkan.

## 7. Tes pengunci

| Invarian | Berkas / tes |
|---|---|
| Satu daftar → total, 1 jurnal, order nilai 0, item+unit dari baris yang sama; tanpa Payment/invoice/OrderItem | `pkrItemTerpadu`: "terpadu: satu daftar item" |
| Input ganda ditolak; jalur lama tanpa kolom kanonis | `pkrItemTerpadu`: "input ganda ditolak" |
| Set = satu harga induk, tiga komponen | `pkrItemTerpadu`: "Set Kasur Lengkap"; `pkrItemInvarian`: "Set Kasur" |
| Pemenuhan wajib & tidak menebak; stok/tanpa operasional tanpa unit/job | `pkrItemTerpadu`: "pemenuhan wajib"; `pkrItemInvarian`: "item stok & tanpa operasional" |
| Harga tidak keluar (endpoint terpilih; ledger revisi) | `pkrItemTerpadu`: "harga hanya untuk Finance/Admin" |
| **Peta nilai: tak ada kolom uang di tabel operasional** | `pkrItemInvarian`: "peta nilai" |
| **Satu sumber: Σ baris = total = jurnal; unit = jumlah × komponen; notes tanpa harga; setelah ubah/tambah/hapus** | `pkrItemInvarian`: "satu sumber nilai" |
| **Tanpa Payment/invoice/pendapatan/jurnal kedua sampai DELIVERED + pintu CRM lama menolak** | `pkrItemInvarian`: "tidak ada Payment/invoice" |
| **Matriks progres (6 pemicu) × (jumlah/ukuran/hapus/kirim) diblokir; harga boleh** | `pkrItemInvarian`: "matriks progres" |
| **Pemenuhan tidak bisa diubah di tempat; hapus+tambah atomik** | `pkrItemInvarian`: "pemenuhan/kategori tidak bisa diubah" |
| Koreksi atomik (satu bagian gagal = tidak ada yang berubah); revisi optimistis; replay/paralel | `pkrItemTerpadu`: "koreksi baris" (4 tes: atomik, tambah/hapus, revisi optimistis, lapis layanan), "pembuatan: Idempotency-Key"; **`pkrItemInvarian`: "replay & paralel" (kunci sama bersamaan)** |
| **Sapuan kebocoran 577 URL × 8 peran + export Finance menolak peran operasional** | `pkrItemInvarian`: "sapuan kebocoran" |
| Penjaga DB (jumlah/nama menyimpang, hapus baris dipakai) | `pkrItemTerpadu`: "penjaga DB" + rehearsal skrip rilis |
| Data lama terbaca; tanpa backfill | `pkrItemTerpadu`: "data lama tetap terbaca" + skrip rilis (kolom baru NULL) |

## 8. Rilis & rollback

Skrip `scripts/release-pkr-item-penjualan-pemenuhan.sh` (fail-closed): allowlist berkas eksplisit, pin sha256 migrasi, pemindai DDL + 29 mutan negatif, backup nyata + restore, rehearsal (migrasi di DB hasil restore, uji perilaku 14 penolakan/5 lolos dibatalkan semua, sidik jari 21 tabel lama identik), smoke baca-saja.
Rollback kode **ditolak** (`scripts/rollback-guard-pkr-item-penjualan-pemenuhan.sh`, exit 1) begitu baris penjualan terpadu, item bertaut, atau revisi bersisi Finance sudah ada.
