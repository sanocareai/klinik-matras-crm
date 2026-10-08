# Purchase Order Bahan Baku — Fase 1 integrasi Finance → Gudang

Status: dibangun di branch `feat/finance-po-bahan-baku` (dasar: HEAD main `1a783034`; release live saat dicek 8 Okt 2026 = `2e7d5db8`, 113 commit di depan dasar ini — merge percobaan ke live tanpa konflik dan skema gabungan valid; ulangi pengecekan baseline live sebelum rilis). **Belum di-merge, belum di-deploy, tidak ada data production yang diubah.**

## Prinsip

1. **PO adalah dokumen komitmen.** Membuat, mengubah, menyetujui, merevisi jumlah, atau membatalkan PO **tidak menulis `stock_movements` dan tidak membuat jurnal**. Kode PO (`services/finance/purchaseOrder.js`) tidak mengimpor `postStockMovement`/`postJournal`; tes `purchaseOrderBahanBaku` membuktikan stok, jurnal, tagihan, dan posting-gap tidak berubah oleh operasi PO.
2. **Stok masuk dan jurnal tetap hanya lahir saat putaway** penerimaan (`POST /api/inventory/goods-receipts/:id/putaway`): Dr Persediaan (1-1400) / Cr Utang Barang Belum Ditagih (2-1150).
3. **PO tidak menyimpan saldo.** Dipesan = `qty` baris PO. Diterima baik, ditolak, belum diterima, dan ditagih dihitung dari baris penerimaan berstatus `COMPLETED` yang menunjuk baris PO.
4. **Penerimaan tanpa PO tetap ada** (jalur lama, dokumen historis tidak disentuh/di-backfill) dan ditandai "Tanpa PO".

## Model data (migration `20261026090000_purchase_order_bahan_baku`, aditif)

- `fin_purchase_orders` — `po_number` unik `PO-DDMMYYYY-NNN` (urut per bulan, `generateDocumentNumber`), supplier (FK `fin_suppliers`), tanggal PO, estimasi kedatangan, catatan, status (`DRAFT`, `DISETUJUI`, `DITERIMA_SEBAGIAN`, `SELESAI`, `DIBATALKAN`), pembuat, penyetuju + waktu, alasan batal.
- `fin_purchase_order_lines` — item katalog (`materials`), `unit` (snapshot), `qty` Decimal(14,3), `unit_price` **Int rupiah bulat** (sama dengan `stock_movements.unit_cost`), catatan, urutan.
- `fin_purchase_order_events` — riwayat append-only: jenis, aktor, waktu, catatan, metadata (sebelum/sesudah revisi).
- `goods_receipts.purchase_order_id` (nullable, FK Restrict) dan `goods_receipt_lines.purchase_order_line_id` (nullable, FK Restrict).
- Tidak ada perubahan/backfill pada baris yang sudah ada. Semua kolom baru nullable.

## Kontrak API

### Finance — `/api/finance/purchase-orders` (header `Idempotency-Key` didukung)

| Metode & path | Izin | Fungsi |
|---|---|---|
| `GET /` `?status=A,B&supplierId=&q=` | `finance:read` | Daftar PO + harga + kuantitas per baris |
| `GET /:id` | `finance:read` | Detail: baris, penerimaan tertaut (+tagihan), riwayat |
| `POST /` | `finance:post` | Buat draf `{ supplierId, orderDate, expectedDate?, notes?, lines:[{materialId, qty, unitPrice, notes?}] }` |
| `PATCH /:id` | `finance:post` | Ubah draf (hanya `DRAFT`) |
| `POST /:id/approve` | `finance:approve` | `DRAFT` → `DISETUJUI` |
| `POST /:id/cancel` `{reason}` | `finance:post` untuk draf; **`finance:admin`** untuk PO disetujui | Ditolak 409 bila ada penerimaan berjalan atau barang sudah masuk |
| `POST /:id/revisi-jumlah` `{lineId, qty, reason}` | `finance:approve` | Penanganan selisih eksplisit (naik/turun); tidak boleh di bawah jumlah yang sudah diterima baik; harga tidak bisa diubah |

### Gudang — `/api/inventory/purchase-orders` (baca saja, **tanpa harga/nilai**)

- `GET /` — default hanya `DISETUJUI,DITERIMA_SEBAGIAN` (izin `inventory:read`)
- `GET /:id` — draf tidak terlihat (404)
- Setiap baris: `id, materialId, kode, nama, satuan, dipesan, diterimaBaik, ditolak, belumDiterima, dalamProses, ditagih`

### Penerimaan Barang — perubahan pada `/api/inventory/goods-receipts`

- `POST /` menerima `purchaseOrderId` (+ opsional `lines:[{purchaseOrderLineId, orderedQty?}]`, default semua baris yang masih punya sisa dengan `orderedQty` = sisa). Server **mengisi** `sourceType=PURCHASE_ORDER`, `sourceReference=poNumber`, `supplier=nama supplier PO`; isian bebas yang bertentangan diabaikan. PO harus `DISETUJUI`/`DITERIMA_SEBAGIAN`; jadwal tidak boleh melebihi sisa PO.
- Respons penerimaan kini memuat `purchaseOrderId`, `purchaseOrder {id,poNumber,status}`, per baris `purchaseOrderLineId`, dan di `GET /:id` ringkasan kuantitas `poRingkas` (tanpa harga).
- `PATCH /:id`: supplier & referensi penerimaan dari PO dikunci.
- `PATCH /:id/lines/:lineId` (baris tertaut PO): baik + ditolak ≤ datang; baik ≤ sisa PO (pesan jelas, 409).
- `POST /:id/putaway`: untuk penerimaan dari PO — mengunci baris PO, **menolak (409, tanpa stok tertulis)** bila jumlah baik kumulatif melebihi PO atau PO bukan lagi `DISETUJUI`/`DITERIMA_SEBAGIAN`; menilai stok dengan harga satuan PO (`unitCost`) sehingga jurnal Dr Persediaan / Cr GRNI terbentuk; lalu menghitung ulang status PO (`DITERIMA_SEBAGIAN` / `SELESAI`) dan mencatat riwayat. Penerimaan tanpa PO: perilaku lama (tanpa harga, gap `TANPA_HARGA_PEROLEHAN`).

## Definisi kuantitas per baris PO

| Angka | Rumus |
|---|---|
| dipesan | `qty` baris PO |
| diterimaBaik / ditolak | Σ `acceptedQty` / `rejectedQty` baris penerimaan **COMPLETED** |
| belumDiterima | `max(0, dipesan − diterimaBaik)` (barang ditolak tidak mengurangi sisa) |
| dalamProses | Σ `receivedQty` penerimaan yang belum selesai dan belum ditolak |
| ditagih | `diterimaBaik` pada penerimaan yang punya tagihan supplier **disetujui/dibayar** (tagihan menempel ke penerimaan, bukan ke baris) |

## Keputusan yang masih dibutuhkan (Owner)

1. **Selisih harga.** Stok dinilai dengan harga PO. Bila faktur supplier berbeda, selisihnya masuk akun Selisih Harga saat tagihan disetujui (perilaku tagihan yang sudah ada, tidak diubah). Putuskan: toleransi selisih yang boleh disetujui Finance, dan apakah selisih di atas ambang harus ditolak/ditinjau.
2. **Pencocokan faktur.** Tagihan masih menaut ke satu penerimaan (bukan baris PO) dan tidak membandingkan faktur dengan PO. Fase berikutnya: tampilkan PO di form Tagihan Supplier, hitung selisih jumlah × harga per baris, dan aturan tolak/izinkan. Satu faktur untuk beberapa penerimaan (atau sebaliknya) belum didukung.
3. **Harga bulat.** `unit_price` wajib rupiah bulat (selaras `unit_cost` Int di ledger stok). Jika ada bahan berharga pecahan per satuan, ledger stok perlu diubah lebih dulu.
4. **Pembatalan PO yang disetujui** memakai izin `finance:admin` (pola tagihan/pembelian). Konfirmasi bahwa Finance biasa tidak boleh membatalkannya.
5. **Mulai kapan wajib PO?** Saat ini PO opsional (penerimaan tanpa PO tetap diizinkan, hanya ditandai). Tentukan apakah kelak penerimaan bahan baku dari supplier wajib PO.

## Pengujian (Fase 1)

- Backend: `tests/integration/purchaseOrderBahanBaku.integration.test.js` (18 tes).
- Frontend: `frontend/tests/purchaseOrderUI.test.js` (11 tes) + QA browser Finance & Gudang di 1440 dan 390 px.
- Sebelum rilis: periksa baseline live terbaru (`.release-commit` di VPS), merge ke branch rilis aktif, dan pastikan migration ini berurutan paling akhir.

---

# Fase 2 — Pencocokan faktur supplier per baris PO

Branch `feat/finance-po-faktur-fase2` (dasar: merge live `2e7d5db8` + Fase 1). Migration `20261027090000_po_pencocokan_faktur` (aditif + 2 CHECK qty/harga positif); migration PO Fase 1 diurutkan ulang menjadi `20261026090000` agar paling akhir terhadap seluruh migration kandidat (live, Produksi Fase 4: sampai `20261025100000`).

## Aturan
1. **Faktur/pembayaran tidak menambah stok.** Tidak ada `postStockMovement` di jalur faktur; tes membandingkan snapshot `stock_movements` sebelum/sesudah faktur dan pembayaran.
2. **Barang baik yang sama tidak ditagih dua kali.** Klaim = alokasi per baris penerimaan (`fin_supplier_bill_allocations`) dari faktur berstatus masuk buku, plus penerimaan yang sudah ditagih lewat tagihan lama (`goodsReceiptId`, dianggap terklaim penuh). Ditegakkan saat **menyetujui**, di bawah kunci baris tagihan lalu kunci baris PO — dua persetujuan paralel diserialkan; yang kedua melihat klaim pertama dan **tertahan** (409 `TAGIHAN_PO_TERTAHAN`, tanpa alokasi/jurnal tertulis). Dua persetujuan faktur yang sama: satu 200, satu 409.
3. **Tanpa toleransi otomatis.** Faktur yang menagih lebih dari barang baik belum ditagih tertahan dengan alasan per baris. Harga faktur ≠ harga PO (sekecil apa pun) wajib catatan tinjauan Finance (≥5 karakter, `body.catatanTinjauanHarga` pada approve; tersimpan bersama peninjau & waktu).
4. **Jurnal** memakai kebijakan existing: Dr GRNI (2-1150) per penerimaan = jumlah teralokasi × **harga PO** (sama dengan nilai stok saat putaway) ± Selisih Harga Pembelian (selisih nominal faktur vs nilai itu) / Cr Utang Usaha. Bentuk identik dengan tagihan lama (tes paritas).
5. Alokasi FIFO menurut tanggal terima penerimaan; `receiptIds` membatasi penerimaan yang ditagih (kosong = semua yang masih punya sisa).
6. Faktur atas PO **tidak bisa dikoreksi** (versi pengganti) — blokir `FAKTUR_ATAS_PO`; batalkan (jurnal dibalik, klaim lepas karena status DIBATALKAN) lalu catat ulang. Nominal faktur selalu Σ(jumlah × harga faktur); biaya lain (ongkir/pajak) belum didukung. Tagihan lama yang menaut penerimaan yang sudah diklaim faktur atas PO ditolak (`PENERIMAAN_SUDAH_DITAGIH`), dan sebaliknya.

## Kontrak API (untuk layar Produksi/Gudang berikutnya)
Semua di `/api/finance/purchase-orders` kecuali disebut lain; baca = `finance:read`, catat/ubah = `finance:post`, setuju = `finance:approve` (`POST /api/finance/bills/:id/approve`), batal = `finance:admin` (`POST /api/finance/bills/:id/cancel`).

| Endpoint | Fungsi |
|---|---|
| `GET /:id/penagihan` | Per baris PO: `dipesan, diterimaBaik, sudahDitagih, tersedia, hargaPO`; per penerimaan: `diterimaBaik, sudahDitagih, tersedia`; `fakturTerbuka` |
| `POST /:id/faktur` `{ supplierRef, billDate, dueDate?, description?, receiptIds?, lines:[{purchaseOrderLineId, qty, unitPrice}] }` | Catat faktur (Menunggu Persetujuan); `Idempotency-Key` didukung; mengembalikan evaluasi |
| `GET /faktur/:billId` | Evaluasi: per baris `dipesan, diterimaBaik, sudahDitagih, tersedia, diajukanIni, hargaPO, hargaFaktur, selisihHarga, selisihNilai, melebihi`; `tertahan`, `alasanTertahan[]`, `perluTinjauanHarga`, `selisihHargaTotal`, `catatanTinjauan`, `alokasi[]` |
| `PATCH /faktur/:billId` `{ reason, ...isian }` | Ubah faktur yang belum disetujui (ganti seluruh baris; nominal dihitung ulang) |
| `GET /:id` | Detail PO kini memuat `faktur[]` dan, per penerimaan, tagihan (lama & via alokasi `lewatPO:true`); kolom `ditagih` per baris = alokasi + tagihan lama |
| `POST /api/finance/bills/:id/approve` `{ catatanTinjauanHarga? }` | Setujui; 409 kode `TAGIHAN_PO_TERTAHAN` / `SELISIH_HARGA_PERLU_TINJAUAN` / `PENERIMAAN_BELUM_DIBUKUKAN` / `PO_TIDAK_BISA_DIFAKTURKAN` |

Catatan: jumlah PO & faktur kini maksimal 2 desimal (Fase 1 sebelumnya 3) agar penutupan GRNI per alokasi tepat pada presisi uang 2 desimal.

## Keputusan yang masih terbuka
- Toleransi selisih harga: saat ini nol (semua selisih wajib tinjauan). Tentukan ambang bila ingin otomatis.
- Biaya tambahan faktur (ongkir/pajak/diskon header) belum didukung.
- Retur setelah faktur disetujui: belum ada alur otomatis; faktur dibatalkan lalu dicatat ulang dengan jumlah baru (penolakan barang di Gudang sebelum putaway sudah mengurangi jumlah baik yang bisa ditagih).
- Satu penerimaan sebagian ditagih lewat faktur atas PO **dan** ingin ditagih lewat tagihan lama: ditolak; wajib lewat PO.
