-- Kolom rawType di Message — simpan tipe pesan WhatsApp ASLI kalau
-- parseHistoryMessage.js tidak mengenalinya (content jadi
-- "[Pesan tidak didukung]"). Sebelumnya info ini cuma di-console.warn lalu
-- dibuang, jadi begitu log server ke-reset (mis. redeploy) kita PERMANEN
-- kehilangan info tipe apa yang sebenarnya masuk. Nullable, tidak perlu
-- backfill — data lama tetap tidak diketahui tipenya (memang sudah hilang).
ALTER TABLE "Message" ADD COLUMN "rawType" TEXT;
