-- Jenis revisi baru "PEMBELI" pada buku revisi order PKR (Okt 2026): koreksi data customer/penerima/alamat/catatan memakai buku revisi yang SAMA (token optimistis + audit).
-- MELONGGARKAN CHECK jenis: menambah satu nilai. Tanpa data yang berubah, tanpa backfill, tanpa UPDATE/DELETE.

ALTER TABLE "pkr_item_revisions" DROP CONSTRAINT "pkr_item_revisions_kind_chk";
ALTER TABLE "pkr_item_revisions" ADD CONSTRAINT "pkr_item_revisions_kind_chk" CHECK ("kind" IN ('DIBUAT', 'DILENGKAPI', 'DIKOREKSI', 'PEMBELI'));
