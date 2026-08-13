-- Atribusi iklan Meta Click-to-WhatsApp (CTWA).
--
-- Iklan CTWA melompat LANGSUNG dari Meta ke WhatsApp tanpa menyentuh
-- website, jadi tag tak-terlihat dari sanomatrassehat.com tidak pernah
-- kepasang. Satu-satunya jejak ada di contextInfo payload WAHA (engine
-- GOWS mengirimnya -- diverifikasi langsung dari log production 13 Agt
-- 2026: 173 pesan ber-CTWA dalam 72 jam, semuanya SEBELUMNYA salah
-- dilabeli WHATSAPP_DIRECT alias "organik").
--
-- ctwa_clid = Click ID unik per klik iklan. Diberi kolom SENDIRI (bukan
-- diselipkan ke leadSourceDetail) supaya bisa di-query untuk mengirim
-- balik data konversi ke Meta Conversions API -- itu yang membuat Meta
-- bisa mengoptimalkan ke orang yang BENAR-BENAR closing, bukan sekadar
-- yang chat.
--
-- Additive-only, keduanya nullable: TIDAK ada data lama yang berubah,
-- tidak ada backfill, tidak ada risiko ke 2.430 customer yang sudah ada.

-- AlterTable
ALTER TABLE "Customer" ADD COLUMN     "ctwa_clid" TEXT,
ADD COLUMN     "ctwa_source_url" TEXT;
