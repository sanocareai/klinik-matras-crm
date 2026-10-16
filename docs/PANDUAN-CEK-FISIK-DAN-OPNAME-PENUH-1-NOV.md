# Panduan Gudang — cek fisik prioritas sekarang, lalu Opname Penuh 1 November 2026

Untuk: Kepala Gudang, petugas Gudang (penghitung dan pemeriksa), Finance, Owner, Tech. Dibuat 16 Okt 2026.
Dasar: file Stock Gudang adalah **catatan kerja**, bukan hasil opname (SO Oktober gagal) dan bukan saldo resmi. Saldo resmi = ledger sistem. Catatan Gudang dipakai untuk **menunjuk bahan yang perlu dicek fisik**, bukan untuk mengganti saldo. Tidak ada adjustment massal dari file, tidak ada jurnal, tidak ada GR dibatalkan oleh alat ini.

## A. Cek fisik prioritas (sekarang → ± 23 Okt)
Daftar dari `rekon-catatan-gudang.xlsx` (sheet *Prioritas (menghambat)*) dan lembar buta `Lembar-Cek-Fisik-CF-xx.xlsx`.
- **P1 menghambat** — sistem ≤ 0 tetapi catatan Gudang menyatakan barang ada → Material Issue tertahan (saldo tidak boleh minus). Kerjakan dulu.
- **P2 risiko** — sistem positif tetapi catatan menyatakan habis/negatif → sistem bisa mengeluarkan barang yang mungkin tidak ada (atau catatan masuk/awal tidak lengkap).
- **P3** selisih besar, dan semua bahan ledger negatif.

Langkah per batch (lakukan oleh orang yang berbeda untuk hitung dan periksa):
1. Gudang → Stock Opname → Schedule Count: jenis **Cycle Count** (batch CF), *By Item*, blind count menyala, tambahkan bahan sesuai lembar. Penghitung membuat sendiri dari akunnya.
2. **Start Count** (snapshot saldo + waktu tercatat). Hitung buta, **satuan master**; masukkan angka di aplikasi segera per bahan. Nol hanya bila dicari dan memang kosong (beri alasan). Barang tiba yang belum diputaway, dalam perjalanan, sisa di lantai produksi, atau milik customer **tidak** dihitung di rak.
3. Tandai satu per satu pergerakan ledger yang terjadi selama sesi (sudah/belum masuk hitungan fisik). Submit.
4. Pemeriksa (akun lain) menekan **Saya memeriksa hitungan ini** (wajib untuk Opname Penuh; sangat dianjurkan untuk Cycle Count).
5. Koreksi resmi, per bahan, oleh penyetuju **OWNER/FINANCE yang bukan penghitung/pemeriksa**: **Complete Count** (menulis ADJUSTMENT untuk baris berselisih; alasan wajib) **atau** Stock Adjustment per bahan (pengaju Gudang → penyetuju lain → posting Gudang). Tidak ada koreksi satu langkah.
6. Selisih yang disebabkan **pemakaian lama yang tidak tercatat** (89 bahan punya KELUAR Oktober hanya di file) cukup diselesaikan oleh hasil hitung fisik; **tidak** direkonstruksi per transaksi tanpa bukti.
7. Konflik satuan (LEM KG vs CAN, LIST WIBING METER vs ROLL, dst) **diputuskan dulu** (faktor + satuan hitung) sebelum dihitung; sistem tidak mengonversi.
Koreksi sementara ini hanya agar produksi berjalan; **saldo definitif ditetapkan Opname Penuh 1 Nov**. Jangan mengoreksi bahan P3/P4 sebelum 1 Nov kecuali menghambat pekerjaan.

## B. Opname Penuh 1 November 2026 (Minggu)
Tujuan: menetapkan saldo definitif seluruh bahan (370 per 16 Okt; roster dibaca ulang saat hari-H). 1 Nov 2026 jatuh pada **hari Minggu** — cocok untuk membekukan gudang.

### B1. Keputusan sebelum menjadwalkan
| # | Keputusan | Pemutus | Catatan |
|---|---|---|---|
| 1 | Tanggal cutover Finance. Pengaturan masih bawaan 1 Okt dan draf PSA-30092026-001 (counted_at 30 Sep 23:59, 0 baris) | Owner + Finance | Opsi A: hitung 1 Nov dengan gudang dibekukan sejak 31 Okt sore → cutover 1 Nov, PSA baru counted_at 31 Okt 23:59. Opsi B: cutover 2 Nov, counted_at 1 Nov 23:59. **Jangan** backdate ke 30 Sep; PSA lama dibatalkan/diganti **hanya setelah** keputusan. |
| 2 | Dua petugas Gudang nyata (penghitung, pemeriksa) + cadangan | Owner | Akun nyata, bukan akun bersama "OWNER (Admin)". Saat ini hanya Nadya Marsha berperan WAREHOUSE. |
| 3 | Penyetuju (OWNER/FINANCE), ≥ 2 orang, berbeda dari penghitung/pemeriksa | Owner | Gilang, Juri, Kemal, Natasha memenuhi syarat peran. |
| 4 | Perlakuan pembelian tanpa GR dan 242 order lama | Owner | Tidak direkonstruksi tanpa bukti per transaksi. |
| 5 | Satuan & faktor (LEM, LIST WIBING, COTTON SHEET, STREPLES, PAKU, KAYU RACUK, BUSA REBONDED BATU, RODA) | Gudang + Tech | Perbaiki master/satuan hitung sebelum hari-H. |
| 6 | Pemetaan 63 baris file yang belum berpasangan | Gudang | Kandidat ada di workbook; keputusan manusia. |

### B2. Jadwal usulan
| Waktu | Kegiatan | PJ |
|---|---|---|
| ≤ 23 Okt | Cek fisik prioritas (bagian A); satuan/faktor diputuskan | Gudang |
| ≤ 28 Okt | Dokumen tertunda tuntas: GR-091026-01 / GR-161026-01 (Ocean), GR-091026-02 (ESA, bukti kedatangan dulu — tidak otomatis ditolak); PO tanpa GR dicatat | Gudang + Finance |
| ≤ 28 Okt | Pilot Opname Penuh kecil (12 bahan) lewat alur lengkap untuk latihan petugas | Gudang + Tech |
| ≤ 30 Okt | Finance menyiapkan harga bersumber **dokumen** (faktur/tagihan/pembelian); harga file tidak dipakai | Finance |
| 29–30 Okt | Roster dibaca ulang, lembar per batch dibuat, backup + rollback tercatat, zona/label rak, pengumuman pembekuan | Tech + Kepala Gudang |
| 31 Okt (Sabtu) sore | Pembekuan: tidak ada GR/Issue/transfer; catatan terakhir dokumen | Kepala Gudang |
| **1 Nov** | Hitung per batch (± 30 bahan/batch, 13 batch) → input → tandai → Submit → periksa | Gudang |
| 1–2 Nov | Preview/matriks baca-saja, keputusan Gudang + Finance per bahan, paket persetujuan (hash), persetujuan pemeriksa + penyetuju berbeda | Tech + Gudang + Finance |
| 2–3 Nov | Eksekusi (Complete/adjustment) hanya bahan GO; jurnal persediaan awal oleh Finance (Owner + PIN) terpisah | Penyetuju + Finance |

### B3. Aturan hari-H
Opname Penuh wajib diperiksa akun lain sebelum Complete (409 `PEMERIKSA_BELUM_ADA`); pemeriksa tidak boleh menyetujui. Kosong bukan nol. Tidak ada Complete/posting sebelum pemeriksa dan penyetuju berbeda menyetujui paket konkret. Selisih naik dan turun serta nilai Rp naik dan turun dilaporkan terpisah. Saldo operasional sah dimulai pada **timestamp opname** (bukan 30 Sep); jembatan 1 Okt → cutover dan penutupan September (belum terbukti) dilaporkan terpisah.
