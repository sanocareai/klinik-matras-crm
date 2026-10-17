# Daftar Keputusan per Dokumen — Laporan Keuangan (17 Okt 2026)

Dibaca baca-saja dari produksi pada live `d4d0dee2` (17 Okt 2026, ± 11.30 WIB). **Belum ada jurnal diposting, atribusi diubah, PIN dimasukkan, atau koreksi massal dijalankan.** Semua angka di bawah dibaca ulang dari data, bukan dari audit lama. Tanggal buku, harga, tanggal serah, dan sumber uang **tidak ditebak**: bila bukti tidak ada, dokumen ditahan.

Penyetuju: **Owner** = keputusan bisnis/tanggal/kebijakan. **Finance Admin** = menyimpan di sistem (PIN Finance). **Akuntan** = tinjauan kebijakan periode. Menyimpan apa pun di layar *Koreksi Dokumen* butuh PIN Finance (hanya Admin/Owner).

Ringkasan layar Koreksi Dokumen (live): perlu keputusan **17** order (Rp21.630.000) · harga Rp0 **18** · riwayat sebelum buku besar **329** (hanya dihitung) · lain-lain 1 · konflik atribusi **18 dokumen** (Rp11.166.831). Margin tetap **belum final** (254 ISSUE tanpa nilai; tidak di-backfill).

---

## 1. Pengakuan pendapatan — 17 order perlu keputusan

Kelas tunggal per order. Pratinjau jurnal ada di layar (dibatalkan setelah dilihat); tanggal pada pratinjau pra-cutoff hanyalah contoh.

### 1A. Pra-cutoff (diserahkan sebelum 18 Sep) dengan uang masuk terverifikasi & terjurnal — 4 order, Rp7.090.000

Uang sudah masuk **Uang Muka Pelanggan** (kewajiban) sebesar pembayaran; pendapatan belum diakui. Jurnal bila disetujui: `Dr Piutang / Cr Pendapatan` lalu `Dr Uang Muka / Cr Piutang` → pendapatan +nilai, piutang tetap Rp0, uang muka −nilai.

| Order | Nilai | Bukti serah | Pembayaran (ledger) | Status bukti | Usulan |
|---|---|---|---|---|---|
| RES-09092026-045 | 3.990.000 | Job DELIVERY 14 Sep, **POD terverifikasi**; status Natasha 14 Sep | 28 Sep, verifikasi sama hari, JV-28092026-736 | **Lengkap** | Owner tetapkan tanggal buku → terapkan |
| SWS-14092026-007 | 100.000 | DELIVERY 15 Sep **terverifikasi**; ambil kembali 18 Sep terverifikasi | 19 Sep, JV-19092026-401 | **Lengkap** | Owner tetapkan tanggal buku → terapkan |
| RES-02092026-011 | 1.500.000 | Job selesai 9 Sep 15:11 WIB, 1 foto, **POD belum diverifikasi** | 8 Okt, verifikasi 9 Okt, JV-08102026-281 | Serah belum terbukti kuat | **Tahan** sampai POD diverifikasi / bukti serah fisik |
| RES-07092026-034 | 1.500.000 | Job selesai 9 Sep 15:11 WIB, **13 detik** setelah order -011; status oleh Kiki; **POD belum diverifikasi** | 8 Okt, JV-08102026-282 | Pola penutupan administratif | **Tahan** (sama) |

**Keputusan Owner:** tanggal buku untuk 045 dan SWS-007. Opsi: (a) 18 Sep (hari pertama buku besar) — pendapatan masuk periode Sep 18–30; (b) tanggal uang masuk (28 Sep / 19 Sep) — juga September; (c) tanggal lain di ≥ 18 Sep. Tanggal sebelum 18 Sep **ditolak sistem** (buku besar belum ada). Risiko: pendapatan Sep 18–30 naik Rp4,09 jt; kewajiban Uang Muka turun Rp4,09 jt; tidak ada kas yang berubah. Persetujuan eksplisit "mengakui di periode berjalan" wajib (bukan arsip pra-buku).

### 1B. Pra-cutoff dan "LUNAS tanpa pembayaran" — 10 order, Rp12.100.000 — **TETAP DIBLOKIR**

RES-19082026-083 … -092 (HOTEL DISCOVERY ANCOL; 083–086 @1,5 jt; 087–091 @1,0 jt; 092 @1,1 jt).

Bukti: **tidak ada satu pun Payment**; semua ditandai LUNAS manual pada 30 Sep 23:15–23:17 WIB (burst 2 menit); status "diserahkan" 2 Sep oleh Kiki, tetapi satu-satunya job adalah **PICKUP** selesai 4 Sep (tidak ada job pengiriman). Satu pelanggan, dibuat dalam 8 menit pada 19 Agt. Pada 14 dan 16 Okt ada biaya "tagihan Ancol" (Lalamove, gerbang, JNE) → indikasi hotel **sedang ditagih**, bukan sudah lunas (indikasi, bukan bukti). Invoice: 9 DRAFT, 1 SENT (085).

Tindakan (bukan koreksi pengakuan): Finance memeriksa apakah hotel membayar; bila ya → catat Payment dengan bukti lewat penuntasan pembayaran historis; bila belum → status LUNAS salah dan harus dikoreksi order oleh Admin. Baru setelah itu pengakuan dipertimbangkan. **Penyetuju:** Owner + Finance Admin.

### 1C. Sewa Oktober — 2 order, Rp350.000

| Order | Nilai | Bukti | Penghalang | Usulan |
|---|---|---|---|---|
| SWS-13102026-001 | 150.000 | DELIVERY selesai 14 Okt 10:39 WIB, penerima "Pa hendro", GPS (akurasi 13 m), 1 foto; selesai oleh Agung (driver Alwan); belum dibayar; invoice DRAFT | POD belum diverifikasi; PIN | Jurnal: `Dr Piutang 150.000 / Cr Pendapatan Sewa 150.000`, tanggal 14 Okt (Oktober terbuka). Terapkan setelah POD diverifikasi/Owner menyatakan cukup |
| SWS-16102026-003 | 200.000 | **Job UNSCHEDULED**, tanggal kirim terkonfirmasi **19 Okt (belum terjadi)**; status SEWA_DIKIRIM terpasang saat order dibuat | Belum terkirim | **Jangan diakui.** Koreksi yang benar adalah status order (data), bukan pendapatan |

### 1D. Pengakuan sudah dibalik — 1 order, Rp2.090.000 — **TAHAN**

**NEW-23092026-040** (Ninik [Cs Vina], kasur Sano 90x200). Kronologi dari ledger & audit:
- 23 Sep order dibuat; 24 Sep 14:47 Payment **QRIS Rp2.090.000** dicatat Natasha **tanpa rekening, tanpa nomor referensi, tanpa foto bukti**, **diverifikasi oleh Natasha sendiri 32 detik kemudian** (pencatat = pemverifikasi).
- 26 Sep job selesai; Gilang memposting pengakuan JV-26092026-672 (Dr Piutang / Cr Pendapatan Produk 2.090.000).
- 29 Sep 08:24 **Kemal membalik** pengakuan (JV-29092026-758) dengan alasan **"belum ada sumber bank"**.
- 29 Sep 09:02 (38 menit sesudahnya) jurnal pembayaran JV-24092026-763 diposting Gilang setelah sistem membuat gap *REKENING_BELUM_DIPETAKAN*; sistem **memasang rekening bawaan QRIS "KEM - Sano Bank"** (tanggal 24 Sep). Rekening itu **bukan** dari pencatat pembayaran.
- Impor mutasi bank di sistem: **0 baris** — tidak ada bukti bank yang dapat dicocokkan; Rekonsiliasi Bank belum dipakai.

Kesimpulan: **sumber uang tidak terbukti** (rekening ditebak sistem, tidak ada mutasi/pencairan QRIS). Bukti yang dibutuhkan: laporan pencairan QRIS merchant dan mutasi rekening untuk 24–27 Sep (nilai 2.090.000 atau neto MDR), atau pernyataan Owner/Kemal atas alasan pembalikan. Setelah itu: (1) Finance memutuskan sumber uang; (2) bila terbukti, order dapat diakui ulang tanggal 26 Sep dengan persetujuan eksplisit (kunci jurnal "ULANG"); bila tidak terbukti, uang muka Rp2,09 jt tetap kewajiban dan pembayaran perlu ditinjau/dikoreksi. **Penyetuju:** Owner (alasan pembalikan) + Finance Admin.

### 1E. Order harga Rp0 — 18 order (nilai tidak terbukti, tidak diisi)

8 berasal dari gap sistem; sisanya tanpa gap. 16 di antaranya juga LUNAS tanpa pembayaran → diblokir (lihat 1B). Hanya **RES-01102026-008** (DELIVERED, belum bayar, serah 6 Okt) dan **SWS-21092026-011** (SEWA_DIAMBIL, belum bayar) tidak punya penghalang lain — butuh **harga dari penawaran/kesepakatan** (diisi manusia + bukti) sebelum pengakuan. Harga katalog hanya acuan tampilan.

---

## 2. Konflik atribusi divisi — 18 dokumen, Rp11.166.831

Keputusan **tidak mengubah jurnal maupun total beban**; hanya menghapus tanda konflik dan menetapkan divisi. Semua usulan di bawah = divisi yang **sudah dipakai laporan** (tertulis di dokumen) → total per divisi **tidak berubah** (sebelum = sesudah); bila Finance memilih kandidat lain nilai berpindah antar-divisi sebesar nilai dokumen.

| Kelompok | Dokumen (nilai) | Dasar | Usulan | Kepastian |
|---|---|---|---|---|
| Iklan Meta/TikTok — 5 dok, **Rp8.613.700** | EXP-03102026-036 (3.000.000), -037 (1.111.200), 05102026-058 (1.000.000), 11102026-121 (1.502.500), 13102026-154 (2.000.000) | Kategori bawaan "Belanja Iklan" (ADSPEND) dikonfigurasi milik D&T; 6/6 dokumen promosi lain konsisten D&T; tidak ada jurnal BIAYA_IKLAN (tak ada risiko ganda dengan sinkron iklan) | **Digital & Technology** | Jelas |
| Servis Corolla — 1 dok, Rp280.000 | EXP-04102026-040 | Armada hanya pick-up/box; Corolla bukan armada Delivery | **Management** | Cukup jelas |
| Lalamove bahan ke produksi — 3 dok, Rp81.000 | EXP-02102026-031 (35.000), -05102026-076 (30.000), -06102026-070 (16.000) | Deskripsi: plastik/kain/karet ban ke produksi; pola lama 12 dokumen Kurir Eksternal dicatat Produksi (vs 258 Delivery) | **Produksi** | Perlu konfirmasi Finance |
| Tagihan Ancol — 4 dok, Rp107.500 | EXP-14102026-160 (45.000 netto setelah koreksi), -178 (25.000), -179 (27.500), 16102026-186 (10.000) | Biaya menagih (kurir, gerbang, JNE) ke Hotel Discovery Ancol; dokumen tertulis Sales | **Sales** | Perlu konfirmasi Finance |
| Tripod — 2 dok, Rp370.631 | EXP-11102026-124 (220.600), 16102026-189 (150.031) | Dokumen D&T vs kategori Konten Marketing; tak ada dasar menentukan | — | **Tahan** |
| DP villa gathering — 1 dok, Rp500.000 | EXP-12102026-140 | Dokumen Management vs kategori Kesejahteraan (HR&GA); belum ada kebijakan | — | **Tahan** |
| Triplek / kain+plastik — 2 dok, Rp1.214.000 | PUR-05102026-005 (264.000), -004 (950.000) | Dokumen Gudang vs aturan bahan baku→Produksi; kebijakan belum ada | — | **Tahan** |

**Penyetuju:** Finance Admin (simpan, PIN) dengan persetujuan Owner untuk kelompok "perlu konfirmasi". Risiko: salah divisi mengubah Laporan Divisi (total beban tetap).

---

## 3. HPP lintas bulan — pasangan faktur pengganti & dampak

Ledger menunjukkan pembalik Rp102.797.090 pada laporan 18–30 Sep terdiri dari: (i) 22 pasangan EXP/PUR "double-post" (aslinya 2–15 Sep, pembalik 19 Sep: netto Rp0, benar) — hanya terlihat negatif karena jendela 18 Sep tidak memuat aslinya; laporan September penuh benar. (ii) **tiga kasus lintas bulan yang nyata** (jurnal pengganti dicatat mundur ke tanggal asli, pembatalan faktur lama jatuh bulan lain):

| Kasus | Faktur lama (dibatalkan) | Faktur pengganti | Bukti pasangan | Dampak |
|---|---|---|---|---|
| MBB 35.505.600 | BILL-20072026-004 (PT Mitra Bisnis Bersama, "PE-019 : PE ENCASEMENT datang tgl 20 Juli"); dibuat 24 Sep; batal 25 Sep "perlu dikategorikan sebagai bahan baku" | BILL-20072026-005 (ref 2605048, BAHAN_BAKU, 5-1100, tgl 20 Jul; dibuat 25 Sep 07:38, 5 menit sesudah batal); dibayar sebagian 16.810.750 (25 Sep) | Supplier, uraian, tanggal, nominal **identik**; dibuat berurutan oleh Natasha; alasan batal = reklasifikasi | Juli HPP **+35,5 jt terlalu tinggi** (dua faktur); Sept **35,5 jt terlalu rendah**; Utang MBB 31 Jul/31 Agt terlalu tinggi 35,5 jt (71,0 jt vs 35,5 jt) |
| Esa 5.850.000 ×2 | BILL-01092026-003 (1 Sep) dan BILL-15092026-004 (15 Sep), batal 1 dan 5 Okt "pajak tidak terhitung" | BILL-01092026-008 (ref 1981/CR/EB/09/2026) dan BILL-15092026-009 (ref 2126/CR/EB/09/2026), masing-masing **6.493.500 = 5.850.000 × 1,11** (PPN), tgl 1 dan 15 Sep, dibuat 1 dan 5 Okt; keduanya LUNAS | Supplier, uraian "LEM I-SR 1037 13 KG", tanggal, rumus PPN | Sept HPP **+11,7 jt terlalu tinggi**; Okt **11,7 jt terlalu rendah**; Utang Esa 30 Sep terlalu tinggi 11,7 jt (24,687 jt vs 12,987 jt) |
| (bukan lintas bulan) Sinar Utama 3.671.325 | BILL-01092026-001 batal 25 Sep | BILL-01092026-005 (3.608.388, LUNAS), sama bulan | Uraian "PLASTIK PE UK 240XROLLX0,05" | Tidak ada koreksi periode |

Data tidak mengikat pasangan secara formal (`replaces_bill_id` kosong) — pasangan dibuktikan dari kecocokan supplier + uraian + tanggal + nominal/PPN + urutan pembuatan + alasan batal.

**Sebelum → sesudah (beban pokok per bulan; total Jul–Okt tetap Rp618.130.545):**

| Bulan | Sekarang | Seharusnya |
|---|---|---|
| Juli | 246.065.063 | 210.559.463 |
| Agustus | 202.204.177 | 202.204.177 |
| September | 166.950.553 | 190.756.153 |
| Oktober | 2.910.752 | 14.610.752 |

**Utang Usaha per supplier (akhir bulan, sebelum → sesudah):** PT Mitra Bisnis Bersama 31 Jul & 31 Agt 71.011.200 → 35.505.600 (30 Sep tetap 18.694.850); PT Esa Bumindo 30 Sep 24.687.000 → 12.987.000 (31 Okt tetap 0); Sinar Utama tidak berubah.

**Pratinjau jurnal reklas (belum diposting; sumber MANUAL, baris utang membawa supplier):**
1. 31 Jul — `Dr 2-1100 Utang Usaha (MBB) 35.505.600 / Cr 5-1300 Overhead 35.505.600`
2. 25 Sep — `Dr 5-1300 35.505.600 / Cr 2-1100 (MBB) 35.505.600` (menetralkan pembalik JV-25092026-627 di September)
3. 30 Sep — `Dr 2-1100 (Esa) 11.700.000 / Cr 5-1300 11.700.000`
4. 1 Okt `Dr 5-1300 5.850.000 / Cr 2-1100 (Esa) 5.850.000` dan 5 Okt `Dr 5-1300 5.850.000 / Cr 2-1100 (Esa) 5.850.000` (menetralkan JV-01102026-022 dan JV-05102026-115)

**Risiko:** (a) Juli–Oktober semua periode **terbuka** → teknis boleh, tapi laporan bulan lalu berubah (Juli −35,5 jt); (b) jurnal MANUAL tidak membawa atribusi divisi → di *Beban per Divisi* muncul +/− Rp35,5 jt dan Rp11,7 jt di "Belum teratribusi" sementara pembalik asli tetap di divisinya (distorsi divisi, total benar); (c) jurnal pembalik tidak boleh dibalik lagi oleh sistem — itu sebabnya dipakai pasangan jurnal manual; (d) nilai belum final selama HPP bahan historis belum terbukti — reklas ini hanya soal PERIODE, bukan harga bahan. Alternatif tanpa posting: biarkan + catatan pengungkapan, dan ubah kebijakan sistem ke depan ("koreksi tagihan dibukukan pada periode jurnal asli"). **Penyetuju:** Owner (kebijakan koreksi lintas periode) + Akuntan (tinjauan) → Finance Admin (PIN).

---

## 4. Yang tidak dilakukan
Tidak ada jurnal diposting; tidak ada atribusi diubah; tidak ada PIN dimasukkan; tidak ada backfill 254 ISSUE atau harga referensi Excel; stok fisik dan Produksi–Gudang tidak disentuh.
