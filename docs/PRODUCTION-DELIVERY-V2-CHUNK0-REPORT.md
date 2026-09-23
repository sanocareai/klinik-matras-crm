# Production + Delivery V2 — Chunk 0 Report

Tanggal: 23 September 2026

## Baseline dan isolasi

- Commit dasar awal: `e408c1fe49d59feb418a8b4c22a6de92d041b5c4`; baseline terbaru yang sudah tersedia di `origin/main`: `ff04b6952f1a576cf29278330f967c5890f7fda2`.
- Branch/worktree implementasi: `feat/production-delivery-v2` / `KM_SANSS-prod-delivery-v2`.
- Worktree utama tidak disentuh. Perubahan Claude pada Finance/insentif tetap berada di worktree utama.
- Perubahan Claude sudah menjadi commit di `origin/main`; branch ini sudah direbase ke `ff04b6952f1a576cf29278330f967c5890f7fda2`. Shared files dari commit tersebut terbatas pada schema, bootstrap API, permissions/capabilities, serta Finance/insentif; tidak ada route writer Delivery yang ditimpa.

## Inventory lokal

- Orders: 153.
- Units: 0.
- Jobs: 1 (`EN_ROUTE`, `DELIVERY`).
- Routes: 1 (`PUBLISHED`).
- Active mobile sessions: 2.
- Ditemukan satu mismatch kritis: `Job.scheduledDate=null` sedangkan tanggal Route `2026-09-22`.
- Mismatch tidak diperbaiki dengan tebakan; route ditandai `KEEP_V1` dan tidak eligible untuk cutover.

Artefak rinci disimpan pada direktori ignored `backups/production-delivery-v2/`.

## Backup dan restore drill lokal

- Format backup: PostgreSQL custom format (`pg_dump -Fc`).
- Ukuran: 604,892 byte.
- SHA-256: `EABB423F836079E03EE2D5B94A0356132F231ECA15A3A21FFE2BB0FA0A32411F`.
- Restore target: database terisolasi `klinik_matras_v2_restore_drill_test`.
- `dataChecksum` sumber dan restore: `5aa3cadb04e956450aabbccb8dfeb7365391cbad5d997615b2d824c777f17370`.
- Hasil: PASS.

## Backup dan restore drill production

- Backup production dibuat tanpa menghentikan atau mengubah transaksi aktif, memakai PostgreSQL custom format (`pg_dump -Fc`).
- Lokasi remote: `backups/production_delivery_v2_chunk0_20260923.dump`; salinan lokal berada di direktori ignored `backups/production-delivery-v2/`.
- Ukuran: 23,287,817 byte.
- SHA-256 remote dan lokal: `7E028E7C9E2C9D36641AF084B47EA155582FD89787E53A1B6263836E7C6B876C`.
- Restore target lokal terisolasi: `klinik_matras_v2_prod_restore_drill_test`.
- Restore: PASS. Tidak ada data production yang dimutasi.
- Inventory restore: 542 order, 541 unit, 827 job, 32 route, 43 execution event, 658 position ping, dan 6 mobile session aktif.
- Job aktif orphan: 0; unit pada lebih dari satu job aktif: 0; duplicate route sequence: 0; route/job assignment mismatch aktif: 0.
- 43 unit berstatus produksi belum memiliki route snapshot V1; backfill dry-run menahan 5 unit `CURRENT_STAGE_WITHOUT_SERVICE` sebagai `KEEP_V1` dan tidak menebak lifecycle-nya.
- Migrasi additive berhasil diterapkan pada salinan restore production.
- Apply awal dengan sengaja gagal tertutup saat menemukan mapping fase legacy `FINISH` yang belum valid untuk enum V2. Mapping diperbaiki eksplisit (`INTAKE → INTAKE`, `MODULE → PROCESS`, `FINISH → QC`); fase historis tanpa bukti granular diberi `MIGRATION_REVIEW`.
- Backfill apply setelah perbaikan: 541 ProductionRun, 32 baseline publication, dan 827 DeliveryJobState. Apply kedua menghasilkan plan/result checksum identik `08cb0345e26032f03807bbbfface7cdfb7121d17b72162f987c6941f7fee299e`.
- Exception akhir: 5 `KEEP_V1`, 0 `OPEN`. Shadow akhir: 1,400/1,400 `MATCH`, 0 mismatch.
- Catch-up rehearsal pada salinan production: perubahan V1 terdeteksi dan parity pulih setelah source dipulihkan—PASS.
- Rollback rehearsal: 542 order, 541 unit, 827 job, dan 32 route V1 tetap; seluruh row V2 dipertahankan; semua flag kembali OFF—PASS.

## Additive schema

- Migration: `20260925000000_production_delivery_v2_foundation`.
- Tidak mengandung `DROP`, `TRUNCATE`, `DELETE`, rename, atau perubahan tabel Finance/Sales/Warehouse.
- Migration berhasil diterapkan pada database kosong hasil seluruh migration history dan database hasil restore.
- Seluruh reader/writer/fence flag di-seed OFF.

## Backfill, exception, shadow, dan rehearsal

- Dry-run: 1 route, 1 job, 0 unit, 1 exception.
- Apply diulang; entity V2 tidak terduplikasi dan checksum plan stabil untuk source yang sama.
- Exception terakhir: 1 `KEEP_V1`, 0 `OPEN`.
- Shadow comparison: 2/2 aggregate MATCH setelah backfill.
- Catch-up rehearsal setelah mutation V1 sintetis: perubahan terdeteksi, backfill catch-up memperbarui shadow, dan parity kembali setelah source dipulihkan—PASS.
- Rollback rehearsal: reader dimatikan sebelum writer; count V1 tidak berubah dan row V2 tetap dipertahankan—PASS.

## Status gate

- Foundation teknis Chunk 0 pada database lokal/test: PASS.
- Cutover: **TETAP OFF**.
- Production inventory/backup/restore evidence: PASS. Migrasi V2 belum diterapkan ke production; pengujian migration/backfill hanya pada database restore lokal.
- Coordination gate Claude: PASS untuk baseline `ff04b695`; branch telah direbase tanpa konflik. `backend/prisma/schema.prisma`, `backend/src/index.js`, dan `frontend/src/api.js` tetap diperlakukan sebagai shared files pada chunk selanjutnya.
- Backend regression suite setelah rebase: 604/604 PASS.
- Chunk 0 pre-cutover gate: PASS untuk pengembangan writer dengan seluruh flag OFF. Ini bukan persetujuan deployment/cutover production.
- Aggregate route yang mismatch tetap V1 sampai ada bukti operasional; ini tidak menghambat pengembangan writer V2, tetapi menghambat cohort route tersebut.
