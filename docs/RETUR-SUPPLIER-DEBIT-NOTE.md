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

Jurnal saat barang keluar: Dr Utang Belum Ditagih (GRNI) / Cr Persediaan Bahan.
Jurnal saat Debit Note disetujui: Dr Utang Usaha / Cr Utang Belum Ditagih (± Selisih Harga Pembelian).
Pemakaian saldo kredit pada faktur berikutnya: dipilih dan dikonfirmasi Finance, tanpa jurnal baru, tanpa uang keluar. Tidak ada refund kas otomatis.

## Peran

- **Gudang** (`INVENTORY_WRITE`): membuat retur, mencatat kondisi, mengonfirmasi barang keluar. Tidak melihat nilai rupiah.
- **Finance**: melihat nilai; `FINANCE_APPROVE` menyetujui Debit Note dan memakai saldo kredit; `FINANCE_ADMIN` membatalkan Debit Note / pemakaian kredit. Finance hanya membatalkan retur berstatus DRAFT.
- Tanpa PIN. Wajib: alasan, izin, pratinjau server, audit, `Idempotency-Key`, penguncian paralel.

## Pemblokiran (kode alasan)

`TANPA_PO`, `PENERIMAAN_BELUM_SELESAI`, `DITAGIH_LAMA`, `DIPAKAI_PRODUKSI` (dihitung FIFO, termasuk retur lama), `STOK_DIRESERVASI`, `STOK_TIDAK_CUKUP`, `SUDAH_HABIS_DIRETUR`, `PERIODE_TERTUTUP`, faktur sudah direkonsiliasi (lewat `pastikanBelumDirekonsiliasi`), `PRATINJAU_USANG`, `KREDIT_SUDAH_DIPAKAI`, `KREDIT_TIDAK_CUKUP`.

## Skema (migrasi aditif `20261102090000_retur_supplier_debit_note`)

- Enum: `StockMovementType.SUPPLIER_RETURN`, `FinJournalSource.RETUR_SUPPLIER`, `FinJournalSource.DEBIT_NOTE_SUPPLIER`.
- Kolom: `fin_supplier_bills.credit_applied` (CHECK `0 ≤ credit_applied ≤ amount`).
- Tabel: `supplier_returns`, `supplier_return_lines`, `fin_supplier_debit_notes`, `fin_supplier_debit_note_lines`, `fin_supplier_credits`, `fin_supplier_credit_applications`.
- Trigger `trg_goods_receipt_line_terkunci_retur`: baris penerimaan yang punya retur KELUAR/SELESAI tidak bisa diubah qty/PO/material-nya.
- Indeks unik parsial: satu Debit Note aktif per retur.

## Batas dengan branch Koreksi Penerimaan

- Baris penerimaan dengan retur aktif terkunci oleh trigger; koreksi harus membatalkan retur terlebih dulu.
- Branch Koreksi tidak boleh mengubah `accepted_qty`/`received_qty` baris yang punya retur aktif dan harus memakai `qtyReturAktif` dari `services/finance/returSupplier.js` bila perlu membaca kuantitas bersih.
- Urutan kunci: retur → PO → material (terurut). Koreksi yang mengunci ulang harus mengikuti urutan ini.

## Keterbatasan yang diketahui

- Progres PO "Masuk stok" belum mengurangi barang yang diretur.
- Pemakaian FIFO oleh Produksi adalah pendekatan (heuristik) per material.
- Blokir faktur terekonsiliasi bergantung pada `pastikanBelumDirekonsiliasi`; belum punya tes khusus.
- Pembatalan pemakaian kredit di UI memakai `window.prompt`.

## Rollback

Migrasi aditif sehingga skema aman dibiarkan. Rollback KODE tidak aman begitu ada Debit Note/saldo kredit/retur KELUAR: `credit_applied` dan jurnal tertaut tetap ada, dan kode lama tidak mengenalinya.

## Tes terarah

`backend/tests/integration/returSupplier.integration.test.js` (11 tes), `frontend/tests/returSupplierUI.test.js` (5 tes).
