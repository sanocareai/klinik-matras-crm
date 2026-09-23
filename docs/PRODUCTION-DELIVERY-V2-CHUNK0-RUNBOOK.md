# Production + Delivery V2 — Chunk 0 Runbook

Status awal seluruh feature flag: **OFF**. Runbook ini tidak melakukan cutover.

## 1. Safety rules

- Jangan jalankan migration/backfill pada production sebelum backup, restore drill, dan dry-run diperiksa.
- `backfill.js` default read-only. Mode tulis membutuhkan `--apply` dan `ALLOW_V2_BACKFILL_APPLY=YES`.
- Rehearsal hanya berjalan jika nama database mengandung `test` atau `scratch`.
- Aggregate dengan exception `OPEN` atau `KEEP_V1` tidak eligible untuk cutover.
- Jangan memperbaiki mismatch route/job dengan tebakan. Tetapkan disposition berdasarkan bukti operasional.
- Jangan menyalakan reader Delivery sebelum `delivery_v2_writer_route` dan `delivery_v2_writer_execution` aktif serta sehat.
- Tidak ada drop/rename schema, hard delete, atau perubahan kontrak Sales/Warehouse/Finance pada Chunk 0.

## 2. Urutan pra-cutover

1. Catat commit baseline dan diff worktree Claude.
2. Jalankan inventory V1.
3. Buat backup custom-format PostgreSQL dan simpan SHA-256.
4. Restore ke database baru yang namanya mengandung `test`.
5. Bandingkan `dataChecksum` inventory sumber dan restore.
6. Deploy migration additive pada database restore.
7. Jalankan backfill dry-run; review exception.
8. Jalankan backfill apply pada database restore; ulangi untuk bukti idempotency.
9. Seed seluruh feature flag dalam keadaan OFF.
10. Jalankan exception report dan shadow comparison.
11. Jalankan catch-up rehearsal setelah mutation V1 sintetis.
12. Jalankan rollback rehearsal: reader OFF dahulu, writer OFF sesudahnya, tanpa menghapus row V2.

## 3. Commands

Semua command dijalankan dari `backend/` dengan `DATABASE_URL` yang sesuai.

```powershell
npm run v2:inventory -- --output=../backups/production-delivery-v2/inventory.json
npm run v2:backfill -- --output=../backups/production-delivery-v2/backfill-dry-run.json

$env:ALLOW_V2_BACKFILL_APPLY='YES'
npm run v2:backfill -- --apply --output=../backups/production-delivery-v2/backfill-apply.json

npm run v2:flags
npm run v2:exceptions -- --output=../backups/production-delivery-v2/exceptions.json
npm run v2:shadow -- --output=../backups/production-delivery-v2/shadow.json
```

## 4. Writer fence dan catch-up

Bulk backfill bukan cutover. Sebelum writer V2 diaktifkan:

1. aktifkan fence V1 untuk domain yang dipindah;
2. tunggu transaksi V1 yang sudah masuk selesai;
3. jalankan full rescan/catch-up;
4. pastikan checksum dan shadow parity cocok;
5. pastikan semua exception memiliki disposition;
6. baru pindahkan ingress endpoint ke writer V2-first;
7. lepaskan fence setelah endpoint lama sudah menjadi adapter V2-first.

Flag fence tidak boleh dinyalakan tanpa runbook operasional dan komunikasi ke operator karena ia dapat menahan mutation aktif.

## 5. Rollback

Urutan rollback wajib:

1. matikan `driver_v2_snapshot_reader`, `delivery_web_v2_reader`, dan `production_v2_reader`;
2. pastikan client kembali membaca V1;
3. matikan writer V2;
4. aktifkan kembali capture/checkpoint V1;
5. pertahankan seluruh tabel/outbox V2 untuk audit—jangan drop atau delete;
6. sebelum mencoba cutover lagi, jalankan backfill catch-up dan shadow parity ulang.

Rollback schema menggunakan kompatibilitas aplikasi terhadap schema additive, bukan reverse migration.

## 6. Stop conditions

Hentikan cutover bila ada salah satu kondisi berikut:

- backup tidak dapat direstore;
- data checksum berbeda;
- exception `OPEN` pada cohort;
- shadow mismatch;
- mutation route/job dapat bypass publication service;
- reader flag dapat aktif sebelum kedua writer Delivery;
- perubahan membutuhkan kontrak/internals Sales, Warehouse, atau Finance;
- tindakan dapat memutus order/delivery aktif.
