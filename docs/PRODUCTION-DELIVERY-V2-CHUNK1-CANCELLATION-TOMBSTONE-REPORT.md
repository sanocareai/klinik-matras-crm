# Production + Delivery V2 — Chunk 1 cancellation tombstone report

Tanggal: 24 September 2026

Branch: `feat/production-delivery-v2`

Scope: immutable Job cancellation saat Sales membatalkan order

Status: **IMPLEMENTED AND VALIDATED LOCALLY; FLAGS OFF; NO DEPLOY/CUTOVER**

## Outcome

Kedua jalur Sales yang sudah ada—`PATCH /api/orders/:id` dengan status `CANCELLED` dan `POST /api/orders/:id/cancel`—tetap memakai endpoint, request, response, enum, serta business blocker lama. Perubahan internal mengganti hard-delete Job aktif/draft dengan satu command owner atomik.

Setiap Job yang dibatalkan:

- tetap berada di tabel `jobs`, sehingga bukti, unit, route, complaint/revision, position, payment, dan execution reference tidak hilang;
- diproyeksikan ke status V1 `FAILED` dengan alasan pembatalan, tanpa menambah enum atau mengubah payload endpoint;
- mempunyai satu `DeliveryJobCancellation` immutable yang menyimpan reason, actor, waktu, status serta assignment sebelumnya;
- mempunyai `DeliveryJobState.currentStatus=CANCELLED`;
- dihapus dari publication aktif berikutnya, sementara publication/assignment historis tetap tersimpan dan assignment aktif lama menjadi `REVOKED`;
- menghasilkan outbox `delivery.job.cancelled` serta feed `REMOVE_JOB`; route tanpa stop tersisa juga menghasilkan `REMOVE_ROUTE`.

Tombstone dilindungi oleh unique `job_id`, FK `ON DELETE RESTRICT`, dan trigger database yang menolak UPDATE/DELETE. Retry endpoint setelah order sudah `CANCELLED` mengembalikan respons order lama tanpa membuat tombstone/event/publication kedua.

## Kondisi aman dan konflik

Job `UNSCHEDULED`, `SCHEDULED`, `ASSIGNED`, `EN_ROUTE`, dan `ARRIVED` dapat ditombstone. Job `COMPLETED` tidak diubah. Bukti dan reference pada route berjalan tetap dipertahankan.

State berikut fail-closed dengan konflik spesifik dan rollback penuh:

- Job aktif berada pada Route `COMPLETED`: `ORDER_CANCEL_ACTIVE_JOB_ON_COMPLETED_ROUTE`;
- Job aktif sudah mempunyai POD `VERIFIED`: `ORDER_CANCEL_ACTIVE_JOB_WITH_VERIFIED_POD`;
- tombstone sudah ada tetapi projection V1 kembali aktif: `JOB_CANCELLATION_STATE_CONFLICT`.

Blocker lama—unit sedang dikerjakan, pembayaran, dan scope revision—tetap berlaku tanpa perubahan kontrak.

## Validation evidence

| Check | Hasil |
|---|---:|
| Unit tests | 611 passed, 0 failed |
| Targeted integration serial | 47 passed, 0 failed |
| Cancellation scenarios | 7 passed, 0 failed |
| Writer ownership audit | 88/88 owned atau guarded; 0 unowned |
| Additive migration pada integration DB | 177/177 applied |
| Additive migration pada restore lokal | 177/177 applied |
| Shadow parity setelah migration | 1.410/1.410 match; 0 mismatch |
| Prisma schema, syntax, dan diff check | pass |
| Feature flags pada restore lokal | 8 OFF; 0 enabled |

Skenario cancellation mencakup sebelum publish, PATCH dan POST Sales, sesudah publish, route berjalan, Job selesai, offline delta replay, immutable trigger, retry idempotent, state tidak aman, dan rollback caller setelah seluruh projection dibuat.

Evidence machine-readable:

- `docs/evidence/chunk1-cancellation-writer-audit.json`
- `docs/evidence/chunk1-shadow-after-cancellation-tombstone.json`

## File berubah

Schema dan migration:

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260925020000_delivery_job_cancellation_tombstone/migration.sql`

Command/projection/read path:

- `backend/src/services/deliveryJobCancellationService.js`
- `backend/src/services/deliveryCrossBoundaryCommandService.js`
- `backend/src/services/deliveryRouteCommandService.js`
- `backend/src/services/deliveryV2Snapshot.js`
- `backend/src/routes/orders.js`
- `backend/src/routes/armada.js`

Migration tooling dan tests:

- `backend/scripts/production-delivery-v2/backfill.js`
- `backend/scripts/production-delivery-v2/shadow-compare.js`
- `backend/scripts/production-delivery-v2/audit-delivery-writers.js`
- `backend/tests/integration/deliveryJobCancellationV2.integration.test.js`
- `backend/tests/integration/setup/testDb.js`
- `backend/tests/integration/setup/testApp.js`

## Concurrent-work boundary

Tidak ada source Finance atau Warehouse yang diubah. File shared yang berpotensi konflik dengan pekerjaan Claude adalah `backend/prisma/schema.prisma`, `backend/src/routes/orders.js`, `backend/src/routes/armada.js`, `backend/tests/integration/setup/testDb.js`, dan `backend/tests/integration/setup/testApp.js`. Merge wajib dilakukan per hunk setelah refresh baseline; tidak boleh menimpa worktree Claude.

Refresh sebelum commit melihat checkout utama pada `4cb66fa7`. Tracked divergence hanya ditemukan pada `backend/prisma/schema.prisma`, berupa penambahan Finance di bagian yang berbeda dari model tombstone Delivery. Tidak ada tracked divergence pada empat file shared lainnya. Schema tetap harus digabung per hunk agar penambahan Finance Claude dan tombstone Delivery sama-sama dipertahankan.

## Gate

Keputusan tombstone telah menutup blocker cancellation. Semua feature flag tetap OFF dan Driver V2 reader belum diaktifkan. Tidak ada deployment atau cutover pada chunk ini. Aktivasi berikutnya tetap mensyaratkan refresh baseline, parity ulang, dan kedua writer Delivery aktif sebelum reader Driver V2.
