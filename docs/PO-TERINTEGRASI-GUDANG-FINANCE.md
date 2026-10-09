# PO Terintegrasi Finance–Gudang (Okt 2026)

Satu sumber data: **PO** (`fin_purchase_orders`) → **penerimaan** (`goods_receipts`, satu per pengiriman) → baris penerimaan. Finance dan Gudang membaca dan menulis dokumen yang SAMA.

## Definisi progres (satu helper server: `services/finance/progresPO.js`)

Dipakai API Finance & Gudang (daftar, kartu, detail), batas jumlah datang, dan ringkasan PO. Layar tidak menghitung ulang; definisi dikirim server (`progresDefinisi`).

| Label | Arti |
|---|---|
| Dipesan | jumlah di PO |
| Datang | total yang benar-benar tiba (fisik), termasuk yang kemudian ditolak dan pengiriman pengganti |
| Belum datang | Dipesan − datang pada pengiriman ASLI. Barang ditolak tetap dihitung sudah datang; pengganti tidak mengurangi angka ini (batas PO tidak naik) |
| Belum diperiksa | sudah tiba, hasil baik/ditolak belum diisi Gudang |
| Ditolak | hasil pemeriksaan: ditolak (riwayat) |
| Menunggu pengganti | Ditolak (asli + pengganti yang ditolak lagi) − pengganti yang sudah tiba |
| Baik belum disimpan | jumlah baik − masuk stok |
| Masuk stok | baik yang sudah disimpan (satu-satunya yang menambah stok) |
| Belum dipenuhi supplier | Belum datang + Menunggu pengganti |
| Belum masuk stok | Dipesan − masuk stok |

Invarian: Datang = Belum diperiksa + Ditolak + Baik belum disimpan + Masuk stok.
Fixture: PO 10 KG, datang 8, baik 7, ditolak 1, masuk stok 5 → Datang 8 · Belum datang 2 · Menunggu pengganti 1 · Baik belum disimpan 2 · Belum dipenuhi supplier 3 · Belum masuk stok 5.

### Pengiriman pengganti
Pengganti ditandai di Catat Barang Tiba (centang pengganti) dan menyimpan hubungan ke baris penolakan asal (`goods_receipt_lines.replacement_for_line_id`). Jumlahnya dibatasi sisa penolakan baris asal, tidak menaikkan batas PO (belum datang tetap), dan tidak menggandakan nilai PO, stok, GRNI, faktur, atau jadwal termin: hanya barang baik yang masuk stok dan ditagih. Contoh pengganti 1 KG pada fixture: Datang 9, Menunggu pengganti 0, Belum datang 2, Belum dipenuhi supplier 2. Penolakan asal tidak bisa diturunkan di bawah pengganti yang tercatat, dan penerimaan asal yang sudah punya pengganti tidak bisa ditolak seluruhnya.

## Alur catat kedatangan

1. Finance atau Gudang menekan **Catat Barang Tiba**. Gudang tidak perlu membuat penerimaan lebih dulu.
2. `POST …/draf-penerimaan` menyiapkan atau memakai ulang **draf penerimaan** (idempoten, di bawah kunci PO). Dua petugas yang menekan bersamaan memakai draf yang sama.
3. `POST …/kedatangan` mencatat di draf itu (kunci baris penerimaan → PO, `Idempotency-Key` wajib). Yang kedua menerima 409 `KEDATANGAN_SUDAH_DICATAT`; tidak menimpa, tidak menggandakan.
4. Aktor, peran, workspace dari sesi. Wajib: tanggal tiba, jumlah datang, PIC/penerima, catatan. Surat jalan dan bukti opsional (tampil “Belum dilampirkan”). Koreksi wajib alasan dan tercatat sebelum–sesudah (`goods_receipt_events`, append-only).
5. Stok hanya berubah di **Simpan ke Stok** (Gudang, `inventory:write`). PO, kedatangan, dan faktur tidak membuat stok maupun jurnal persediaan.

## Termin

Faktur atas PO berdasar **tanggal tiba** per penerimaan (`term_basis = TANGGAL_TIBA`). Satu faktur = satu utang = beberapa jadwal jatuh tempo (nilai faktur dibagi per penerimaan menurut alokasi; sisa pembulatan di penerimaan terakhir; pembayaran FIFO menurut jatuh tempo). `fin_supplier_bills.due_date` menyimpan yang **terawal**; angka lain berasal dari jadwal (read-model), bukan kolom.

Konsumen yang memakai jadwal per penerimaan: Jadwal & Aging Utang (kartu, tabel, detail, Excel) dan Umur Utang (laporan, export Supplier & Utang). Filter jatuh tempo menilai tiap baris dengan tanggalnya sendiri.

## Rollback

Dua keadaan berbeda:

1. **Sebelum ada data baru yang memakai fitur ini** (belum ada faktur `TANGGAL_TIBA`, belum ada kedatangan dicatat lewat alur ini): kode boleh di-rollback seperti biasa. Migrasi bersifat aditif (kolom/tabel baru); membiarkannya terpasang tidak berbahaya.
2. **Sesudah ada faktur atau jadwal baru** (`fin_supplier_bills.term_basis = 'TANGGAL_TIBA'`) atau penerimaan dengan `arrival_revision > 0`: **jangan rollback ke kode lama tanpa pemeriksaan**. Kode lama tidak memahami jadwal per penerimaan: ia membaca `due_date` (terawal) sebagai satu-satunya jatuh tempo, sehingga seluruh sisa faktur tampak jatuh tempo di tanggal terawal; ia juga tidak mengenal `TANGGAL_TIBA` (constraint `fin_supplier_bills_term_chk` diperluas) dan membuka kembali jalur ganti status ke ARRIVED / isi `receivedQty` langsung.
   Pemeriksaan sebelum rollback:
   ```sql
   SELECT COUNT(*) FROM fin_supplier_bills WHERE term_basis = 'TANGGAL_TIBA';
   SELECT COUNT(*) FROM goods_receipts WHERE arrival_revision > 0;
   ```
   Jika salah satu > 0, pilih **roll-forward** (perbaiki ke depan) atau rencanakan migrasi balik data terlebih dulu (ubah `term_basis` faktur terkait ke `TANGGAL_FAKTUR` dan hitung ulang `due_date` — tindakan data, wajib backup + persetujuan Owner).

## Pilihan desain yang perlu diketahui

- Draf penerimaan yang tersisa dari percobaan yang gagal dipakai ulang oleh permintaan berikutnya (tidak dihapus). Isian yang pasti salah (tanpa PIC/catatan/tanggal/jumlah) ditolak sebelum draf disiapkan.
- Barang ditolak tetap dihitung sudah datang secara fisik; yang menutupnya adalah pengiriman pengganti (bukan pengiriman biasa).
- Jadwal pengiriman (draf dari “Penerimaan Baru” Gudang maupun dari Finance) mengikuti “Belum dipenuhi supplier”.

## Rilis (fail-closed)

`scripts/release-po-terintegrasi.sh <DEPLOY_SHA> <BASE_SHA> [--preflight-only]` — release-directory di atas release aktif; berhenti di langkah mana pun yang menyimpang.

- **Sumber:** kandidat harus turunan baseline; berkas yang berbeda dari baseline HANYA yang ada di allowlist eksplisit; tanpa `frontend/dist`, `package*.json`, Docker/compose, artefak foto uji; `schema.prisma` hanya penambahan baris; migrasi baseline tidak boleh berubah.
- **Pin migrasi:** `20261101090000_po_terintegrasi_kedatangan` dipin sha256 (isi LF). Perubahan sekecil apa pun = berhenti sampai diaudit ulang dan pin diperbarui.
- **Pemindai DDL (daftar putih per pernyataan, 20 pernyataan):** 4 ADD COLUMN (nullable / `arrival_revision` DEFAULT 0) pada 3 tabel, 1 tabel baru `goods_receipt_events`, 2 indeks, 4 FK, 6 CHECK, 1 pasang DROP+ADD `fin_supplier_bills_term_chk` (hanya menambah `TANGGAL_TIBA`), 1 fungsi append-only (badan hanya `RAISE EXCEPTION`), 1 trigger `BEFORE UPDATE OR DELETE`. UPDATE/INSERT/DELETE/DROP TABLE/DROP COLUMN/ALTER COLUMN/TRUNCATE = berhenti.
- **Backup + restore nyata:** `pg_dump` + checksum, lalu restore ke DB sementara dan perbandingan jumlah baris (19 tabel) dan SIDIK JARI isi baris penuh (17 tabel lama, tanpa kolom baru) dengan produksi.
- **Rehearsal migrasi:** migrasi diterapkan pada hasil restore dengan image baru; kolom baru kosong, tidak ada backfill; 10 constraint + fungsi + trigger terpasang; uji perilaku (append-only menolak UPDATE/DELETE, CHECK menolak data salah dan meloloskan data benar, `TANGGAL_TIBA` diterima) lalu dibatalkan; sidik jari tabel lama identik sebelum vs sesudah.
- **Smoke baca-saja:** izin Gudang/Finance/Sales, tampilan Gudang tanpa harga, penulisan ditolak tanpa efek (termasuk tidak ada draf baru), aging & umur utang pada data lama, jumlah baris semua tabel tidak berubah.
- **Rollback guard:** `scripts/rollback-guard-po-terintegrasi.sh` (baca-saja) menolak rollback kode (exit 1) bila ada faktur `TANGGAL_TIBA`, penerimaan dengan kedatangan tercatat, baris pengganti/pendamping, atau riwayat kedatangan; exit 2 bila tidak bisa memastikan. Instruksi rollback yang dicetak skrip rilis mewajibkan guard dijalankan lebih dulu.
