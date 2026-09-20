# Kebijakan akurasi Finance SANSS

Ditetapkan 20 Sep 2026 oleh owner. Berlaku untuk seluruh kode dan operasi Finance (backend, web, mobile, skrip impor/kalibrasi).

## Kebijakan
1. **Angka kontrol utama** = saldo riil rekening bank dan hasil hitung kas fisik pada cutoff yang sudah diverifikasi. Ledger mengikuti angka itu, bukan sebaliknya.
2. **Saldo boleh negatif** bila kondisi riil memang negatif. Jangan dipaksa nol atau positif (tidak ada `max(0, …)`, tidak ada clipping di query, API, maupun tampilan).
3. **Data impor Notion dipertahankan sebagai histori**, tetapi tidak boleh membuat saldo Kas & Bank menyimpang dari saldo riil yang sudah dikonfirmasi. Penyimpangan diselesaikan dengan jurnal koreksi, bukan dengan mengubah impor.
4. **Dilarang** mengubah, menghapus, atau membuat transaksi palsu untuk mempercantik saldo; dilarang menyeimbangkan laporan dengan mengubah saldo Kas & Bank atau membuat jurnal otomatis.
5. **Setiap selisih migrasi** dicatat lewat jurnal koreksi resmi: melalui `postJournal`, seimbang, idempoten (kunci unik), transaksi atomik, dengan audit trail (`ActivityEvent`), lawan akun ekuitas sistem `3-4100 Koreksi Saldo Awal` (bukan pendapatan/biaya).
6. **Setelah cutoff**: saldo current = saldo riil pada cutoff + seluruh mutasi setelah cutoff (dihitung dari ledger, tidak ada kolom/sumber saldo tandingan).
7. **UI, API, laporan** mendukung nilai negatif: web memakai format kurung + merah (`formatUang`/`Uang`), mobile `MoneyText autoNegatif` (string desimal `-…`), API mengirim angka bertanda apa adanya.
8. **JV-19092026-372** (kalibrasi 19 Sep 2026 20.00 WIB) tidak diubah kecuali lewat reversal resmi (`reverseJournal`).

Prosedur kalibrasi berikutnya: `docs/FINANCE-KALIBRASI-SALDO-2026-09-19.md` (pratinjau → backup → `--apply`, konfigurasi baru per cutoff).

## Audit selisih Neraca −Rp45.834.231 (read-only, 20 Sep 2026)

**Kesimpulan: bug di laporan Neraca (query/pemetaan), bukan data/jurnal.** Neraca Saldo selalu seimbang; hanya penyajian Neraca yang timpang.

`neraca()` menghitung laba **hanya sejak 1 Januari tahun berjalan** dan melewati akun pendapatan/beban dari bagian aset/kewajiban/ekuitas. Sistem tidak punya tutup buku, jadi saldo pendapatan/beban tahun-tahun sebelumnya tidak muncul di sisi mana pun. Dengan komentar desain "neraca selalu seimbang tanpa proses apa pun", asumsi itu hanya benar untuk pembukuan satu tahun; produksi punya jurnal Des 2025 (48 jurnal: PENGELUARAN 37, PEMBELIAN 9, MANUAL 2).

Rekonsiliasi (per 20 Sep 2026, dari ledger produksi):

| Komponen | Rp |
|---|---:|
| Total aset (Kas 104.500 + Bank 36.587.122 + Piutang Usaha 42.915.000 + Piutang Karyawan 27.300.000 + Peralatan 54.000 + Aset Tak Berwujud 14.044.531) | 121.005.153 |
| Kewajiban (hanya 2-1600 Utang Pihak Ketiga, **bersaldo debit**) | −42.398.335 |
| Ekuitas tercatat (3-3100 Laba Ditahan 2.546.054.537,10 + 3-4100 Koreksi Saldo Awal −90.397.439,10) | 2.455.657.098 |
| Laba/rugi 2026 (pendapatan 83.352.937 − beban pokok 1.161.546.912 − beban 1.168.225.404) | −2.246.419.379 |
| Total pasiva yang ditampilkan sebelum perbaikan | 166.839.384 |
| **Selisih aset − pasiva** | **−45.834.231** |

Selisih itu sama persis dengan **rugi bersih 2025** yang terlewat (semua jurnal bertanggal < 1 Jan 2026): 5-1150 Pembelian Bahan Baku 12.263.000 + 6-1150 Pemeliharaan Mesin 22.250.000 + 6-1900 Beban Lain-lain 6.924.574 + 6-1600 Perlengkapan Kantor 1.884.457 + 6-1170 Operasional & Perjalanan 1.018.700 + 6-1300 BBM 380.000 + 6-1340 Kurir 360.000 + 6-1310 Tol & Parkir 203.500 + 6-1100 Gaji 400.000 + 6-1200 Iklan 150.000 = **45.834.231** (semua di sisi debit; tidak ada pendapatan 2025). Setelah perbaikan: total aset 121.005.153 = kewajiban −42.398.335 + ekuitas (209.237.719 − 45.834.231 = 163.403.488).

Yang diperiksa dan **bukan** penyebab: tanda debit/kredit kewajiban negatif (`saldoNormal` mengikuti `normalBalance`, hasil −42.398.335 benar); akun 3-4100 (debit Rp90.429.439,10, kredit Rp32.000, saldo −90.397.439,10 — tampil negatif di ekuitas, benar); Laba Ditahan; tidak ada akun bertipe di luar enam tipe; tidak ada akun header/nonaktif yang berjurnal.

**Perbaikan** (`services/finance/reports.js#neraca`): laba/rugi tahun-tahun sebelumnya dihitung dari akun pendapatan/beban sebelum 1 Januari, dimasukkan ke ekuitas sebagai baris "Laba/rugi tahun-tahun sebelumnya (belum ditutup ke Laba Ditahan)" (nilai negatif tidak di-clip) dan field `labaTahunSebelumnya`. Bila tutup buku dibuat kelak, nilainya otomatis 0 (tidak terhitung ganda; ada tesnya). Tidak ada jurnal yang diposting, tidak ada saldo Kas & Bank yang berubah. Tes: `tests/integration/financeNeraca.integration.test.js` (gagal pada kode lama).

## Untuk keputusan bisnis (tidak diubah): kewajiban negatif 2-1600 = −Rp42.398.335

Seluruh isi 2-1600 berasal dari **impor Notion** (68 jurnal MANUAL), bukan transaksi aplikasi:

| Sumber impor | Jurnal | Debit | Kredit |
|---|---:|---:|---:|
| `IMPORT_INCOMES2026` ([IMPOR-NOTION-INCOMES-2026]) — penerimaan pinjaman/suntikan (Pinjaman MUF 33 jt, INVES FARHAN 30 jt, pinjaman pasamebel 5,15 jt, Pinjaman Mat Juri 5 jt, juri suntik 5 jt, dll.) | 11 | 0 | 85.950.000 |
| `IMPORT_FULLHIST2026` ([IMPOR-NOTION-FULLHIST-2026]) — pelunasan/pembayaran ke pihak ketiga (JV-30062026-412 "Jan-Jun pelunasan Hutang SANO ke Pasamebel" 40.422.000; fee investor Farhan/Mei/Juli 9,24 jt + 7,57 jt + 4,85 jt + 4,0 jt; kasbon pasamebel 4,11 jt; dst.) | 56 | 126.723.335 | 0 |
| `IMPORT_SEPT2026` | 1 | 1.625.000 | 0 |

Pembayaran/pelunasan (Rp128,3 jt) melebihi penerimaan pinjaman yang tercatat (Rp85,95 jt). Kemungkinan penjelasan bisnis yang perlu Anda putuskan: (a) pokok pinjaman lama tidak ikut terimpor (mis. utang ke Pasamebel Rp40,4 jt dilunasi tetapi hanya Rp5,15 jt penerimaannya tercatat); (b) "fee investor" seharusnya beban/bagi hasil (akun beban), bukan pengurang pokok utang; (c) sebagian memang piutang kepada pihak ketiga. Sistem tidak menebak; tidak ada koreksi otomatis. Jika diputuskan, koreksinya berupa **jurnal reklasifikasi resmi** (mis. memindahkan fee investor dari 2-1600 ke akun beban) atas persetujuan owner, bukan pengubahan jurnal impor.
