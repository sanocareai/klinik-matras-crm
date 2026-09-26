# Bagi Hasil Investor (profit sharing) — cara mencatat di Finance

Fee investor yang dibayar rutin tiap bulan dari skema profit sharing adalah **pembagian laba**, bukan beban operasional,
bukan biaya produksi, dan bukan pengeluaran biasa. Karena itu dicatat lewat **Jurnal Umum** ke akun ekuitas khusus,
bukan lewat menu Pengeluaran.

## Akun

| Kode | Nama | Tipe | Saldo normal | Fungsi |
|---|---|---|---|---|
| **3-4200** | Distribusi Laba / Bagi Hasil Investor | Ekuitas | Debit | Mencatat pembagian laba/profit sharing kepada investor |
| **2-1800** | Utang Bagi Hasil Investor | Kewajiban Lancar | Kredit | Dipakai bila bagi hasil diakui dulu tetapi belum dibayar |

Keduanya aktif dan bisa diposting, sehingga langsung muncul di pilihan akun **Jurnal Umum**.

## Jurnal

**Dibayar langsung**

| | Akun | Debit | Kredit |
|---|---|---|---|
| Dr | 3-4200 Distribusi Laba / Bagi Hasil Investor | X | |
| Cr | Bank / Kas | | X |

**Diakui dulu, dibayar kemudian**

Saat diakui:

| | Akun | Debit | Kredit |
|---|---|---|---|
| Dr | 3-4200 Distribusi Laba / Bagi Hasil Investor | X | |
| Cr | 2-1800 Utang Bagi Hasil Investor | | X |

Saat dibayar:

| | Akun | Debit | Kredit |
|---|---|---|---|
| Dr | 2-1800 Utang Bagi Hasil Investor | X | |
| Cr | Bank / Kas | | X |

## Dampak di laporan

- **Laba Rugi**: tidak berubah. 3-4200 bukan beban, jadi tidak mengurangi laba.
- **Neraca**: 3-4200 tampil sebagai **pengurang** ekuitas (nilai negatif); 2-1800 tampil di Kewajiban selama belum dibayar. Neraca tetap seimbang.
- **Arus Kas**: pembayaran ke investor tergolong **pendanaan**, bukan operasi.
- **Pengeluaran / ringkasan biaya**: tidak muncul. Akun ini tidak bisa dijadikan kategori biaya (server menolak dengan pesan
  "Kategori biaya harus menunjuk akun bertipe Beban atau Beban Pokok").

## Yang perlu dibedakan

- **Pokok pinjaman investor/mitra** tetap di **2-1600 Utang Pihak Ketiga** (pencairan = pendanaan masuk, pelunasan = pendanaan keluar).
- **Bunga/fee pinjaman murni** (bukan bagi hasil dari laba) tetap beban di akun beban yang sesuai.
- Jurnal lama tidak diubah. Bila ada bagi hasil bulan lalu yang sudah terlanjur dicatat sebagai beban, koreksinya lewat jurnal
  pembalik/reklasifikasi baru (tidak mengedit jurnal lama).

## Catatan teknis

- Migrasi `20260927170000_coa_bagi_hasil_investor` menambah kedua akun secara idempoten (dilewati bila kodenya sudah ada) dan tidak
  menyentuh jurnal atau akun lain. `ensureDefaultChartOfAccounts` (DEFAULT_COA) memuat definisi yang sama untuk instalasi baru.
- Perbaikan pendamping di Neraca (`services/finance/reports.js#neraca`): akun **kontra** (sisi berlawanan dengan kelompoknya, mis. 3-4200 dan
  Prive 3-2100 di Ekuitas, Akumulasi Penyusutan 1-2900 di Aset) kini mengurangi total kelompoknya. Sebelumnya akun kontra menambah total dan
  Neraca selisih 2× nominal. Saldo akun kontra di produksi saat perbaikan dibuat = 0, sehingga tidak ada angka lama yang berubah.
