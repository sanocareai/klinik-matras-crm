# Checklist Gudang — Simpan ke Stok GR-141026-01 (PO-13102026-003)

Untuk: staf Gudang yang memegang penerimaan barang. Dikerjakan di **layar Penerimaan Barang** (UI) — bukan lewat SQL, bukan lewat Finance.
Dokumen ini tidak mengubah apa pun. Stok dan jurnal baru terbentuk saat **Anda** menekan **Simpan ke Stok**.

## Kenapa dulu gagal
Sistem menolak "Simpan ke Stok" bila saldo catatan material minus, walau barang yang datang jelas menambah stok. LIST-WIBING-ABU tercatat −388,5 ROLL (sisa impor pemakaian lama), sehingga penerimaan +5 ROLL ditolak dengan pesan "tersedia -388.5, butuh 5". Sudah diperbaiki: penerimaan **boleh** pada saldo minus; pengeluaran (Issue/Waste) pada saldo minus **tetap ditolak**. Saldo minus tidak dikoreksi otomatis — itu diselesaikan lewat stok opname.

## A. Sebelum menekan Simpan ke Stok — periksa tujuh baris
Buka GR-141026-01 (status **Siap Disimpan**). Pastikan kolom **Jumlah baik** sama dengan barang yang benar-benar baik di rak/di gudang:

| # | Material | Satuan | Dipesan | Datang | Baik (tercatat) | Perlu Anda pastikan |
|---|---|---|---|---|---|---|
| 1 | KAI-001 | METER | 12 | 12 | **8** | **Baru 8 dari 12 diperiksa. Lihat bagian B.** |
| 2 | KAI-002 | METER | 11 | 11 | 11 | Cocok dengan fisik? |
| 3 | KAIN-OSCAR-HITAM | METER | 40 | 40 | 40 | Cocok dengan fisik? |
| 4 | LIST-WIBING-ABU | ROLL | 5 | 5 | 5 | Satuan ROLL (bukan meter) — cocok dengan fisik? |
| 5 | LIST-WIBING-COKLAT | ROLL | 10 | 10 | 10 | Satuan ROLL — cocok dengan fisik? |
| 6 | SPANBON-75GRAM | METER | 100 | 100 | 100 | Cocok dengan fisik? |
| 7 | STREPLES-10-13 | PACK | 10 | 10 | 10 | Cocok dengan fisik? |

- [ ] Semua tujuh baris diperiksa terhadap barang fisik (bukan terhadap catatan lama).
- [ ] Tidak ada baris yang jumlah baik + ditolak melebihi jumlah datang.
- [ ] Barang rusak/cacat dicatat di kolom **Ditolak**, bukan dibiarkan di Baik.

## B. KAI-001: 8 dari 12 meter
Selisih 4 meter belum punya keputusan di sistem (baik 8, ditolak 0). Periksa fisiknya, lalu pilih **satu** — jangan menebak:

- [ ] **Keempat meter baik** → ubah Jumlah baik KAI-001 menjadi **12**. (Nilai jurnal naik Rp260.000.)
- [ ] **Sebagian/semua rusak** → isi **Ditolak** sesuai fisik (baik + ditolak = 12). Penolakan memengaruhi tindak lanjut ke supplier (pengganti/retur) — kabari Finance.
- [ ] **Belum bisa diperiksa** → biarkan 8. Hanya 8 yang masuk stok; sisa 4 m tetap belum diputuskan di PO dan **harus ditindaklanjuti** (jangan dilupakan).

Catatan keputusan: ____________________  Diperiksa oleh: ____________  Tanggal/jam: ____________

## C. Menyimpan ke stok (hanya oleh Gudang)
- [ ] Pastikan status GR **Siap Disimpan** dan belum ada yang menekan Simpan ke Stok sebelumnya.
- [ ] Tekan **Simpan ke Stok SATU kali**. Tunggu sampai layar selesai; jangan tekan ulang.
- [ ] Bila muncul pesan galat: **catat pesannya lengkap** dan hentikan. Jangan coba berulang-ulang dan jangan membuat penerimaan baru. Gagal berarti tidak ada yang tersimpan (satu transaksi) — aman dicoba lagi hanya setelah penyebabnya jelas.
- [ ] Jangan menjalankan stok opname/penyesuaian untuk material ini sebelum langkah D selesai.

## D. Setelah menekan — yang diharapkan
Status GR menjadi **COMPLETED**. Hasil yang benar (bila angka baik tidak diubah):

| Material | Movement | Saldo sebelum | Saldo sesudah |
|---|---|---|---|
| KAI-001 | +8 | 0 | 8 |
| KAI-002 | +11 | 0 | 11 |
| KAIN-OSCAR-HITAM | +40 | 0 | 40 |
| LIST-WIBING-ABU | +5 | −388,5 | **−383,5 (masih minus: normal)** |
| LIST-WIBING-COKLAT | +10 | −116,5 | **−106,5 (masih minus: normal)** |
| SPANBON-75GRAM | +100 | 100 | 200 |
| STREPLES-10-13 | +10 | 3 | 13 |

Satu jurnal Finance: Dr Persediaan Bahan Baku / Cr Utang Barang Belum Ditagih **Rp4.325.000** (jumlah baik × harga PO). Bila KAI-001 diubah menjadi 12, nilainya **Rp4.585.000**.

Saldo ABU dan COKLAT yang masih minus **bukan kesalahan putaway** — itu sisa pemakaian lama yang akan dibereskan oleh stok opname.

## E. Verifikasi (dikerjakan tim sistem, baca-saja)
Setelah Gudang selesai, kabari tim; mereka menjalankan `docs/cek-pasca-putaway-gr-141026-01.sql` dan memastikan: tepat **1 movement per baris**, **1 jurnal POSTED** sebesar nilai di atas, tanpa duplikasi dan tanpa adjustment. Setelah itu preview opname dan rekonsiliasi valuasi Finance diperbarui. **Hitung fisik opname dimulai setelah ini**, supaya barang GR ini tidak terhitung dua kali.

## Bila ada yang tidak cocok
Jangan koreksi sendiri lewat penyesuaian stok. Catat: baris mana, angka yang terlihat, pesan layar (foto layar). Koreksi penerimaan yang sudah tersimpan hanya lewat **Koreksi Kedatangan** (wajib alasan, tercatat sebelum–sesudah).
