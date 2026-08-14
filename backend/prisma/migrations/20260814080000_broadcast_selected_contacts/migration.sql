-- Menyimpan kontak yang secara eksplisit dicentang admin di layar
-- "Pilih Kontak", supaya pilihan itu bertahan lintas simpan-draft/buka-lagi.
--
-- BUG NYATA yang kolom ini perbaiki (14 Agt 2026): pilihan cuma hidup di
-- state React. Admin mencentang 1 orang, simpan draft, buka draft lain,
-- lalu kembali -> layar "Pilih Kontak" memuat ulang kandidat dan diam-diam
-- mencentang SEMUA lagi (300 kontak), tanpa peringatan apa pun.
--
-- ADITIF MURNI: satu kolom array baru dengan default kosong. Kampanye yang
-- sudah ada tetap berperilaku sama seperti sebelumnya (kosong = boleh
-- default pilih-semua saat pertama kali dibuka).

-- AlterTable
ALTER TABLE "broadcast_campaigns" ADD COLUMN "selected_customer_ids" TEXT[] DEFAULT ARRAY[]::TEXT[];
