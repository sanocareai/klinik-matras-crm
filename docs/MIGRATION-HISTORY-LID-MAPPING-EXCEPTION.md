# Pengecualian checksum historis: `20260707130141_add_lid_mapping`

Status: keputusan owner 2026-09-26 (opsi 1 + migration normalisasi). Baseline/squash dijadwalkan terpisah.

## Fakta
| | SHA-256 | Byte |
|---|---|---|
| Asli, commit `279dda7f` (= checksum `_prisma_migrations` produksi) | `0fd0fc382fa921b9afea7d5ba89aec885946a174223e549ae122ca4e74d6b24d` | 414 |
| Saat ini di repo (sejak `0019ff81`) | `0c718a28653672313df578f43dc824233f7bd2bde203c298ad106a48665a937f` | 424 |

Beda semantik hanya satu baris: `DROP INDEX "OrderWeightEntry_orderId_idx";` → `DROP INDEX IF EXISTS "OrderWeightEntry_orderId_idx";`.

## Mengapa urutan produksi berbeda dari urutan leksikal
Index `OrderWeightEntry_orderId_idx` dibuat oleh `20260707160000_add_order_weight_entries`, yang secara leksikal SETELAH
`20260707130141_add_lid_mapping`. Di produksi `160000` terapan lebih dulu (2026-07-07 01:25Z) dan `130141` belakangan
(13:53Z), sehingga `DROP INDEX` polos berhasil. Pada DB kosong urutan leksikal berlaku dan `DROP INDEX` polos GAGAL
(`index does not exist`); karena itu `0019ff81` menambah `IF EXISTS`. Mengembalikan berkas ke bentuk asli memulihkan
provenance tetapi merusak bootstrap 0→latest (diuji: error), jadi berkas TIDAK dikembalikan.

Akibat: DB hasil chain bersih memiliki index `OrderWeightEntry_orderId_idx` (dibuat `160000`, `IF EXISTS` di `130141` tak mengenainya) yang
TIDAK ada di produksi maupun `schema.prisma`. Diselesaikan oleh migration normalisasi di bawah.

## Migration normalisasi
`20260926140000_normalize_order_weight_entry_index` (checksum `630591e4fcfac47cc42d8ed7b82aea2c857f2604b4d54be1fac0ee21f4bac618`), isi hanya:
`DROP INDEX IF EXISTS "OrderWeightEntry_orderId_idx";`. Chain bersih: menghapus index buatan `160000`. Produksi: no-op (index sudah tidak ada).
Timestamp sengaja setelah migration terbaru di branch dan di `origin/main` (`20260926130000`).

## Kontrol
`backend/scripts/verify-migration-history.js` (logika: `backend/src/lib/migrationHistoryVerifier.js`, tes: `backend/tests/migrationHistoryVerifier.test.js`).
Hanya-baca (SELECT). Exit 0 bila semua migration applied checksum-identik, ATAU satu-satunya beda adalah pengecualian ini
dengan SEMUA syarat: nama persis; checksum DB = hash asli; checksum repo = hash current; beda tepat satu baris di atas
(dibuktikan dengan merekonstruksi berkas asli dan mencocokkan hash); index `OrderWeightEntry_orderId_idx` tidak ada;
`LidMapping_lid_key` dan `LidMapping_pkey` ada; migration normalisasi WAJIB ada di repo dengan checksum di atas (hilang/berubah → gagal). Bukan allowlist umum: satu byte berubah / checksum lain berbeda / CRLF → gagal.
Baris `_prisma_migrations` berstatus rolled_back (percobaan gagal yang sudah di-resolve) diabaikan seperti Prisma; baris menggantung → gagal.
Migration pending tidak disentuh dan diproses normal oleh `prisma migrate deploy`.

Catatan: berkas harus LF. Checkout Windows dengan `autocrlf` menghasilkan CRLF dan verifier (juga Prisma) akan menganggapnya beda;
build rilis dari blob git / worktree LF.

## Audit script rilis (2026-09-26)
- Prisma 5.22.0 (`prisma migrate deploy`) TIDAK mengeluarkan warning apa pun untuk migration yang berkasnya berubah setelah
  applied, dan tidak gagal; ia hanya menerapkan migration pending. Artinya perubahan checksum historis tidak terdeteksi oleh
  Prisma sendiri — verifier inilah satu-satunya penjaga. Jangan menonaktifkan pemeriksaan apa pun secara global.
- `backend/Dockerfile` menjalankan `npx prisma migrate deploy` saat start; `scripts/release-delivery-control-production.sh`
  hanya memeriksa daftar migration baru/pending dan tidak memeriksa checksum. Tidak diubah di sini (spesifik rilis lain).
  Untuk rilis gabungan Delivery V2: jalankan `node scripts/verify-migration-history.js` terhadap DB produksi SEBELUM `migrate deploy`.

## Bukti rehearsal (2026-09-26, dengan migration normalisasi)
Restore `pre-c1-20260926-135457.sql.gz` ke Postgres 16 terisolasi; checkout LF dari HEAD `d1ea493a` + migration normalisasi; Prisma 5.22.0.
- Verifier pra-deploy: OK (185 applied, tepat 1 pengecualian, pending = normalisasi). `migrate deploy`: exit 0, normalisasi applied (186 migration), tanpa warning.
- Replay `migrate deploy`: "No pending migrations". Verifier pasca-deploy OK.
- Baris `_prisma_migrations` lain identik; hanya 1 baris baru. Skema produksi sebelum/sesudah identik. Data 162 tabel (hash isi terurut per tabel) identik dengan restore murni.
- Clean 0→latest: exit 0, 186 migration; replay tanpa pending. Index `OrderWeightEntry_orderId_idx` tidak ada di clean maupun produksi; index `LidMapping` lengkap di keduanya.
- Skema clean vs produksi: identik, kecuali (1) tabel `backup_assigned_sales_20260823` dan `backup_unit_status_20260830`: artefak operasional produksi, bukan migration dan bukan drift;
  (2) CHECK `fin_inventory_openings_status_check`: cetakan berbeda (`ARRAY[...]::text[]` vs `ARRAY[(..)::text]`) tetapi himpunan nilai identik (DRAFT, DIPERIKSA, DIPOSTING, DIBALIK, DIBATALKAN) — ekuivalen semantik.
- Uji negatif: satu byte ekstra pada berkas LID → verifier exit 1.

## Baseline/squash (terpisah)
Bangun baseline dari skema produksi, tandai chain lama sebagai historis, dan hapus kebutuhan pengecualian ini beserta verifier-nya (migration normalisasi ikut tercakup baseline).
