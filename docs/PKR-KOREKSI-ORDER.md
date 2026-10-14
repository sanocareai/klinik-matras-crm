# Koreksi Order Penjualan Karyawan (PKR)

Fitur resmi untuk memperbaiki dan menambah order PKR **di semua tahap progres**. Dialog "Lengkapi spesifikasi order" bukan pengganti: ia hanya untuk data awal yang masih kosong.

## Kenapa "Koreksi Order" tidak muncul pada PKR-11102026-005

Dua lapis penyebab (diaudit di kode, bukan ditebak):

1. **Layar** — tombol "Koreksi item" hanya aktif bila `order.modeItem === true` (order punya daftar `pkr_order_items`). PKR-005 dibuat lewat jalur lama: baris catatan `(nama, jumlah, harga)` + order satu-spesifikasi, tanpa `pkr_order_items`. Satu-satunya aksi yang tersisa hanyalah "Lengkapi spesifikasi order".
2. **Server** — `hitungKoreksi` menolak order lama (`KOREKSI_ORDER_LAMA`), dan koreksi baris menolak baris catatan lama (`fulfillment IS NULL`) walau hanya mengubah harga. Jadi bukan sekadar tombol tersembunyi: jalurnya memang tidak ada.

Perbaikan: order lama dikoreksi **apa adanya** (spesifikasi, customer, alamat, harga). Untuk jumlah/tambahan, order dicatat dulu sebagai satu item "Pesanan awal (order lama)" — **ADOPSI**: unit yang ada hanya ditautkan, tidak diubah; tercatat di buku revisi; tanpa backfill otomatis.

## Dua jenis koreksi

| | PERBAIKAN (salah input) | TAMBAHAN (permintaan customer) |
|---|---|---|
| Pemakaian | Data di SANSS salah; pekerjaan fisik mengikuti data yang benar | Customer menambah produk/jumlah/layanan setelah order dibuat |
| Efek | Memperbarui data yang ada; tidak ada Unit/Order/Job/jurnal baru kecuali terdampak | Item + unit baru + baris Finance baru + jurnal delta; unit lama tidak disentuh |
| Revisi | `PEMBELI`, `ORDER_ADMIN`, `NILAI`, `DIKOREKSI` | `ADOPSI` (bila order lama) + `TAMBAHAN` |
| Tampilan | Riwayat Perubahan | Item bertanda "Tambahan pesanan" |

## Matriks progres (ditegakkan server)

| Kelompok | Produksi belum mulai | Produksi berjalan | Produksi selesai | Delivery terjadwal | Delivery berjalan/selesai |
|---|---|---|---|---|---|
| Customer, kontak, catatan | langsung | langsung | langsung | langsung | langsung (catatan) |
| Alamat, Maps, patokan, penerima | langsung (job sinkron) | langsung | langsung | job **yang sama** diperbarui | **terkunci** → Reschedule/Koreksi Delivery |
| Merk, ukuran, spesifikasi | langsung (unit sama, atomik) | **terkunci** → Tambahan | **administratif** (konfirmasi + snapshot) | idem tahap Produksi | idem |
| Jumlah, produk, kategori | boleh turun (naik = tambahan) | **terkunci** → Tambahan | **terkunci** → Tambahan | — | — |
| Harga dan nilai | koreksi nilai | koreksi nilai | koreksi nilai | koreksi nilai | koreksi nilai |
| Tambahan pesanan | boleh | boleh | boleh | boleh | boleh (job via aturan baku) |

Perbaikan administratif (Produksi selesai): wajib alasan + konfirmasi eksplisit; snapshot unit/spesifikasi lama disimpan di buku revisi; **tidak** mengubah BOM, pemakaian bahan, stok, milestone, PIC, atau jurnal.

## Koreksi nilai

Harga/jumlah tagihan tidak diedit sebagai teks: lewat `koreksi-baris` (dokumen koreksi). Total baru → jurnal penjualan lama **dibalik**, jurnal pengganti **diposting** (delta); Payment lama tidak diubah; Order CRM tetap Rp0; tidak ada invoice/pendapatan CRM; periode tertutup menjaga perubahan keuangan. Bila total baru < pembayaran: ditolak dengan `kelebihanBayar` + arahan **Koreksi Pembayaran / Refund resmi** — kas tidak dikeluarkan otomatis.

## API

| Rute | Fungsi |
|---|---|
| `GET  /api/finance/penjualan-karyawan/:id/koreksi-order` | Keadaan + matriks kemampuan (baca-saja) |
| `POST /api/finance/penjualan-karyawan/:id/koreksi-order/pratinjau` | Pratinjau dampak = terapkan di transaksi yang **dibatalkan** (fungsi hitung yang sama) |
| `POST /api/finance/penjualan-karyawan/:id/koreksi-order` | Terapkan. Wajib `Idempotency-Key`, `expectedRevision`, `alasan` ≥ 5 karakter |

Pengaman: izin `FINANCE_POST`; kunci baris PKR → order → unit; revisi optimistis (dua koreksi paralel: satu 201, satu 409); replay aman per kunci turunan; tidak ada penghapusan fisik OrderItem/Unit/Job/Payment/jurnal; semua atomik.

## Migrasi

`20261114090000_pkr_koreksi_order_jenis_revisi` — hanya melonggarkan CHECK `pkr_item_revisions_kind_chk` (tambah `ORDER_ADMIN`, `TAMBAHAN`, `ADOPSI`, `NILAI`). Aditif, tanpa backfill/UPDATE/DELETE. Rollback kode aman selama belum ada revisi jenis baru (lihat `scripts/rollback-guard-pkr-koreksi-order.sh`).

## Khusus Indra (PKR-11102026-005)

Produksi 3/3 selesai, Delivery terjadwal, order NEW-11102026-023, U1/U2/U3. Tetap tersedia: lengkapi/koreksi customer, HP, alamat (tersinkron ke job **yang sama**), Maps, penerima, keluhan, catatan; perbaikan spesifikasi sebagai **administratif** (snapshot lama tersimpan); tambahan customer = item/unit baru; harga = koreksi nilai. Koreksi hanya data non-keuangan: Payment/jurnal/saldo tidak berubah.
