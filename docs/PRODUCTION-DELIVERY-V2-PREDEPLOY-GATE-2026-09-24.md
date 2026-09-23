# Production + Delivery V2 — Pre-deploy Gate

Tanggal: 24 September 2026

## Keputusan

Gate kode dan rehearsal data **lulus**, tetapi deployment **ditahan**. Preflight VPS menemukan worktree production pada `main` memiliki perubahan tracked dan untracked yang bukan milik perubahan ini (termasuk banyak file `frontend/dist`, data operasional, dan settings). Menjalankan `pull`, merge, build, atau restart pada keadaan itu dapat menimpa pekerjaan/artefak aktif. Tidak ada push, merge ke `main`, migrasi production, atau deploy dilakukan oleh gate ini.

Seluruh feature flag V2 tetap OFF. Tidak ada writer/reader V2 atau Driver App cutover yang diaktifkan.

## Baseline dan commit

- Baseline `origin/main`: `5e9c04c3d64c7f2eaf15a604fa1ba9ebd5f44453`.
- Baseline diintegrasikan ke branch V2 lewat `c56eb569` tanpa konflik dan tanpa mengubah kode Finance/Warehouse.
- Perbaikan tombstone yang digate: `e8f7936f` (`fix(delivery): isolate cancellation tombstones from failure flows`).
- Branch yang digate: `feat/production-delivery-v2`.

## Cancellation dan ownership writer

- Seluruh consumer Delivery yang memperlakukan `Job.status=FAILED` sebagai kegagalan operasional sekarang mengecualikan `cancellationV2`.
- Tombstone tidak masuk antrean reschedule, issue/timeline, Kendali failure metrics, laporan Delivery, POD, board, maps route, maupun notifikasi kurir eksternal. Endpoint reschedule menolak tombstone dengan `409`.
- Integration proof cancellation sebelumnya lulus 7/7: tidak ada `JobIssueLog`, `RescheduleCase`, `IncentivePayout`, atau `FinJournalEntry` yang dibuat oleh cancellation; Finance dan Warehouse tidak diubah.
- Audit writer terbaru: **88 mutation sites, 88 owned/guarded, 0 unowned** ([evidence](evidence/predeploy-delivery-writer-audit.json)).
- Angka 89 menjadi 88 karena satu site `job.deleteMany()` pada cancel order dihapus saat diganti command owner tombstone atomik; ini bukan bypass yang hilang. Cakupan tetap 100%.

## Backup dan restore rehearsal

- Backup production baru dibuat sebagai PostgreSQL custom dump tanpa menghentikan transaksi: `production_delivery_v2_predeploy_20260924.dump`.
- Ukuran: 23,338,274 byte.
- SHA-256 remote dan salinan lokal sama: `925dc649a4bf65f72478ce14ba584eb3906f82a771a81fcb40c00c0f36dd111b`.
- Backup dipulihkan hanya ke database lokal terisolasi `klinik_matras_v2_predeploy_restore_test`; database operasional lokal maupun production tidak dimutasi.

## Migration dan backfill rehearsal

- Prisma menerapkan tiga migration additive pada restore: `20260925000000_production_delivery_v2_foundation`, `20260925010000_delivery_v2_sync_foundation`, dan `20260925020000_delivery_job_cancellation_tombstone`.
- Inventory restore: 543 order, 542 unit, 828 job, 32 route; tidak ada orphan job aktif, duplicate route sequence, duplicate active job unit, atau route/job assignment mismatch ([evidence](evidence/predeploy-v2-inventory.json)).
- Backfill dry-run dan apply kedua stabil/idempoten dengan `planChecksum` `3d23e274efff679338d62827233b968cfd5173e9f33770d816654277337bcfb1` ([dry-run](evidence/predeploy-v2-backfill-dry-run.json), [apply](evidence/predeploy-v2-backfill-apply-2.json)).
- Exception report: 5 `KEEP_V1`, 0 `OPEN`; kelimanya `CURRENT_STAGE_WITHOUT_SERVICE`. Tidak ada lifecycle yang ditebak, dan lima aggregate tersebut tetap dikecualikan dari cohort cutover ([evidence](evidence/predeploy-v2-exceptions.json)).

## Sync, parity, dan rollback rehearsal

- Shadow parity akhir: **1,410/1,410 MATCH**, 0 mismatch ([evidence](evidence/predeploy-v2-shadow-final.json)).
- Catch-up rehearsal: perubahan V1 terdeteksi dan parity pulih setelah source dikembalikan ([evidence](evidence/predeploy-v2-catchup.json)).
- Rollback rehearsal: reader dimatikan sebelum writer; V1 tidak berubah, row V2 dipertahankan, dan tidak ada flag aktif ([evidence](evidence/predeploy-v2-rollback.json)).
- Writer/Driver snapshot rehearsal: **10/10 PASS** — publish tidak kehilangan stop, reassignment mencabut akses driver lama, replay idempoten, stale revision ditolak, offline delta deterministik, cancellation menghapus ghost route, full refresh setelah cancel kosong, lifecycle completion mempublikasikan revisi baru, dan fault injection rollback atomik ([evidence](evidence/predeploy-v2-writer-rehearsal.json)).
- Flag check setelah rehearsal: 8 flag terdaftar, 0 enabled.

## Production preflight blocker

VPS berada pada commit `5e9c04c3` tetapi `git status` tidak bersih: ada tracked deletions/modifications dan data/asset untracked yang tidak berasal dari branch ini. Ini adalah blocker keselamatan deployment, bukan kegagalan schema atau parity. Sebelum deploy, owner/Claude yang memiliki perubahan VPS harus membersihkan atau menginventarisasi perubahan tersebut secara eksplisit. Setelah VPS clean, ulangi preflight singkat (remote HEAD/status, migration deploy, flag OFF, health check, dan smoke V1) sebelum deployment.
