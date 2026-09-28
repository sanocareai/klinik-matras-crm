# B3.8 — Koreksi Finance Lanjutan: Tagihan Supplier & Refund Disetujui

Finance → Supplier & Utang → Tagihan, dan Piutang & Refund → Refund: menu ⋯ pada dokumen yang **sudah disetujui** kini punya **Edit Informasi**, **Koreksi**, **Riwayat perubahan**, dan **Batalkan**. Kasbon dan Pembayaran Supplier punya tombol **Riwayat perubahan** (rantai siapa/kapan/alasan/jurnal).

## Prinsip
- **Administratif** (tanpa angka buku besar) → boleh diedit, tanpa jurnal, alasan wajib + audit sebelum/sesudah. Izin `finance:post`.
- **Finansial** → **tidak pernah overwrite**: dokumen lama DIBATALKAN (jejak tetap), jurnal lama DIBALIK pada tanggal aslinya, dokumen BARU (versi pengganti) langsung DISETUJUI + jurnal pengganti — satu transaksi database. Izin `finance:admin` + PIN Finance (step-up 5 menit). **Batalkan tetap tanpa PIN** (keputusan owner).
- Pratinjau (`preview:true`) menjalankan kode yang sama lalu ROLLBACK — tanpa PIN, tanpa menulis apa pun.

## Endpoint (`/api/finance/…`)
| Endpoint | Izin | Isi |
|---|---|---|
| `POST /bills/:id/info` | `finance:post` | `{ reason, supplierRef?, dueDate?, attachmentUrl? }` |
| `POST /bills/:id/koreksi` | `finance:admin` + PIN | `{ reason, supplierId?, billDate?, amount?, description?, expenseCategoryId?/purchaseCategoryId?, dueDate?, preview? }` |
| `POST /refunds/:id/info` | `finance:post` | `{ reason, alasanRefund?, attachmentUrl? }` |
| `POST /refunds/:id/koreksi` | `finance:admin` + PIN | `{ reason, amount?, date?, cashAccountId?, paymentMethod?/transferFeeType?/transferFeeAmount?, alasanRefund?, preview? }` |
| `GET /riwayat-versi/:jenis/:id` | `finance:read` | `jenis` = `bills`, `refunds`, `kasbon`, `supplier-payments`, …; untuk bills/refunds memuat `rantai` versi |
`GET /bills` dan `GET /refunds` mengembalikan `koreksi: { aktif, kode, alasan, arah }` per baris (dihitung server; UI hanya menampilkan).

## Blokir (kode → arah tindakan)
- **Tagihan**: `BELUM_DISETUJUI` (pakai Edit), `SUDAH_DIGANTI`/`SUDAH_DIBATALKAN`/`DITOLAK`, `ADA_PEMBAYARAN` (pembayaran supplier aktif → batalkan dulu), `JURNAL_TIDAK_ADA`, `SUDAH_DIREKONSILIASI`, `PERIODE_AKUNTANSI_TUTUP`. Jenis tagihan & penerimaan barang tidak bisa diubah (`JENIS_TIDAK_BISA_DIUBAH`, `PENERIMAAN_TIDAK_BISA_DIUBAH` → Batalkan & catat ulang; tagihan lama tanpa jenis boleh dilengkapi).
- **Refund**: sama, ditambah `PERIODE_REKON_SELESAI` (rekening asal/tujuan), `PENGAKUAN_PENDAPATAN_BERUBAH` (akun lawan jurnal lama ≠ yang berlaku sekarang → koreksi lewat Jurnal Umum), `MELEBIHI_UANG_DITERIMA`.
- Baris rekonsiliasi bank rekening terkait dikunci `FOR UPDATE` sebelum blokir dievaluasi (penyelesaian rekonsiliasi paralel tidak bisa menyelinap).
- Koreksi paralel/klik ganda: kunci baris dokumen + `UNIQUE(replaces_*_id)` → satu menang, satu `409 SUDAH_DIGANTI`. `Idempotency-Key` opsional (web mengirimnya untuk koreksi non-pratinjau).

## Data
Migrasi `20261003070000_finance_koreksi_tagihan_refund` — aditif: `fin_supplier_bills.replaces_bill_id` dan `fin_refunds.replaces_refund_id` (UUID nullable, UNIQUE, FK Restrict). Sengaja bernomor tepat sebelum migrasi P6 supaya tes urutan P6 ("P6 adalah migrasi terbaru") tetap benar.

## Gap yang diketahui
- Periode akuntansi tempat jurnal asli berada yang sudah ditutup memblokir koreksi (jurnal lama dibalik pada tanggal aslinya) — lewat Jurnal Umum resmi Admin.
- `Batalkan refund` (jalur lama, tanpa PIN) belum menyesuaikan Uang Muka↔Piutang bila pendapatan order sudah diakui setelah refund dibukukan — karena itu blokir `PENGAKUAN_PENDAPATAN_BERUBAH` sengaja mengarahkan ke Jurnal Umum, bukan Batalkan.
