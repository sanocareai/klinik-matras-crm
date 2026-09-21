# Rekonsiliasi Pendapatan & Rekening 2026 — metodologi dan hasil agregat (disanitasi)

Diperbarui 22 Sep 2026. Dokumen ini **hanya** memuat metodologi, hasil agregat, dan manifest artefak. Tidak memuat nama pelanggan, rincian transaksi, mutasi rekening, atau proposal jurnal per transaksi. Bukti mentah disimpan di lokasi privat di luar Git (lihat manifest: `docs/pilot/manifest-rekonsiliasi-20260921.json`).

## Status & keputusan Owner (22 Sep 2026)

- **Tidak ada jurnal produksi yang dibuat/diubah.** Jumlah jurnal 2.863 sebelum dan sesudah seluruh pekerjaan; total debit/kredit buku besar identik. Kas & Bank, JV-19092026-372, JV-21092026-391, akun 2-1600 tidak disentuh.
- **Ditangguhkan (tidak dijalankan):** proposal 298 jurnal pengakuan pendapatan, koreksi PT Sano Rp27.395.000, koreksi KEM, posting historis apa pun.
- **Rekonsiliasi bank menunggu cutoff baru** (tanggal & jam WIB) beserta rekening koran PT Sano dan KEM dari 19 Sep 2026 20.00 WIB sampai cutoff tersebut.
- **APK internal v1.1.0 menunggu reset kuota EAS (1 Okt 2026).** Keystore produksi tidak dipakai/disalin lokal. Tidak ada EAS Update/AAB.
- Peringatan UI "Pendapatan 2026 masih dalam proses rekonsiliasi data sebelum sistem dan backfill order. Angka belum final." dipertahankan (web + mobile).
- File data mentah dilarang di Git (`.gitignore` diperbarui); bukti mentah di `C:\Users\rudya\SANO-PRIVATE\finance-2026-09-21\`.

## 1. Data Sebelum Sistem (arsip Notion "Incomes")

Berkas ekspor Notion (943 baris; SHA-256 `29049dc1…56d3`) diimpor sebagai register **non-posting** (batch `e6e156d7…`). Isinya catatan uang masuk per rekening, bukan invoice/order — tanpa kolom pelanggan/nomor order/jenis. Hasil: 618 baris siap (Jan–11 Jul; Rp1.622.376.331), 305 di luar periode (12 Jul–16 Sep; Rp923.825.500; tidak dihitung), 2 perlu ditinjau, 18 bukan pendapatan/tidak valid.

> Catatan: berkas CSV Notion sudah ter-*track* di Git sejak sebelum pekerjaan ini (`backend/data/notion-data-2026/`) dan memuat nama pelanggan. Belum diubah; keputusan `git rm --cached`/pembersihan riwayat ada pada Owner.

## 2. Audit order 12 Jul – 16 Sep

Dari 458 order non-batal, 30 sudah diakui (17–21 Sep) → 428 belum. Layak diakui (selesai, tanggal pengiriman terbukti): 298 (Rp744.615.500). Selesai tanpa bukti tanggal: 50 (Rp102.294.500, Perlu Ditinjau). Berjalan: 68 (Rp140.107.000). Nilai Rp0: 12. Refund aktif: 0. Batal: 30 (di luar 458). Tanggal pengakuan = tanggal pengiriman selesai pertama; akun menurut jenis order (4-1100/4-1200/4-1300/4-1900). Simulasi (tidak dijalankan): pendapatan +Rp744,6 jt, piutang +Rp9,79 jt, Koreksi Saldo Awal −Rp734,7 jt, total ekuitas +Rp9,89 jt, saldo rekening tidak berubah. **Proposal ditangguhkan.**

## 3. Pencocokan lanjutan Notion ↔ order (12 Jul–16 Sep; 305 baris)

Kode: `backend/src/services/finance/cocokNotion.js` (murni, tanpa database; tes `backend/tests/cocokNotion.test.js`). **Hanya laporan; tidak mengubah data produksi.**

**Metode.** (a) Ekstrak nama dari "Pembayaran/Pelunasan/DP <nama>", buang tag `(…)`/`[…]`. (b) Normalisasi: huruf kecil, tanpa aksen/emoji/tanda baca, buang gelar (ibu/bapak/mba/dr/hj/an/pt…), seragamkan singkatan (M./Moh/Muh → muhammad), abaikan urutan kata. (c) Skor nama 0–1: sama = 1; token saling memuat ≈ 0,9; typo ringan ≈ 0,85. (d) Nominal: sama persis dengan nilai order (harga + ongkir); kombinasi cicilan (2–4 penerimaan berjumlah tepat satu order); satu pembayaran untuk beberapa order (kombinasi 2–3 order pelanggan sama). (e) Jendela tanggal: 3 hari sebelum order dibuat s.d. 45 hari setelah pengiriman/dibuat. (f) Rekening hanya pendukung: kolom "Accounts" Notion ambigu (sebagian "Untitled"/dua rekening) sehingga tidak dijadikan syarat.

**Confidence.** *Tinggi* = nama kuat + nominal tepat + tanggal dalam jendela + penjelasan **unik** (dan order tidak diklaim penuh oleh penerimaan lain). *Sedang* = nominal tepat tetapi tidak unik/tanggal di luar jendela/nama kurang kuat, atau nama kuat dengan nominal sebagian (DP/cicilan belum lengkap). *Rendah* = hanya nama atau hanya nominal. *Tidak ada* = tanpa kandidat. **Hanya Tinggi (unik) dianggap terjelaskan.**

| Confidence | Baris | Nilai | Rincian jenis |
|---|---:|---:|---|
| **Tinggi (terjelaskan)** | 127 | Rp412.784.000 | penuh 106, gabungan beberapa order 19, cicilan 2 |
| Sedang (Perlu Ditinjau) | 81 | Rp230.551.500 | penuh-tidak-unik 35, sebagian/DP 33, gabungan-tidak-unik 13 |
| Rendah (Perlu Ditinjau) | 77 | Rp220.302.000 | nominal saja 53, nama saja 24 |
| Tidak ada | 20 | Rp60.188.000 | 16 nama tidak ada di order sistem, 3 deskripsi lain, 1 korporat/sewa |
| **Total** | 305 | Rp923.825.500 | |

Per bulan (Tinggi/Sedang/Rendah/Tidak ada): Jul 30/13/25/10 · Agu 59/45/39/9 · Sep 38/23/13/1.

**Temuan.** 127 penerimaan Tinggi menjelaskan **148 order** — seluruhnya berstatus pembayaran LUNAS di sistem, dan jumlah penerimaan **sama persis** dengan nilai order (0 order kurang, 0 order kelebihan/dobel). Dari 23 pembayaran sistem (sejak 1 Sep), hanya 2 yang sama nominal dengan penerimaan Notion untuk order yang sama; 21 lainnya tidak ada di Notion (Notion berhenti dipakai sebagai catatan utama pada September). 365 order LUNAS non-batal: 47 (Rp96,58 jt) tanpa satu pun kandidat Notion, 19 di antaranya punya pembayaran di sistem.

## 4. Audit double counting (305 baris Notion vs order sistem)

- **Register tidak menghitung satu pun dari 305 baris** (semuanya *Di luar periode*), sehingga pendapatan historis tidak menggandakan pendapatan order sistem. Pendapatan gabungan = sistem + baris SIAP sebelum 12 Jul saja.
- Uji arah sebaliknya: baris SIAP sebelum cutoff (1 Jun–11 Jul; 212 baris) terhadap order sistem — **0** kecocokan Tinggi; 16 baris (Rp38.490.000) Sedang (mis. nominal & nama cocok tetapi tanggal jauh sebelum order) → **Perlu Ditinjau**, batas atas risiko hitung ganda pada register.
- 178 baris Notion periode sistem (Sedang/Rendah/Tidak ada; Rp511 jt) tetap Perlu Ditinjau; tidak dijurnal.
- Order berstatus LUNAS tanpa catatan pembayaran (293 dari 298 yang layak) dan penerimaan Notion Tinggi saling menguatkan bahwa uangnya diterima sebelum pembayaran dicatat di sistem — dasar asumsi "lawan ekuitas non-kas" (3-4100) pada proposal yang ditangguhkan.

## 5. Dua order sudah diakui tetapi belum selesai (bukti & proposal saja; jurnal tidak dibalik)

| Order | Bukti | Penilaian | Proposal (tidak dijalankan) |
|---|---|---|---|
| `RES-13092026-079` (layanan) | Pengiriman selesai 17 Sep; unit berstatus DELIVERED; pengakuan JV-17092026-002 dijurnal 17 Sep oleh admin keuangan sesuai serah-terima. Pada 21 Sep 11.26 status order dikunci manual ke PROCESSING (tanpa catatan) dan dibuat tugas PICKUP baru (belum dijadwalkan). | Pengakuan **sah** saat dibuat; status mundur = kemungkinan revisi/retur/komplain baru. | Pertahankan jurnal. Konfirmasi ke pengubah status apakah ini revisi (bukan retur). Jika retur/refund: gunakan alur Refund resmi (bukan membalik pengakuan). Catat alasan pada order. |
| `NEW-30082026-023` (produk) | Pengakuan JV-21092026-429 dijurnal 21 Sep 16:45:50; status order dikunci manual ke SHIPPING 2 detik kemudian (16:45:52) oleh pengguna yang sama; pengiriman masih SCHEDULED; unit READY_FOR_DELIVERY; tidak ada pengiriman selesai. | Pengakuan **prematur**: barang belum diserahterimakan (kemungkinan status sempat diset ke Delivered lalu dikoreksi ke Shipping). | Setelah persetujuan Owner: balik JV-429 lewat pembalikan resmi, lalu akui saat pengiriman selesai. **Peringatan teknis:** mesin pengakuan menganggap kunci `PENGAKUAN_PENDAPATAN:<orderId>` sudah ada walau jurnalnya dibalik; pengakuan ulang akan menjadi no-op — pembalikan harus melepaskan kunci (atau memakai sufiks koreksi) sebelum pengakuan ulang. Efek jika dibalik: pendapatan −Rp2.961.000, piutang −Rp2.961.000. |

## 6. Rekonsiliasi bank — ditangguhkan

Cutoff baru dan rekening koran belum tersedia; **selisih PT Sano dan KEM pada cutoff yang sama tidak dilaporkan** (tidak boleh membandingkan saldo dari waktu berbeda). Catatan hipotesis kerja (tidak dipakai sebagai kesimpulan): jurnal pembayaran/pengeluaran bertanggal sebelum saat saldo riil kalibrasi diambil tetapi dijurnal sesudahnya berpotensi menggandakan kas; untuk PT Sano pola ini menjelaskan 100% selisih terhadap saldo riil yang diberikan (13 jurnal), untuk KEM sebagian (sisa belum terjelaskan). Proposal koreksi per transaksi (24 baris) **dinonaktifkan**; akan disusun ulang setelah cutoff baru + mutasi bank tersedia. Dokumen kunci yang dibutuhkan: rekening koran PT Sano & KEM (19 Sep 2026 20.00 WIB → cutoff), tanggal & jam WIB cutoff.

## 7. Manifest artefak privat

Lihat `docs/pilot/manifest-rekonsiliasi-20260921.json` (nama artefak, ukuran, jumlah baris/rekord, SHA-256). Artefak sendiri **tidak** ada di Git.
