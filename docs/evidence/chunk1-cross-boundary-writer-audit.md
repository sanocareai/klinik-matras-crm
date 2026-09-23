# Chunk 1 cross-boundary writer audit

Tanggal audit: 23 September 2026  
Baseline branch: `feat/production-delivery-v2`  
Disposition gate: **ADAPTERS_COMPLETE; CONDITIONAL_G2_D**

## Kesimpulan

Seluruh mutation utama di router Armada dan writer lintas-boundary yang ditemukan sudah memiliki satu command owner. Adapter menerima transaction client milik caller agar mutation V1, state V2, publication, feed, dan outbox commit atau rollback bersama. Endpoint, payload, enum, dan kontrak lintas divisi tidak diubah.

Audit statis setelah adapter mencatat **89/89 mutation sites owned atau guarded, 0 unowned**. Repair scripts tetap dapat dry-run, tetapi mode apply ditolak apabila writer/reader/fence Delivery V2 aktif. Driver App V2 reader tetap OFF pada langkah ini.

Driver App V2 reader tetap OFF sampai semua writer aktif yang dapat mengubah visibility, membership, assignment, atau status stop telah:

1. dipindahkan ke command service V2 dalam transaksi yang sama;
2. secara eksplisit ditetapkan sebagai boundary owner dan memasok adapter yang gap-free; atau
3. dipagari agar tidak dapat berjalan selama cohort V2 aktif.

## Disposition writer aplikasi

| File | Mutation yang ditemukan | Pemanggil/boundary | Risiko bila reader V2 aktif | Disposition |
|---|---|---|---|---|
| `backend/src/services/armadaAutoJob.js` | create/update Job pickup/delivery skeleton | order creation dan unit provisioning | stop sah dapat tidak masuk snapshot/feed | Adapter lintas-boundary atomik |
| `backend/src/services/deliveryHandoff.js` | create/update Job delivery | Production stage completion dan Sales order flow | handoff baru dapat tertinggal dari shadow model | Adapter lintas-boundary atomik |
| `backend/src/services/complaintCase.js` | create Job pickup/delivery complaint | complaint flow lintas Sales/Delivery/Production | complaint stop dapat hilang dari reader V2 | Adapter lintas-boundary atomik |
| `backend/src/services/orderStatusSync.js` | update Route completion; batch update/reopen Job | dipanggil Armada, Sales, Production | publication dapat tidak mencerminkan completion/reopen | Adapter lintas-boundary atomik |
| `backend/src/routes/orders.js` | batch update/delete Job dan memanggil auto-job/handoff | Sales CRM internal | direct correction/cancel dapat bypass publication | Adapter minimal; hard delete dipagari saat writer V2 ON |
| `backend/src/services/rescheduleCase.js` | menautkan `rescheduleCaseId` ke Job | Armada reschedule flow | perubahan checksum Job harus ikut diproyeksikan | Tetap di dalam command callback Armada |

`unitProvisioning.js` dan `unitStageEngine.js` tidak menulis Job secara langsung pada temuan ini, tetapi memanggil `armadaAutoJob.js`/`deliveryHandoff.js` dari transaksi Production/Sales. Karena itu adapter harus menerima transaction client yang sama; asynchronous dual-write setelah commit tidak memenuhi invariant.

## Repair dan backfill writer yang harus dipagari

Writer berikut bersifat operasional/manual dan dapat mengubah data Delivery tanpa publication V2:

- `backend/scripts/backfill-job-geocode-from-order-link.js`
- `backend/scripts/backfill-complete-stale-pickups.js`
- `backend/scripts/backfill-aida-complaint-176.js`
- `backend/scripts/backfill-reschedule-cases.js`
- `backend/scripts/backfill-richard-revision-201.js`
- `backend/scripts/clear-non-link-job-geocode.js`
- `backend/scripts/correct-orphan-job-arman-16sep.js`
- `backend/scripts/fix-baru-order-units.js`
- `backend/scripts/fix-stale-jobs-order-closed.js`
- `backend/scripts/fix-stuck-en-route-jobs.js`

Semua script di atas, ditambah `backend/scripts/backfill-route-completion.js`, kini memanggil guard sebelum mode apply. Daftar ini tidak memberi izin menjalankan script. Dry-run tetap tersedia dan read-only.

## Writer yang sudah tertutup pada Chunk 1

Router `backend/src/routes/armada.js` sudah mengarahkan jalur berikut ke command service ketika flag writer aktif:

- route create/edit/membership/reorder/publish/cancel/start/delete;
- job create/edit/reassign/external-courier/return-to-depot/delete/void-backfill;
- POD verify/reject/edit;
- issue reschedule dan note;
- execution start/arrive/complete/fail/proof;
- revision pickup/delivery job creation.

Direct move antar-route ditolak dengan `409` pada mode V2 sampai source-route revision disertakan. Persistence geocode tersembunyi pada GET juga dimatikan pada mode V2 agar reader tidak menjadi writer.

## Gate berikutnya

Ownership/bypass portion dari `G2-D` lulus: audit statis 89/89 owned atau guarded, integration lintas-boundary 5/5, dan shadow parity 1.410/1.410. Gate cutover tetap tertutup karena seluruh flag OFF dan semantik pengganti hard delete Job pada pembatalan order belum diputuskan. Selama flag OFF, perilaku legacy tidak berubah; saat writer V2 ON, jalur tersebut fail-closed dengan `409 HISTORICAL_DATA_PROTECTED` agar data historis tidak terhapus. Aktivasi writer/reader memerlukan keputusan terpisah dan rerun gate.
