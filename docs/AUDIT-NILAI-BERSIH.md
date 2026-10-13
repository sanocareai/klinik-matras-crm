# Audit end-to-end "Nilai Bersih" — Nota Kredit di semua laporan (Okt 2026)

Latar: Nota Kredit/Keringanan (rilis 62516a0a) mengurangi **tagihan** tetapi sengaja tidak mengubah `Order.value` (nilai item). Akibatnya setiap laporan yang menjumlah `Order.value`
mentah — omset, "Lunas"/komisi, target, nilai pelanggan — tetap memakai angka KOTOR. Kasus nyata: order Sofyan RES-07102026-037 (4,3 jt, nota 200 rb tertaut refund) masuk komisi
Fadlan 4,3 jt; yang benar 4,1 jt.

## Definisi (satu sumber: `backend/src/services/orderNilaiBersih.js`, UI: `frontend/src/utils/nilaiBersih.js`)

> **Nilai bersih = `Order.value` − Σ Nota Kredit AKTIF pada order itu** (tidak pernah negatif).

| Alat | Pemakaian |
|---|---|
| `aggregateBersih(db, args)` / `groupByBersih(db, args)` | pengganti drop-in `order.aggregate/groupBy` — `_sum.value` & `_avg.value` bersih, bentuk hasil sama |
| `NILAI_BERSIH_SQL` | fragmen SQL untuk `$queryRaw` (alias tabel `o`): `SUM(${NILAI_BERSIH_SQL})` |
| `PILIH_KREDIT` + `nilaiBersih(o)` | untuk baris order yang sudah dimuat |
| `nilaiBersihPerOrder(db, rows)` / `kreditAktifPerOrder(db, ids)` | menambah `notaKredit`/`nilaiBersih` pada daftar baris |
| `nilaiBersihOrder(o)` (UI) | `value` − `orderCredits`/`notaKredit` |

## Inventaris permukaan (apa yang diubah)

### Laporan Sales / komisi / target — `routes/analytics.js`
`/overview` (omset, bulan ini, pendapatan 6 bulan), `/business-summary` (omset, terkumpul, DP, piutang, aging, per status/kategori, deret hari/jam/bulan),
`/sales-report` (omset per sales **Reach**, **Lunas = dasar komisi**, AOV, % target, total tim), `/sales-report/lunas-detail` (rincian: `value` bersih + `nilaiKotor` + `notaKredit`),
`/performance`, `/source-performance` (nilai per sumber), `/sales-performance`, `/pipeline-funnel`, `/stage-by-sales`, `/revenue-series`, `/lead-source-detail`, `/recent-orders`,
`/recent-activity`, `/hot-leads`, `/recommendations` (order siap + capaian target). 15 `aggregate`, 2 `groupBy`, 9 SQL mentah, 7 pembacaan per-baris.

### Pelanggan & order
- `Customer.orderValue/orderCount` (`customerOrderAggregate.js`) — dihitung bersih; **disinkron ulang setelah nota dibuat/dibatalkan** (`routes/financeTransactions.js`). Dipakai filter VIP ≥ Rp5jt & urutan.
- Daftar Order (`routes/orders.js`): KPI nilai aktif, belum lunas, per status; tiap order memuat `orderCredits`. Respons PATCH/aksi order ikut memuat nota.
- Detail pelanggan (`routes/customers.js`), daftar pelanggan (order terbaru), B2B (`routes/b2b.js`).
- Pipeline: kolom/kartu kanban (`/board`), papan order (`/order-board`: `value` bersih + `nilaiKotor`), Promo (`/promos` omzet per promo).
- Invoice pelanggan (`services/invoice.js`, PDF, teks WA, panel, daftar invoice Finance): `totalTagihan` = layanan + ongkir − nota; baris **Potongan (Nota Kredit)**; sisa/lunas konsisten.
- Ringkasan WA order (`buildWaMessage`, backend & frontend): baris Potongan + Total bersih.

### Mesin lain yang membaca nilai order
- MCP (`mcp/tools.js`, `toolsShared.js`): `nilai` = bersih, `nilaiKotor`, `notaKredit`; agregat memakai helper.
- Webhook otomasi `lead.won` (`totalValue`, `latestOrderValue` bersih), Intelligence/Sales-Risk (nilai pelanggan), Reply Assistant, Cohort atribusi (`cohortLoader` value bersih).
- Produksi: nilai order di papan/ekspor/overview unit (hanya peran ber-izin harga) memakai nilai bersih.
- Perpindahan kredit order antar sales, pengecualian tanggal lunas Owner: nilai bersih.

### Finance
- Laporan Piutang (`reports.js#umurPiutang`): `tagihanDiakui`/`sudahDilunasi` mengeluarkan potongan nota mandiri (bukan pembayaran) + field `notaKredit`; order yang HANYA dapat potongan
  berlabel "Belum bayar" (bukan "Dibayar sebagian"). Posisi per tanggal.
- Rekonsiliasi Sales–Finance: `nilai` Lunas = bersih (jembatan tetap menutup, residual 0).
- Detail piutang/transaksi, picker order refund/klaim, label DP/Cicilan/Pelunasan, Resi (`PILIH_ANAK`), diagnosis piutang, penerimaan order — select memuat `PILIH_KREDIT`/`PILIH_TAGIHAN`.

## Nilai KOTOR yang SENGAJA dipertahankan (terdaftar di tes `nilaiBersihRegistry.test.js` dengan alasan)
- Pengakuan pendapatan (`posting/orderRevenue.js`) & usulan rekonsiliasi 2026: pendapatan diakui kotor; potongan dicatat terpisah sebagai Retur & Potongan (Nota Kredit hanya untuk order yang sudah diakui).
- Dokumen legacy/backfill (`legacyPendapatan.js`, `resiBackfill.js`), revisi lingkup harga (`scopeRevision.js`).
- Guard `value > 0` ("order sudah dihargai") dan komponen rumus tagihan (`tagihanOrder.js`).
- Order PKR: nominal dikelola PKR di Finance (bukan penjualan CRM) — ditolak untuk nota kredit.
- Refund tanpa nota (mis. kelebihan bayar dikembalikan atau uang dikembalikan tanpa potongan): **tidak** mengurangi nilai penjualan — keputusan bisnis, konfirmasi Owner.

## Pengaman "jangan terulang"
1. **Tes statis backend** `tests/nilaiBersihRegistry.test.js` — memindai `backend/src`; GAGAL bila ada:
   R1 `order.aggregate/groupBy` yang menjumlah `value` mentah · R2 `SUM(o.value)` mentah di SQL · R3 pembacaan `o.value` di JS di luar registri bertanda alasan ·
   R4 select `ongkir: true` di file pemakai `tagihanOrder`/`dasarStatusBayar` tanpa `PILIH_TAGIHAN`/`PILIH_KREDIT`. Terbukti menolak pelanggaran sungguhan.
2. **Tes statis UI** `frontend/tests/nilaiBersihOrder.test.js` — melarang `order.value` mentah dijumlah/diformat di luar daftar pengecualian.
3. **Kontrak runtime** `tagihanOrder/dasarStatusBayar`: order tanpa relasi `orderCredits` → **melempar** di tes (`NILAI_BERSIH_STRICT=1` di tes integrasi), peringatan log di produksi.
4. **Tes end-to-end** `nilaiBersihLaporan.integration.test.js`: satu skenario (Sofyan) melalui laporan Sales/Overview/Ringkasan/Pelanggan/Order/Pipeline/Invoice + nota dibatalkan.

## Data produksi (baca-saja, 13 Okt 2026)
- 1 nota aktif (NK-13102026-001, Rp200.000, tertaut RFD-12102026-002). Dampak sebelum rilis ini: komisi Fadlan Oktober = **Rp4.300.000** untuk order itu; sesudah = **Rp4.100.000**.
- `Customer.orderValue` Sofyan tersimpan 4.300.000, hitungan bersih 4.100.000 → perlu `scripts/sync-customer-order-value.js` (dry-run default, `--apply` untuk menulis; hanya pelanggan
  terkait nota). Dua profil staf PKR (Kemal, Sulaiman) punya `orderCount` 0 vs 1 — drift lama tak terkait nota, hanya dilaporkan.
- Tidak ada backfill/koreksi otomatis oleh rilis.

## Rollback
Tanpa migrasi. Rollback kode kembali ke angka kotor (laporan lagi memakai `Order.value`); data tidak berubah. `Customer.orderValue` yang sudah disinkron bersih tetap bersih.
