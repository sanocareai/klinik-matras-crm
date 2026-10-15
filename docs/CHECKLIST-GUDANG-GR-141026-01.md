# Checklist Gudang — Putaway GR-141026-01 (TOKO BERSAMA FURNITURE, PO-13102026-003)

Untuk: petugas Gudang (yang menjalankan putaway) dan pemeriksa Gudang. Putaway dilakukan **manual lewat UI Penerimaan Barang** setelah pemeriksaan di bawah. Tidak ada putaway otomatis, tidak lewat SQL, tidak oleh Tech/Claude.
Kondisi sistem saat checklist dibuat (15 Okt 2026, 06:15 UTC): status **READY_FOR_PUTAWAY**, belum ada movement, belum ada jurnal.

## 1. Cocokkan fisik dengan dokumen (7 baris)

| # | Kode | Dipesan (PO) | Diterima | **Diterima baik** (sekarang) | Harga PO | Nilai bila putaway apa adanya |
|---|---|---|---|---|---|---|
| 1 | KAI-001 | 12 METER | 12 | **8** ← periksa | Rp65.000 | Rp520.000 |
| 2 | KAI-002 | 11 METER | 11 | 11 | Rp65.000 | Rp715.000 |
| 3 | KAIN-OSCAR-HITAM | 40 METER | 40 | 40 | Rp21.250 | Rp850.000 |
| 4 | SPANBON-75GRAM | 100 METER | 100 | 100 | Rp6.700 | Rp670.000 |
| 5 | STREPLES-10-13 | 10 PACK | 10 | 10 | Rp27.000 | Rp270.000 |
| 6 | LIST-WIBING-ABU | 5 ROLL | 5 | 5 | Rp90.000 | Rp450.000 |
| 7 | LIST-WIBING-COKLAT | 10 ROLL | 10 | 10 | Rp85.000 | Rp850.000 |
| | **Total** | | | | | **Rp4.325.000** |

Yang Gudang pastikan, satu per satu (centang di kertas, jangan menebak):
- [ ] Jumlah fisik yang benar-benar baik tiap baris = kolom "Diterima baik". Satuan = satuan master (ROLL untuk wibing, bukan meter).
- [ ] **KAI-001:** diterima 12 tetapi diterima baik 8. Pilih dan catat alasan: (a) 4 meter rusak/cacat → isi *ditolak* 4 + kondisi, nilai tetap 8; (b) seluruhnya baik → ubah *diterima baik* menjadi 12 (nilai total menjadi **Rp4.585.000**, +Rp260.000); (c) ada 4 meter belum terhitung → hitung ulang di rak.
- [ ] Tidak ada barang dari GR ini yang sudah dicatat lewat jalur lain (cek Riwayat Pergerakan: tidak ada RECEIPT untuk 7 kode ini sejak 14 Okt).
- [ ] Foto barang + surat jalan difoto dan nomornya dicatat di kolom catatan GR.
- [ ] Pemeriksa kedua (orang lain dari petugas putaway) sudah memeriksa dan menandatangani kertas.

## 2. Hal yang perlu diketahui sebelum menekan putaway
- Saldo catatan LIST-WIBING-ABU **−388,5** dan LIST-WIBING-COKLAT **−116,5** (warisan impor pemakaian dalam meter terhadap satuan roll). Setelah hotfix 15 Okt, penerimaan **diterima** walau saldo minus. Setelah putaway saldo menjadi −383,5 dan −106,5: **tetap minus** — itu diselesaikan opname, bukan putaway. Jangan membuat adjustment untuk "membersihkan" minus sebelum opname.
- Nilai persediaan masuk Dr 1-1400 / Cr 2-1150 sebesar Σ(diterima baik × harga PO). Perbedaan harga dengan faktur ditangani Finance saat tagihan.
- Putaway **sekali saja**. Bila layar menolak/lambat, jangan menekan berulang: periksa dulu Riwayat Pergerakan. Sistem menolak putaway kedua, tetapi catat kejadiannya.
- GR-151026-01 (SCHEDULED, PT ESA BUMINDO) dan GR-091026-02 menunjuk PO yang sama (LEM-I-SR-1037-13-KG 10 CAN). Itu bukan bagian GR ini; batalkan salah satunya sebelum ada yang di-putaway.

## 3. Langkah putaway (hanya petugas Gudang, lewat UI)
1. Penerimaan Barang → buka GR-141026-01 → cek 7 baris sesuai bagian 1 (ubah *diterima baik* KAI-001 bila perlu).
2. Simpan ke Stok (putaway) **satu kali**.
3. Catat jam putaway dan nama petugas di kertas; foto layar "Selesai".

## 4. Sesudah putaway — verifikasi (Tech, baca-saja)
Jalankan `verifikasi-gr-141026-01.sql` (PGOPTIONS default_transaction_read_only=on). Harus:
- status GR **COMPLETED**; **7** movement RECEIPT (tepat satu per baris, qty = diterima baik, harga = harga PO); tidak ada baris dengan >1 movement;
- **1** jurnal `PENERIMAAN_BAHAN` (idempotensi `PENERIMAAN_BAHAN:<id GR>`) dengan nilai = Σ(diterima baik × harga PO): **Rp4.325.000** bila KAI-001 = 8, **Rp4.585.000** bila 12;
- saldo: ABU −388,5 → −383,5; COKLAT −116,5 → −106,5; SPANBON 100 → 200; STREPLES 3 → 13; KAI-002 0 → 11; OSCAR 0 → 40; KAI-001 0 → diterima baik.
Lalu: ambil ulang saldo dan dokumen tertunda, dan perbarui preview opname 12 material (angka GR dipakai **hanya sesudah** hasil verifikasi LULUS).

## 5. Bila ada yang tidak cocok
Jangan memperbaiki lewat SQL atau adjustment spontan. Lapor ke Finance + Tech dengan hasil verifikasi; koreksi penerimaan memakai jalur resmi koreksi penerimaan (Finance) bila perlu.
