# Production + Delivery V2 — Chunk 1 cross-boundary adapter report

Tanggal: 24 September 2026

Branch: `feat/production-delivery-v2`

Scope: penutupan bypass writer Delivery V2 yang disetujui

Status: **IMPLEMENTED AND VALIDATED LOCALLY; FLAGS OFF; NO CUTOVER**

## Outcome

Writer order aktif, complaint, Production handoff, auto-job, completion/reopen, dan repair tooling kini memiliki ownership eksplisit. Setiap mutation runtime memakai transaction client milik caller: projection V1, state V2, route publication/feed, command record, dan outbox commit atau rollback bersama. Tidak ada endpoint, payload, enum, maupun kontrak Sales CRM, Production, Finance, atau Warehouse yang berubah.

Driver App masih membaca V1. Semua delapan feature flag V2 terverifikasi OFF pada restore lokal, termasuk kedua writer Delivery dan reader snapshot Driver. Tidak ada deploy, cutover, atau mutation database production.

## Jalur yang ditutup

- `armadaAutoJob.js`: pickup/auto-job baru dan update existing job.
- `deliveryHandoff.js`: handoff Production ke Delivery.
- `complaintCase.js`: complaint delivery task dan activity terkait.
- `orderStatusSync.js`: completion, stale pickup completion, dan reopen cascade.
- `routes/orders.js`: location correction, cancel completion, stale pickup correction, serta guard hard delete.
- Sebelas repair/backfill scripts: dry-run tetap tersedia; apply dipagari saat Delivery V2 aktif.

`deliveryCrossBoundaryCommandService.js` menjadi satu command owner bagi mutation lintas-boundary. Ia tidak membuka nested transaction. Setelah callback V1 selesai, service menyinkronkan job state dan membangun publication route immutable sebelum transaction dapat commit.

## Validation evidence

| Check | Hasil |
|---|---:|
| Unit tests | 611 passed, 0 failed |
| Targeted integration serial | 40 passed, 0 failed |
| Integration khusus cross-boundary | 5 passed, 0 failed |
| Writer ownership audit | 89/89 owned atau guarded; 0 unowned |
| Shadow comparison setelah adapter | 1.410/1.410 match; 0 mismatch |
| Feature flags pada restore lokal | 8 OFF; 0 enabled |
| Syntax check dan `git diff --check` | pass |

Integration khusus membuktikan auto-job pickup, Production handoff, complaint task, publication route pada completion order aktif, rollback atomik setelah fault injection, serta penolakan repair apply/hard delete ketika writer V2 aktif. Targeted suite tambahan mencakup execution/POD, route-centric driver jobs, unit revision link, dan complaint end-to-end.

Evidence machine-readable:

- `docs/evidence/chunk1-cross-boundary-writer-audit.json`
- `docs/evidence/chunk1-shadow-after-cross-boundary-adapters.json`
- `docs/evidence/chunk1-cross-boundary-writer-audit.md`

## Risiko yang sengaja tidak ditebak

Order cancellation V1 saat ini menghapus Job yang belum berjalan. Itu bertentangan dengan invariant mempertahankan seluruh data historis setelah writer V2 aktif. Implementasi mempertahankan perilaku legacy ketika flags OFF, tetapi fail-closed dengan `409 HISTORICAL_DATA_PROTECTED` ketika writer V2 ON.

Sebelum aktivasi writer/cutover, owner harus memilih salah satu kebijakan:

1. representasi cancellation/tombstone immutable untuk Job; atau
2. kebijakan discard destruktif yang sangat terbatas hanya untuk draft V2-native yang belum pernah dipublish, dengan migrated/historical Job tetap dilindungi.

Tidak ada risiko ke order aktif saat ini karena flags tetap OFF. Gate reader Driver V2 tetap tertutup sampai keputusan ini dibuat, seluruh writer diaktifkan, dan parity/gate dijalankan ulang.

## File yang berpotensi bentrok dengan pekerjaan Claude

File shared/high-conflict pada perubahan ini:

- `backend/src/routes/orders.js`
- `backend/src/services/deliveryRouteCommandService.js`
- `backend/tests/integration/setup/testDb.js`

Merge harus dilakukan per hunk setelah membandingkan baseline Claude. Tidak ada file Finance atau Warehouse yang diubah.

Refresh sebelum commit melihat checkout utama pada `aadcc20c` dengan perubahan kerja Claude di file Finance dan generated frontend assets. Diff tracked sejak merge-base tidak menunjukkan perubahan pada file shared di atas. Semua pekerjaan adapter tetap berada di worktree/branch terisolasi dan tidak mengambil atau menimpa perubahan tersebut.

## Gate berikutnya

Tidak ada bypass writer yang tersisa menurut audit saat ini. Namun aktivasi flag dan cutover belum diizinkan. Gate berikutnya mensyaratkan keputusan semantik cancellation di atas, refresh baseline/concurrent diff, rerun parity, dan verifikasi bahwa writer route + execution aktif sebelum reader Driver V2 dapat dinyalakan.
