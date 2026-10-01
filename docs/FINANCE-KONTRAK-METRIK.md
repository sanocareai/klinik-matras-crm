# Finance — Kontrak Metrik Kanonis (Fase 1)

> DIBANGUN OTOMATIS dari `backend/src/services/finance/kontrakMetrik.js` — jangan edit di sini. Ubah kontraknya lalu jalankan `node backend/scripts/finance-kontrak-doc.js`.

Zona waktu semua tanggal: WIB (UTC+7); database & API UTC.

## Basis tanggal

| Kunci | Arti | Sumber teknis |
|---|---|---|
| TGL_PEMBAYARAN | Tanggal pembayaran diterima | Payment.createdAt (WIB) |
| TGL_BUKU | Tanggal buku (jurnal) | FinJournalEntry.date |
| TGL_LUNAS | Tanggal order menjadi Lunas | Order.paidAt (WIB) |
| TGL_DOKUMEN | Tanggal dokumen | tanggal pada dokumen sumber |
| POSISI | Posisi per tanggal | saldo kumulatif sampai tanggal itu |

## Istilah yang harus dibedakan

| Istilah | Arti singkat | Metrik |
|---|---|---|
| Payment tercatat | Catatan pembayaran — belum tentu uang masuk. | `payment_tercatat` |
| Uang masuk terverifikasi | Payment yang sudah diverifikasi Finance. | `uang_masuk_terverifikasi` |
| Klaim Lunas | Pengajuan Sales, belum mengubah apa pun. | `klaim_lunas_menunggu` |
| Order Lunas terverifikasi | Status Lunas dari ledger (Payment terverifikasi ≥ tagihan). | `order_lunas_terverifikasi` |
| Pendapatan diakui | Omzet menurut jurnal (saat diserahkan), bukan uang. | `pendapatan_diakui` |
| Piutang | Pendapatan diakui yang belum dibayar. | `piutang_usaha` |
| Uang muka pelanggan | DP sebelum diserahkan — kewajiban. | `uang_muka_pelanggan` |
| Beban diakui | Biaya menurut jurnal, sudah dibayar atau belum. | `beban_diakui` |
| Uang keluar | Kas/Bank yang benar-benar berkurang. | `uang_keluar_kas` |
| Utang supplier | Tagihan disetujui yang belum dibayar. | `utang_supplier` |
| Persediaan / aset | Barang & aset bernilai — bukan beban sampai dipakai. | `persediaan_nilai` |
| Komitmen belum dibayar | Sudah disetujui, uang belum keluar. | `komitmen_belum_dibayar` |

## Uang & penjualan pelanggan

### Payment Tercatat (`payment_tercatat`)

Semua catatan pembayaran pelanggan yang pernah dibuat, apa pun statusnya. Ini BUKAN uang masuk pasti: sebagian masih menunggu verifikasi, ditolak, atau dibatalkan.

| | |
|---|---|
| Rumus | Σ Payment.amount (semua status) |
| Sumber | tabel payments |
| Status dihitung | menunggu, terverifikasi, ditolak, dibatalkan |
| Basis tanggal | Tanggal pembayaran diterima |
| Termasuk | Pembayaran yang belum diverifikasi Finance; Pembayaran yang kemudian dibatalkan |
| Tidak termasuk | Klaim Lunas yang belum menjadi Payment |
| Pasangan rekonsiliasi | Uang Masuk Terverifikasi; Klaim Lunas Menunggu Verifikasi |
| Tampil di | Pembayaran & Verifikasi |
| Export | pembayaran |

### Uang Masuk Terverifikasi (`uang_masuk_terverifikasi`)

Uang pelanggan yang SUDAH diverifikasi Finance, dihitung per tanggal pembayaran diterima. Ini angka uang (sisi Finance), belum tentu sama dengan omzet order yang lunas bulan itu.

| | |
|---|---|
| Rumus | Σ Payment.amount WHERE aktif (tidak dibatalkan) AND punya verifikasi, tanggal = Payment.createdAt WIB |
| Sumber | tabel payments + payment_verifications |
| Status dihitung | terverifikasi |
| Basis tanggal | Tanggal pembayaran diterima |
| Termasuk | DP, cicilan, dan pelunasan; Ongkir yang ikut dibayar; Pembayaran sebelum tanggal saldo awal (tidak menambah kas) |
| Tidak termasuk | Pembayaran menunggu/ditolak/dibatalkan; Klaim Lunas yang belum diverifikasi |
| Pasangan rekonsiliasi | Kas Masuk dari Pelanggan (Menurut Buku); Nilai Order yang Menjadi Lunas — Total Perusahaan; Payment Tercatat |
| Tampil di | Pembayaran & Verifikasi; Pemasukan (Uang Masuk); Rekonsiliasi Sales–Finance |
| Export | pembayaran, pemasukan, rekon-sales-finance |

### Kas Masuk dari Pelanggan (Menurut Buku) (`kas_masuk_pelanggan`)

Uang pelanggan yang benar-benar menambah saldo Kas/Bank di buku besar. Lebih kecil dari Uang Masuk Terverifikasi bila ada pembayaran sebelum tanggal saldo awal (sudah termasuk saldo bank asli).

| | |
|---|---|
| Rumus | Σ debit akun Kas/Bank pada jurnal sumber PEMBAYARAN_ORDER (POSTED) |
| Sumber | tabel fin_journal_entries/lines |
| Status dihitung | terposting |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Pembayaran setelah tanggal saldo awal yang sudah dibukukan |
| Tidak termasuk | Pembayaran sebelum saldo awal (dijurnal ke Laba Ditahan, kas tidak berubah); Pembayaran terverifikasi yang belum dibukukan (gap) |
| Pasangan rekonsiliasi | Uang Masuk Terverifikasi; Kas Masuk (Arus Kas) |
| Tampil di | Arus Kas; Jembatan Uang Masuk → Kas |
| Export | — |

### Klaim Lunas Menunggu Verifikasi (`klaim_lunas_menunggu`)

Pengajuan Sales bahwa order sudah dibayar. Klaim BELUM mengubah status, Payment, jurnal, atau saldo — baru berubah setelah Finance memverifikasi.

| | |
|---|---|
| Rumus | COUNT/Σ klaim berbukti status SUBMITTED + order berstatus Lunas lama tanpa Payment penuh |
| Sumber | tabel order_payment_claims + Order |
| Status dihitung | diajukan (menunggu), diminta bukti |
| Basis tanggal | Tanggal dokumen |
| Termasuk | Klaim berbukti baru dari Sales; Klaim lama (Lunas tanpa Payment, 'Bukti belum lengkap') |
| Tidak termasuk | Klaim yang sudah diverifikasi/ditolak/ditarik |
| Pasangan rekonsiliasi | Uang Masuk Terverifikasi; Order Lunas Terverifikasi |
| Tampil di | Dashboard; Pembayaran & Verifikasi (Klaim Lunas) |
| Export | pembayaran |

### Order Lunas Terverifikasi (`order_lunas_terverifikasi`)

Order yang statusnya Lunas karena Payment terverifikasi sudah mencapai tagihan (nilai order + ongkir yang ditagih). Status Lunas hanya dihasilkan sistem dari ledger setelah gerbang Klaim Lunas aktif.

| | |
|---|---|
| Rumus | Order.paymentStatus = LUNAS AND Σ Payment terverifikasi ≥ tagihan kanonis |
| Sumber | tabel Order + payments |
| Status dihitung | lunas |
| Basis tanggal | Tanggal order menjadi Lunas |
| Termasuk | Order tunggal dan child Resi (alokasi) |
| Tidak termasuk | Order berstatus Lunas tanpa Payment (klaim lama); Order batal/pending/spam |
| Pasangan rekonsiliasi | Nilai Order yang Menjadi Lunas — Total Perusahaan; Klaim Lunas Menunggu Verifikasi |
| Tampil di | Laporan Sales; Rekonsiliasi Sales–Finance |
| Export | rekon-sales-finance |

### Nilai Order yang Menjadi Lunas — Total Perusahaan (`nilai_order_lunas_perusahaan`)

Nilai penuh semua order yang mencapai lunas pada periode (basis tanggal lunas), termasuk yang tanpa Sales. Tidak selalu sama dengan uang masuk karena DP, ongkir, dan pembayaran lintas periode.

| | |
|---|---|
| Rumus | Σ Order.value WHERE paidAt di periode AND status bukan CANCELLED/PENDING AND pelanggan bukan SPAM |
| Sumber | tabel Order |
| Status dihitung | lunas |
| Basis tanggal | Tanggal order menjadi Lunas |
| Termasuk | Order tanpa atribusi Sales |
| Tidak termasuk | Ongkir (bukan nilai jasa); DP order yang belum lunas; Order batal/pending/spam |
| Pasangan rekonsiliasi | Uang Masuk Terverifikasi; Nilai Order yang Menjadi Lunas — Tim Sales |
| Tampil di | Rekonsiliasi Sales–Finance |
| Export | rekon-sales-finance |

### Pendapatan Diakui (`pendapatan_diakui`)

Omzet penjualan yang diakui di buku besar (saat order diserahkan), dikurangi retur & potongan. Bukan uang masuk: order bisa diakui sebelum dibayar (piutang) atau dibayar sebelum diakui (uang muka).

| | |
|---|---|
| Rumus | Σ kredit − debit akun pendapatan order (Layanan/Produk/Sewa/Ongkir) − Retur & Potongan |
| Sumber | jurnal PENGAKUAN_PENDAPATAN + pembalikan/refund/retur |
| Status dihitung | terposting |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Pengakuan pendapatan order; Ongkir yang diakui |
| Tidak termasuk | Uang masuk/DP (kewajiban sampai diserahkan); Pemasukan lain di luar order; Modal & pinjaman |
| Pasangan rekonsiliasi | Uang Masuk Terverifikasi; Piutang Usaha; Uang Muka Pelanggan |
| Tampil di | Dashboard; Pemasukan; Laporan Keuangan (Laba Rugi) |
| Export | pemasukan |

### Piutang Usaha (`piutang_usaha`)

Sisa tagihan pelanggan yang sudah diakui sebagai pendapatan tetapi belum dibayar, menurut saldo akun Piutang Usaha. Posisi per tanggal, bukan arus.

| | |
|---|---|
| Rumus | Σ debit − kredit akun Piutang Usaha sampai tanggal posisi |
| Sumber | jurnal akun 1-xxxx Piutang Usaha |
| Status dihitung | terposting |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Piutang order yang sudah diserahkan; Order berstatus Lunas yang masih menunggu verifikasi (ditampilkan terpisah) |
| Tidak termasuk | Order yang belum diakui pendapatannya; Uang muka pelanggan |
| Pasangan rekonsiliasi | Pendapatan Diakui; Uang Masuk Terverifikasi |
| Tampil di | Dashboard; Piutang & Refund; Pemasukan (Piutang masih tersisa); Neraca |
| Export | piutang-refund |

### Uang Muka Pelanggan (`uang_muka_pelanggan`)

DP/pembayaran yang diterima sebelum order diserahkan. Ini KEWAJIBAN (kita berutang barang/jasa), bukan pendapatan.

| | |
|---|---|
| Rumus | Σ kredit − debit akun Uang Muka Pelanggan sampai tanggal posisi |
| Sumber | jurnal akun Uang Muka Pelanggan |
| Status dihitung | terposting |
| Basis tanggal | Posisi per tanggal |
| Termasuk | DP sebelum penyerahan |
| Tidak termasuk | Pendapatan diakui |
| Pasangan rekonsiliasi | Pendapatan Diakui; Piutang Usaha |
| Tampil di | Neraca |
| Export | — |

### Refund Diberikan (`refund_diberikan`)

Uang yang dikembalikan ke pelanggan atas order tertentu. Mengurangi pendapatan/uang masuk bersih, tidak boleh melebihi uang yang pernah benar-benar masuk.

| | |
|---|---|
| Rumus | Σ FinRefund.amount status DISETUJUI |
| Sumber | tabel fin_refunds + jurnal refund |
| Status dihitung | disetujui (diposting) |
| Basis tanggal | Tanggal dokumen |
| Termasuk | Refund atas order lunas maupun yang kembali belum lunas |
| Tidak termasuk | Refund menunggu persetujuan/ditolak/dibatalkan |
| Pasangan rekonsiliasi | Uang Masuk Terverifikasi; Pendapatan Diakui |
| Tampil di | Piutang & Refund |
| Export | piutang-refund |

## Sales & komisi

### Nilai Order yang Menjadi Lunas — Tim Sales (`nilai_lunas_tim_sales`)

Angka kartu di Laporan Sales (dasar komisi): Total Perusahaan dikurangi order tanpa Sales, ditambah order yang dihitung untuk lebih dari satu Sales.

| | |
|---|---|
| Rumus | nilai_order_lunas_perusahaan − tanpa_atribusi_sales + dihitung_ganda |
| Sumber | tabel Order + atribusi (salesOwnerId / percakapan) |
| Status dihitung | lunas |
| Basis tanggal | Tanggal order menjadi Lunas |
| Termasuk | Sales aktif dan closing Team Lead |
| Tidak termasuk | Order tanpa Sales; Closing Admin/Owner selain Team Lead |
| Pasangan rekonsiliasi | Nilai Order yang Menjadi Lunas — Total Perusahaan; Tanpa Atribusi Sales |
| Tampil di | Laporan Sales; Rekonsiliasi Sales–Finance |
| Export | rekon-sales-finance |

### Tanpa Atribusi Sales (`tanpa_atribusi_sales`)

Order lunas yang tidak dimiliki Sales mana pun (order internal / pelanggan di luar percakapan Sales). Tetap masuk total perusahaan, tidak ditebak ke Sales.

| | |
|---|---|
| Rumus | Σ Order.value lunas periode yang tidak punya pemilik Sales |
| Sumber | tabel Order |
| Status dihitung | lunas |
| Basis tanggal | Tanggal order menjadi Lunas |
| Termasuk | Order internal/Owner |
| Tidak termasuk | Order yang pemilik Sales-nya jelas |
| Pasangan rekonsiliasi | Nilai Order yang Menjadi Lunas — Tim Sales |
| Tampil di | Rekonsiliasi Sales–Finance |
| Export | rekon-sales-finance |

## Biaya, pembelian & utang

### Pengeluaran (Aktif) (`pengeluaran_aktif`)

Biaya operasional yang masih berlaku: semua pengeluaran periode di luar yang Dibatalkan dan Ditolak. Satu pengeluaran dihitung sekali, baik sudah dibayar maupun belum.

| | |
|---|---|
| Rumus | Σ FinExpense.amount WHERE status ∉ {DIBATALKAN, DITOLAK} |
| Sumber | tabel fin_expenses |
| Status dihitung | draf, menunggu persetujuan, disetujui, dibayar |
| Basis tanggal | Tanggal dokumen |
| Termasuk | Pengeluaran langsung, reimbursement, dan yang memakai uang muka (pertanggungjawaban) |
| Tidak termasuk | Dibatalkan; Ditolak; Pembelian/aset dan tagihan supplier (modul terpisah) |
| Pasangan rekonsiliasi | Beban Diakui; Uang Keluar (Kas/Bank); Uang Muka Operasional (Saldo Aktif) |
| Tampil di | Pengeluaran |
| Export | pengeluaran |

### Pembelian (Aktif) (`pembelian_aktif`)

Pembelian bahan/aset tanpa tagihan resmi supplier yang masih berlaku (di luar Dibatalkan/Ditolak). Terpisah dari Pengeluaran supaya satu pembelian tidak dihitung dua kali.

| | |
|---|---|
| Rumus | Σ FinPurchase.amount WHERE status ∉ {DIBATALKAN, DITOLAK} |
| Sumber | tabel fin_purchases |
| Status dihitung | menunggu persetujuan, disetujui, dibayar |
| Basis tanggal | Tanggal dokumen |
| Termasuk | Bahan baku manual, aset tetap/tak berwujud, uang muka pembelian |
| Tidak termasuk | Dibatalkan; Ditolak; Tagihan supplier resmi (Supplier & Utang) |
| Pasangan rekonsiliasi | Utang Supplier; Pengeluaran (Aktif); Nilai Persediaan |
| Tampil di | Pembelian |
| Export | pembelian |

### Beban Diakui (`beban_diakui`)

Biaya yang diakui di Laba Rugi menurut jurnal (saat disetujui/diposting), terlepas sudah dibayar atau belum.

| | |
|---|---|
| Rumus | Σ debit − kredit akun beban dan HPP pada periode |
| Sumber | jurnal akun tipe BEBAN/BEBAN_POKOK |
| Status dihitung | terposting |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Beban dari pengeluaran, kendaraan, iklan, pemakaian bahan, insentif, admin bank |
| Tidak termasuk | Pembelian aset (menjadi aset/persediaan); Uang muka operasional sebelum dipertanggungjawabkan; Kasbon (piutang karyawan) |
| Pasangan rekonsiliasi | Pengeluaran (Aktif); Uang Keluar (Kas/Bank) |
| Tampil di | Dashboard; Laporan Keuangan |
| Export | — |

### Uang Keluar (Kas/Bank) (`uang_keluar_kas`)

Uang yang benar-benar keluar dari Kas/Bank menurut buku besar. Berbeda dari beban (yang bisa diakui sebelum dibayar) dan dari utang (yang dibayar kemudian).

| | |
|---|---|
| Rumus | Σ kredit akun Kas/Bank (kecuali transfer antar rekening) |
| Sumber | jurnal akun Kas/Bank |
| Status dihitung | terposting |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Pengeluaran langsung, pembelian, pembayaran supplier, kasbon, uang muka, refund, biaya admin transfer |
| Tidak termasuk | Transfer antar rekening sendiri; Pertanggungjawaban uang muka (kas sudah keluar saat uang muka diberikan) |
| Pasangan rekonsiliasi | Beban Diakui; Utang Supplier; Kas Keluar (Arus Kas) |
| Tampil di | Arus Kas; Kas & Bank |
| Export | — |

### Utang Supplier (`utang_supplier`)

Tagihan supplier yang sudah disetujui dan belum lunas dibayar. Posisi per tanggal. Pembayaran supplier MENGURANGI utang — bukan pengeluaran baru.

| | |
|---|---|
| Rumus | Σ FinSupplierBill disetujui − Σ alokasi pembayaran supplier aktif (= saldo akun Utang Usaha) |
| Sumber | tabel fin_supplier_bills + alokasi pembayaran |
| Status dihitung | disetujui, dibayar sebagian |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Tagihan dari penerimaan barang; Tagihan bahan/biaya supplier |
| Tidak termasuk | Tagihan menunggu persetujuan/ditolak/dibatalkan; Penerimaan barang yang belum ditagih (ditampilkan terpisah) |
| Pasangan rekonsiliasi | Pembelian (Aktif); Komitmen Belum Dibayar |
| Tampil di | Dashboard; Supplier & Utang |
| Export | supplier-utang |

### Komitmen Belum Dibayar (`komitmen_belum_dibayar`)

Biaya yang sudah disetujui tetapi uangnya belum keluar (pengeluaran/pembelian Disetujui-belum-dibayar, tagihan supplier terbuka). Belum mengurangi kas, sebagian sudah menjadi beban/utang.

| | |
|---|---|
| Rumus | Σ pengeluaran & pembelian status DISETUJUI (belum DIBAYAR) + utang_supplier |
| Sumber | tabel fin_expenses, fin_purchases, fin_supplier_bills |
| Status dihitung | disetujui belum dibayar |
| Basis tanggal | Tanggal dokumen |
| Termasuk | Reimbursement karyawan yang disetujui |
| Tidak termasuk | Yang sudah dibayar; Yang masih menunggu persetujuan (belum komitmen) |
| Pasangan rekonsiliasi | Utang Supplier; Uang Keluar (Kas/Bank) |
| Tampil di | Pengeluaran; Pembelian; Supplier & Utang |
| Export | — |

## Kas, bank & rekonsiliasi

### Kas & Bank (Menurut Buku) (`kas_bank_buku`)

Saldo seluruh rekening Kas/Bank menurut buku besar pada tanggal posisi. Dapat berbeda dari saldo di koran bank sampai direkonsiliasi.

| | |
|---|---|
| Rumus | Σ debit − kredit akun Kas/Bank sampai tanggal posisi |
| Sumber | jurnal akun Kas/Bank per rekening |
| Status dihitung | terposting |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Semua rekening aktif termasuk kas tunai |
| Tidak termasuk | Dana belum teridentifikasi (kewajiban sementara) |
| Pasangan rekonsiliasi | Saldo Menurut Bank (Koran); Saldo Akhir Kas (Arus Kas) |
| Tampil di | Dashboard; Kas & Bank |
| Export | buku-besar, jurnal-umum |

### Saldo Menurut Bank (Koran) (`saldo_bank_koran`)

Saldo menurut koran/mutasi bank pada periode rekonsiliasi. Selisihnya dengan buku harus dijelaskan oleh baris mutasi yang belum cocok.

| | |
|---|---|
| Rumus | saldo akhir koran yang diinput + selisih terbuka = saldo buku − saldo koran |
| Sumber | tabel fin_bank_statements/lines |
| Status dihitung | periode rekonsiliasi |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Mutasi yang sudah dicocokkan |
| Tidak termasuk | Mutasi yang diabaikan dengan alasan |
| Pasangan rekonsiliasi | Kas & Bank (Menurut Buku) |
| Tampil di | Rekonsiliasi |
| Export | rekonsiliasi |

### Kas Masuk (Arus Kas) (`arus_kas_masuk`)

Jumlah debit Kas/Bank pada jurnal periode di luar transfer antar rekening. Mencakup uang pelanggan DAN penyesuaian saldo awal, pembalikan, dan rekonsiliasi sementara — lihat rincian per sumber.

| | |
|---|---|
| Rumus | Σ debit Kas/Bank jurnal periode, kecuali sumber TRANSFER_KAS |
| Sumber | jurnal akun Kas/Bank |
| Status dihitung | terposting + dibalik |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Uang pelanggan; Pemasukan lain; Penyesuaian saldo awal (SALDO_AWAL); Jurnal pembalik (REVERSAL); Rekonsiliasi sementara |
| Tidak termasuk | Transfer antar rekening sendiri |
| Pasangan rekonsiliasi | Kas Masuk dari Pelanggan (Menurut Buku); Uang Masuk Terverifikasi |
| Tampil di | Laporan Keuangan (Arus Kas) |
| Export | — |

### Kas Keluar (Arus Kas) (`arus_kas_keluar`)

Jumlah kredit Kas/Bank pada jurnal periode di luar transfer antar rekening, termasuk jurnal pembalik dan penyesuaian saldo awal.

| | |
|---|---|
| Rumus | Σ kredit Kas/Bank jurnal periode, kecuali sumber TRANSFER_KAS |
| Sumber | jurnal akun Kas/Bank |
| Status dihitung | terposting + dibalik |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Pengeluaran, pembelian, supplier, kasbon, refund |
| Tidak termasuk | Transfer antar rekening sendiri |
| Pasangan rekonsiliasi | Uang Keluar (Kas/Bank) |
| Tampil di | Laporan Keuangan (Arus Kas) |
| Export | — |

### Saldo Akhir Kas (Arus Kas) (`arus_kas_saldo_akhir`)

Saldo awal periode ditambah arus bersih periode; harus sama dengan Kas & Bank menurut buku pada akhir periode.

| | |
|---|---|
| Rumus | saldo awal (mutasi sebelum periode) + kas masuk − kas keluar |
| Sumber | jurnal akun Kas/Bank |
| Status dihitung | terposting + dibalik |
| Basis tanggal | Posisi per tanggal |
| Termasuk | — |
| Tidak termasuk | — |
| Pasangan rekonsiliasi | Kas & Bank (Menurut Buku) |
| Tampil di | Laporan Keuangan (Arus Kas) |
| Export | — |

## Aset, kasbon & persediaan

### Kasbon Diberikan (`kasbon_diberikan`)

Uang muka gaji yang diberikan ke karyawan pada periode. Bukan beban: menjadi piutang karyawan sampai dipotong dari gaji.

| | |
|---|---|
| Rumus | Σ Kasbon.amount (aktif) pada periode |
| Sumber | tabel fin_kasbon + jurnal Piutang Karyawan |
| Status dihitung | aktif, lunas |
| Basis tanggal | Tanggal dokumen |
| Termasuk | Kasbon baru |
| Tidak termasuk | Kasbon dibatalkan |
| Pasangan rekonsiliasi | Kasbon Belum Dipotong; Uang Keluar (Kas/Bank) |
| Tampil di | Kasbon |
| Export | kasbon |

### Kasbon Belum Dipotong (`kasbon_sisa`)

Sisa kasbon seluruh karyawan yang belum dipotong dari gaji, apa pun periodenya (posisi saat ini, tidak mengikuti filter periode).

| | |
|---|---|
| Rumus | Σ (kasbon − potongan) semua kasbon aktif |
| Sumber | tabel fin_kasbon |
| Status dihitung | aktif |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Semua kasbon aktif |
| Tidak termasuk | Kasbon lunas/dibatalkan |
| Pasangan rekonsiliasi | Kasbon Diberikan |
| Tampil di | Kasbon |
| Export | kasbon |

### Uang Muka Operasional (Saldo Aktif) (`uang_muka_operasional_saldo`)

Uang yang dipegang driver/PIC untuk biaya operasional dan belum dipertanggungjawabkan. Kas keluar SEKALI saat diberikan; pertanggungjawaban memindahkan ke beban tanpa menyentuh kas lagi.

| | |
|---|---|
| Rumus | Σ uang muka aktif − pertanggungjawaban − pengembalian |
| Sumber | tabel fin_operational_advances + settlements |
| Status dihitung | aktif |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Uang muka yang belum habis dipertanggungjawabkan |
| Tidak termasuk | Uang muka lunas/dibatalkan |
| Pasangan rekonsiliasi | Pengeluaran (Aktif); Uang Keluar (Kas/Bank) |
| Tampil di | Uang Muka Operasional |
| Export | uang-muka |

### Nilai Persediaan (`persediaan_nilai`)

Nilai bahan/barang di gudang menurut buku (bertambah dari penerimaan barang, berkurang dari pemakaian produksi/susut/opname). Kuantitas milik Gudang; Finance hanya menilai rupiahnya.

| | |
|---|---|
| Rumus | saldo akun Persediaan (penerimaan − HPP pemakaian ± opname) |
| Sumber | jurnal persediaan; kuantitas dari stock_movements |
| Status dihitung | terposting |
| Basis tanggal | Posisi per tanggal |
| Termasuk | Penerimaan barang bernilai; Persediaan awal (cutover) |
| Tidak termasuk | Barang yang dipakai produksi (menjadi HPP) |
| Pasangan rekonsiliasi | Pembelian (Aktif); Utang Supplier |
| Tampil di | Persediaan Awal; Neraca |
| Export | — |

## Laporan keuangan

### Laba Bersih Sementara (`laba_bersih_sementara`)

Pendapatan bersih dikurangi HPP dan beban operasional menurut jurnal pada periode. 'Sementara' karena belum semua pengakuan/penyesuaian periode ditutup.

| | |
|---|---|
| Rumus | pendapatan bersih − beban pokok − beban operasional |
| Sumber | jurnal akun pendapatan, HPP, beban |
| Status dihitung | terposting |
| Basis tanggal | Tanggal buku (jurnal) |
| Termasuk | Semua beban yang diakui periode |
| Tidak termasuk | Aset/persediaan, kasbon, uang muka, pembayaran utang |
| Pasangan rekonsiliasi | Pendapatan Diakui; Beban Diakui |
| Tampil di | Dashboard; Laporan Keuangan |
| Export | — |
