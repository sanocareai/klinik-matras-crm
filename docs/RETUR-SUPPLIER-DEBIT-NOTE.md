# Retur Supplier & Debit Note

Branch: `feat/retur-supplier-debit-note` (dasar: release aktif `12dda033`). Belum merge, belum deploy.

## Dua keputusan untuk barang bermasalah

| Keputusan | Alur | Nilai tagihan |
|---|---|---|
| **Minta pengganti** | Alur penolakan saat pemeriksaan + pengiriman pengganti di Barang Akan Datang. Tidak ada dokumen retur. | Tidak berubah |
| **Retur untuk kredit** | Dokumen Retur Supplier: alasan, jumlah, bukti, tautan PO – penerimaan – baris barang, konfirmasi barang benar-benar keluar dari Gudang. | Berkurang lewat Debit Note / pengurangan jumlah yang boleh ditagih |

API menolak `decision` selain `KREDIT` dengan `409 GUNAKAN_ALUR_PENOLAKAN`.

## Dampak keuangan

| Kondisi saat barang keluar | Efek |
|---|---|
| Belum ada faktur yang mengklaim barangnya | Jumlah yang boleh ditagih turun. Faktur untuk jumlah lama ditahan/ditolak saat disetujui. |
| Faktur sudah disetujui | Faktur lama TIDAK diubah. Debit Note (menunggu Finance) mengurangi utang lewat jurnal tertaut. |
| Faktur dibayar sebagian | Debit Note mengurangi sisa utang; kelebihan di atas sisa menjadi saldo kredit supplier. |
| Faktur lunas | Seluruh nilai menjadi saldo kredit supplier. |

Pemakaian saldo kredit pada faktur berikutnya: dipilih dan dikonfirmasi Finance, tanpa jurnal baru, tanpa uang keluar. Tidak ada refund kas otomatis.

### Jurnal, dengan angka contoh (harga PO Rp40.000/KG, harga faktur Rp45.000/KG, retur 2 KG dari 5 KG)

Dikunci `returSupplierFinal.integration.test.js`. Persediaan dinilai pada **harga perolehan (PO)**; utang dan Debit Note pada **harga faktur**; selisihnya hanya lewat akun Selisih Harga Pembelian — sama seperti saat faktur disetujui, jadi terbalik persis.

| Langkah | Dr | Cr | Rp |
|---|---|---|---:|
| Penerimaan 5 KG | Persediaan | GRNI | 200.000 |
| Faktur 5 KG disetujui | GRNI 200.000 + Selisih Harga 25.000 | Utang Usaha | 225.000 |
| **Barang keluar (retur 2 KG)** | GRNI | Persediaan | 80.000 |
| **Debit Note disetujui** | Utang Usaha 90.000 | GRNI 80.000 + Selisih Harga 10.000 | 90.000 |

Saldo akhir: Persediaan 120.000 (3 × 40.000), GRNI 0, Utang Usaha 135.000 (3 × 45.000), Selisih Harga 15.000 (3 × 5.000), buku besar seimbang. Hasilnya identik dengan retur SEBELUM faktur disetujui (faktur 3 KG × 45.000). Harga faktur lebih murah dari PO: Selisih Harga dikredit/didebit berlawanan, tetap seimbang. Pembatalan Debit Note + retur mengembalikan semua akun ke kondisi sebelum retur.

Faktur dibayar 200.000 dari 225.000: Debit Note 90.000 = 25.000 mengurangi sisa + 65.000 saldo kredit (Utang Usaha bersaldo debit 65.000, tanpa jurnal kas).

Harga rata-rata bahan: barang yang sudah diretur dikurangkan dari penerimaan asalnya saat menghitung rata-rata tertimbang (`dasarHargaRataRata`), dan dikembalikan bila retur dibatalkan.

## Asal stok (audit klaim FIFO)

Sistem memakai harga **rata-rata tertimbang dan tidak melacak lot fisik**: Material Issue tidak menyebut penerimaan mana yang diambil. "Bahan dari penerimaan R sudah dipakai Produksi" karena itu tidak bisa dipastikan bila stok tercampur — FIFO hanya asumsi, dan dihapus sebagai dasar keputusan.

Aturan (hanya yang bisa dibuktikan dari ledger). `keluar` = Σ pengeluaran ISSUE/WASTE/ADJUSTMENT(−) setelah penerimaan itu tiba:

| Keadaan | Hasil |
|---|---|
| `keluar = 0` | **Pasti**: seluruh jumlah masih utuh; boleh diretur penuh (dibatasi stok & reservasi). |
| `keluar > 0`, tidak ada stok sebelumnya dan tidak ada masuk lain setelahnya | **Pasti** dari penerimaan ini → blokir `DIPAKAI_PRODUKSI` (jumlah tepat). |
| `keluar > 0`, kolam tercampur | **Tidak pasti**: kasus terburuk — seluruh pengeluaran bisa saja dari penerimaan ini. Yang boleh diretur = jumlah baik − diretur − min(keluar, jumlah baik). Bila 0 → blokir `ASAL_STOK_TIDAK_PASTI`; bila sebagian → jumlah dibatasi dengan peringatan. |

Pesan blokir menyebut jumlah yang pasti masih ada dan arah penyelesaian (alur koreksi stok — opname/penyesuaian — bukan retur supplier otomatis). Draf retur tetap bisa dibuat sebagai rencana; konfirmasi barang keluar menegakkan aturan di bawah kunci.

Diblokir juga: `PENERIMAAN_BELUM_DIBUKUKAN` — penerimaan yang nilainya belum dibukukan ke Persediaan (sebelum saldo awal/cutover, atau "Posting Tertunda"), karena jurnal retur akan membalik GRNI.

## Progres: masuk stok (bruto) · diretur · diterima bersih dari PO

Satu definisi di `progresPO.js`, dipakai Finance dan Gudang:

| Angka | Arti |
|---|---|
| Masuk stok | Barang baik yang sudah disimpan ke stok — **bruto**, tidak berkurang karena retur. |
| Diretur ke supplier | Retur untuk kredit yang barangnya sudah keluar gudang (status Barang sudah keluar / Selesai). Draf dan yang dibatalkan tidak dihitung. |
| Diterima bersih dari PO | Masuk stok − diretur. **BUKAN stok tersedia**: belum dikurangi pemakaian Produksi, waste, penyesuaian, atau reservasi; stok tersedia hanya dari Stok & Lokasi. |

Retur **tidak** membuka lagi "Belum datang" / "Belum dipenuhi supplier" (retur untuk kredit mengurangi tagihan, bukan meminta pengganti). Di Finance: kolom Diretur & Diterima bersih dari PO di detail PO, total nilai diretur & diterima bersih dari PO (harga PO). Di Gudang: kartu Barang Akan Datang (tanpa nilai) dan jejak penerimaan (Masuk stok · Diretur ke supplier · Diterima bersih dari PO · Retur dari Produksi · Tersisa).

## Peran

- **Gudang** (`INVENTORY_WRITE`): membuat retur, mencatat kondisi, mengonfirmasi barang keluar. Tidak melihat nilai rupiah.
- **Finance**: melihat nilai; `FINANCE_APPROVE` menyetujui Debit Note dan memakai saldo kredit; `FINANCE_ADMIN` membatalkan Debit Note / pemakaian kredit. Finance hanya membatalkan retur berstatus DRAFT.
- Tanpa PIN. Wajib: alasan, izin, pratinjau server, audit, `Idempotency-Key`, penguncian paralel.

### Pembatalan pemakaian saldo kredit (diaudit)

Dialog (bukan `window.prompt`): rincian faktur, jumlah, siapa yang memakai dan kapan, dampak pada sisa utang faktur & saldo kredit (dari server), alasan wajib ≥ 5 karakter, tombol hanya aktif untuk Admin Keuangan (non-Admin melihat alasan nonaktif). Server: `FINANCE_ADMIN`, `Idempotency-Key` wajib, alasan wajib; mencatat `cancelReason`/`cancelledById`/`cancelledAt` dan satu peristiwa audit `batal_pakai_saldo_kredit` (replay tidak menggandakan).

## Pemblokiran (kode alasan)

`TANPA_PO`, `PENERIMAAN_BELUM_SELESAI`, `PENERIMAAN_BELUM_DIBUKUKAN`, `DITAGIH_LAMA`, `DIPAKAI_PRODUKSI`, `ASAL_STOK_TIDAK_PASTI`, `STOK_DIRESERVASI`, `STOK_TIDAK_CUKUP`, `SUDAH_HABIS_DIRETUR`, `PERIODE_TERTUTUP`, `SUDAH_DIREKONSILIASI`, `PRATINJAU_USANG`, `KREDIT_SUDAH_DIPAKAI`, `KREDIT_TIDAK_CUKUP`.

### Gerbang rekonsiliasi bank — apa yang sebenarnya dijaga

Pencocokan Rekonsiliasi Bank hanya mungkin pada baris kas/bank. Maka jurnal faktur, retur, dan debit note (tanpa baris kas) praktis tidak pernah tercocok lewat UI; gerbang `SUDAH_DIREKONSILIASI` bersifat fail-closed untuk data yang tercocok di luar jalur normal. Ia memeriksa jurnal yang dibalik atau menjadi dasar perubahan: jurnal faktur (setujui DN, pakai & batal kredit), jurnal debit note (batal DN), jurnal retur (batal retur barang keluar). **Pembayaran faktur yang sudah direkonsiliasi sengaja TIDAK memblokir** — Debit Note tidak menyentuh jurnal pembayaran, dan skenario "faktur lunas → saldo kredit" harus tetap jalan.

## Skema (migrasi aditif `20261102090000_retur_supplier_debit_note`)

- Enum: `StockMovementType.SUPPLIER_RETURN`, `FinJournalSource.RETUR_SUPPLIER`, `FinJournalSource.DEBIT_NOTE_SUPPLIER`.
- Kolom: `fin_supplier_bills.credit_applied` (CHECK `0 ≤ credit_applied ≤ amount`).
- Tabel: `supplier_returns`, `supplier_return_lines`, `fin_supplier_debit_notes`, `fin_supplier_debit_note_lines`, `fin_supplier_credits`, `fin_supplier_credit_applications`.
- Trigger `trg_goods_receipt_line_terkunci_retur`: baris penerimaan yang punya retur KELUAR/SELESAI tidak bisa diubah qty/PO/material-nya.
- Indeks unik parsial: satu Debit Note aktif per retur.
- Finalisasi ini TIDAK menambah migrasi.

## Batas dengan branch Koreksi Penerimaan

**Status (10 Okt 2026): branch Koreksi Penerimaan TIDAK ditemukan** di repo (semua branch lokal & remote, riwayat komit, worktree). Yang ada hanya `koreksiKedatangan` (live sejak PO Terintegrasi): koreksi tanggal/PIC/catatan/surat jalan/bukti, dan jumlah datang HANYA selama penerimaan masih "Tiba" (belum diperiksa) — jadi tidak pernah menyentuh penerimaan yang sudah punya retur. Maka **tes gabungan Retur + Koreksi BELUM ada dan BELUM dijalankan**; kandidat ini berdiri sendiri.

Kontrak yang harus dipenuhi branch Koreksi bila nanti ada:
- Panggil `pastikanTanpaReturAktif(db, { goodsReceiptLineId | goodsReceiptId })` (`services/finance/returSupplier.js`) SEBELUM mengubah jumlah/material/PO baris penerimaan yang sudah masuk stok. Retur aktif (draf, barang sudah keluar, selesai) → `409 RETUR_AKTIF` dengan nomor retur dan statusnya; jalan yang benar: batalkan retur dulu (Gudang), baru koreksi.
- Pagar terakhir di basis data: trigger `trg_goods_receipt_line_terkunci_retur` menolak ubah `received_qty`/`accepted_qty`/`rejected_qty`/`purchase_order_line_id`/`material_id`/`goods_receipt_id` untuk baris dengan retur KELUAR/SELESAI (pesannya teknis; jangan diandalkan sebagai UX).
- Urutan kunci: retur → PO → material (terurut). Koreksi yang mengunci ulang harus mengikuti urutan ini.
- Faktur atas PO tidak bisa dikoreksi lewat Koreksi Tagihan (`FAKTUR_ATAS_PO`); penyesuaian nilainya hanya lewat Debit Note.
- Berkas bersama yang diubah rilis ini (berpotensi konflik): `posting/inventory.js`, `progresPO.js`, `kedatangan.js`, `purchaseOrder.js`, `biayaBahanSumber.js`.

Tes yang sudah ada untuk kontrak ini (`returSupplierFinal.integration.test.js`, "KOREKSI PENERIMAAN dengan retur aktif tertolak jelas"): guard menolak untuk retur draf dan barang keluar (baris maupun penerimaan), jalur koreksi kedatangan & ubah baris yang ada menolak, trigger menolak, dan guard lolos setelah retur dibatalkan. **Tes gabungan yang HARUS dijalankan begitu branch Koreksi ada**: setiap jalur ubah-jumlah baru → penolakan `RETUR_AKTIF`; koreksi pada penerimaan tanpa retur tetap lolos; pembatalan retur lalu koreksi lolos; paralel (koreksi vs konfirmasi keluar) tepat satu menang.

## Keterbatasan yang diketahui

- Aturan asal stok sengaja konservatif: pada stok tercampur, retur bisa diblokir walau secara fisik lot itu masih utuh di rak. Jalan keluarnya adalah alur koreksi stok oleh Gudang/Finance — bukan menebak lot.
- Pemakaian oleh Produksi dihitung dari ledger (ISSUE/WASTE/ADJUSTMENT); pengembalian dari Produksi tidak dianggap mengurangi pemakaian.
- Gerbang rekonsiliasi hanya melindungi jurnal yang dibalik/menjadi dasar; pembayaran terekonsiliasi tidak memblokir (lihat di atas).
- Bila satu penerimaan memuat dua baris bahan yang sama, jejak penerimaan menjumlah per bahan (perilaku lama).

## Rilis dan rollback

Skrip: `scripts/release-retur-supplier.sh` (release-directory, fail-closed; kerangka sama dengan rilis PO Terintegrasi) dan `scripts/rollback-guard-retur-supplier.sh` (baca-saja).

```
cat scripts/release-retur-supplier.sh | tr -d '\r' | ssh ubuntu@43.133.152.6 'cat > /tmp/reti1.sh'
ssh ubuntu@43.133.152.6 'bash /tmp/reti1.sh <DEPLOY_SHA> <BASE_SHA> --preflight-only'
```

Gerbang (berhenti bila salah satu gagal): kandidat = ujung branch; baseline = release aktif; baseline dan `origin/main` leluhur kandidat; berkas berbeda ⊆ allowlist eksplisit (tanpa `frontend/dist`, dependensi, Docker, artefak uji); migrasi baseline tidak diubah; `schema.prisma` hanya penambahan; **pin sha256 migrasi**; **pemindai DDL daftar putih + 24 mutan uji negatif** (DROP/UPDATE/DELETE/INSERT/TRUNCATE/ALTER COLUMN, kolom/indeks/FK di tabel lama, enum liar, GRANT, trigger/fungsi menulis) semuanya harus ditolak; prasyarat skema (objek rilis belum ada); sidik jari dokumen beku pada T0.

Setelah preflight: backup + checksum, build frontend & image di release dir, **rehearsal** (restore backup NYATA ke DB sementara → migrasi → uji perilaku: CHECK menolak data salah, trigger mengunci baris dengan retur KELUAR, satu debit note aktif per retur, enum terpakai → semuanya dibatalkan → isi 17 tabel lama identik), migrasi, switch, verifikasi (berkas backend byte-identik, **smoke baca-saja**: izin, Gudang tanpa nilai, 14 angka progres berlabel "Diterima bersih dari PO", 9 penulisan ditolak sebelum menyentuh data, 6 invarian basis data), dokumen beku identik sebelum/sesudah.

**Rollback guard** menolak (exit 1) bila ada retur keluar, debit note, saldo kredit/pemakaian, faktur dengan `credit_applied` > 0, pergerakan `SUPPLIER_RETURN` atau jurnal `RETUR_SUPPLIER`/`DEBIT_NOTE_SUPPLIER` — termasuk yang sudah dibatalkan (kode lama tidak mengenal nilai enum itu dan bisa gagal membaca barisnya). Skema aditif aman dibiarkan; rollback KODE tidak aman begitu ada data baru.

## Tes terarah

`backend/tests/integration/returSupplier.integration.test.js` (11), `returSupplierFinal.integration.test.js` (17), `frontend/tests/returSupplierUI.test.js` (10).
