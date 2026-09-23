# Production + Delivery V2 — Chunk 1 report

Tanggal: 23 September 2026  
Branch: `feat/production-delivery-v2`  
Scope: Delivery V2 writers, compatibility projection, dan sync foundation  
Status: **IMPLEMENTED INTERNALLY; G2-D BLOCKED; NO CUTOVER**

## Outcome

Chunk 1 membangun command path V2 untuk mutation inti Armada, immutable route publication, revisioned driver feed, snapshot/full-refresh API, idempotent execution command, dan compatibility projection ke tabel V1 dalam transaksi yang sama. Seluruh feature flag reader/writer tetap OFF. Tidak ada migration yang dijalankan pada database production dan tidak ada order/delivery aktif yang dialihkan.

Writer rehearsal pada database restore/test membuktikan 10 skenario utama lulus. Shadow comparison setelah rehearsal tetap 1.410/1.410 match. Namun audit global menemukan writer lintas-boundary di luar router Armada; karena itu acceptance `G2-D` belum lulus dan Driver App V2 reader tidak boleh diaktifkan.

## Perubahan data model additive

- `DeliveryRouteState.lifecycleStatus` menyimpan lifecycle Route yang terakhir diproyeksikan.
- `DeliveryRouteState.draftSnapshot` dan `draftChecksum` menyimpan projection terbaru sebelum/di antara publication.
- `DeliveryJobState.migrationSource` membedakan state hasil migrasi dari mutation native V2.
- Migration hanya additive; tidak ada drop, rename, hard delete, atau perubahan data historis.

## Command dan read path

- `deliveryRouteCommandService.js`: revision check, idempotency, route lock, draft/publication, recipient revocation, feed change, outbox, dan V1 projection atomik.
- `deliveryExecutionCommandService.js`: status transition/idempotency, Job revision, execution event, feed, lifecycle route sync, dan V1 projection atomik.
- `deliveryJobCommandService.js` dan `deliveryJobBatchCommandService.js`: mutation Job tanpa kehilangan shadow state.
- `deliveryV2Snapshot.js`: canonical snapshot dan checksum deterministik.
- `driverFeedV2.js`: opaque principal-bound cursor, ordered delta, pagination, retention-gap detection, dan `FULL_REFRESH_REQUIRED`.
- `driverSnapshotV2.js`: principal eligibility fail-closed, complete snapshot pagination, dan akses helper/driver berbasis publication aktif.
- `routes/deliveryV2.js`: endpoint snapshot/delta V2 yang server-side bergantung pada kedua writer flag.
- `routes/armada.js`: adapter V2-first untuk mutation utama; saat flag OFF, perilaku V1 tetap dipertahankan.

Published edit/cancel/reassignment selalu membuat publication version baru sebelum feed event tersedia. Reassignment mencabut assignment publication lama sehingga principal lama kehilangan akses pada refresh berikutnya. Direct cross-route move ditolak pada mode V2 bila source revision tidak dibawa, untuk mencegah ghost route.

## Backfill dan parity

- Backfill dry-run dan apply menghasilkan plan checksum yang sama.
- Catch-up tidak menimpa revision/history yang sudah menjadi native V2.
- Production tetap memiliki 5 exception `CURRENT_STAGE_WITHOUT_SERVICE` berdisposition `KEEP_V1`; tidak ditebak dan tidak masuk cohort cutover.
- Shadow setelah catch-up: 1.400/1.400 match.
- Shadow setelah writer rehearsal: 1.410/1.410 match; mismatch 0.
- Seluruh fixture rehearsal sintetis dipertahankan pada database test untuk audit; data historis source tidak dihapus.

## Validation evidence

| Check | Hasil |
|---|---:|
| Prisma migration deploy pada DB integration terisolasi | 176/176 migration berhasil |
| Unit tests | 611 passed, 0 failed |
| Targeted integration tests serial | 35 passed, 0 failed |
| Writer rehearsal | 10 passed, 0 failed |
| Shadow parity setelah rehearsal | 1.410/1.410 match |
| `git diff --check` | pass |

Targeted integration suite dijalankan pada database baru `klinik_matras_v2_chunk1_integration_test`, bukan shared `klinik_matras_test`. Ini menghilangkan kontaminasi worker lama yang sebelumnya melakukan truncate secara paralel. Suite mencakup driver execution/POD, route-centric my-jobs, unit revision job link, dan complaint end-to-end.

Writer rehearsal memvalidasi:

1. additive writer projection;
2. tidak ada stop hilang;
3. reassignment mencabut akses principal lama;
4. retry idempotent;
5. stale route revision ditolak;
6. offline delta replay deterministik;
7. cancel tidak meninggalkan ghost route;
8. app full refresh berhasil setelah cancel;
9. execution completion menaikkan route publication;
10. fault injection me-rollback mutation V1 dan V2 bersama.

Bug app-load konkret yang ditemukan selama rehearsal—snapshot memilih kolom `Job.startedAt` yang tidak ada—sudah diperbaiki dengan membatasi select pada field schema yang valid.

## File berubah

### Schema dan migration

- `backend/prisma/schema.prisma`
- `backend/prisma/migrations/20260925010000_delivery_v2_sync_foundation/migration.sql`

### Runtime backend

- `backend/src/index.js`
- `backend/src/routes/armada.js`
- `backend/src/routes/deliveryV2.js`
- `backend/src/services/deliveryV2Snapshot.js`
- `backend/src/services/driverFeedV2.js`
- `backend/src/services/driverSnapshotV2.js`
- `backend/src/services/deliveryRouteCommandService.js`
- `backend/src/services/deliveryExecutionCommandService.js`
- `backend/src/services/deliveryJobCommandService.js`
- `backend/src/services/deliveryJobBatchCommandService.js`

### Migration safety, tests, dan docs

- `backend/scripts/production-delivery-v2/backfill.js`
- `backend/scripts/production-delivery-v2/shadow-compare.js`
- `backend/scripts/production-delivery-v2/delivery-writer-rehearsal.js`
- `backend/src/services/productionV2BackfillMapping.js`
- `backend/tests/driverFeedV2.test.js`
- `backend/tests/driverSnapshotV2.test.js`
- `backend/tests/productionV2BackfillMapping.test.js`
- `docs/PRODUCTION-DELIVERY-V2-CHUNK0-REPORT.md`
- `docs/PRODUCTION-DELIVERY-V2-CHUNK1-REPORT.md`
- `docs/evidence/chunk1-*`

## Risiko dan blocker gate

Audit writer lengkap menemukan mutation `Route`/`Job` di `armadaAutoJob.js`, `deliveryHandoff.js`, `complaintCase.js`, `orderStatusSync.js`, `routes/orders.js`, dan sejumlah repair scripts. Jalur tersebut dapat membuat stop hilang, ghost route, atau snapshot stale bila Driver reader V2 diaktifkan sekarang. Detail dan disposition ada di `docs/evidence/chunk1-cross-boundary-writer-audit.md`.

Karena beberapa writer dipanggil dari transaksi Sales CRM/Production dan `routes/orders.js` adalah internal Sales CRM, menutupnya memerlukan approval scope terpisah. Sampai itu diputuskan:

- `delivery_v2_writer_route=OFF`;
- `delivery_v2_writer_execution=OFF`;
- `delivery_v2_reader_driver=OFF`;
- tidak ada cohort cutover;
- Chunk 2 tidak dimulai.

## Potensi konflik dengan pekerjaan Claude

Shared files yang berubah pada Chunk 1:

- `backend/prisma/schema.prisma`
- `backend/src/index.js`
- `backend/src/routes/armada.js`

`armada.js` juga memuat surface insentif/expense yang Finance-adjacent, tetapi perubahan Chunk 1 dibatasi ke route/job/driver execution adapter. Tidak ada file di `backend/src/routes/finance*`, `backend/src/services/finance/`, router incentive, frontend Finance, atau kontrak Finance yang diubah. Sebelum merge/rebase, ketiga shared files wajib dibandingkan lagi dengan baseline Claude dan conflict diselesaikan per hunk, bukan ditimpa.

## Gate berikutnya

Chunk 1 internal acceptance lulus, tetapi gate untuk Chunk 2 **belum lulus**. Diperlukan approval khusus untuk salah satu keputusan berikut:

1. mengizinkan adapter Delivery V2 atomik pada service yang dipanggil transaksi Sales/Production/complaint, termasuk perubahan minimal pada `routes/orders.js` bila tidak dapat dihindari, tanpa mengubah endpoint/payload/enum/ownership kontrak lintas divisi; serta memagari repair scripts; atau
2. tidak memberi approval tersebut, sehingga semua reader/cutover Delivery V2 tetap diblokir dan implementasi berhenti sebelum Chunk 2.

Approval Chunk 1/Phase 2 tidak dianggap sebagai izin untuk opsi pertama.
