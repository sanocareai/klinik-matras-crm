# SOP Tim Finance — mulai 22 September 2026 (versi ringkas)

Berlaku sampai ada revisi. Tujuan: angka Finance Workspace bisa dipercaya dan tidak ada transaksi yang terhitung dua kali. **Cutoff saldo terakhir yang terkonfirmasi: 21 September 2026 pukul 20.00 WIB.** Semua kas/bank yang terjadi **sebelum** cutoff itu sudah tercermin dalam saldo riil.

## 1. Mencatat pembayaran (Payment)
1. Catat pembayaran **saat uang diterima**, bukan saat menagih. Isi: order yang benar, nominal, metode, **rekening tujuan yang sebenarnya** (PT Sano / KEM Sano / Kas), tanggal terima yang sebenarnya, dan bukti (foto/screenshot).
2. Satu pembayaran = satu Payment. Pembayaran untuk beberapa order dialokasikan lewat fitur alokasi, bukan dicatat berkali-kali.
3. **Dilarang menandai order "Lunas" di CRM tanpa Payment.** Status Lunas harus lahir dari Payment yang tercatat dan terverifikasi.
4. Pembayaran tanpa rekening tujuan **tidak boleh dibiarkan**: tetapkan rekening hari itu juga (bila tidak diketahui, tanya pengirim/cek mutasi; jangan menebak).

## 2. Verifikasi rekening
1. Verifikasi Payment hanya setelah dicocokkan dengan **mutasi bank/kas nyata** (bukan hanya bukti dari sales/driver).
2. Cocokkan: nominal, tanggal, rekening. Beda salah satunya → tandai Perlu Ditinjau, jangan disamakan.
3. Payment yang sudah diverifikasi tidak diubah; koreksi lewat pembatalan + pencatatan baru yang disetujui.

## 3. Pengakuan pendapatan = saat serah-terima
1. Pendapatan diakui **ketika barang/jasa diserahterimakan** dan ada bukti (pengiriman selesai/POD). Bukan saat order dibuat, bukan saat dibayar.
2. Status **DELIVERED / SEWA_DIKIRIM** hanya boleh diset setelah serah-terima benar-benar terjadi. Begitu status itu diset, sistem **langsung membukukan pendapatan dan tidak otomatis membaliknya** bila status diubah lagi. Jangan memilih DELIVERED "sementara" lalu mengoreksinya.
3. Bila terlanjur salah: **jangan ubah-ubah status**. Laporkan ke Finance (nomor order + alasan); pembalikan dilakukan lewat pembalikan jurnal resmi yang disetujui.
4. Order batal setelah serah-terima → lewat alur Refund/Retur, bukan menghapus pengakuan.

## 4. Penanganan DP / uang muka
1. DP dicatat sebagai Payment dengan rekening tujuan seperti biasa; buku mencatatnya sebagai **Uang Muka Pelanggan (kewajiban)**, bukan pendapatan.
2. Saat serah-terima, sistem memindahkan uang muka menjadi pelunasan piutang. Jangan mencatat DP sebagai "pendapatan lain" atau memakai jurnal manual.
3. DP yang order-nya batal → proses refund; jangan dibiarkan menggantung.
4. Order yang dinyatakan Lunas di CRM tetapi belum diserahkan wajib punya Payment (agar uang muka tercatat); jangan berhenti di status CRM.

## 5. Transaksi lama yang baru dimasukkan
1. Transaksi bertanggal **sebelum** cutoff (≤ 21 Sep 2026 20.00 WIB) yang baru ditemukan/diinput **tidak boleh** langsung dicatat dengan pengaruh kas/bank: kasnya sudah ada di saldo riil. Mencatatnya menggandakan kas (ini penyebab selisih Rp27,4 juta PT dan Rp5,3 juta KEM pada 19–21 Sep).
2. Prosedurnya: (a) cek apakah tanggal transaksi ≤ cutoff; (b) bila ya, **ajukan ke Finance** untuk dicatat sebagai koreksi **non-kas** (bukan lewat form Pembayaran/Pengeluaran biasa); (c) bila tidak (tanggal sesudah cutoff), catat normal.
3. Jangan memundurkan tanggal pembayaran/pengeluaran ke sebelum cutoff untuk "merapikan" data.

## 6. Rekonsiliasi harian (akhir hari kerja, ±15 menit)
1. Buka **Ringkasan Keuangan**: baca banner kualitas data; pastikan butir "belum tercatat/belum lengkap" tidak bertambah dibanding kemarin.
2. Bandingkan **saldo buku** vs **saldo bank/kas nyata** tiap rekening (jam yang sama). Catat selisih di Rekonsiliasi Bank.
3. Masukkan mutasi bank asli hari itu ke periode Rekonsiliasi Bank; cocokkan satu per satu; sisanya dijelaskan (biaya admin, transfer antar-rekening, dll.).
4. Selisih yang tidak bisa dijelaskan: **biarkan terbuka dan laporkan** — dilarang membuat jurnal penyeimbang.
5. Periode rekonsiliasi hanya ditutup bila mutasi asli sudah dimasukkan, semua baris cocok/dijelaskan, dan selisih nol.

## 7. Larangan mencatat ulang transaksi yang sudah tercakup cutoff
- Dilarang: mencatat lagi pembayaran/pengeluaran/kasbon/transfer yang tanggalnya ≤ cutoff dengan pengaruh kas; menjurnal ulang saldo awal; memposting data historis (Notion) tanpa persetujuan Owner; memakai jurnal manual untuk menyamakan saldo.
- Dilarang mengubah/membalik: JV-19092026-372, JV-21092026-391, 23 jurnal koreksi kas ganda (JV-21092026-436 s.d. 458), dan akun 2-1600.
- Ragu apakah sudah tercakup? **Tanya Finance dulu, jangan catat.**

## 8. Eskalasi
| Masalah | Siapa |
|---|---|
| Pembayaran tanpa rekening / bukti tidak jelas | Finance (hari itu) |
| Status DELIVERED terlanjur salah | Finance + Kepala Produksi |
| Selisih rekening tidak terjelaskan | Owner |
| Ada transaksi lama baru ditemukan | Finance → Owner bila nilainya material |
