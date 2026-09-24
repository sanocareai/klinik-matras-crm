# Audit read-only jurnal baru — 24 September 2026 (agregat)

Metode: perbandingan **backup pra-deploy** (`pg_dump` 2.995 jurnal / 6.004 baris) dengan produksi saat audit (3.027 jurnal), lewat query SELECT saja.
Tidak ada transaksi yang diubah, dibalik, dihapus, atau diposting. Rincian per jurnal (nomor, dokumen, aktor, akun) disimpan di lokasi privat, bukan di Git.

## Selisih
| | Jumlah |
|---|---|
| Jurnal baru (tidak ada di backup) | 32 POSTED (bertambah dari 25 saat pertama dilaporkan — aktivitas produksi terus berjalan) |
| Jurnal lama berubah status | 1 (POSTED → REVERSED) |
| Jurnal lama hilang / kolom berubah selain status | 0 / 0 |
| Baris jurnal lama hilang / berubah | 0 / 0 (dari 6.004) |

## Pengelompokan (32 jurnal baru)
| Kelompok | Sumber | Jumlah | Bukti |
|---|---|---|---|
| Operasional normal | Pembayaran order (transfer, terverifikasi) | 11 | dokumen pembayaran ada; 100% transfer |
| Operasional normal | Pengakuan pendapatan order | 4 | keempat order berstatus DELIVERED; aktor staf sales/admin |
| Operasional normal | Pengeluaran | 11 | 0 tertaut pengajuan biaya Delivery, 0 tertaut order |
| Operasional normal | Pembelian | 1 | dokumen ada |
| Operasional normal | Tagihan supplier / Pembayaran supplier | 3 / 1 | dokumen ada |
| Koreksi/reversal | Reversal | 1 | membalik 1 jurnal pengeluaran lama (lihat catatan) |
| Hasil fitur Delivery V2 | — | 0 terbukti | tidak ada jurnal yang dokumen sumbernya milik modul Delivery |
| Hasil fitur Edit & Koreksi Aman | — | 0 | 0 event DOCUMENT_CORRECTED, 0 kunci idempotensi `KOREKSI` |
| Tidak dapat dijelaskan | — | 0 | semua jurnal punya dokumen sumber dan aktor |

Aktor (agregat): 1 staf Finance = 27 jurnal, 3 staf sales/admin = 5 jurnal. Semua jurnal punya pembuat.

## Pemeriksaan integritas (seluruh tabel)
- Jurnal tidak seimbang: **0**. Jurnal tanpa baris: **0**. Total debit = total kredit (5.968.768.706,20).
- Kunci idempotensi ganda: **0**. Jurnal baru tanpa kunci: 1 — reversal (memang tidak memakai kunci).
- Dokumen sumber ganda pada jurnal baru: **0**.
- JV-372/391/515/516/517: tetap POSTED, tidak berubah. Akun 2-1600 dan 2-1700: **0 baris baru**, saldo sama dengan snapshot.
- Saldo berubah tanpa jurnal: **tidak ada**. Saldo kas/bank tidak disimpan di tabel rekening (turunan jurnal); saldo sekarang = saldo pra-deploy + dampak 32 jurnal baru, cocok persis untuk ketiga rekening (PT Sano +11.866.076; KEM −2.279.500; Kas −56.000).

## Catatan tindak lanjut (bukan pelanggaran integritas)
1. **Satu dokumen pengeluaran berstatus DIBAYAR sementara jurnalnya sudah dibalik** lewat reversal (bukan lewat pembatalan dokumen: tidak ada event pembatalan, reversal tanpa kunci idempotensi). Alasan tercatat: biayanya sudah terhitung di utang supplier — konsisten dengan tagihan/pembayaran supplier yang diposting beberapa menit sebelumnya. Perlu Finance memastikan status dokumen itu dirapikan.
2. Angka jurnal baru bertambah selama audit; ulangi perbandingan dengan backup yang sama bila perlu snapshot terbaru.

## Keputusan
**Aman melanjutkan B3.** Tidak ada temuan tidak seimbang, duplikat, perubahan pada jurnal/akun yang dilindungi, atau saldo tanpa jurnal. Penyebab Delivery V2 **tidak** dinyatakan karena tidak ada bukti source/dokumen.
