# Order PKR multi-item — kategori, bundel, rute, koreksi, pengiriman

Berlaku untuk "Order untuk Produksi dan Delivery" pada **Penjualan Karyawan** (PKR). Satu PKR tetap satu Order CRM operasional (nilai 0, tanpa Payment/invoice/pendapatan/jurnal/OrderItem) dan memuat banyak **item produksi**.

## Pemetaan PKR → Order → item → unit → Delivery

| Lapisan | Perilaku |
|---|---|
| PKR (`fin_penjualan_karyawan`) | Satu-satunya sumber nominal, piutang, jurnal. Tidak disentuh oleh item/koreksi. |
| Order CRM | `Order.penjualanKaryawanId` UNIQUE. Kategori diturunkan dari item: semua BARU → `BARU`, semua LAYANAN → `LAYANAN`, campuran → **`CAMPURAN`** (nomor `MIX-…`). |
| Item (`pkr_order_items`) | Snapshot kategori/produk, jumlah, P×L×T/tinggi, spesifikasi, dikirim/diambil. Dihapus lunak (`removed_at`), nomor tak dipakai ulang. Cerminan di `Order.notes.pkrItems`. |
| Bundel | `Set Kasur Lengkap` dipecah saat order dibuat menjadi komponen Kasur, Divan, Sandaran (komposisi `pkr_bundle_components`, diatur Admin). Komponen = item biasa dengan `bundle_no`. |
| Unit | Satu unit per item × jumlah. Tiap unit **distempel** `work_category`, `product_line`, `product_type` (units.*): rute Produksi dihitung per unit; NULL = ikut order (semua unit lama). |
| Delivery | Menunggu **seluruh** unit yang dikirim `READY_FOR_DELIVERY`, lalu membuat **satu** job. Tidak ada job kedua otomatis. Pengiriman sebagian hanya lewat aksi eksplisit. |

Order lama (tanpa baris `pkr_order_items`) tetap terbaca lewat *item virtual*; tidak ada backfill.

## Aturan penting

- **Kategori/rute efektif per unit**: gunakan `lib/domain/unitKategori.js` (`kategoriUnit`, `produkUnit`, `statusOrderEfektif`, `unitKategoriIn`). Jangan membaca `order.category` langsung untuk keputusan Produksi.
- **Kelengkapan per item** (kontekstual per kategori): item yang belum lengkap tidak menahan unit milik item lain; gerbang jadwal/mulai Produksi fail-closed per unit (`pkrProduksiGuard`).
- **Pemetaan rute wajib**: produk BARU butuh jenis produk (lini + jenis → alur kasur/non-kasur), LAYANAN butuh layanan produksi; produk menimpa kategori. Tanpa pemetaan, pratinjau **dan** pembuatan diblokir (`RUTE_PRODUK_BELUM_DIPETAKAN` / `RUTE_LAYANAN_BELUM_DIPETAKAN`) dengan arah tindakan untuk Admin.
- **Katalog**: izin `pkr_catalog:manage` (ADMIN/OWNER) — bukan `production_settings:write`. Peran biasa hanya membaca/memilih.

## Koreksi Item (`POST /finance/penjualan-karyawan/:id/koreksi-item[/pratinjau]`)

Tambah/hapus item, ubah jumlah/ukuran/spesifikasi/dikirim-diambil **sebelum unit dijadwalkan/diproses** (per item). Wajib: alasan (≥5), `expectedRevision`, `Idempotency-Key` (428 bila hilang); pratinjau dampak memakai fungsi hitung yang sama dengan penerapan; atomik; audit sebelum/sesudah di `pkr_item_revisions` (append-only, trigger DB; unik `(order, revision)`). Unit yang sudah dijadwalkan/diproses/diambil → 409 `ITEM_TERKUNCI` dengan arahan pembatalan resmi.

## Pengiriman sebagian (`/api/armada/pkr-pengiriman/:orderId/kirim-sebagian`)

Pilih unit siap, alasan (≥5), `Idempotency-Key`; ditolak bila unit sudah di job pengiriman (`UNIT_SUDAH_DI_JOB`) atau belum siap. Tercatat di `pkr_pengiriman_sebagian` + riwayat aktivitas.

## Rilis & rollback

`scripts/release-pkr-multi-item.sh` (fail-closed, 3 migrasi aditif dipin + pemindai DDL + rehearsal pada restore) dan `scripts/rollback-guard-pkr-multi-item.sh`. Kode lama gagal membaca enum `CAMPURAN` — rollback hanya aman bila belum ada item/order CAMPURAN/revisi/pengiriman sebagian.
