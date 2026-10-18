# Koreksi Kesalahan Input — Seluruh Alur Gudang

Status: kandidat di branch `feat/gudang-koreksi-input` (dasar: live `56b87721`). **Belum dirilis.** Migrasi baru: `20261220090000_gudang_koreksi_dokumen` (aditif).

## 1. Aturan produk (yang ditegakkan kode)

| Aturan | Penegakan |
|---|---|
| Draf boleh diedit sesuai izin, dengan jejak | `DOCUMENT_EDITED` (sebelum–sesudah, siapa, kapan) di GR (header+baris), Material Issue (header+baris), Stock Transfer, Return Record, Stock Adjustment |
| Dokumen yang sudah diposting tidak diubah/dihapus diam-diam | tidak ada rute ubah/hapus; koreksi = dokumen `warehouse_corrections` + pergerakan **baru** bertaut (`correction_id`, `corrects_movement_id`); trigger DB menolak DELETE/UPDATE isi koreksi |
| Pratinjau dampak, alasan wajib | `POST …/pratinjau` (transaksi READ ONLY, tidak menulis); alasan 5–500 karakter (CHECK DB) |
| Metadata ≠ koreksi yang mengubah stok | `kind = METADATA` langsung `POSTED`; `kind = STOCK` menunggu persetujuan |
| Pemohon ≠ penyetuju | layanan (403 `PEMOHON_SAMA`) **dan** CHECK DB `warehouse_corrections_keputusan_chk`; izin `inventory:adjustment_approve` (Owner/Finance) |
| Cegah saldo negatif | `postStockMovement` (invarian ledger) + penghalang `STOK_TIDAK_CUKUP` (stok − reservasi) |
| Cegah pembalikan ganda / retry | satu koreksi tertunda per dokumen (`KOREKSI_TERTUNDA`); koreksi dihitung terhadap jumlah **bersih ledger** (pembalikan kedua → `TANPA_PERUBAHAN`); `Idempotency-Key` unik; setujui/tolak/batal berulang = hasil sama; kunci baris dokumen + token keadaan (`KEADAAN_BERUBAH`) |
| Bahan sudah dipakai/dipindah/dihitung opname → penghalang + jalan keluar nyata | `BAHAN_SUDAH_BERGERAK`, `SUDAH_DIHITUNG_OPNAME` dengan langkah (Penyesuaian Stok, Pengembalian, dll.); koreksi **tidak dipaksakan** |
| Batas Finance | GR dari PO → alur resmi *Koreksi Kedatangan* (sudah Finance-aware); GR yang sudah dijurnal / tertaut tagihan → `JURNAL_FINANCE` / `TAGIHAN_TERKAIT` diblokir dengan arah ke Finance; koreksi Gudang **tidak menulis** jurnal/pembayaran/tagihan; pembayaran PO tidak bergantung pada GR |
| Batas Produksi | tidak membuat QC, penerimaan fisik, atau pemakaian; dokumen bahan Produksi V2 diblokir; baris tanpa jumlah baik **tidak** bisa “ditambah” stoknya (itu penerimaan fisik baru) |
| Audit lengkap | siapa/kapan/alasan/sebelum–sesudah/dokumen/pergerakan: tabel koreksi + `activity_events` (`DOCUMENT_CORRECTED` pada GR) + kolom `created_by` pergerakan = penyetuju |

## 2. Audit alur data per menu (dokumen → stok → Produksi → Finance)

| Menu / dokumen | Draf (belum posting) | Posting menulis stok? | Terhubung Produksi | Terhubung Finance |
|---|---|---|---|---|
| Penerimaan Barang (GR) | DRAFT…READY_FOR_PUTAWAY | ya, saat *Simpan ke Stok* (RECEIPT) | tidak langsung | dari PO: progres PO, termin, faktur, **jurnal persediaan/GRIR** (`postGoodsReceiptValue`); tanpa PO: nilai nol → gap harga |
| Barang Akan Datang | catat tiba (tanpa stok) | tidak | tidak | ya (milik PO/Finance) |
| Pengeluaran Material / Permintaan Bahan | DRAFT…PICKED (reservasi) | ya, saat ISSUED (ISSUE) | ya (unit/work order; V2 = dokumen Produksi) | nilai bahan per unit (jejak biaya) |
| Transfer Stok | DRAFT…PICKED | ya, dua sisi (net 0) | tidak | tidak |
| Retur (Return Record) | CREATED…INSPECTION | ya, resolusi *Return to Available* (RETURN) | asal unit/MI | tidak (jurnal stok resmi belum aktif) |
| Retur Supplier | DRAFT | ya, saat KELUAR (SUPPLIER_RETURN) | tidak | ya (nota debit) |
| Barang Rusak | REPORTED, UNDER_INSPECTION | ya, resolusi Dispose/Return to Supplier (WASTE) | tidak | ya bila retur ke supplier |
| Penyesuaian Stok | DRAFT…APPROVED | ya, saat POSTED (ADJUSTMENT) | tidak | jurnal selisih stok resmi (sakelar Finance) |
| Stock Count / Opname | SCHEDULED…WAITING_REVIEW | ya, saat COMPLETED (ADJUSTMENT) | tidak | jurnal selisih stok resmi (sakelar Finance) |
| Opname Cutover Persediaan | draf | tidak (snapshot nilai) | tidak | ya (milik Finance) |
| Terima Barang Jadi / Penerimaan Unit / Antrean Produksi | — | — | ya (QC, serah-terima, custody) | tidak |

## 3. Matriks cakupan per menu (sumber tunggal: `services/warehouseCoverage.js`, tersedia di `GET /api/inventory/koreksi/cakupan`)

Jalur: **EDIT_DRAF** (edit dengan jejak) · **KOREKSI_UI** (koreksi bertaut lewat UI) · **ALUR_RESMI** (alur resmi yang sudah ada, ditunjukkan langkahnya) · **DIBLOKIR** (alasan + langkah) · **FINAL**.

| Menu | Sebelum posting | Sesudah posting |
|---|---|---|
| **Penerimaan Barang — tanpa PO** | EDIT_DRAF | **KOREKSI_UI**: metadata (supplier, referensi, surat jalan, catatan, tanggal dokumen, kondisi/catatan baris) langsung tercatat; jumlah baik / bahan (sesatuan) / lokasi → pemohon≠penyetuju |
| **Penerimaan Barang — dari PO** | EDIT_DRAF (+ Catat Barang Tiba) | **ALUR_RESMI**: tombol *Koreksi Kedatangan (resmi)* di detail GR membuka form resmi (jumlah baik, termin, jurnal koreksi, progres PO); hanya *catatan* + kondisi/catatan baris yang bisa dikoreksi lewat jalur Gudang |
| Barang Akan Datang | — | ALUR_RESMI (Koreksi Kedatangan sudah ada) |
| Pengeluaran Material / Permintaan Bahan | EDIT_DRAF (+ batal) | ISSUED: ALUR_RESMI (Pengembalian Bahan → Permintaan baru; selisih → Penyesuaian); dokumen V2 Produksi: DIBLOKIR |
| Transfer Stok | EDIT_DRAF (+ batal) | IN_TRANSIT: ALUR_RESMI (Terima); COMPLETED: ALUR_RESMI (Transfer balik) |
| Retur | EDIT_DRAF (+ batal) | masuk stok: ALUR_RESMI (Penyesuaian bertaut) |
| Retur Supplier | EDIT_DRAF (draf) | ALUR_RESMI (Batalkan Retur → pergerakan balik; nota debit milik Finance) |
| Barang Rusak | EDIT_DRAF | RESOLVED: ALUR_RESMI (Penyesuaian bertaut) |
| Penyesuaian Stok | EDIT_DRAF (+ batal) | POSTED: ALUR_RESMI (penyesuaian pembalik, penyetuju berbeda) |
| Stock Count / Opname | EDIT_DRAF (Hitung Ulang) | COMPLETED: ALUR_RESMI (hitungan baru / Penyesuaian bertaut) |
| Opname Cutover Persediaan, Pengajuan Biaya | — | DIBLOKIR (milik Finance) |
| Terima Barang Jadi / Penerimaan Unit / Antrean Produksi | — | DIBLOKIR (milik Produksi) |
| Riwayat Pergerakan / KPI / Laporan | — | FINAL (hanya baca; koreksi tampil sebagai pergerakan bertaut) |

Setiap detail dokumen menampilkan **kartu “Koreksi kesalahan input”** (jalur, penjelasan, langkah nyata, apa yang disentuh: Stok/Produksi/Finance, riwayat koreksi). Tidak ada tombol “Edit” umum.

## 4. Contoh alur pengguna

**A. Salah ketik jumlah di GR tanpa PO yang sudah masuk stok (10 → 7).**
Detail GR → kartu “Koreksi bertaut” → *Koreksi Penerimaan* → isi jumlah baik 7 + alasan → *Lihat Dampak* (saldo 10 → 7, pergerakan pembalik −3) → *Ajukan Koreksi Stok*. Stok belum berubah. Owner/Finance lain membuka *Barang Rusak, Retur & Penyesuaian → Koreksi Dokumen* → *Setujui & terapkan*. Pergerakan RECEIPT −3 tertulis, bertaut ke pergerakan asal; catatan GR asal tetap 10.

**B. Salah ketik supplier/surat jalan (tanpa efek stok).** Sama, tetapi hasil *Lihat Dampak* “Hanya data dokumen”; tombol *Simpan Koreksi Data* langsung mencatat sebelum–sesudah.

**C. Bahan sudah dipakai Produksi.** *Lihat Dampak* → diblokir `BAHAN_SUDAH_BERGERAK` dengan rincian ISSUE yang terjadi dan jalan keluar (Penyesuaian Stok pemohon≠penyetuju, atau kembalikan pergerakan lanjutan lalu ulangi). Metadata tetap boleh dikoreksi.

**D. GR dari PO.** Kartu menjelaskan alasan (progres PO, termin, jurnal) dan menyediakan *Koreksi Kedatangan (resmi)*; bahan yang salah → Finance mengoreksi PO lebih dulu.

## 5. Penghalang (kode stabil → pesan + langkah)
`BUKAN_COMPLETED, PENERIMAAN_DITOLAK, DARI_PO, KOREKSI_TERTUNDA, BARIS_BAHAN_GANDA, LEDGER_TIDAK_SINKRON, BAHAN_SUDAH_BERGERAK, SUDAH_DIHITUNG_OPNAME, STOK_TIDAK_CUKUP, RETUR_AKTIF, TAGIHAN_TERKAIT, JURNAL_FINANCE, TERCAKUP_STOK_OPNAME, TANPA_PERUBAHAN, NILAI_TIDAK_VALID, BAHAN_PENGGANTI_TIDAK_VALID, SATUAN_BEDA, WAKTU_TIDAK_VALID` — lihat `PENGHALANG` di `warehouseCoverage.js`.

**Satuan** melekat pada bahan (master): “satuan salah” = bahan salah → koreksi bahan sesatuan; bahan beda satuan ditolak (`SATUAN_BEDA`), tidak ada konversi otomatis. **Waktu pergerakan** tidak diubah (append-only); koreksi dicatat pada waktu koreksi, tanggal dokumen bisa dikoreksi sebagai metadata hanya bila belum dijurnal.

## 6. Migrasi
`20261220090000_gudang_koreksi_dokumen`: tabel `warehouse_corrections` (kosong) + 2 kolom NULL di `stock_movements` (`correction_id`, `corrects_movement_id`) + indeks/FK/CHECK/trigger append-only + `REVOKE` dari `mcp_hub_readonly` (bersyarat). Tanpa backfill. Diterapkan lewat skrip rilis bergerbang (bukan oleh sesi ini).

## 7. Risiko rilis tersisa
1. `inventoryLedger.js` (sumber tunggal tulis stok) diubah kecil (dua parameter opsional); skrip rilis lain yang menjaga berkas itu “tidak berubah dari baseline” akan menandainya — rilis ini harus dijalankan dengan allowlist sendiri.
2. Kolom baru di `stock_movements` (tabel panas): `ADD COLUMN` NULL tanpa default = cepat (metadata saja), tetapi tetap perlu rehearsal pada restore backup.
3. Koreksi stok untuk GR **dari PO** sengaja tidak dibangun ulang (memakai Koreksi Kedatangan resmi); perubahan bahan/lokasi pada GR PO belum ada (Finance memegang PO).
4. Jalur ALUR_RESMI untuk dokumen selain GR berupa panduan langkah — belum ada tombol pembalik otomatis (Material Issue/Transfer/Return/Damaged/Adjustment/Count), karena menyentuh Produksi/Finance dan memerlukan keputusan produk terpisah.
5. Pemetaan baris GR → pergerakan memakai kecocokan bahan (tidak ada FK baris pada pergerakan); GR dengan bahan sama di >1 baris diblokir (`BARIS_BAHAN_GANDA`).
6. Persetujuan hanya untuk pemegang `inventory:adjustment_approve` (Owner/Finance); bila hanya ada satu pemegang aktif, koreksi stok tidak bisa disetujui sendiri (disengaja).

## 8. Hasil tes (DB terisolasi, Postgres tersendiri; zona waktu server uji = UTC seperti produksi)
- `gudangKoreksi.integration.test.js` — 13 tes: hak akses; jalur per dokumen; metadata (langsung, sebelum–sesudah, idempoten, kunci dipakai dokumen lain, tanpa dampak Finance/Produksi); stok sebagian (menunggu → pemohon tak bisa setujui sendiri → penyetuju lain → pembalik bertaut, asal utuh, retry tak menggandakan); persetujuan paralel + pembalikan ganda; tambah/ganti bahan/lokasi (satuan beda ditolak); 17 penghalang (bergerak, opname, reservasi, PO, belum masuk stok, dijurnal, bahan ganda, ledger tak sinkron, tanggal); keadaan berubah sesudah pengajuan; rollback atomik (satu pergerakan gagal → semua batal); DB (trigger/CHECK); alur normal Simpan ke Stok tetap; draf diedit dengan jejak; endpoint keadaan.
- Regresi gabungan 11 berkas integrasi (koreksi penerimaan resmi, ledger inti, penerimaan saldo minus, Material Issue Produksi, retur supplier ×2, stok resmi, segregasi penyesuaian, riwayat referensi, opname cutover, koreksi gudang): 124 lulus, 0 gagal.
- Unit/verifier/MCP: 92 + `warehouseCoverage` 6 lulus. Frontend (`koreksiGudang`, arsitektur, UX, riwayat referensi): 60 lulus.
- Catatan lingkungan uji: server Postgres lokal berzona Asia/Bangkok membuat satu tes lama (`returSupplier` “BLOKIR…”) gagal karena `createdAt` default DB ≠ UTC; dengan zona UTC (sama dengan produksi) lulus. Bukan perubahan perilaku dari fitur ini.
