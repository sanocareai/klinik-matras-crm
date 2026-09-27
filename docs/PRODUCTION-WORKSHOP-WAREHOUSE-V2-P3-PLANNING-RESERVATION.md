# Production Workshop + Warehouse V2 — P3 Planning Produksi H-1 & Reservasi Bahan

Slice ketiga dari `PRODUCTION-WORKSHOP-WAREHOUSE-V2-P0.md`, dibangun di atas P1–P2 (`docs/PRODUCTION-WAREHOUSE-V2-P1P2-INBOUND-CUSTODY.md`).
Additive; flag default OFF (SAMA flag dengan P1-P2, tidak ada flag baru); V1 tidak berubah; **tidak memulai pekerjaan
produksi** (fase PROCESS) — kode slice ini tidak pernah menulis `ProductionRun.status`/`currentPhase` atau
`ProductionPhaseRun` sama sekali.

## Keputusan reuse vs baru (audit sebelum coding)
- **Assignment workshop/operator**: dipetakan ke `WorkCenter` dan `ProductionOperator` yang SUDAH ADA (Production
  Core Slice 4E) — bukan entitas baru. "Team" di bahasa tugas = `WorkCenter`.
- **Reservasi bahan**: TIDAK menaruh reservasi V2 ke `MaterialIssue`/`MaterialIssueLine` (V1) — itu adalah dokumen
  approval yang sudah live dan dilihat staf Gudang setiap hari; menaruh reservasi eksperimental V2 di sana akan
  bocor ke antrean V1 terlepas dari flag (melanggar fail-closed cohort). Sebagai gantinya: tabel baru
  `material_reservations_v2`, TAPI perhitungan **availability** menggabungkan reserved V1
  (`inventoryLedger.RESERVED_STATUSES`) **dan** reserved V2 aktif — supaya dua jalur tidak bisa menjanjikan stok
  fisik yang sama tanpa saling tahu.
- **Ledger stok**: reuse penuh `services/inventoryLedger.js` (`lockRowForUpdate`, `lockMaterialBalance`,
  `RESERVED_STATUSES`) — TIDAK ada query SUM/lock duplikat. Slice ini tidak pernah memanggil `postStockMovement`
  (tidak ada pengurangan fisik).
- **Eligibility unit**: `ProductionRun` yang sudah dibuat P1-P2 (`openProductionIntakeV2`, custody INBOUND
  ACCEPTED) + fase PROCESS belum `ACTIVE`/`COMPLETED`, ATAU `migrationSource` terisi (pengecualian data legacy).
  Tidak ada tabel eligibility baru.

## Model (migration `20260929080000_production_planning_reservation_v2`, aditif)
- **`ProductionRunPlan`** (1:1 `ProductionRun`): `status` (DRAFT → PLANNED → MATERIAL_RESERVED, atau CANCELLED
  terminal), `workCenterId`/`operatorId` (FK kanonis), `targetStartAt`/`targetCompleteAt`, `revision`.
  "Satu planning aktif per Unit" mewarisi `production_runs_v2_active_unit_key` (P1-P2) lewat 1:1 ke Run — tidak
  perlu index baru.
- **`PlannedBOMLine`** (N:1 Plan): snapshot `materialId`+`qty`+`unit`+`revision` per baris; `status`
  ACTIVE/SUPERSEDED/CANCELLED. Partial unique `(plan_id, material_id) WHERE status='ACTIVE'` — satu baris aktif
  per material per plan.
- **`MaterialReservation`** (N:1 BOM line + Plan, denormalisasi `materialId`): `qty`, `status`
  ACTIVE/RELEASED/CONSUMED/CANCELLED. Partial unique `(bom_line_id) WHERE status='ACTIVE'` — satu reservasi aktif
  per sumber (baris BOM); histori (RELEASED/CANCELLED) boleh banyak. `CONSUMED` disiapkan untuk P4 (Material
  Issue/PICKED) — belum ada penulis ke status itu di slice ini.

## Transisi
```
DRAFT --assign(workshop, operator, target waktu)--> PLANNED
PLANNED --setBOM--> PLANNED (BOM belum direservasi)
PLANNED --reserve(fail-closed, atomik)--> MATERIAL_RESERVED
MATERIAL_RESERVED --setBOM(ubah)--> PLANNED  (SEMUA reservasi aktif otomatis RELEASED, tanpa yatim; reservasi ulang eksplisit)
* --release(manual, no-op aman)--> PLANNED (bila sebelumnya MATERIAL_RESERVED) / status tetap (no-op)
* --cancel(alasan wajib)--> CANCELLED (terminal; reservasi+BOM aktif ikut dibatalkan, histori dipertahankan)
```
Hanya plan yang belum `CANCELLED` dapat diproses; `expectedRevision` basi ditolak 409. Reservasi hanya dari
status `PLANNED` (bukan DRAFT, bukan yang sudah `MATERIAL_RESERVED`).

## Reservasi: lock deterministik & fail-closed atomik
`reserveMaterialForPlan` mengurutkan `materialId` Planned BOM (ascending) lalu mengunci tiap baris `materials`
lewat `lockMaterialBalance` (reuse `inventoryLedger.js`) **dalam urutan itu** — mencegah deadlock antara dua
command reservasi yang berebut material yang sama dalam urutan berbeda. Availability per material = on-hand
(`SUM stock_movements`) − reserved V1 (`MaterialIssueLine`, `RESERVED_STATUSES`) − reserved V2 aktif material
tersebut (plan manapun, kecuali plan ini sendiri). Semua baris BOM diperiksa SEBELUM baris reservasi apa pun
ditulis — kekurangan pada material apa pun (409 `PLAN_MATERIAL_SHORTAGE`, daftar lengkap kekurangan) membatalkan
seluruh transaksi (Prisma `$transaction`), tidak ada reservasi sebagian. **Tidak menulis `stock_movements`** —
stok fisik baru berkurang lewat Material Issue/PICKED (P4).

## Endpoint (`/api/production-planning`, permission Produksi/Inventori, pesan Indonesia)
| Method | Path | Permission | Keterangan |
|---|---|---|---|
| GET | `/eligible-units` | UNIT_READ atau INVENTORY_READ | Unit eligible belum punya plan aktif |
| GET | `/plans?status=` | idem | DRAFT/PLANNED/MATERIAL_RESERVED/CANCELLED |
| GET | `/plans/:id` | idem | Detail satu plan |
| POST | `/plans` `{runId}` | UNIT_MATERIAL_WRITE atau INVENTORY_WRITE | Buat plan DRAFT |
| POST | `/plans/:id/assign` | idem | Workshop/operator/target waktu |
| POST | `/plans/:id/bom` `{lines}` | idem | Full-replace Planned BOM |
| POST | `/plans/:id/reserve` | **INVENTORY_WRITE** (Gudang) | Reservasi bahan |
| POST | `/plans/:id/release` `{reason}` | **INVENTORY_WRITE** (Gudang) | Lepas reservasi manual |
| POST | `/plans/:id/cancel` `{reason}` | UNIT_MATERIAL_WRITE atau INVENTORY_WRITE | Batalkan plan |
Semua POST wajib header `Idempotency-Key` + `expectedRevision` (kecuali create). GET digerbang flag reader
terpisah (lihat § Flag) — sama pola dengan unit-custody.

## Command, outbox, audit
Command owner tunggal: `src/services/productionPlanningCommandService.js` (`v2_commands` domain `PRODUCTION`,
idempotency `(actorId, key)`, baris plan dikunci `FOR UPDATE` sebelum mutasi). Outbox:
`production.plan.{created,assigned,bom_set,material_reserved,cancelled}`, `production.reservation.{created,released}`.
Audit: `PRODUCTION_PLAN_{CREATED,ASSIGNED,BOM_SET,MATERIAL_RESERVED,CANCELLED}` (kalimat Indonesia di `activityLog`).

## Flag dan cohort
Reuse **persis** flag P1-P2 — TIDAK ADA flag baru:
- **Writer** (`production_v2_writer`): OFF/GLOBAL/COHORT `config.unitIds`, fail-closed, sama resolver
  (`resolveProductionWriterState`/`isProductionWriterEnabledFor`). Unit di luar cohort/writer OFF → 503
  `PLANNING_WRITER_OFF`, TIDAK ADA baris ditulis ke `production_run_plans_v2`/`planned_bom_lines_v2`/
  `material_reservations_v2` (diuji: `v2Counts()` tetap sama sebelum/sesudah).
- **Reader** (`production_v2_reader`): menggerbang GET `eligible-units`/`plans` — OFF → `{items:[], readerMode:"OFF"}`
  (bukan error), sama seperti antrean custody.
- Delivery writer cohort (`delivery_v2_writer_route`/`execution`, canary RTE-280926-01) **tidak disentuh sama
  sekali** oleh slice ini — tidak ada kode di sini yang membaca/menulis flag Delivery.

## Gate
`scripts/production-delivery-v2/audit-planning-writers.js`: `production_run_plans_v2`/`planned_bom_lines_v2`/
`material_reservations_v2` HANYA boleh ditulis oleh `productionPlanningCommandService.js` — penulis lain =
pelanggaran (0 toleransi, tidak ada kelas "PENDING_LATER_SLICE" di sini karena tidak ada jalur V1 yang perlu
di-hook seperti armada.js pada custody).

## UI Gudang/Produksi
`frontend/src/pages/bengkel/ProductionPlanning.jsx` (`/bengkel/planning`, nav "Rencana Produksi" di section
OPERASIONAL Bengkel). Tab Antrean (eligible-units)/Draf/Direncanakan/Bahan Direservasi/Dibatalkan. Kartu Antrean
→ "Buat Rencana"; kartu plan → modal detail (assignment workshop/operator/target waktu dari `WorkCenter`/
`ProductionOperator` kanonis — tanpa teks bebas; editor Planned BOM dari master `Material` dengan tampilan
tersedia/direservasi/kebutuhan/kekurangan per baris dari `GET /inventory/stock`; reservasi/lepas/batalkan).
Loading/kosong/error/409/replay ditangani; reader OFF → pesan "belum diaktifkan (canary)", bukan error. Logika
murni di `frontend/src/features/production/planning.js` (diuji `frontend/tests/productionPlanning.test.js`).

## Gap berikutnya (P4+)
Material Issue/PICKED yang benar-benar mengurangi stok fisik dari reservasi V2 (`MaterialReservation` →
`CONSUMED`, `postStockMovement` ISSUE); mulai fase PROCESS (di luar scope P3, sengaja); P2b unit lahir tanpa
pickup; P7 fence kaskade Sales.
