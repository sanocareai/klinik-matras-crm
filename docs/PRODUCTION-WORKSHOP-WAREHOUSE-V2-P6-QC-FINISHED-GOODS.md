# Production Workshop + Warehouse V2 — P6 QC V2, Rework, Barang Jadi, Rekonsiliasi Override V1

Slice keenam, di atas P5 (`...-P5-WORKSHOP-EXECUTION.md`, commit `234234b1`). Additive; flag SAMA dengan P1–P5 (`production_v2_writer`/
`production_v2_reader`, cohort `unitIds`, fail-closed); jalur V1 untuk writer OFF / non-cohort **tidak berubah dan tanpa jejak V2**.
Menutup lifecycle produksi dari `AWAITING_QC` sampai barang jadi diterima Gudang (run `COMPLETED`, unit `READY_FOR_DELIVERY`).

## Keputusan Owner (diterapkan)
1. Tahap SETELAH gerbang QC (`corner_sewing`, `finished`) **tidak dilewati**: QC PASS mengembalikan run ke `PROCESS` (IN_PROGRESS); handoff barang jadi baru
   dibuat SETELAH tahap terakhir (`finished`) selesai. QC PASS tidak pernah langsung membuat handoff.
2. QC FAIL membuka rework terkontrol: tahap rework **ditentukan eksplisit** (wajib SEBELUM gerbang), unit wajib kembali ke QC (tidak bisa PASS/HANDOFF langsung).
3. `quality_inspections_v2` = sumber kebenaran; command QC menulis proyeksi `qc_fit_tests` V1 + ledger tahap V1 di transaksi yang SAMA lewat primitive `*InTx` engine.
4. Bahan tambahan rework: baris BOM + reservasi + Material Issue BARU terhubung ke inspeksi (jalur P3–P4); reservasi asli `CONSUMED` tidak disentuh.
5. Custody memakai `unit_custody_handoffs_v2` arah `FINISHED_GOODS` (tanpa Job); INBOUND/RETURN tetap wajib punya Job.
6. Exception override V1 + pagar Sales: satu exception OPEN per run, command P5/P6 fail-closed, resolusi idempoten (restore / cancel / accept override dengan `QC_WAIVE`).

## Reuse vs baru
| Reuse | Baru |
|---|---|
| `quality_inspections_v2` + items (result `PASS`/`FAIL_REWORK`/`OVERRIDDEN`) | Kolom `qc_fit_test_id`; trigger immutability (hanya INSERT); command owner `productionQcHandoffCommandService.js` |
| Stage engine V1 (`startStageInTx`, `recordQcFitTestInTx`, `completeStageInTx`) | `waiveQcGateInTx`, `markUnitReadyForDeliveryInTx`, `reopenStageBeforeQcInTx`, `restoreUnitStatusInTx`, `isUnitPathDoneInTx`; opsi `deferReady`, `reworkStageId`, `allowRerunOfLastStage` |
| `unit_custody_handoffs_v2` (lokasi wajib valid, tolak wajib alasan, riwayat kekal, proyeksi `units.storage_location`) | Arah `FINISHED_GOODS`, `delivery_job_id` NULLABLE + CHECK; `offerFinishedGoodsCustodyInTx`; keputusan Gudang mengubah run |
| P3 reservasi/availability, P4 Material Issue/pick/stock movement/HPP | `reserveSupplementalInTx`, `cancelSupplementalInTx` (P3); `createSupplementalIssueInTx` (P4); kolom `supplemental_inspection_id`, `rework_inspection_id` |
| `v2_commands`, `domain_outbox`, revisi Production Run, `lockRowForUpdate` | Tabel `production_run_exceptions_v2`; `productionRunGuards.js` |

## State machine final
Run (`production_runs_v2`), fase → status:
```
PROCESS (pra-gerbang) ──selesai──► AWAITING_QC   [PROCESS COMPLETED, currentPhase=QC]
AWAITING_QC ──QC PASS/WAIVED──► PROCESS (pasca-gerbang: corner_sewing, finished)   [QC COMPLETED]
PROCESS (pasca-gerbang) ──tahap terakhir selesai (P5)──► HANDOFF ACTIVE + penawaran FINISHED_GOODS (OFFERED)
AWAITING_QC ──QC FAIL (+tahap rework eksplisit, bahan tambahan opsional)──► PROCESS (rework) ──selesai──► AWAITING_QC   [wajib QC ulang]
HANDOFF ──Gudang ACCEPTED (lokasi aktif bertipe barang jadi/dispatch)──► run COMPLETED, HANDOFF COMPLETED, unit READY_FOR_DELIVERY
HANDOFF ──Gudang REJECTED (alasan wajib)──► HANDOFF BLOCKED (kasus kembali ke Production; run tetap ACTIVE, histori handoff kekal)
HANDOFF BLOCKED ──TAWARKAN ULANG──► HANDOFF ACTIVE + handoff baru | ──REWORK (tahap eksplisit)──► PROCESS, QC/HANDOFF NOT_STARTED (wajib QC ulang)
```
Custody `FINISHED_GOODS`: `OFFERED → ACCEPTED | REJECTED | CANCELLED | SUPERSEDED`. Unit **tidak pernah** `READY_FOR_DELIVERY` sebelum Gudang menerima
(`advanceUnitPastStage(..., { deferReady: true })` dipakai semua command V2; V1 tidak pernah mengirim opsi itu). Saat diterima: lokasi legacy+kanonis
diproyeksikan → fase HANDOFF selesai → run COMPLETED → baru unit READY_FOR_DELIVERY (+ sinkron status order + saran job pengiriman seperti V1).

## Aturan QC
- Inspeksi hanya untuk run `AWAITING_QC` (status ACTIVE, PROCESS selesai, QC NOT_STARTED, tanpa operasi aktif, unit di gerbang QC pada ledger).
- **PASS/FAIL:** foto bukti ≥ 1, berat acuan (kg, bilangan bulat), hasil uji berat badan; izin `QC_WRITE` (QC_LEAD). PASS hanya untuk `PAS` atau override preferensi customer
  dengan konfirmasi edukasi (D-009); FAIL wajib `TERLALU_KERAS`/`TERLALU_EMPUK`, catatan temuan, dan `reworkStageId`.
- **QC_WAIVED:** izin `QC_WAIVE` (hanya ADMIN/OWNER; ADMIN tetap tidak memegang `QC_WRITE`, Production Lead tidak bisa mem-waive), alasan ≥ 10 karakter, audit `PRODUCTION_QC_WAIVED`.
  Dicatat `OVERRIDDEN`/`QC_WAIVED` (BUKAN PASS), ledger V1 = satu baris `SKIP` dengan catatan eksplisit, **tanpa** `qc_fit_tests` (tidak ada berat acuan dikarang).
- Inspeksi immutable (trigger `quality_inspection_immutable`): tidak bisa UPDATE/DELETE, termasuk butir. Versi naik per run (`runId, version`).
- Proyeksi V1: `qc_fit_tests` (linked `qc_fit_test_id`), START gerbang + COMPLETE/FAIL di `unit_stage_logs`, `units.currentStageId`. Replay tidak menggandakan keduanya.
- Rework: FAIL menaruh `currentStageId` pada tahap rework yang dipilih (harus ada di jalur, BUKAN gerbang, SEBELUM gerbang); operasi P5 bertambah; revisi run bertambah.

## Bahan tambahan rework
Diajukan di dalam QC FAIL (`supplementalMaterials`) atau menyusul sebelum rework dimulai (`POST /qc/runs/:runId/rework-material`, sekali per inspeksi). Availability + kunci material
memakai jalur P3; dokumen Material Issue baru `READY_TO_PICK` memakai jalur P4 (serah bahan = `pickMaterialIssue`: stock movement + HPP). Selama baris BOM tambahan belum tercakup
reservasi `CONSUMED` yang dirujuk issue `ISSUED`, P5 menolak start (`WORKSHOP_MATERIAL_NOT_ISSUED`). Batal sebelum serah: reservasi tambahan dilepas, baris BOM tambahan dibatalkan, plan tetap
`MATERIAL_RESERVED`. Rework tanpa bahan tambahan: tidak ada dokumen kosong. Kekurangan stok me-rollback seluruh QC FAIL.

## Rekonsiliasi override V1
- **Pencegahan:** dropdown status order (`READY`/`DELIVERED`/`CANCELLED`), `POST /orders/:id/cancel`, `reopen-for-delivery`, `reopen-for-pickup` menolak 409 untuk unit cohort dengan run aktif
  (`assertOrderUnitsNotV2Owned`). Writer OFF / non-cohort / tanpa run: tidak ada efek.
- **Deteksi:** `detectRunInconsistency` (run ACTIVE/BLOCKED + unit CANCELLED / READY_* / IN_TRANSIT_OUT / DELIVERED). Command QC/handoff/Gudang menolak `409 PRODUCTION_RUN_INCONSISTENT`; antrean tab **Konflik** menampilkannya (read-only);
  `POST /exceptions/open` (server yang menurunkan jenis konflik) dan `POST /exceptions/sweep` mencatat `production_run_exceptions_v2` (satu OPEN per run, idempoten).
- **Fail-closed:** exception OPEN menolak SEMUA command P5 (start/jeda/lanjut/selesai) dan P6 untuk run itu (`PRODUCTION_RUN_EXCEPTION_OPEN`).
- **Resolusi (idempoten, expectedRevision, catatan wajib):** `RESTORE_UNIT_STATUS` (bukan untuk unit yang sudah keluar gudang), `CANCEL_RUN`, `ACCEPT_OVERRIDE` (izin `QC_WAIVE`; run ditutup tanpa bukti QC/custody
  yang dikarang, fase → NOT_APPLICABLE), `NO_LONGER_APPLICABLE`. Status unit tidak pernah ditimpa diam-diam. `POST /qc/runs/:runId/cancel` (Production Lead) = prasyarat pembatalan order unit cohort.

## Kepemilikan writer (audit `audit-qc-handoff-writers.js`, 0 pelanggaran)
| Objek | Penulis tunggal |
|---|---|
| `quality_inspections_v2` (create saja) / items | `productionQcHandoffCommandService.js` (nested create); update/delete = pelanggaran + trigger DB |
| `qc_fit_tests` | engine (`recordQcFitTestInTx`) |
| `production_run_exceptions_v2` | `productionQcHandoffCommandService.js` |
| `unit_custody_handoffs_v2` (termasuk FINISHED_GOODS) | `unitCustodyCommandService.js` |
| Penyelesaian run (`status COMPLETED`) | custody (Gudang menerima) dan P6 (`ACCEPT_OVERRIDE`) |
| `markUnitReadyForDeliveryInTx` | dipanggil HANYA custody |
| Fase/operasi run | custody, P5, P6 (audit P5 diperbarui) |
| `Unit.status` | engine + jalur V1 yang dikenal (orders/armada/orderStatusSync); jalur Order V1 dipagari; antrean QC V1 (`/production/qc-queue`) menyaring unit yang QC-nya dimiliki V2 |

## Urutan kunci (konsisten P1–P5)
custody accept/reject: handoff → unit → run · QC/handoff-resolve/P5: unit → run · QC dengan bahan tambahan & rework-material: **plan → unit → run** (sama dengan P3/P4: plan lebih dulu; tidak ada
siklus dengan P5 yang tidak mengunci plan) · cancel/resolve exception: handoff barang jadi (id ascending) → unit → run → exception. Semua dalam satu transaksi Prisma bersama command, outbox, dan audit.

## Migration `20261003080000_production_qc_finished_goods_v2`
Additive: `ALTER TYPE … ADD VALUE 'FINISHED_GOODS'`; `delivery_job_id` DROP NOT NULL + CHECK `(direction = FINISHED_GOODS) = (delivery_job_id IS NULL)`; kolom nullable `qc_fit_test_id`,
`supplemental_inspection_id`, `rework_inspection_id`; tabel `production_run_exceptions_v2`; trigger immutability; satu `DROP INDEX planned_bom_lines_v2_active_material_key` dibuat ulang (menampung baris BOM tambahan);
LF. Tanpa DROP TABLE/COLUMN/UPDATE/DELETE. Rehearsal: `scripts/production-delivery-v2/p6-upgrade-rehearsal.js` (13/13: sebelum→sesudah, baris lama utuh, kolom baru NULL, CHECK/trigger/index aktif, bentuk tulis
kode lama tetap valid = rollback aplikasi aman). Clean 0→latest terverifikasi tiap run integration terisolasi. Urutan rilis: setelah P4 (195) dan P5 (196) → P6.

## UI (Bahasa Indonesia)
`/bengkel/qc-v2` Antrean QC (Menunggu QC · Rework · Menunggu Gudang · Ditolak Gudang · Konflik): detail unit/run/tahap, riwayat inspeksi + foto, form Lulus/Gagal/Waive, bahan tambahan, tindak lanjut penolakan Gudang,
panel konflik. `/warehouse/finished-goods` Terima Barang Jadi (Terima/Tolak, lokasi wajib, status, histori). Antrean Kerja (P5) menampilkan gerbang QC, tahap pasca-QC, dan status Menunggu Gudang/Ditolak Gudang.
Loading, kosong, galat, replay, revisi basi (409), dan reader OFF (canary, bukan galat) ditangani.

## Risiko tersisa
1. Order yang dibatalkan/dipaksa READY dari jalur V1 lain di luar Order (mis. skrip/SQL langsung) tidak dicegah; terdeteksi + fail-closed lewat exception (bukan dicegah).
2. `ACCEPT_OVERRIDE` menutup run tanpa bukti QC — hanya `QC_WAIVE`, tercatat di audit.
3. Pembatalan run TIDAK melepas reservasi/issue bahan yang belum diserahkan; Gudang membatalkannya lewat P4 (issue `READY_TO_PICK`) atau P3 (release).
4. Restore/override bisa menyisakan job Delivery yang sempat dibuat `suggestDeliveryJob` oleh override V1 — ditangani dispatcher.
5. Layar QC V1 lama (Inspeksi QC) tidak lagi memuat unit yang QC-nya dimiliki V2; hasil `qc_fit_tests` V1 tetap terisi lewat proyeksi.
6. Penerimaan barang jadi memicu `suggestDeliveryJob` (perilaku V1 saat unit siap kirim) — membuat kerangka job Delivery UNSCHEDULED; tidak ada perubahan kode Delivery/Driver/Finance/Resi.
