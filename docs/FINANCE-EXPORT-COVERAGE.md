# Matriks Coverage Export Excel — seluruh halaman & tab Finance (29 Sep 2026)

Sumber kebenaran: kode (`frontend/src/pages/finance/*.jsx`, `backend/src/services/finance/export/*.js`). Dikunci tes `frontend/tests/financeExportCoverage.test.js` (setiap halaman Finance harus punya tombol export ATAU tercantum sebagai "tidak diekspor" beserta alasannya) dan tes integrasi `backend/tests/integration/financeExport*.integration.test.js` (paritas berkas ↔ endpoint layar).

Mode filter: **Server** = layar mengirim filter/periode ke endpoint daftar, export menjalankan fungsi baca yang sama tanpa batas baris layar. **Klien** = layar menyaring di JS (pencarian/chip) → tombol mengirim `ids` baris yang tampil (urutan layar), server memuat ulang lewat fungsi baca yang sama. Semua modul: izin `finance:read`, tanpa login 401, tanpa izin 403; kolom sensitif hanya `finance:admin`.

## A. Halaman yang diekspor (11 modul yang diminta Owner + `rekon-sales-finance`)

| Halaman / tab | Modul (`:modul`) | Endpoint layar (satu sumber query) | Filter & periode | Total layar → total export | Kolom sensitif (hanya admin) |
|---|---|---|---|---|---|
| **Pemasukan** — Pendapatan Diakui, Uang Masuk, Pemasukan Lain, Dana Masuk Bukan Pendapatan, Data Sebelum Sistem, Perlu Verifikasi (daftar pembayaran) | `pemasukan` | `GET /finance/pemasukan` (`pemasukanTersaring`) | Server: kategori(tab), q, pihak, rekening, status, statusBayar + periode | "total nilai" di FilterBar → baris TOTAL sheet Pemasukan (tanpa Dikecualikan/Ditolak/Dibatalkan) + sheet Rekap Klasifikasi | — (tidak ada catatan internal di read-model) |
| Pemasukan — tab **Ringkasan** | `pemasukan` | idem (semua kategori) | Server: periode | Kartu ringkasan → sheet Rekap Klasifikasi | — |
| **Pembayaran & Verifikasi** — Perlu Verifikasi, Terverifikasi, Dibatalkan, Semua | `pembayaran` | `GET /finance/customer-payments` (`customerPaymentRead`) | Server: periode + tab(status). Server: periode + tab(status) + saringan layar (pencarian, cara bayar, status, dibagi, foto bukti, rekening) dikirim sebagai PARAMETER dan disaring `saringPembayaran` (dibuktikan identik dengan layar oleh tes paritas); `ids` hanya dari klien lama. Tab **Perlu Verifikasi** = antrean gabungan: sheet Ringkasan, Payment Menunggu, Klaim Lunas Sales (berbukti + klaim lama, satu baris per order), Definisi Angka (`antreanVerifikasi`) | Kartu "Total Uang Masuk / Menunggu / Terverifikasi" → sheet Ringkasan; baris TOTAL = pembayaran aktif | tautan foto bukti, no. referensi, catatan, catatan internal, alasan pembatalan |
| Pembayaran — tab **Klaim Lunas dari Sales** | `pembayaran` (sheet Klaim Lunas Sales) | `GET /finance/penerimaan/lunas-belum-dicatat` | Klien: pencarian/filter → `klaimIds`; sheet memuat klaim berbukti (menunggu / bukti diminta) + klaim lama | Total "perlu dicek" → baris TOTAL sheet | — |
| Pembayaran — kartu **Kenapa angka Finance dan Sales berbeda?** | `rekon-sales-finance` | `GET /sales-finance/rekon` (`rekonSalesFinance`) — payload yang sama dengan kartu, drill-down, dan panel Rekonsiliasi Laporan Sales | Server: periode | `kartuSelisih` → sheet Ringkasan; `detail` → sheet Rincian Order; jembatan dua tahap → sheet Jembatan | — |
| **Pengeluaran** — semua tab status | `pengeluaran` | `GET /finance/expenses` (`expenseRead`) | Server: periode, status, q, kategori, divisi, mode, rekening, bukti | `total` respons → sheet Ringkasan + baris TOTAL | alasan penolakan, catatan internal, tautan foto nota |
| **Pembelian** — semua tab status | `pembelian` | `GET /finance/purchases` (`purchaseRead`, termasuk indikator DP/Sisa) | Server: sama dengan Pengeluaran | `total` respons → baris TOTAL | — |
| **Kasbon** — Aktif, Lunas, Dibatalkan, Semua | `kasbon` | `GET /finance/kasbon` (`kasbonRead`) | Server: status, q, karyawan, periode | Kartu (sisa/bulan ini) dihitung dari SEMUA kasbon aktif (bukan yang disaring); baris TOTAL export = baris yang disaring (sama dengan tabel) | alasan pembatalan, catatan internal |
| **Uang Muka Operasional** — Saldo Aktif, Pertanggungjawaban, Pengembalian, Riwayat | `uang-muka` | `GET /finance/uang-muka(+/riwayat)` (`uangMukaRead`) + `expenseRead` | `filter.tab` mengikuti tab aktif (tanpa tab = semua sheet); `ids` bila ada baris terpilih | 4 kartu kepala halaman → sheet Ringkasan | alasan pembatalan, tautan bukti, catatan internal |
| **Piutang & Refund** — Piutang (ember umur) & Refund | `piutang-refund` | `GET /finance/reports/receivables` (`umurPiutang`) + `GET /finance/refunds` (`refundRead`) | Klien: ember, sales, umur, acuan, pencarian, status → `piutangIds`/`refundIds` | Kartu ember umur → sheet Ringkasan Umur; baris TOTAL per sheet | alasan penolakan/pembatalan, tautan lampiran |
| **Supplier & Utang** — Tagihan, Pembayaran, Master Supplier | `supplier-utang` | `GET /finance/bills`, `/supplier-payments`, `/suppliers`, `/reports/payables` (`supplierRead`) | `filter.tab` mengikuti tab; server: status, supplierId, jatuh tempo, periode; klien: pencarian → `ids` | Kartu Total Utang / Lewat Tempo / Menunggu / Penerimaan Belum Ditagih → sheet Ringkasan + Umur Utang | alasan penolakan/pembatalan, tautan lampiran, no. referensi, catatan internal, no. rekening & atas nama supplier |
| **Rekonsiliasi** — daftar periode + periode yang dibuka | `rekonsiliasi` | `GET /finance/bank-statements(+/:id)` (`bankStatementRead`) | Server: rekening; klien: pencarian → `ids`; `statementId`, `lineIds`, `fokus` mengikuti periode/tampilan aktif | Kartu Detail Periode (saldo buku/bank/selisih/belum cocok) → sheet Detail Periode + total Mutasi | catatan internal, catatan/alasan abaikan, catatan tinjauan. Keterangan & referensi mutasi bank SENGAJA tidak sensitif (data inti kerja Finance) |
| **Jurnal Umum** | `jurnal-umum` | `GET /finance/journal` (`jurnalRead`) | Server: sumber, status, pencarian + periode | Total Debit = Total Kredit → baris TOTAL | alasan pembalikan (+ bagian sesudah " — " pada keterangan jurnal balik dipotong untuk non-admin) |
| **Buku Besar** (per akun) | `buku-besar` | `GET /finance/reports/ledger/:accountId` (`bukuBesar`) | Server: akun + periode; klien: pencarian/sumber/jenis/status → `ids` | Saldo awal, total debit/kredit, saldo akhir → baris TOTAL + sheet Ringkasan | (alasan pembalikan pada keterangan dipotong untuk non-admin) |

## A2. Export lewat endpoint sendiri — Laporan Divisi (Fase 2)

| Halaman / tab | Endpoint | Isi | Parity |
|---|---|---|---|
| **Laporan Divisi** (Finance: semua divisi) dan **Laporan Biaya** di workspace Delivery/Produksi/Gudang/Marketing/Management/HR-GA — tab Ringkasan, Kategori, Tren Bulanan, Transaksi, Komitmen, Anggaran, atau Semua | `POST /api/laporan-divisi/export` (`laporan-divisi`; `dataExportLaporan` memanggil `bangunLaporan` yang SAMA dengan layar) | Satu sheet per tab + sheet Definisi Angka; kepala berisi periode (WIB), divisi, filter aktif, basis tanggal; angka numerik, baris TOTAL, pesan "Tidak ada data sesuai periode dan filter." bila kosong | Izin & isolasi divisi ditegakkan `muatAkses` (sama dengan layar); data sensitif disaring untuk non-Finance; tes paritas `laporanDivisi.integration.test.js` |

## B. Halaman yang TIDAK diekspor (keputusan + alasan)

| Halaman / tab | Perlu export? | Alasan |
|---|---|---|
| **Dashboard Finance** | Tidak | Hanya kartu KPI/grafik, tidak ada tabel transaksi. |
| **Kas & Bank → Mutasi Rekening** (per rekening: PT Sano, KEM, Uang Kas) | **Ya** — modul `mutasi-rekening` (tombol di tab, features/finance/MutasiRekening.jsx) | Saldo awal, tiap uang masuk/keluar dengan saldo berjalan, saldo akhir; filter pencarian ikut; peringatan data lama tercantum di catatan sheet. |
| **Kas & Bank** — Rekening; Mutasi Antar Rekening; Pemasukan Lain | Tidak (di luar 11 modul) | Pemasukan Lain sudah tercakup export Pemasukan; mutasi & saldo rekening tercakup Buku Besar akun kas/bank + Jurnal Umum (sumber transfer kas) + Rekonsiliasi. Bisa dibuat bila Owner minta. |
| **Faktur** | Tidak (di luar 11 modul) | Dokumen tagihan pelanggan; nilai/saldonya tercakup Piutang & Refund dan Pembayaran & Verifikasi. |
| **Persediaan Awal (cutover)** | Tidak (di luar 11 modul) | Alur input/pemeriksaan snapshot (Tempel CSV); bukan laporan transaksi. Usul lanjutan: template hitung fisik. |
| **Laporan Keuangan** — Laba Rugi, Neraca, Arus Kas, Neraca Saldo | Tidak (di luar 11 modul) | Laporan terhitung; angka pokoknya dapat ditelusuri dari Buku Besar & Jurnal Umum. Usul lanjutan bila Owner butuh Excel laporan. |
| **Bagan Akun**, **Pengaturan Finance** | Tidak | Data master/konfigurasi, bukan transaksi. |
| **Pengecualian Tanggal Lunas** (keputusan Owner, 2 Okt 2026) | Tidak (di luar 11 modul) | Daftar riwayat keputusan Owner yang kecil; setiap perubahan juga tercatat di Aktivitas order. Export dibuat bila Owner minta. |
| **Penjualan Karyawan** (input manual di luar Order, 2 Okt 2026) | Tidak (di luar 11 modul) | Modul baru. Jurnalnya (sumber Penjualan Karyawan / Pembayaran Penjualan Karyawan) tercakup Jurnal Umum & Buku Besar; pendapatannya tercakup export Pemasukan (Pemasukan Lain · Penjualan karyawan). Export khusus bisa dibuat bila Owner minta. |

## C. Gap yang ditutup pada finalisasi ini
1. Pemasukan → tab **Ringkasan** tidak punya tombol export (tab lain sudah) — ditambahkan; memuat seluruh pemasukan periode + Rekap Klasifikasi.
2. Tes tata-kelola `financeExportCoverage.test.js` mencegah halaman Finance baru lupa diklasifikasikan.

Tidak ada gap lain yang nyata di dalam 11 modul: tiap tab di tabel A punya tombol atau tercakup sheet pada modul yang sama.
