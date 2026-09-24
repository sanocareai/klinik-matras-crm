# Edit & Koreksi Transaksi Aman — Matriks Kemampuan (24 September 2026)

Prinsip: **jurnal yang sudah POSTED tidak pernah di-UPDATE/DELETE.** Perubahan yang memengaruhi buku besar = reversal resmi + jurnal pengganti dalam satu transaksi DB
(lewat `postJournal`/`reverseJournal`/`balikkanJurnalAktif` — tidak ada ledger paralel). Field non-keuangan boleh diedit langsung dengan audit trail.

Alur "Koreksi" di layar: ubah → **Lihat Pratinjau** (server menjalankan koreksi sungguhan lalu ROLLBACK: nilai lama vs baru, jurnal yang dibalik, jurnal pengganti,
dampak saldo rekening, debit = kredit) → **Konfirmasi Koreksi** → **PIN Finance** (step-up, token 5 menit, salah 5× = kunci 15 menit) → tersimpan.
Setelah itu **Riwayat perubahan** (siapa, kapan, alasan, perubahan, rantai jurnal asli → dibalik → pengganti) ada di menu aksi baris.

| Modul | Belum berjurnal | Sudah berjurnal — non-keuangan | Sudah berjurnal — memengaruhi ledger | Diblokir bila | Riwayat versi |
|---|---|---|---|---|---|
| Pengeluaran & reimbursement | **Edit** penuh (nominal, tanggal, kategori, divisi, penerima, penalang, rekening, metode/biaya transfer, bukti, catatan) | Bukti/catatan langsung (audit) | **Koreksi**: reversal + pengganti, pratinjau, PIN | Sudah direkonsiliasi bank; mode Uang Muka (angka: batalkan lalu catat ulang); cara bayar tidak bisa diubah | Ya |
| Pembelian (termasuk DP/Uang Muka Pembelian) | **Edit** penuh | Bukti/catatan | **Koreksi** sama seperti di atas | Direkonsiliasi; DP sudah dipakai/diterapkan (relasi aktif) | Ya |
| Pengajuan Biaya Delivery → FinExpense | Draf: edit oleh pengaju | Koreksi metadata pengajuan (alasan wajib) | Koreksi di FinExpense-nya (jalur Pengeluaran) | Sama dengan Pengeluaran | Lewat FinExpense |
| Kasbon | — (langsung berjurnal) | PATCH: nama karyawan, urgensi, catatan, bukti (audit) | Nominal tidak diedit: **Batalkan** (jurnal dibalik) lalu catat ulang | Sudah ada pelunasan aktif → batalkan pelunasan dulu | API ya; UI: riwayat kasbon yang ada |
| Pemasukan Lain | — (langsung berjurnal) | Lampiran/catatan lewat Koreksi | **Koreksi** (tanggal, nominal, keterangan, akun pendapatan, rekening) + pratinjau + PIN; **Batalkan** | Direkonsiliasi; akun pendapatan order dilarang | Ya |
| Transfer kas/bank | — | Referensi/catatan lewat Koreksi | **Koreksi** (tanggal, nominal, biaya admin, rekening asal/tujuan) + pratinjau + PIN; **Batalkan** | Direkonsiliasi | Ya |
| Refund | **Edit** (MENUNGGU_APPROVAL): nominal, tanggal, alasan, rekening, biaya transfer, bukti; validasi ulang batas uang diterima | — | Sudah disetujui: **Batalkan** (reversal, status bayar order dihitung ulang) lalu ajukan ulang | Hanya pembuat/admin yang boleh edit | Ya |
| Tagihan supplier | **Edit** (DRAFT/MENUNGGU): supplier, nomor faktur, tanggal, jatuh tempo, nominal, keterangan, kategori | — | Sudah disetujui: **Batalkan** (reversal) lalu catat ulang | Ada alokasi pembayaran aktif → batalkan pembayaran dulu | Ya |
| Pembayaran supplier | — | — | **Batalkan** (reversal alokasi + jurnal) lalu catat ulang | — | Riwayat jurnal |
| Uang Muka Operasional | — (langsung berjurnal) | **Edit keterangan**: tujuan, tenggat, catatan, bukti, divisi (tanpa jurnal, saldo tetap) | Angka/pemegang/rekening/tanggal **diblokir**: Batalkan lalu catat ulang | Ada pertanggungjawaban/pengembalian aktif → batalkan itu dulu | Ya |

Izin: edit biasa mengikuti pemilik/status; **koreksi finansial minimal FINANCE_ADMIN + PIN**. Pembatalan (reversal) saat ini FINANCE_ADMIN tanpa PIN (gap di bawah).

## Gap yang tersisa (jujur)
- Pembatalan (Batalkan) belum meminta PIN; hanya Koreksi yang meminta.
- Tagihan/refund yang sudah disetujui tidak punya "Koreksi in-place": jalurnya Batalkan lalu catat ulang.
- Pemasukan Lain/Transfer: koreksi hanya untuk dokumen yang belum dibatalkan.
- Riwayat versi Kasbon/Pembayaran supplier belum ada tombolnya di UI (API sudah).
- Aplikasi mobile Finance & insentif driver sengaja tidak disentuh (sesi pemilik lain).
- Rute insentif/armada masih memetakan P2028 ke 409 yang menyesatkan; akar masalahnya diredam di `db.js` (batas transaksi Prisma 15 dtk/30 dtk).

## Rollback
Revert commit fitur ini. Migrasi `20260924100000_finance_stepup_pin` hanya menambah 4 kolom di `User` (aditif) — aman dibiarkan.

## Menu Aksi di layar — sebelum & sesudah (B3.2, 25 September 2026)
Sumber tunggal: `frontend/src/features/finance/matriksAksi.js` (dites di `frontend/tests/matriksAksi.test.js`). Item yang tidak tersedia **tetap tampil, nonaktif, dengan alasan berbahasa Indonesia** (terlihat langsung di menu, bukan hanya tooltip). Izin tetap divalidasi server; UI hanya mencerminkan (Koreksi/Batalkan butuh Admin Keuangan).

| Transaksi / status | Sebelum | Sesudah |
|---|---|---|
| Pengeluaran & Pembelian — Menunggu Persetujuan | Edit / koreksi, Tolak | **Edit**, Tolak, Riwayat; Batalkan nonaktif ("Belum berjurnal — gunakan Tolak") |
| Pengeluaran & Pembelian — Disetujui/Dibayar | Edit / koreksi, Batalkan | **Koreksi**, Batalkan, Riwayat |
| Pengeluaran & Pembelian — Ditolak/Dibatalkan | (Edit tidak muncul, tanpa penjelasan) | Edit/Koreksi nonaktif + alasan |
| Tagihan supplier — Menunggu | Edit, Tolak | Edit, Tolak, Riwayat |
| Tagihan supplier — Disetujui belum dibayar | Batalkan | **Batalkan & Catat Ulang**; Edit nonaktif + alasan |
| Tagihan supplier — Dibayar sebagian/Lunas | Batalkan (ditolak server) | **Batalkan & Catat Ulang nonaktif: "Memiliki pembayaran aktif"** |
| Pembayaran supplier | (tidak ada menu) | Riwayat, **Batalkan & Catat Ulang**, Koreksi nonaktif ("Koreksi langsung tidak tersedia") |
| Kasbon | Edit data, Batalkan | **Edit Data** (non-uang), **Batalkan & Catat Ulang** (dengan penjelasan nominal); nonaktif + alasan bila ada pelunasan aktif |
| Refund | Edit (menunggu), Batalkan (disetujui) | Edit nonaktif + alasan bila disetujui; **Batalkan & Ajukan Ulang** |
| Transfer, Pemasukan Lain | Koreksi, Batalkan bila belum batal | + alasan bila sudah dibatalkan |
| Uang Muka Operasional | Edit keterangan, Batalkan | + **Ubah nominal/rekening** nonaktif ("Batalkan & Catat Ulang"); Batalkan nonaktif bila ada pertanggungjawaban aktif |

Catatan teknis: komponen `Button` kini `forwardRef`. Sebelumnya trigger menu `…` tidak meneruskan ref ke Radix sehingga popper tidak pernah memosisikan menu (tetap `translate(0,-200%)`, di luar layar).
