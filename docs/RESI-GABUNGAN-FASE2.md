# Resi Gabungan — Fase 2 (OrderGroup)

Status: **kode selesai, belum dideploy.** Fitur tetap OFF (`resi_input_aktif = false`); tidak ada backfill yang dijalankan.

## Apa yang berubah

| Lapisan | Perubahan |
|---|---|
| Skema | Tabel baru `order_groups`, enum `OrderGroupSource` (`BARU`, `BACKFILL_BUNDLE`), kolom nullable `Order.group_id`. Murni aditif. |
| Alur Buat Resi | Dalam transaksi yang sama membuat 1 `OrderGroup` + N `Order` child (`group_id`). Anchor = order pertama. |
| Backfill | Skrip terpisah `backend/scripts/resiBackfillBundle.js`: dry-run baca-saja + apply metadata-only (idempoten). Tidak dijalankan otomatis. |
| Tidak berubah | Payment, jurnal, Invoice (termasuk `combinedIntoId`), Unit, Job, Produksi, Delivery, insentif, status, nominal, alamat order. |

`OrderGroup` menyimpan snapshot: customer, alamat/kota/tautan lokasi, tanggal kirim, ongkir tambahan, DP persen dan DP target, anchor, sumber, pembuat (`created_by`), dan `metadata` JSON. Untuk backfill, ongkir tambahan dan DP persen **NULL** (bundle lama tidak punya kesepakatan resi; tidak ditebak).

## Jaminan "order lama identik"

- `group_id` NULL untuk semua order yang ada; tidak ada kode baca/tulis lain yang bergantung pada kolom itu.
- Backfill memakai `UPDATE "Order" SET group_id = …` mentah, sehingga `Order.updatedAt` tidak bergeser (Prisma `@updatedAt` akan mengubahnya).
- Order dikunci `FOR UPDATE` dan `group_id IS NULL` dicek ulang di dalam transaksi; `anchor_order_id` unik → run ulang / hasil klasifikasi basi tidak membuat grup ganda.
- Tes membuktikan sidik jari (md5 seluruh baris) `Order` tanpa `group_id`, invoice, payment, jurnal, baris jurnal, alokasi, unit, job, dan item identik sebelum/sesudah backfill.

## Klasifikasi bundle lama

| Kelas | Arti | Kode alasan |
|---|---|---|
| BISA | Boleh di-backfill | — |
| PERINGATAN | Boleh (dengan `--sertakan-peringatan`); metadata dicatat apa adanya + kode peringatan | `ANGGOTA_DIBATALKAN`, `ALAMAT_BERBEDA`, `ALAMAT_KOSONG_ANCHOR`, `TANGGAL_BERBEDA`, `ONGKIR_TERSEBAR`, `DP_TARGET_PARSIAL` |
| TIDAK_BISA | Tidak pernah ditulis | `ANGGOTA_KURANG`, `ANCHOR_TIDAK_ADA`, `ANCHOR_JAMAK`, `CUSTOMER_CAMPUR`, `RANTAI_BUNDLE`, `ORDER_GANDA` |
| SUDAH_ADA | Anggota sudah punya grup (setelah apply) | — |

Alamat dibandingkan lewat sidik jari md5 yang dihitung di SQL; nama, telepon, dan teks alamat tidak pernah keluar dari database.

## Cara menjalankan dry-run

```
node scripts/resiBackfillBundle.js --cetak-sql [--pra-migrasi]   # SQL baca-saja
psql (transaksi READ ONLY) < sql  > anggota.txt
node scripts/resiBackfillBundle.js --dari-json=anggota.txt --out=<PATH DI LUAR REPO>
```

`--out` **ditolak** bila berada di dalam repo. stdout hanya agregat. Apply (hanya lewat `DATABASE_URL`, tidak dari berkas): `RESI_BACKFILL_APPLY=YA node scripts/resiBackfillBundle.js --apply [--sertakan-peringatan]`.

## Hasil dry-run produksi (agregat, 27 Sep 2026, sebelum migrasi)

- 28 bundle, 89 order (28 anchor + 61 anggota), 89 unit, 131 job, 42 payment yang melekat pada order anggota (tidak disentuh).
- **14 BISA, 14 PERINGATAN, 0 TIDAK_BISA.**
- Alasan peringatan (satu bundle bisa punya lebih dari satu): tanggal berbeda 11, alamat berbeda 9 (7 alamat berbeda nyata + 2 anchor tanpa alamat vs anggota beralamat), alamat anchor kosong 2, ada order CANCELLED 1.
- Tidak ada bundle dengan ongkir tercatat, tidak ada `dpTarget` tercatat, tidak ada rantai, tidak ada customer campur.

## Verifikasi

- Migrasi dari nol (`migrate deploy` DB sekali pakai) lulus.
- Upgrade: DB pada skema sebelumnya berisi order → hanya migrasi `20260927200000_order_groups` diterapkan; hash order identik; `group_id` semua NULL; tidak ada drift skema terkait `order_groups`/`group_id`.
- Tes: `resiOrderGroup.integration` (7), `resiGabungan.integration` (7, Fase 1 tetap hijau), unit `resiBackfill`, `resiRingkasan`, `invoice`, `orderDeliveredRollback`, `orderStatusSync` (35), regresi insentif snapshot/summary (39).

## Risiko

1. Kolom `group_id` ditambah pada tabel `Order` yang besar/ramai: `ADD COLUMN` nullable tanpa default di PostgreSQL bersifat instan (tanpa rewrite); `CREATE INDEX` singkat pada ±560 baris.
2. Klien Prisma harus digenerate ulang saat build rilis (otomatis lewat `prisma generate` di build backend). Kode lama tidak mengenal `group_id`, tetapi tetap kompatibel dengan skema baru karena kolom nullable.
3. Grup baru hanya dibuat saat flag `resi_input_aktif` ON; selama OFF, tidak ada grup yang lahir.
4. Backfill PERINGATAN membekukan alamat/tanggal anchor sebagai snapshot walau anggota berbeda — informasi itu tetap tercatat lewat kode peringatan. Keputusan Owner sebelum apply.

## Rollback

- Kode: deploy ulang commit sebelumnya (`272392ba`). Kolom/tabel baru tidak dibaca kode lama, jadi aman dibiarkan.
- Data grup (bila sudah ada): `UPDATE "Order" SET group_id = NULL WHERE group_id IS NOT NULL; DELETE FROM order_groups;` lalu, bila skema ingin dikembalikan sepenuhnya: `ALTER TABLE "Order" DROP COLUMN group_id; DROP TABLE order_groups; DROP TYPE "OrderGroupSource";` (tidak berdampak pada data lain karena tidak ada yang bergantung padanya).
