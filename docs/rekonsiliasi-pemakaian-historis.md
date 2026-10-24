# Rekonsiliasi Pemakaian Historis (Sep–Okt 2026) — rancangan bertahap

Status: **kandidat di branch `feat/rekon-pemakaian-historis` (belum deploy, belum menyentuh production)**. Dibangun di atas `693b8c52` (UX Bahan katalog, juga belum deploy) yang berdiri di atas live `fa6beb86`.

## 1. Keputusan Owner yang dipenuhi
| Keputusan | Pemenuhan |
|---|---|
| CSV Admin Sales = sumber catatan historis; nilai asli disimpan, jangan "diperbaiki" otomatis | `unit_usage_notes.raw_*` dikunci trigger DB; angka janggal hanya diberi penanda. LEM `1,5 KG` pada bahan `CAN` → penanda `SATUAN_BEDA_MASTER` "kg atau kemasan? Tidak dikonversi otomatis" (tanpa ×13). |
| Semua order yang punya baris bahan harus tampil di Produksi; jangan gandakan 254 ISSUE | Setiap baris → satu catatan; yang sama dengan ISSUE lama ditautkan (`TERCATAT_DI_STOK`, tanpa movement baru). Tampil di Bahan, Ringkasan, Riwayat, daftar, Excel. |
| Alur koreksi mudah: pemakaian per order, saldo bahan, harga — terpisah, berjejak | Koreksi catatan · koreksi pemakaian per order (efek stok) · koreksi saldo (Stock Adjustment + `saldoBaru`) · koreksi harga (tabel sendiri). Semua: sebelum–sesudah, alasan, pelaku, waktu, tautan ke asal. Tidak ada yang menimpa. |
| "Perlu dicek" + catatan singkat; bahan baru boleh jadi master tanpa stok; komponen lama terpisah | Penanda BLOK/INFO dengan teks + tindakan. Master baru tidak menambah stok; nama persis dipetakan otomatis saat evaluasi ulang; "belum ada catatan stok" ≠ saldo nol. Komponen lama (`KILOAN`, `LAMA`) → `BUKAN_STOK`. |
| HPP per order parsial bila belum pasti | `bacaJejakUnit` menambah gap `CATATAN_BELUM_JADI_STOK`, `PEMAKAIAN_PERLU_DICEK`, `JURNAL_PERLU_PENYESUAIAN`; `ringkasan.parsial`; Detail Order Produksi menampilkan "HPP bahan PARSIAL" + gap. |

## 2. Audit jalur data Gudang–Produksi (live `fa6beb86`)
* Ledger: `stock_movements` (`postStockMovement`: kunci bahan, invarian saldo ≥ 0). Pergerakan bertaut `unit_id` **langsung tampil** di Bahan/Ringkasan/Riwayat/daftar/Excel Order Produksi (`ambilPemakaianAktual`, `productionOrderList`, `productionOrderExport`).
* 254 ISSUE September (impor `createMany`): bertaut unit (254/254, 34 unit DELIVERED) → tampil; **pelaku kosong, 0 valuasi, 0 jurnal**.
* Jalur resmi `POST /units/:id/materials`: cap waktu = sekarang (tak bisa historis) + otomatis jurnal HPP.
* Unit 360 (`production-v2`) hanya melayani unit kohort V2 → tidak relevan untuk order September/Oktober.
* Koreksi yang sudah ada: `warehouse_corrections` (hanya GR; pemohon ≠ penyetuju), Stock Adjustment (review-gated; satu-langkah ditutup), `unit_provisional_usages` (menolak unit DELIVERED dan bahan berstok → tidak cocok untuk data ini).
* Branch lain: hanya `fix/ux-bahan-drawer-pemakaian` (693b8c52) menyentuh berkas yang sama (`bahan/*`, `unitProvisionalUsageService`) → kandidat ini ditumpuk di atasnya; branch lain hanya menyentuh `schema.prisma` (migrasi berbeda, tidak bentrok). Perubahan pada berkas bersama dibuat **aditif**.

## 3. Fase
| Fase | Isi | Status kandidat |
|---|---|---|
| 1 Catatan | tabel `unit_usage_notes` (+ batch, peristiwa), impor idempoten, klasifikasi, tampil di Produksi, laporan | selesai + diuji |
| 2 Koreksi | koreksi catatan/konfirmasi/kecualikan · koreksi pemakaian (UNIT_USAGE) · koreksi saldo (origin + saldoBaru) · koreksi harga | selesai (backend + UI catatan/pemakaian) + diuji; UI koreksi harga & antrean persetujuan belum |
| 3 Posting terpadu | `postingPemakaianHistoris`: rencana berhash → persetujuan → satu transaksi per order, tanggal historis, valuasi beku, idempoten | selesai + diuji (belum dijalankan di production) |
| 4 HPP | gap parsial per unit; koreksi harga terpisah | selesai (read-model); jurnal HPP historis = keputusan Finance |
| 5 Rilis | skrip rilis bergerbang (pola `release-ux-bahan-*.sh`), UI antrean persetujuan & koreksi harga | menyusul setelah persetujuan Owner |

## 4. Model data (migrasi `20261228090000_catatan_pemakaian_historis`, aditif)
`usage_import_batches` · `unit_usage_notes` · `unit_usage_note_events` (append-only) · `fin_stock_movement_valuation_corrections` (append-only) · kolom `origin_type/origin_id` di `stock_adjustment_requests` · pagar `warehouse_corrections.doc_type` + `UNIT_USAGE`.
Keadaan catatan: `TERCATAT_DI_STOK` · `PERLU_DICEK` · `SIAP_POSTING` · `DIPOSTING` · `BUKAN_STOK` · `TIDAK_DIHITUNG` · `DIKOREKSI`.
Invarian: nilai asli tak berubah; catatan tak dihapus; setiap perubahan ada peristiwa; catatan **tidak** mengubah status kerja dan **tidak** dijumlahkan ke "Pemakaian aktual".

## 5. Runbook
1. `node scripts/import-pemakaian-historis.js <csv>` (dry-run) → baca ringkasan.
2. `... --apply` → catatan tampil di Produksi; ulang = nol perubahan.
3. `node scripts/laporan-rekonsiliasi-pemakaian.js --keluar=... ` → kejanggalan per bahan/order, dampak stok & HPP.
4. Tindak lanjut lewat UI: koreksi catatan, konfirmasi baris berulang, kecualikan salinan ganda, ajukan koreksi pemakaian (disetujui orang lain), koreksi saldo (Stock Adjustment), buat master bahan baru (tanpa stok).
5. `GET /api/production/posting-historis/rencana` → hash → Owner menyetujui → `POST .../jalankan {hashDisetujui, rujukan}` (izin `inventory:adjustment_approve`). `jurnalHPP` default **mati**.
6. Pasca-posting: kueri baca-saja di `docs`/lampiran rilis (jumlah movement, tanpa duplikat, tanpa saldo negatif baru, valuasi beku, pelaku terisi, status unit tak berubah).
Rollback: catatan tidak mengubah stok → cukup tidak dipakai. Posting yang sudah terjadi dikoreksi dengan **koreksi pemakaian** (pembalik bertaut asal), bukan dihapus.

## 6. Keputusan terbuka
* Jurnal HPP historis (tanggal Sep–Okt) atau cukup valuasi beku.
* Harga: 319 dari 384 transaksi siap-posting **tanpa harga perolehan** di ledger (persediaan awal belum diposting) → HPP parsial sampai ada harga (koreksi harga manual atau cutover persediaan).
* Faktor satuan (kecuali LEM 13 kg/CAN yang terbukti) dan pemetaan nama bahan — lihat laporan.
