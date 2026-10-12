# Navigasi Finance — 10 hub & layar Piutang & Refund (Okt 2026)

Restrukturisasi **navigasi dan entry point** saja. Tidak ada tabel/data bisnis yang digabung, tidak ada rumus/jurnal/saldo/status Payment/paidAt yang berubah, tidak ada migrasi.

## Sidebar → hub

Sumber tunggal: `frontend/src/lib/financeHubs.js` (`FINANCE_HUBS`). Tiap tab hub = **rute lama** (`path` + `?tab=` bila halamannya punya tab internal), jadi deep-link, refresh, Back/Forward, tab dalam-app, dan izin tidak berubah. Bilah tab hub dirender `features/finance/FinanceHubFrame.jsx` di atas halaman (dipasang di `routes/pageRegistry.jsx` untuk semua `/finance/*`).

| Hub (sidebar) | Tab → rute lama |
|---|---|
| Ringkasan | `/finance/dashboard` |
| Penjualan & Piutang | Uang Masuk `/finance/pemasukan` · Verifikasi `/finance/payments` · Invoice Pelanggan `/finance/invoices` · Piutang & Refund `/finance/receivables` · Rekonsiliasi Sales–Finance `/finance/payments?tab=lunas_crm` |
| Pengeluaran & Biaya | Pengeluaran `/finance/expenses` · Pengajuan Biaya Divisi `/finance/pengajuan-divisi` (ADMIN/OWNER/FINANCE/APPROVER) |
| Pembelian & Supplier | Purchase Order `/finance/purchase-orders` · Pembelian/Faktur `/finance/purchases` · Supplier & Utang `/finance/suppliers` · Jadwal & Aging `/finance/suppliers?tab=aging` · Retur & Debit Note `/finance/retur-supplier` |
| Kas & Bank | Saldo Rekening `/finance/cash?tab=rekening` · Mutasi Buku `/finance/cash?tab=mutasi` · Rekonsiliasi Bank `/finance/reconciliation` |
| Transaksi Karyawan | Penjualan Karyawan `/finance/penjualan-karyawan` · Kasbon `/finance/kasbon` · Uang Muka Operasional `/finance/uang-muka` |
| Persediaan & HPP | Biaya Bahan per Unit `/finance/biaya-bahan` · Persediaan Awal & Tutup Stok `/finance/persediaan-awal` |
| Pembukuan | Jurnal Umum `/finance/journal` · Buku Besar `/finance/ledger` · Bagan Akun `/finance/accounts` |
| Laporan | Laporan Keuangan `/finance/reports` · Laporan Divisi `/finance/laporan-divisi` |
| Pengaturan | Pengaturan Finance `/finance/settings` · Pengecualian Tanggal Lunas `/finance/pengecualian-lunas` |

Halaman dengan tab internal (`/finance/cash`, `/finance/suppliers`, `/finance/payments`, `/finance/receivables`) kini mengikat tabnya ke `?tab=` (`lib/useUrlTab.js`); tanpa `?tab=` perilaku lama (tab bawaan) tetap.

**Badge pekerjaan** memakai angka antrean yang sudah ada di `GET /finance/dashboard → antrean` (`lib/financeAntrean.js`): Verifikasi (pembayaran belum diverifikasi), Piutang & Refund (refund menunggu), Pengeluaran, Pembelian/Faktur, Supplier & Utang (tagihan menunggu). Badge hub = penjumlahan hitungan antrean item-nya; tidak ada angka keuangan baru.

## Piutang & Refund

Layout: header ringkas (periode = posisi, bantuan "Bagaimana angka ini dihitung?", Export, Ajukan Refund) → empat kartu → strip diagnosis → tab sticky (Daftar Piutang · Jatuh Tempo · Perlu Tindakan · Refund · Diagnosis & Penjelasan, terikat `?tab=`) → filter sticky → daftar.

Kontrak server (aditif, tanpa mengubah field/angka lama):

- `GET /finance/reports/receivables`: baris + `tagihanDiakui`, `sudahDilunasi`, `statusBayar`, `tanggalOrder`; respons + `jatuhTempo: { lewat, tujuhHari }` (`lewat` = `hariLewat > 0`; `tujuhHari` = jatuh tempo hari ini s.d. 7 hari ke depan, relatif ke tanggal posisi).
- `GET /finance/reports/receivables/diagnosis`: + `perluTindakan { jumlah, perSumber }`.
- `GET /finance/reports/receivables/order/:orderId` (baru, finance:read): invoice, pembayaran, jurnal akun Piutang Usaha, riwayat — untuk drawer.

Posisi bawaan layar = **hari ini (WIB)**; periode dapat diganti (parameter `to`). Export mengikuti posisi + filter aktif dan menyebut tab/scope di label berkas.
