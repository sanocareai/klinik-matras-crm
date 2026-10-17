# Koreksi per Dokumen — Laporan Keuangan (Okt 2026)

Menyelesaikan gap Laporan Keuangan **satu dokumen per langkah**. Tidak ada posting massal, tidak ada tebakan harga/tanggal/nilai. Semua angka di bawah dibaca ulang dari produksi saat rilis (lihat `smoke.log`), bukan dari audit lama.

## Alur
Buka **Laporan Keuangan → Laba Rugi → Koreksi Dokumen** (atau tautan dari tab Gap Pembukuan). Hanya Admin/Owner yang dapat menyimpan; Finance biasa melihat bukti & pratinjau.

### 1. Pengakuan Pendapatan
Daftar order yang sudah diserahkan tetapi pendapatannya belum diakui, dikelompokkan:

| Kelas | Arti | Tindakan |
|---|---|---|
| Perlu keputusan | Diserahkan, ada bukti/uang/tanggal sesudah cutoff buku besar | Buka → periksa bukti → pratinjau jurnal → akui |
| Harga belum diisi (Rp0) | Item berharga Rp0 (gap NILAI_ORDER_NOL) | Tetapkan harga **dari bukti** → lalu akui |
| Riwayat sebelum buku besar | Diserahkan dan dibayar sebelum cutoff | Hanya dihitung; tidak diperinci |
| Lain-lain | PKR, digabung, belum diserahkan, dsb. | Ditahan dengan alasan |

Tiap order menampilkan: bukti sumber (status, POD, pembayaran, uang muka di buku, invoice, gap sistem), **penyebab yang terbukti**, tanggal serah, pilihan tanggal pengakuan (hanya dari bukti), **pratinjau jurnal**, dampak ke pendapatan / piutang / uang muka, dan alasan bila tertahan.

Aturan keras:
- **Tanggal** hanya dari POD, riwayat status serah, atau *Keputusan Owner* (tanggal + bukti referensi + alasan). Tanggal sebelum cutoff buku besar atau di masa depan ditolak.
- **Bukti serah wajib.** Order tanpa pengiriman selesai maupun riwayat status serah (mis. job masih UNSCHEDULED) ditahan KERAS: pratinjau dan simpan ditolak `422 SERAH_TIDAK_TERBUKTI` walau memakai *Keputusan Owner*. Penyerahan harus dibuktikan dulu lewat alur Delivery; Keputusan Owner hanya menentukan *tanggal buku* untuk order yang SUDAH punya bukti serah (mis. pra-cutoff).
- **Harga** hanya diisi manusia (item Rp0 saja, wajib bukti). Harga katalog hanya acuan tampilan. Menyimpan harga tidak memposting jurnal.
- Order **Lunas tanpa catatan pembayaran**, PKR, digabung, atau belum diserahkan ditahan tanpa override.
- Order diserahkan **sebelum cutoff** hanya bisa diakui lewat Keputusan Owner + persetujuan eksplisit.
- Menyimpan butuh **PIN Finance**, alasan ≥10 karakter, dan `Idempotency-Key`. Replay/klik ganda/paralel → satu jurnal. Periode tertutup → ditolak tanpa jejak.
- **Pembalikan** hanya untuk jurnal hasil koreksi ini, ditolak bila ada transaksi lain yang memakai piutang order itu atau periode tertutup; jurnal balik resmi bertanggal hari ini.

### 2. Atribusi Beban Divisi
Dokumen biaya (Pengeluaran/Pembelian) yang buktinya menunjuk >1 divisi. Finance Admin memilih divisi yang benar dengan alasan; riwayat sebelum/sesudah tersimpan (`fin_attribution_decisions`, append-only, satu keputusan aktif per dokumen). **Tidak mengubah jurnal maupun total beban** — hanya divisi mana yang dipakai laporan. Keputusan dapat dicabut (konflik muncul lagi).

## Tidak dilakukan
Backfill 254 ISSUE, harga referensi Excel, SO Oktober yang gagal, scope stok fisik/pemakaian bahan Produksi–Gudang. Margin tetap *belum final* selama HPP bahan belum lengkap.

## Rilis & rollback
`scripts/release-koreksi-dokumen.sh` (fail-closed: pin migrasi + pemindai DDL, backup–restore, rehearsal pada salinan restore termasuk pengakuan/harga/atribusi sungguhan, smoke baca-saja). Rollback kode: jalankan `scripts/rollback-guard-koreksi-dokumen.sh` (menolak bila ada keputusan atribusi aktif).
