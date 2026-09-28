# Production Workshop + Warehouse V2 — P4 Pengambilan Bahan Produksi (Material Issue / PICKED)

Slice keempat, di atas P3 (`...-P3-PLANNING-RESERVATION.md`). Additive; flag SAMA dengan P1–P3 (`production_v2_writer`/
`production_v2_reader`, cohort `unitIds`, fail-closed); V1 tidak berubah; **tidak memulai fase PROCESS** (P5).

## Reuse vs baru
| Reuse (tidak diduplikasi) | Baru |
|---|---|
| Tabel `material_issues`/`material_issue_lines` (dokumen), enum `IssueStatus` | Kolom nullable `material_issues.production_plan_id`, `revision`, `command_id`, `cancelled_*`; `material_issue_lines.reservation_id`; `material_reservations_v2.consumed_*` |
| `inventoryLedger.postStockMovement` (satu-satunya penulis ledger, menolak saldo negatif), `lockRowForUpdate` | Command owner `productionMaterialIssueCommandService.js` (request/pick/cancel + bacaan) |
| `postMaterialIssueCost` (HPP D-180, idempoten per `materialIssueId`) | Endpoint `/api/production-planning/material-requests…` |
| `releaseReservationsInTx` (dipecah dari P3, satu transaksi) | Partial unique "satu issue aktif per plan" |
| `generateIssueCode` (penomoran satu pola) | UI Gudang `/warehouse/material-pickup`; seksi "Permintaan Bahan" di modal Rencana Produksi |
Tidak ada ledger/saldo paralel dan tidak ada penulisan HPP/jurnal sendiri (diaudit).

## Kepemilikan V2 vs V1 (tanpa kebocoran)
`production_plan_id` terisi = dokumen dimiliki command P4. Endpoint V1 (`PATCH /:id`, `/lines/:lineId`, `POST /:id/issue`,
`PATCH /:id/cancel`) menolak memutasinya (409); `GET /api/inventory/material-issues` (V1) hanya memuat `production_plan_id IS NULL`
— perilaku V1 untuk semua baris lama identik. Antrean V2 punya endpoint sendiri, digerbang reader flag.

## State machine
Issue (memakai `IssueStatus`): `READY_TO_PICK` (dibuat langsung; reservasi P3 = persetujuan) → `ISSUED` (terminal, "Serahkan Bahan"/PICKED)
atau `CANCELLED` (hanya dari READY_TO_PICK). Reservasi: `ACTIVE` → `CONSUMED` (saat PICKED) atau `RELEASED` (batal sebelum PICKED).
Plan tetap `MATERIAL_RESERVED` selama request/pick; batal sebelum PICKED mengembalikan plan ke `PLANNED`.
Setelah ISSUED tidak ada cancel/delete — koreksi lewat return/adjustment kanonis. Tidak ada partial pick (qty keluar = qty reservasi).

## PICKED atomik (satu transaksi)
kunci dokumen (`material_issues`) → per baris (materialId ascending) `postStockMovement` ISSUE negatif (kunci `materials`, tolak saldo
negatif → seluruh transaksi rollback) → `issuedQty` → reservasi `CONSUMED` → issue `ISSUED` → `postMaterialIssueCost` (HPP, jalur kanonis) →
outbox `warehouse.material_issue.picked` + audit. Replay (Idempotency-Key sama) mengembalikan respons tersimpan tanpa movement/jurnal/audit/outbox baru.
Stok fisik berkurang HANYA saat PICKED, bukan saat request.

## Reserved: tanpa hitung ganda
`computeStockSnapshot` dan availability P3 kini menghitung reserved V1 hanya untuk dokumen `production_plan_id IS NULL`, ditambah reservasi V2
`ACTIVE`. Issue P4 berstatus READY_TO_PICK termasuk `RESERVED_STATUSES`, sehingga tanpa filter ini demand-nya terhitung dua kali.

## Guard P3
Selama ada permintaan aktif (409 `PLAN_MATERIAL_ISSUE_ACTIVE`) atau setelah ISSUED (409 `PLAN_MATERIAL_ALREADY_ISSUED`), P3 menolak lepas reservasi/ubah BOM/batal
rencana/reservasi ulang — mencegah dokumen yatim dan pemesanan ulang bahan yang sudah keluar.

## Endpoint
| Method | Path | Permission |
|---|---|---|
| GET | `/material-requests?status=&planId=` , `/material-requests/:id` | UNIT_READ/INVENTORY_READ (reader-gated) |
| POST | `/plans/:id/material-request` (tanpa body baris) | UNIT_MATERIAL_WRITE/INVENTORY_WRITE |
| POST | `/material-requests/:id/pick` `{expectedRevision}` | INVENTORY_WRITE (Gudang) |
| POST | `/material-requests/:id/cancel` `{reason,expectedRevision}` | UNIT_MATERIAL_WRITE/INVENTORY_WRITE |
Semua POST: header `Idempotency-Key`. Kode galat: `PLAN_NOT_MATERIAL_RESERVED`, `MATERIAL_ISSUE_ALREADY_ACTIVE`, `MATERIAL_ISSUE_REVISION_CONFLICT`,
`MATERIAL_ISSUE_SHORTAGE`, `MATERIAL_ISSUE_ALREADY_PICKED`, `MATERIAL_ISSUE_CANCELLED`, `MATERIAL_ISSUE_WRITER_OFF` (503).

## Migration `20260930080000_production_material_issue_v2`
Hanya `ADD COLUMN` nullable (kecuali `revision INTEGER NOT NULL DEFAULT 1`), 2 index, 2 FK, 1 partial unique. Menyentuh `material_issues`/
`material_issue_lines` yang SUDAH berisi data production (berbeda dengan P1–P3 yang hanya tabel baru) — baris lama otomatis NULL/1.

## Gate
`scripts/production-delivery-v2/audit-material-issue-writers.js`: penulis issue/line hanya V1 + command P4; reservasi hanya P3 + P4; stock_movements hanya
`inventoryLedger`; P4 wajib memakai `postStockMovement` + `postMaterialIssueCost` dan tidak menulis jurnal sendiri.

## Gap menuju P5
Mulai fase PROCESS produksi memakai bahan yang sudah diserahkan; return/adjustment bahan pasca-PICKED yang terhubung ke reservasi CONSUMED;
penyerahan parsial (sengaja tidak didukung); notifikasi Gudang; P2b unit tanpa pickup; P7 fence Sales.
