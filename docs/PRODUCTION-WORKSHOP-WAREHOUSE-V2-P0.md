# Production Workshop + Warehouse V2 — P0 Arsitektur

Status: **P0 (dokumen)**. Tidak ada perubahan kode, migration, flag, atau data production.
Baseline audit: `main` `8b1756a6` (production aktif `87bbba36` + tes). Sumber kebenaran: kode aktual, bukan rencana lama.
Blueprint Production V2 yang diacu = model V2 yang SUDAH ada di schema lewat migration
`20260925000000_production_delivery_v2_foundation` (`production_runs_v2`, `production_phase_runs_v2`,
`production_operation_runs_v2`, `diagnosis_reports_v2`, `quality_inspections_v2`(+items), `production_handoffs_v2`) plus
pola command/outbox Delivery V2 (`v2_commands`, `domain_outbox`, `v2_feature_flags`).

Driver Mobile dan Delivery Control Mobile **di luar scope** (tidak diubah). Seluruh UI/copy operasional: Bahasa Indonesia.

---

## 0. Ringkasan temuan kritis

| # | Temuan (kode aktual) | Dampak | Bukti |
|---|---|---|---|
| K1 | Pickup selesai langsung menulis `Unit.status=RECEIVED`; tidak ada check-in gudang. `IN_TRANSIT_IN` **tidak punya writer**. | Tidak ada serah-terima fisik Delivery→Gudang; kondisi/foto/lokasi masuk tidak tercatat; unit "diterima" padahal masih di mobil. | `routes/armada.js:5084` (komentar mengakui "belum ada fitur scan intake gudang") |
| K2 | Dropdown status Order (Sales) mengkaskade ke Unit/Job: `READY` memaksa unit `READY_FOR_DELIVERY` + membuat job Delivery, `DELIVERED` memaksa unit `DELIVERED`, `CANCELLED` membatalkan unit. | Sales dapat melewati Produksi, QC, Gudang, dan Delivery. Melanggar ownership V2 dan membuat parity V2 tidak mungkin dijaga. | `routes/orders.js` `PATCH /:id` (blok kaskade ±L395–540; cabang READY L460) |
| K3 | QC hanya "fit test" kekerasan (`TERLALU_KERAS/PAS/TERLALU_EMPUK`) di tahap yang ditandai gerbang QC. Checklist QC (`quality_inspections_v2`) belum dipakai; `adminBypassProduction` langsung ke `READY_FOR_DELIVERY`. | Tidak ada QC checklist/foto/disposisi yang bisa diaudit; bypass tanpa jejak QC. | `services/unitStageEngine.js:848`, `:952` |
| K4 | `POST /api/units/:id/materials` (Produksi) langsung memposting `StockMovement` ISSUE/RETURN — melewati Material Issue (approval, reservasi, pick) dan tidak memposting HPP inline. | Dua jalur pengeluaran bahan; stok gudang bisa dikurangi tanpa gudang; HPP masuk antrean `FinPostingGap`. | `routes/units.js:605` |
| K5 | Delivery gagal: unit `IN_TRANSIT_OUT` → langsung `READY_FOR_DELIVERY`. | Unit tidak pernah kembali tercatat di gudang; lokasi fisik tidak jujur. | `routes/armada.js:5313` |
| K6 | Tidak ada payment hold di jalur outbound. `Order.paymentStatus` diturunkan dari ledger `Payment` + `PaymentVerification`, tetapi Delivery tidak membacanya. | Unit belum lunas bisa dikirim tanpa keputusan eksplisit. | `services/paymentLedger.js:41`; tidak ada referensi paymentStatus di armada/deliveryHandoff |
| K7 | Order BARU melahirkan unit langsung `RECEIVED`; SEWA langsung `READY_FOR_DELIVERY`. | Tidak semua unit melalui intake; V2 harus punya jalur "lahir di bengkel" yang eksplisit, bukan status palsu. | `services/unitProvisioning.js:134` |
| K8 | Tabel Production V2 hanya ditulis oleh backfill (`scripts/production-delivery-v2/backfill-core.js`); tidak ada command owner Produksi. `production_runs_v2` tidak punya unique "satu run aktif per unit"; `production_handoffs_v2.deliveryJobId` tidak unique. | Sebelum writer Produksi V2 aktif, invariant ini wajib ditambahkan (additive). | schema L8124–8269 |
| K9 | Lokasi berbentuk teks bebas: `Unit.storageLocation` (string) dan `StockMovement.location` (string), bukan FK `StorageLocation`. | Custody unit & bin bahan tidak bisa divalidasi. | schema `Unit`, `StockMovement` |

Hal yang **sudah benar** dan dipakai ulang (bukan diduplikasi): reservasi implisit Material Issue
(status `APPROVED/READY_TO_PICK/PICKED` = reserved, `services/inventoryLedger.js`), `lockMaterialBalance` (SELECT … FOR UPDATE),
posting HPP (`services/finance/posting/inventory.js`, cutover perpetual B3.6), pola `executeDelivery*Command`
(`v2_commands` + `domain_outbox` + idempotency), writer cohort berbasis route, dan `ComplaintCase`/`UnitRevision` untuk revisi pasca-kirim.

---

## 1. Mapping entitas, status, endpoint, writer owner, tabel existing

### 1.1 Entitas inti

| Entitas | Tabel | Kunci | Status | Writer saat ini (V1) | Owner V2 yang diusulkan |
|---|---|---|---|---|---|
| Order | `Order` | `id`, `orderNumber` | `OrderStatus` PENDING…DELIVERED, SEWA_* ; `paymentStatus` BELUM_BAYAR/DP/LUNAS | Sales (`orders.js`), turunan `orderStatusSync.syncOrderStatus`, Finance (`penerimaanOrder`, `paymentLedger`) | **Sales** (komersial). Status fisik = proyeksi turunan, bukan diinput |
| Unit (kasur fisik) | `Unit` | `id`, `unitCode` | `UnitStatus` AWAITING_PICKUP, IN_TRANSIT_IN, RECEIVED, IN_PRODUCTION, READY_FOR_DELIVERY, READY_ON_CUSTOMER_HOLD, IN_TRANSIT_OUT, DELIVERED, CANCELLED | armada.js, unitStageEngine, orders.js, units.js, productionRouting, scopeRevision, orderStatusSync | **Proyeksi kompatibilitas V1**; state kanonik dipecah ke custody (Gudang), run (Produksi), job (Delivery) |
| Job (pickup/delivery) | `Job`, `JobUnit` | `id`; `JobUnit(jobId,unitId)` unique | `JobStatus` | Delivery (armada + command service V2) | **Delivery** (sudah V2) |
| Route | `Route` + `delivery_route_states_v2`, `route_publications_v2`, `route_stop_assignments_v2` | `id`, `code` | `RouteStatus` | Delivery | **Delivery** (V2, writer cohort) |
| Tahap produksi | `RoutingStage`, `ServiceCatalog`, `ProductionRoute(+Stage)`, `UnitStageLog`, `ProductionBlocker`, `StageAssignment`, `WorkCenter`, `ProductionOperator` | — | `StageLogAction`, `BlockReason`, `PauseReason` | unitStageEngine, productionRouting | **Produksi** |
| QC fit | `QcFitTest` | — | `FitVerdict` | unitStageEngine.recordQcFitTest | **QC** (di dalam domain Produksi) |
| Production V2 | `production_runs_v2`, `production_phase_runs_v2`, `production_operation_runs_v2`, `diagnosis_reports_v2`, `quality_inspections_v2`(+items), `production_handoffs_v2` | `runId`; `(runId,phase)`, `(runId,sequence)`, `(runId,version)` | `ProductionRun*`, `ProductionPhaseRun*`, `ProductionOperationStatus`, `DiagnosisReportStatus`, `QualityInspectionResult`, `ProductionHandoffStatus` | hanya backfill | **Produksi** |
| Bahan | `Material`, `StockMovement` | `code` | `StockMovementType` RECEIPT/ISSUE/RETURN/WASTE/ADJUSTMENT/TRANSFER | inventoryLedger.postStockMovement (dipanggil inventory.js, goodsReceipt, materialIssue, stockTransfer, stockCount, damagedStock, returnRecord, stockAdjustment, **units.js**) | **Gudang** |
| Permintaan bahan | `MaterialIssue`(+lines) | `issueNumber` | `IssueStatus` DRAFT→WAITING_APPROVAL→APPROVED→READY_TO_PICK→PICKED→ISSUED / CANCELLED | materialIssue.js | **Gudang** (permintaan diajukan Produksi) |
| Lokasi | `Warehouse`, `StorageLocation` | `code` | `LocationType` RECEIVING/RAW/WIP/FG/QUARANTINE/DAMAGED/RETURN/DISPATCH | inventory | **Gudang** |
| Retur/rusak | `ReturnRecord`, `DamagedStockRecord`, `StockAdjustmentRequest` | nomor dokumen | enum masing-masing | Gudang | **Gudang** |
| Pembayaran | `Payment`, `PaymentVerification`, `FinPaymentAllocation` | `paymentId` unique pada verifikasi | turunan `Order.paymentStatus` | Finance/Sales/driver (catat), Finance (verifikasi) | **Finance** |
| Revisi/komplain | `UnitRevision`, `UnitRevisionJobLink`, `ComplaintCase`, `ScopeRevision` | — | enum masing-masing | armada.js, complaintCase, scopeRevision | CS/Produksi (tetap) |
| V2 infra | `v2_commands`, `domain_outbox`, `v2_feature_flags`, `v2_migration_*`, `v2_shadow_comparisons` | `(actorId,idempotencyKey)`, `dedupeKey` | — | command services | Infrastruktur bersama |

### 1.2 Endpoint per domain (existing)

- **Sales**: `PATCH /api/orders/:id` (status + kaskade, **K2**), pembuatan order + `createUnitsForOrder`.
- **Delivery**: `/api/armada/*` (route/job/publish/start/arrive/complete/fail, revisi pickup), `/api/delivery-v2/*` (snapshot/delta driver), `/api/delivery-control/*`.
- **Produksi**: `/api/production/*` (`board`, `work-orders`, `qc-queue`, `material-usage`, `command-center`, `units/:id/done`, route/work-center/operator), `/api/units/*` (`stages/start|complete|fail|pause|resume|skip|qc|assign`, `blockers/:id/resolve`, `service`, `production`, `route`, `photos`, `materials`).
- **Gudang**: `/api/inventory/*` (materials, movements receipt/issue/return/waste/adjustment), `goods-receipts`, `material-issues`, `transfers`, `stock-counts`, `damaged-stock`, `returns`, `adjustments`, `replenishment`, `reports`.
- **Finance**: `/api/finance/*` (pembayaran, penerimaan, verifikasi, posting gap `finance.js:946`, rekon, persediaan awal).
- **Web**: `frontend/src/pages/bengkel/*` (Produksi: WorkOrders, UnitDetail, QcQueue, MaterialUsage, …), `pages/warehouse/*` (Gudang), `pages/armada/*`, `pages/finance/*`, `Orders.jsx`.

---

## 2. Flow aktual per unit (kode hari ini)

```
Order dibuat (Sales)
 └─ createUnitsForOrder: LAYANAN → AWAITING_PICKUP | BARU → RECEIVED | SEWA → READY_FOR_DELIVERY      (unitProvisioning.js:134)
AWAITING_PICKUP ──(ensurePickupJobForOrder: Job PICKUP)──▶ Delivery menjadwalkan/publish route
 PICKUP start  : unit TETAP AWAITING_PICKUP                                                            (armada.js ±4818)
 PICKUP complete: unit → RECEIVED  (tanpa IN_TRANSIT_IN, tanpa check-in gudang)                        (armada.js:5084)  [K1]
RECEIVED ──(Produksi startStage)──▶ IN_PRODUCTION  (stage log START/COMPLETE/FAIL/PAUSE, blocker)       (unitStageEngine:337/463)
 QC fit test (gerbang QC): PAS/override → lanjut; gagal → FAIL + rework ke modul lapisan               (unitStageEngine:848)  [K3]
 tahap terakhir selesai / adminBypass → READY_FOR_DELIVERY                                             (unitStageEngine:618/971)
READY_FOR_DELIVERY ──(suggestDeliveryJob: Job DELIVERY UNSCHEDULED)──▶ Delivery
 DELIVERY start: unit → IN_TRANSIT_OUT                                                                 (armada.js:4825)
 DELIVERY complete: unit → DELIVERED                                                                   (armada.js:5084)
 DELIVERY fail : IN_TRANSIT_OUT → READY_FOR_DELIVERY (tanpa kembali ke gudang)                         (armada.js:5313)  [K5]
Order.status = computeOrderStatus(units) kecuali statusLocked                                          (orderStatusSync:67/314)
Pembayaran: Payment dicatat → PaymentVerification (Finance) → recomputeOrderPaymentStatus              (paymentLedger:41)  [K6: tidak memblok kirim]
Jalan pintas Sales: PATCH /api/orders/:id status READY/DELIVERED/CANCELLED mengkaskade unit+job        [K2]
Bahan: Material Issue (reservasi→ISSUED, HPP) ATAU /units/:id/materials (langsung ISSUE/RETURN)         [K4]
Pasca-kirim: UnitRevision/ComplaintCase → pickup revisi → produksi ulang
```

---

## 3. Gap matrix terhadap blueprint Production V2

| Kapabilitas blueprint | Model V2 tersedia | Dipakai kode | Gap | Fase |
|---|---|---|---|---|
| Intake/serah-terima pickup → gudang | `ProductionPhaseKind.INTAKE`, `ProductionHandoff` (hanya arah outbound) | Tidak | Tidak ada entitas custody unit & check-in; IN_TRANSIT_IN tak dipakai (K1) | P2 |
| Run produksi per unit (+rework) | `production_runs_v2` (`kind` REWORK, `parentRunId`) | Hanya backfill | Tidak ada command owner; tidak ada unique run aktif (K8) | P3 |
| Fase (INTAKE/DIAGNOSIS/PROCESS/QC/HANDOFF) | `production_phase_runs_v2` | Backfill | Tidak ada transisi terkontrol | P3 |
| Operasi per tahap routing | `production_operation_runs_v2` | Backfill | Stage engine V1 masih writer tunggal | P3 |
| Diagnosis + persetujuan | `diagnosis_reports_v2` | Tidak | Tidak ada UI/command | P3 |
| QC checklist + disposisi + rework | `quality_inspections_v2(+items)` | Tidak | Hanya fit test (K3) | P4 |
| Reservasi/issue/return/scrap bahan per run | `MaterialIssue` (+reserved implisit), `StockMovement.unitId` | Sebagian | Jalur langsung units.js (K4); tidak ada link ke `runId`; scrap = WASTE tanpa referensi run | P5 |
| Handoff Produksi → Delivery | `production_handoffs_v2` (`deliveryJobId`) | Tidak | `suggestDeliveryJob` langsung dari status unit; `deliveryJobId` tidak unique (K8) | P6 |
| Payment hold sebelum outbound | — | Tidak | Tidak ada model hold/keputusan (K6) | P6 |
| Retur gagal kirim ke gudang | `ReturnRecord` (bahan), tidak ada untuk unit | Tidak | K5 | P2/P6 |
| Command + outbox + idempotency | `v2_commands`, `domain_outbox` | Delivery saja | Produksi/Gudang belum | P1 |
| Flag + shadow parity | `v2_feature_flags`, shadow-compare (unit terminal vs run) | Ya (flag Produksi OFF) | Perlu flag Gudang & parity custody | P1/P7 |
| Fence penulis V1 | `production_v1_writer_fence` | Flag ada | Sales kaskade (K2) & units.js (K4) belum ter-fence | P1/P7 |

---

## 4. Batas ownership domain

| Domain | Memiliki (satu-satunya penulis) | Boleh membaca | TIDAK boleh menulis |
|---|---|---|---|
| **Sales** | Order komersial (harga, item, alamat, jadwal yang diminta pelanggan, pembatalan komersial) | proyeksi status fisik, pembayaran | Unit.status, Job, run produksi, stok |
| **Delivery** | Job, Route, publikasi/assignment, eksekusi (start/arrive/POD/fail), serah-terima di titik jemput/antar | custody, readiness, payment hold | run produksi, stok, custody gudang (hanya **mengusulkan** serah-terima) |
| **Gudang** | Custody fisik unit di workshop (check-in, lokasi, karantina, rilis ke dispatch), seluruh stok bahan (issue/return/scrap/adjust/transfer/count) | run produksi, permintaan bahan | run/fase/QC, Job |
| **Produksi** | Run, fase, operasi, diagnosis, blocker, **permintaan** bahan per run, penerimaan intake ke run, penawaran handoff | custody, stok (available), payment hold | stok langsung, Job, pembayaran |
| **QC** (sub-domain Produksi, role `QC_LEAD`) | Inspeksi, hasil, disposisi (lulus/rework/override berwenang) | run, riwayat | stok, Job |
| **Finance** | Payment verification, payment hold/release, jurnal (HPP/WIP/susut) | semua | status fisik unit, Job |

Aturan: satu fakta satu penulis. Domain lain bereaksi lewat **event outbox** atau **command handoff** yang diterima penerima.

---

## 5. Kontrak handoff dua arah + event durable

Pola: pengirim membuat **penawaran** (command, idempotent), penerima **menerima/menolak** (command milik penerima). Tiap command menulis
`v2_commands` + perubahan state + `domain_outbox` dalam **satu transaksi** (pola `executeDeliveryRouteCommand`). `dedupeKey` unik per efek.

| Handoff | Penawaran (pengirim) | Penerimaan (penerima) | Tolak/kembali | Event |
|---|---|---|---|---|
| H1 Delivery → Gudang (pickup tiba) | POD pickup selesai: `OFFER_INBOUND_CUSTODY(unitId, jobId, fotoKondisi)` | Gudang `ACCEPT_INBOUND_CUSTODY(unitId, lokasi)` | `REJECT_INBOUND_CUSTODY(alasan)` → karantina | `warehouse.custody.offered/accepted/rejected` |
| H2 Gudang → Produksi (siap dikerjakan) | Gudang `RELEASE_TO_PRODUCTION(unitId)` | Produksi `ACCEPT_INTAKE(unitId)` → buka run (fase INTAKE) | `RETURN_TO_WAREHOUSE` | `production.run.opened`, `warehouse.custody.released` |
| H3 Produksi → Gudang (bahan) | `REQUEST_MATERIAL(runId, lines)` → MaterialIssue `sourceType=PRODUCTION_WORK_ORDER`, `sourceReference=runId` | Gudang approve/pick/issue (flow existing) | cancel | `warehouse.material.reserved/issued/returned/scrapped` |
| H4 Produksi → QC | fase PROCESS selesai → `REQUEST_INSPECTION(runId)` | QC `RECORD_INSPECTION(runId, version, items)` | FAIL_REWORK → run REWORK | `production.qc.passed/failed` |
| H5 Produksi → Gudang (barang jadi) | `OFFER_FINISHED_GOODS(runId)` setelah QC PASS | Gudang `ACCEPT_FINISHED_GOODS(lokasi FG)` | tolak (kemasan/cacat) → rework | `production.handoff.offered/accepted` |
| H6 Gudang → Delivery (siap kirim) | `READY_FOR_DISPATCH(unitId)` jika **tidak ada payment hold** | Delivery membuat/menyusun job (suggestDeliveryJob via command) | hold aktif → `dispatch.blocked` | `delivery.dispatch.ready`, `finance.payment.hold.*` |
| H7 Delivery → Gudang (gagal kirim) | FAIL job delivery: `OFFER_RETURN_CUSTODY(unitId)` | Gudang `ACCEPT_RETURN_CUSTODY` | — | `warehouse.custody.returned` |
| H8 Finance ↔ Delivery | `PLACE_PAYMENT_HOLD` / `RELEASE_PAYMENT_HOLD` | (dibaca Gudang/Delivery di H6) | — | `finance.payment.hold.placed/released` |

Konsumen outbox: idempotent terhadap `eventId` + `dedupeKey`; urut per `(aggregateType, aggregateId)` berdasarkan `aggregateRevision`.
Drain memakai mekanisme existing (`outbox-drain-rehearsal` membuktikan exactly-once).

---

## 6. Canonical IDs / correlation keys

| Kunci | Sumber | Dipakai untuk |
|---|---|---|
| `orderId` / `orderNumber` | Sales | korelasi komersial & Finance |
| `unitId` / `unitCode` | Unit | **kunci utama fisik lintas domain** |
| `runId` | `production_runs_v2.id` | pekerjaan produksi (termasuk rework: `parentRunId`) |
| `custodyId` (baru) | tabel custody | satu periode unit berada di workshop |
| `jobId`, `routeId`, `publicationVersion` | Delivery | eksekusi pengiriman |
| `materialIssueId`, `movementId` | Gudang | bahan; `MaterialIssue.sourceReference = runId` |
| `inspectionId` + `version` | QC | hasil QC |
| `handoffId` | `production_handoffs_v2` | serah-terima outbound |
| `paymentId`, `holdId` (baru) | Finance | pembayaran & hold |
| `correlationId` | payload outbox | = `unitId`; `causationId` = `v2_commands.id` pemicu |
| `idempotencyKey` | header `Idempotency-Key` | per aktor, unique `(actorId, idempotencyKey)` |

Aturan: route/unit authoritative selalu di-resolve dari database (sama dengan writer cohort Delivery), bukan dari payload klien.

---

## 7. State machine

### 7.1 Custody Gudang (unit fisik, baru)

```
(tidak di workshop) ──OFFER_INBOUND──▶ DITAWARKAN ──ACCEPT──▶ DITERIMA(lokasi RECEIVING)
DITERIMA ──PUTAWAY──▶ DISIMPAN(lokasi) ──RELEASE_TO_PRODUCTION──▶ DI_PRODUKSI
DI_PRODUKSI ──ACCEPT_FINISHED_GOODS──▶ BARANG_JADI(lokasi FG) ──READY_FOR_DISPATCH──▶ SIAP_KIRIM(DISPATCH)
SIAP_KIRIM ──(Delivery start)──▶ KELUAR (custody ditutup)
KELUAR ──OFFER_RETURN (gagal kirim)──▶ DITAWARKAN ──ACCEPT──▶ BARANG_JADI
DITAWARKAN ──REJECT──▶ KARANTINA ──(keputusan)──▶ DITERIMA | DITOLAK_TUTUP
```
Proyeksi ke `UnitStatus` V1: DITAWARKAN=`IN_TRANSIT_IN`, DITERIMA/DISIMPAN=`RECEIVED`, DI_PRODUKSI=`IN_PRODUCTION`,
BARANG_JADI/SIAP_KIRIM=`READY_FOR_DELIVERY`, hold pelanggan=`READY_ON_CUSTOMER_HOLD`, KELUAR=`IN_TRANSIT_OUT`.

### 7.2 Production run (memakai enum existing)

```
PENDING_ARRIVAL ──ACCEPT_INTAKE──▶ ACTIVE[INTAKE]
ACTIVE: INTAKE → DIAGNOSIS (bila kind=RESTORATION; NOT_APPLICABLE untuk FULFILLMENT_ONLY) → PROCESS → QC → HANDOFF
ACTIVE ⇄ BLOCKED (blocker terbuka / bahan tidak tersedia / payment hold tidak memblok produksi)
QC=FAIL_REWORK → run tetap ACTIVE, fase PROCESS dibuka lagi (rework minor) ATAU run anak kind=REWORK (rework mayor)
HANDOFF ACCEPTED oleh Gudang → COMPLETED
batal komersial (Sales) → CANCELLED hanya lewat command Produksi yang menanggapi event order.cancelled
MIGRATION_REVIEW = hasil backfill yang tidak pasti; tidak bisa ditransisikan sebelum keputusan manusia
```
Invariant: satu run **non-terminal** per unit; revisi fase naik monoton; setiap transisi = satu command APPLIED.

### 7.3 Material Issue (existing, tidak diubah)
`DRAFT → WAITING_APPROVAL → APPROVED → READY_TO_PICK → PICKED → ISSUED` (+`CANCELLED`). Reserved = APPROVED..PICKED.

---

## 8. Aturan bisnis

### 8.1 QC / rework
- QC wajib untuk kind RESTORATION/NEW_PRODUCT/REWORK; FULFILLMENT_ONLY memakai QC ringan (checklist kemasan/kelengkapan).
- Satu inspeksi = satu `version`; hasil `PASS` / `FAIL_REWORK` / `OVERRIDDEN` (override wajib role `QC_LEAD`/`OWNER` + alasan).
- Fit test existing (`QcFitTest`) dipetakan sebagai **item** checklist (`itemCode=FIT_TEST`), bukan dihapus.
- FAIL_REWORK: minor → buka ulang operasi terkait di run yang sama; mayor → run anak `REWORK` (`parentRunId`), bahan tambahan lewat H3.
- `adminBypassProduction` di V2 = QC `OVERRIDDEN` + alasan + aktor, tercatat, bukan lompatan status.

### 8.2 Bahan (reservasi / issue / return / scrap)
- **Satu jalur**: permintaan bahan Produksi selalu `MaterialIssue` (`sourceType=PRODUCTION_WORK_ORDER`, `unitId`, `sourceReference=runId`).
- Reservasi = status existing (tidak membuat tabel reservasi baru). Available = on-hand − reserved (`computeStockSnapshot`).
- Issue memposting HPP inline (existing `postMaterialIssueCost`). Return dari produksi = `ReturnRecord` `PRODUCTION_RETURN` → movement RETURN.
- Scrap = `DamagedStockRecord` `PRODUCTION_DEFECT` → movement WASTE (beban susut), dengan `unitId`.
- `POST /api/units/:id/materials` (K4) diubah menjadi **pembuat Material Issue** (koreksi pemakaian) saat flag Gudang V2 ON; jalur langsung di-fence.
- Kekurangan stok: run → `BLOCKED` (`BlockReason` bahan), tidak boleh stok negatif (kebijakan Finance: saldo riil boleh negatif untuk kas, **bukan** untuk stok fisik — perlu konfirmasi owner, lihat §12).

### 8.3 Payment hold
- Hold adalah keputusan Finance eksplisit (bukan otomatis dari `paymentStatus`), tercatat dengan alasan, aktor, dan waktu.
- Hold **tidak** memblok produksi; hanya memblok H6 (siap kirim/start delivery).
- Aturan default yang diusulkan: order `BELUM_BAYAR` tanpa DP → otomatis diusulkan hold, dikonfirmasi Finance (keputusan owner §12).
- Release hold = command Finance; COD (bayar saat antar) dikecualikan bila metode order COD.

---

## 9. API / event contract (pola existing, tanpa domain duplikat)

Semua command: `POST`, header `Idempotency-Key` wajib, body boleh berisi `expectedRevision`; respons `{ revision, replayed }`.
Error: 409 konflik revisi/transisi, 503 bila fence aktif dan flag OFF. Pesan error dan label UI dalam Bahasa Indonesia.

| Endpoint (baru, di router existing) | Owner | Command | Keterangan |
|---|---|---|---|
| `POST /api/inventory/unit-custody/:unitId/accept` | Gudang | `ACCEPT_INBOUND_CUSTODY` | lokasi `StorageLocation` wajib |
| `POST /api/inventory/unit-custody/:unitId/reject` | Gudang | `REJECT_INBOUND_CUSTODY` | ke karantina |
| `POST /api/inventory/unit-custody/:unitId/release` | Gudang | `RELEASE_TO_PRODUCTION` / `READY_FOR_DISPATCH` | dispatch cek hold |
| `POST /api/production/runs/:unitId/intake` | Produksi | `ACCEPT_INTAKE` | membuka run |
| `POST /api/production/runs/:runId/phases/:phase/(start|complete)` | Produksi | `PHASE_*` | memakai stage engine sebagai projector V1 |
| `POST /api/production/runs/:runId/diagnosis` | Produksi | `RECORD_DIAGNOSIS` | |
| `POST /api/production/runs/:runId/inspections` | QC | `RECORD_INSPECTION` | items + foto |
| `POST /api/production/runs/:runId/handoff` | Produksi | `OFFER_FINISHED_GOODS` | |
| `POST /api/finance/payment-holds` / `:id/release` | Finance | `PLACE/RELEASE_PAYMENT_HOLD` | |

Event (`domain_outbox.eventType`, penamaan `domain.aggregate.fakta`): `warehouse.custody.{offered,accepted,rejected,released,returned}`,
`production.run.{opened,blocked,unblocked,completed,cancelled}`, `production.phase.{started,completed}`,
`production.qc.{passed,failed,overridden}`, `production.handoff.{offered,accepted,rejected}`,
`warehouse.material.{reserved,issued,returned,scrapped}`, `finance.payment.hold.{placed,released}`, `delivery.dispatch.{ready,blocked}`.
Payload minimal: `{ unitId, orderId, runId?, custodyId?, revision, occurredAt, actorId }` — tanpa data pribadi pelanggan.

---

## 10. Migration & rollout (additive, flag default OFF)

Migration (satu per fase, hanya `CREATE TABLE/INDEX` dan kolom nullable; tanpa DROP/rename/UPDATE data):
1. `unit_custody_v2` (id, unitId, status, locationId FK `StorageLocation`, offeredByJobId, acceptedById, revision, timestamps).
   Partial unique: satu custody non-terminal per unit.
2. Partial unique `production_runs_v2 (unit_id) WHERE status NOT IN ('COMPLETED','CANCELLED')`; unique `production_handoffs_v2(delivery_job_id)` bila not null.
3. `payment_holds_v2` (id, orderId, status, reason, placedById, releasedById, timestamps); partial unique hold aktif per order.
4. Kolom nullable `material_issues.production_run_id` (FK) — `sourceReference` tetap untuk kompatibilitas.

Flag baru (seed OFF, pola `ensureV2Flags`): `warehouse_v2_custody_writer`, `production_v2_writer` (existing),
`production_v2_qc_writer`, `finance_payment_hold_v2`, `production_v1_writer_fence` (existing), `warehouse_v1_material_fence`.
Cohort mengikuti pola writer Delivery: **berbasis unitId/runId** (`config.unitIds`), pasangan flag yang harus ON bersama divalidasi satu helper.

Urutan rollout: shadow (writer OFF, backfill + parity) → writer cohort 1 unit → cohort kecil → fence V1 → reader.
Rollback = matikan flag writer dalam satu transaksi; data V2 tidak dihapus; V1 tetap berjalan.

---

## 11. Breakdown implementasi P1–P7

| Fase | Isi | Targeted test |
|---|---|---|
| **P1 — Fondasi ownership & guard** | Helper keputusan writer Produksi/Gudang (pola `deliveryWriterDecision`, cohort unit); flag seed OFF; audit writer Produksi+Gudang (pola `audit-delivery-writers`) mencakup unitStageEngine, orders.js kaskade, units.js materials; guard Sales: kaskade status Order ke Unit/Job dimatikan **hanya** saat fence Produksi ON. | unit: matriks flag/cohort; audit: seluruh writer Unit.status & StockMovement terdaftar/terjaga; integrasi: flag OFF = perilaku identik |
| **P2 — Custody Gudang (inbound + retur gagal kirim)** | Migration 1; command H1/H7; pickup selesai → custody DITAWARKAN (proyeksi `IN_TRANSIT_IN`), terima → `RECEIVED`; UI Gudang "Penerimaan Unit dari Pickup" | integrasi: pickup complete → offered; accept/reject; replay idempoten; unit non-cohort tetap V1 (`RECEIVED` langsung) |
| **P3 — Production run writer** | Migration 2; command intake/phase/diagnosis; stage engine sebagai projector V1 dalam transaksi yang sama; backfill catch-up run | integrasi: satu run aktif per unit; phase monoton; parity run vs stage log; rework run anak |
| **P4 — QC V2** | inspeksi checklist + fit test sebagai item; override berwenang; bypass → OVERRIDDEN | integrasi: PASS/FAIL_REWORK/OVERRIDDEN; bypass tercatat; tanpa inspeksi PASS tidak bisa handoff |
| **P5 — Bahan per run** | Migration 4; request bahan dari run; units.js/materials → Material Issue (koreksi); scrap/return dari run; fence jalur langsung | integrasi: reserved/available benar; HPP terposting; jalur langsung 409/503 saat fence; stok tidak negatif |
| **P6 — Handoff outbound + payment hold** | Migration 3; H5/H6/H8; `suggestDeliveryJob` dipicu event `delivery.dispatch.ready`; hold memblok start delivery | integrasi: QC PASS → FG → siap kirim; hold memblok; release membuka; COD dikecualikan; tepat satu job delivery per handoff |
| **P7 — Fence V1 + reader** | Fence kaskade Sales & units.js; reader web Produksi/Gudang V2; runbook canary per unit | integrasi: fence aktif menolak writer V1 dengan pesan Indonesia; shadow parity 0; rollback flag |

Setiap fase: targeted unit/integration + writer audit + migration verifier + `git diff --check`. Tanpa full suite kecuali shared core berubah.

---

## 12. Keputusan owner yang benar-benar diperlukan

1. **Kaskade status Order dari Sales (K2)**: setelah fence Produksi ON, dropdown Sales tidak boleh lagi memindahkan unit ke READY/DELIVERED.
   Opsi: (a) Sales hanya bisa **meminta** (membuat tiket ke Produksi/Delivery), (b) tetap boleh untuk order LAYANAN tanpa unit fisik saja.
2. **Payment hold default (K6)**: apakah order BELUM_BAYAR otomatis diusulkan hold sebelum kirim, dan metode mana yang dikecualikan (COD?).
3. **Stok bahan negatif**: tolak issue saat available < qty, atau izinkan dengan persetujuan (dan siapa yang menyetujui).
4. **Order BARU/SEWA (K7)**: unit baru lahir di workshop — apakah tetap melalui check-in Gudang (disarankan: custody langsung DITERIMA oleh Gudang saat produksi selesai, tanpa pickup).
5. **Override QC**: siapa yang berwenang (`QC_LEAD` saja, atau juga `OWNER`/`PRODUCTION_LEAD`).

Keputusan lain (penamaan, bentuk UI, urutan fase) bisa diambil tim tanpa owner.

---

## 13. Rekomendasi slice pertama

**P1 + P2 inbound saja, cohort per unit, flag OFF saat rilis.** Alasan:
- Menutup gap fisik paling nyata (K1): unit dianggap "di bengkel" padahal belum diterima Gudang.
- Tidak menyentuh Produksi, QC, Sales, atau Finance; tidak butuh keputusan owner (K2/K6 baru relevan di P6/P7).
- Migration kecil (1 tabel + partial unique), pola command/outbox/cohort sudah terbukti di Delivery.
- Proyeksi V1 tetap menghasilkan `RECEIVED` setelah diterima, jadi layar Produksi existing tidak berubah.
- Driver Mobile tidak berubah: penawaran custody dibuat server-side saat POD pickup yang sudah ada.

Targeted test slice pertama: flag OFF identik V1; cohort unit → offered/accept/reject; replay idempoten; non-cohort V1-only;
writer audit memasukkan writer custody; tidak ada perubahan Unit.status di luar command owner.
