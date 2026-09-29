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
| Kasbon | — (langsung berjurnal) | PATCH: nama karyawan, urgensi, catatan, bukti (audit) | Nominal tidak diedit: **Batalkan** (jurnal dibalik) lalu catat ulang | Sudah ada pelunasan aktif → batalkan pelunasan dulu | Ya — tombol **Riwayat perubahan** (B3.8), terpisah dari riwayat pemotongan gaji |
| Pemasukan Lain | — (langsung berjurnal) | Lampiran/catatan lewat Koreksi | **Koreksi** (tanggal, nominal, keterangan, akun pendapatan, rekening) + pratinjau + PIN; **Batalkan** | Direkonsiliasi; akun pendapatan order dilarang | Ya |
| Transfer kas/bank | — | Referensi/catatan lewat Koreksi | **Koreksi** (tanggal, nominal, biaya admin, rekening asal/tujuan) + pratinjau + PIN; **Batalkan** | Direkonsiliasi | Ya |
| Refund | **Edit** (MENUNGGU_APPROVAL): nominal, tanggal, alasan, rekening, biaya transfer, bukti; validasi ulang batas uang diterima | **Edit Informasi** (alasan refund, lampiran) — B3.8 | Sudah disetujui: **Koreksi** (versi pengganti + reversal, TANPA PIN, B3.8) atau **Batalkan** (reversal, status bayar order dihitung ulang) lalu ajukan ulang | Direkonsiliasi/periode rekon selesai/periode akuntansi tutup/pengakuan pendapatan berubah/melebihi uang diterima; hanya pembuat/admin yang boleh edit | Ya (rantai versi) |
| Tagihan supplier | **Edit** (DRAFT/MENUNGGU): supplier, nomor faktur, tanggal, jatuh tempo, nominal, keterangan, kategori | **Edit Informasi** (nomor faktur, jatuh tempo, lampiran) — B3.8 | Sudah disetujui: **Koreksi** (versi pengganti + reversal, TANPA PIN, B3.8) atau **Batalkan** (reversal) lalu catat ulang | Ada alokasi pembayaran aktif → batalkan pembayaran dulu; direkonsiliasi; periode akuntansi tutup; jenis/penerimaan tidak bisa diubah | Ya (rantai versi) |
| Pembayaran supplier | — | — | **Batalkan** (reversal alokasi + jurnal) lalu catat ulang | — | Ya — tombol **Riwayat perubahan** di menu ⋯ |
| Uang Muka Operasional | — (langsung berjurnal) | **Edit keterangan**: tujuan, tenggat, catatan, bukti, divisi (tanpa jurnal, saldo tetap) | Angka/pemegang/rekening/tanggal **diblokir**: Batalkan lalu catat ulang | Ada pertanggungjawaban/pengembalian aktif → batalkan itu dulu | Ya |

Izin: edit biasa mengikuti pemilik/status; **koreksi finansial minimal FINANCE_ADMIN + PIN**. Koreksi Tagihan Supplier & Refund (B3.8) dan Pembatalan: FINANCE_ADMIN TANPA PIN — keputusan owner 29 Sep 2026 (pengaman: izin, alasan, pratinjau server, Idempotency-Key wajib, row lock, audit). Koreksi jenis lain (pengeluaran, pembelian, transfer, pemasukan lain, pembayaran masuk) tetap memakai PIN. Detail B3.8: `docs/B38-KOREKSI-LANJUTAN.md`.

## Gap yang tersisa (jujur)
- Pemasukan Lain/Transfer: koreksi hanya untuk dokumen yang belum dibatalkan.
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
