# Chunk 1 cross-boundary writer audit

Tanggal audit: 23 September 2026  
Baseline branch: `feat/production-delivery-v2`  
Disposition gate: **BLOCKS_G2_D**

## Kesimpulan

Seluruh mutation utama di router Armada sudah memiliki jalur V2-first dengan compatibility projection atomik. Namun audit global terhadap mutation `Route` dan `Job` menemukan writer di luar router Armada. Writer tersebut belum boleh diubah diam-diam karena sebagian berjalan di dalam transaksi milik Sales CRM, Production, complaint flow, atau repair tooling.

Driver App V2 reader tetap OFF sampai semua writer aktif yang dapat mengubah visibility, membership, assignment, atau status stop telah:

1. dipindahkan ke command service V2 dalam transaksi yang sama;
2. secara eksplisit ditetapkan sebagai boundary owner dan memasok adapter yang gap-free; atau
3. dipagari agar tidak dapat berjalan selama cohort V2 aktif.

## Writer aplikasi yang belum tertutup

| File | Mutation yang ditemukan | Pemanggil/boundary | Risiko bila reader V2 aktif | Disposition |
|---|---|---|---|---|
| `backend/src/services/armadaAutoJob.js` | create/update Job pickup/delivery skeleton | order creation dan unit provisioning | stop sah dapat tidak masuk snapshot/feed | Perlu adapter V2 di fungsi Delivery-side, tanpa mengubah kontrak caller |
| `backend/src/services/deliveryHandoff.js` | create/update Job delivery | Production stage completion dan Sales order flow | handoff baru dapat tertinggal dari shadow model | Perlu adapter V2 atomik dalam transaksi caller |
| `backend/src/services/complaintCase.js` | create Job pickup/delivery complaint | complaint flow lintas Sales/Delivery/Production | complaint stop dapat hilang dari reader V2 | Perlu keputusan ownership dan adapter V2 |
| `backend/src/services/orderStatusSync.js` | update Route completion; batch update/reopen Job | dipanggil Armada, Sales, Production | publication dapat tidak mencerminkan completion/reopen | Perlu hook V2 atomik; kontrak Order tidak boleh berubah |
| `backend/src/routes/orders.js` | batch update/delete Job dan memanggil auto-job/handoff | Sales CRM internal | direct correction/cancel dapat bypass publication | Perubahan file Sales dilarang tanpa approval terpisah |
| `backend/src/services/rescheduleCase.js` | menautkan `rescheduleCaseId` ke Job | Armada reschedule flow | perubahan checksum Job harus ikut diproyeksikan | Endpoint Armada sudah memanggil adapter; tetap diaudit saat writer gate diaktifkan |

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

Sebelum G2-D, setiap script harus salah satu dari: dipensiunkan, diberi hard fence saat flag V2 aktif, atau dipindah ke repair command V2 yang mewajibkan reason, actor, idempotency key, audit, dan publication/feed update. Daftar ini tidak memberi izin menjalankan script.

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

`G2-D` tetap gagal sampai ada approval scope untuk mengadaptasi writer lintas-boundary di atas dan memagari repair scripts. Approval tersebut tidak boleh ditafsirkan sebagai izin mengubah endpoint/payload Sales CRM, Warehouse, atau Finance, menjalankan cutover, atau mengganggu delivery aktif.
