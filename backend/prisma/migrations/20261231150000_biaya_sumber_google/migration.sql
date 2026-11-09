-- Sumber GOOGLE sudah dikenal kode biaya iklan, tetapi aturan tabel belum mengizinkannya.
ALTER TABLE "ad_source_spend_entries" DROP CONSTRAINT "ad_source_spend_entries_source_chk";
ALTER TABLE "ad_source_spend_entries" ADD CONSTRAINT "ad_source_spend_entries_source_chk" CHECK ("source_id" IN ('META','TIKTOK','GOOGLE','LAINNYA'));
