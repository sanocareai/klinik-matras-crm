# Panduan Finance — Rekonsiliasi Kas & Bank (PT Sano, KEM, Uang Kas)

Status sistem: fitur impor/pencocokan **sudah terpasang tetapi sakelar `bank_reconciliation_v2_active` MATI**.
Selama mati, Finance bisa MELIHAT Mutasi Buku, Mutasi Rekening, dan panel; impor, pencocokan, pengecualian, dan
opname ditolak 403 `SAKELAR_MATI`. Dokumen ini hanya persiapan — tidak ada angka transaksi di sini.

Berkas pendukung di folder ini:

| Berkas | Fungsi |
|---|---|
| `template-impor-rekening-koran.xlsx` / `.csv` | Contoh bentuk berkas yang diterima sistem (baris isinya SINTETIS, bertanda CONTOH — hapus sebelum dipakai) |
| `backend/scripts/buat-templat-rekening-koran.mjs` | Pembuat ulang templat |
| `backend/tests/bankRekonParseSintetis.test.js` | Uji parser dengan data karangan (ganda, tanggal efektif, BI-FAST, biaya admin, bunga, pajak, transfer, debit/kredit kosong, saldo berjalan tak konsisten) |

---

## 1. Cara mengambil rekening koran dari Mandiri

Ambil **rekening koran per rekening** (PT Sano dan KEM masing-masing satu berkas), bukan gabungan.

1. Masuk Livin' Sukha / Mandiri Online Bisnis (atau minta cetak di cabang bila belum ada akses).
2. Menu **Informasi Rekening → Mutasi / Rekening Koran**.
3. Pilih nomor rekening, atur **Periode: 30 September 2026 s.d. tanggal hari ini** (mulai 30 Sep supaya saldo awal 1 Okt ikut terlihat).
4. **Unduh sebagai Excel (.xlsx) atau CSV.** Hindari PDF/foto — sistem tidak membaca PDF.
5. Jangan edit isi berkas. Jangan hapus baris "saldo awal" atau kop; sistem melewati sendiri.
6. Catat dan kirim bersama berkas: **nomor rekening, periode, tanggal & jam pengunduhan (WIB)**, dan **saldo akhir yang tertera di aplikasi bank pada jam itu**.

### Kolom yang dibutuhkan

| Wajib? | Kolom | Catatan |
|---|---|---|
| Wajib | **Tanggal** | `dd/mm/yyyy` (Indonesia; bukan mm/dd) atau tanggal Excel asli |
| Wajib | **Keterangan** | Tidak boleh kosong; dipakai menebak biaya admin/bunga/pajak |
| Wajib | **Debit** (uang keluar) **dan Kredit** (uang masuk) | ATAU satu kolom **Jumlah** bertanda (−) / dengan kolom **Tipe DB/CR** |
| Sangat disarankan | **Saldo** (saldo setelah baris itu) | Dipakai memeriksa rantai saldo; ketidakcocokan hanya peringatan |
| Disarankan | **Referensi / No. bukti** | Membantu pencocokan & mencegah baris ganda |
| Bila ada | **Tanggal efektif / Val Date** | Dibaca terpisah dari tanggal transaksi |

Aturan baca: angka gaya Indonesia (`1.234.567,89`) atau Inggris; `Rp`, tanda kurung, `DB`/`CR` dikenali. Maks **5 MB** dan **20.000 baris**
per berkas (pecah per bulan bila lebih). Berkas urut terbaru→terlama dibalik otomatis. Baris TOTAL/saldo awal dilewati. Baris bertanggal
dengan nominal tidak terbaca = **galat dengan nomor baris** dan impor ditolak seluruhnya (tidak ada yang masuk setengah-setengah).
Berkas yang tumpang tindih dengan impor sebelumnya aman: baris yang sudah ada dilewati, hanya baris baru yang masuk.

---

## 2. Checklist PT Sano (rekening bank)

Sebelum impor:
- [ ] Rekening koran XLSX/CSV 30 Sep → hari ini, dan saldo akhir bank + jam pengambilannya (WIB).
- [ ] Pastikan tidak ada jurnal baru ke PT Sano sedang diinput (atau catat jam cutoff).
- [ ] Buka **Mutasi Buku** PT Sano, periode yang sama: catat saldo awal, total masuk, total keluar, saldo akhir.
- [ ] Buka **Exception → Jurnal bank tanpa rekening**; tiap baris harus diberi rekening lewat jurnal koreksi (balik + pengganti), BUKAN diedit.

Setelah sakelar dinyalakan (hanya atas keputusan Owner):
- [ ] Pratinjau berkas: periksa kolom terpetakan benar, rantai saldo "konsisten", jumlah baris sesuai.
- [ ] Impor. Jalankan **Cocokkan otomatis** (hanya 1:1 tak ambigu), lalu cocokkan sisanya manual.
- [ ] Panel: **belum dijelaskan harus Rp0**. Bila tidak, jangan "menyelesaikan periode" — telusuri bucket-nya.
- [ ] Baris bank yang belum ada di buku (biaya admin, bunga, pajak bunga, transaksi lupa dicatat) → dibukukan lewat jalur resmi, lalu dicocokkan.
- [ ] Transfer ke/dari KEM: harus ada pasangan di kedua rekening dengan nominal sama.
- [ ] Duplikat: dua penerimaan dengan order & nominal sama pada hari yang sama → tanyakan ke pencatat, batalkan yang salah lewat koreksi pembayaran.

## 3. Checklist KEM (rekening bank)

- [ ] Rekening koran XLSX/CSV KEM (periode sama) + saldo akhir bank & jam pengambilan.
- [ ] **Saldo buku negatif bukan bukti salah.** Periksa dulu urutan input: pengeluaran bisa diinput sebelum transfer pendanaan dari PT Sano.
  Bandingkan saldo buku KEM dengan saldo bank pada tanggal & jam yang sama sebelum menyimpulkan.
- [ ] Cocokkan transfer pendanaan dari PT Sano (tanggal bisa berbeda 1–2 hari; sistem memberi saran ≤7 hari, otomatis hanya ≤3 hari & tak ambigu).
- [ ] Biaya admin/bunga/pajak bunga KEM yang belum dibukukan.
- [ ] Panel: belum dijelaskan Rp0 sebelum periode diselesaikan.

## 4. Checklist Uang Kas (hitung fisik)

Uang Kas **tidak memakai rekening koran** — memakai **opname (hitung fisik)**.

- [ ] Tentukan tanggal & jam hitung; hentikan transaksi kas selama menghitung.
- [ ] Hitung per pecahan (100.000, 50.000, 20.000, 10.000, 5.000, 2.000, 1.000, koin); foto lembar hitung ditandatangani penghitung + saksi.
- [ ] Catat juga: bon/kuitansi belum dibukukan, uang titipan, kasbon belum dicatat (tulis terpisah, jangan dicampur ke fisik).
- [ ] Bandingkan dengan saldo buku Uang Kas pada tanggal yang sama; selisih = buku − fisik, jelaskan tiap bagian.
- [ ] Opname bersifat tidak dapat diubah; koreksi dilakukan dengan opname baru + jurnal resmi.

## 5. Data yang harus diterima dari Finance

1. Rekening koran PT Sano, 30 Sep → hari ini (XLSX/CSV) + saldo bank aplikasi dan jam pengambilannya.
2. Rekening koran KEM, periode sama (XLSX/CSV) + saldo bank aplikasi dan jam pengambilannya.
3. Hasil hitung fisik Uang Kas + tanggal/jam + lembar hitung.
4. Konfirmasi dari pencatat untuk setiap exception sisi buku yang diajukan sistem (lihat laporan preflight — tidak disimpan di Git).
5. Keputusan Owner kapan sakelar `bank_reconciliation_v2_active` boleh dinyalakan.
