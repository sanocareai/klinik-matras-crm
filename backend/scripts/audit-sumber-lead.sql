-- AUDIT SUMBER LEAD ("Other" CRM) — BACA-SAJA. Menghitung customer unik dan customer dengan order menurut BUKTI yang tersimpan; TIDAK mengubah data
-- apa pun (transaksi READ ONLY; tanpa tabel sementara; tanpa nomor/nama/isi chat pada keluaran). Reproduksi:
--   ssh ubuntu@43.133.152.6 "docker exec -i klinik-matras-postgres-1 sh -c 'psql -U \"$POSTGRES_USER\" -d \"$POSTGRES_DB\" -X -P pager=off'" < backend/scripts/audit-sumber-lead.sql
-- Definisi: customer = satu baris tabel Customer (satu nomor); "dengan order" = >= 1 order eligible (bukan CANCELLED/PENDING, bukan penjualan karyawan);
-- era menurut createdAt WIB: pra-13Agu (sebelum kolom ctwa_clid ada), 13Agu s.d. 10Okt 11:48 (clid ada, sourceID belum ditangkap), sejak capture Fase 0 (sourceID ada di berkas JSONL,
-- TETAPI tanpa customer ID). Kategori diurutkan dari bukti paling kuat ke paling lemah; satu customer tepat satu kategori. Spam dan staf ditampilkan terpisah.
BEGIN READ ONLY;
SET LOCAL statement_timeout = '90s';
\echo == P1. partisi SEMUA customer: kategori (total, dgn order, spam, dgn order&bukan spam)
WITH k AS (
SELECT c.id, c."createdAt", c."leadSource"::text AS ls, c."pipelineStage"::text = 'SPAM' AS spam,
  (c.is_internal_staff OR c.staff_user_id IS NOT NULL) AS staf,
  c."leadSourceConfirmed" AS konf,
  CASE WHEN c."leadSourceDetail" ILIKE 'Meta Ads - template%' THEN 'template' WHEN c."leadSourceDetail" ILIKE 'Dimulai manual oleh sales%' THEN 'mulai_sales' ELSE 'lain' END AS detail,
  c.ctwa_clid IS NOT NULL AS clid, c.ctwa_source_url IS NOT NULL AS url,
  EXISTS (SELECT 1 FROM "ClickEvent" e WHERE e."matchedCustomerId" = c.id) AS klik,
  EXISTS (SELECT 1 FROM "Order" od WHERE od."customerId" = c.id AND od.status::text NOT IN ('CANCELLED','PENDING') AND od.penjualan_karyawan_id IS NULL) AS pesan,
  CASE WHEN (c."createdAt" + interval '7 hours') < timestamp '2026-08-13' THEN '1_pra_13Agu'
       WHEN (c."createdAt" + interval '7 hours') < timestamp '2026-10-10 11:48' THEN '2_13Agu_s.d._10Okt'
       ELSE '3_sejak_capture_Fase0' END AS era
  FROM "Customer" c
), t AS (
SELECT k.*, CASE
  WHEN staf THEN '90_staf_internal'
  WHEN ls = 'B2B_DIRECT' THEN '91_b2b_langsung'
  WHEN clid THEN '30_sinyal_iklan_CTWA_clid_tanpa_AdID'
  WHEN url THEN '31_referral_URL_tanpa_clid'
  WHEN ls = 'META_ADS' AND klik THEN '40_Meta_via_klik_tautan_terlacak'
  WHEN ls = 'META_ADS' AND detail = 'template' THEN '41_Meta_via_pola_teks_(inferensi)'
  WHEN ls = 'META_ADS' THEN '42_Meta_sinyal_lain_tanpa_clid'
  WHEN ls IN ('GOOGLE_ADS','TIKTOK_ADS') THEN '50_iklan_non_Meta_(tag/tautan)'
  WHEN ls IN ('WEBSITE_ORGANIC','WEBSITE') THEN '60_website'
  WHEN ls = 'INSTAGRAM' THEN '61_channel_Instagram'
  WHEN ls = 'OTHER' AND detail = 'mulai_sales' THEN '70_dimulai_sales_(manual)'
  WHEN ls = 'WHATSAPP_DIRECT' AND konf THEN '71_input_manual_dikonfirmasi'
  WHEN ls = 'WHATSAPP_DIRECT' THEN '80_direct_WA_tanpa_referral'
  ELSE '99_unknown_lain' END AS kat FROM k
)
SELECT kat, count(*) cust, count(*) FILTER (WHERE pesan) cust_order, count(*) FILTER (WHERE spam) spam, count(*) FILTER (WHERE pesan AND NOT spam) order_bukan_spam FROM t GROUP BY 1 ORDER BY 1;
\echo == P2. per era x kategori (hanya bukan spam, bukan staf)
WITH k AS (
SELECT c.id, c."createdAt", c."leadSource"::text AS ls, c."pipelineStage"::text = 'SPAM' AS spam,
  (c.is_internal_staff OR c.staff_user_id IS NOT NULL) AS staf,
  c."leadSourceConfirmed" AS konf,
  CASE WHEN c."leadSourceDetail" ILIKE 'Meta Ads - template%' THEN 'template' WHEN c."leadSourceDetail" ILIKE 'Dimulai manual oleh sales%' THEN 'mulai_sales' ELSE 'lain' END AS detail,
  c.ctwa_clid IS NOT NULL AS clid, c.ctwa_source_url IS NOT NULL AS url,
  EXISTS (SELECT 1 FROM "ClickEvent" e WHERE e."matchedCustomerId" = c.id) AS klik,
  EXISTS (SELECT 1 FROM "Order" od WHERE od."customerId" = c.id AND od.status::text NOT IN ('CANCELLED','PENDING') AND od.penjualan_karyawan_id IS NULL) AS pesan,
  CASE WHEN (c."createdAt" + interval '7 hours') < timestamp '2026-08-13' THEN '1_pra_13Agu'
       WHEN (c."createdAt" + interval '7 hours') < timestamp '2026-10-10 11:48' THEN '2_13Agu_s.d._10Okt'
       ELSE '3_sejak_capture_Fase0' END AS era
  FROM "Customer" c
), t AS (
SELECT k.*, CASE
  WHEN staf THEN '90_staf_internal'
  WHEN ls = 'B2B_DIRECT' THEN '91_b2b_langsung'
  WHEN clid THEN '30_sinyal_iklan_CTWA_clid_tanpa_AdID'
  WHEN url THEN '31_referral_URL_tanpa_clid'
  WHEN ls = 'META_ADS' AND klik THEN '40_Meta_via_klik_tautan_terlacak'
  WHEN ls = 'META_ADS' AND detail = 'template' THEN '41_Meta_via_pola_teks_(inferensi)'
  WHEN ls = 'META_ADS' THEN '42_Meta_sinyal_lain_tanpa_clid'
  WHEN ls IN ('GOOGLE_ADS','TIKTOK_ADS') THEN '50_iklan_non_Meta_(tag/tautan)'
  WHEN ls IN ('WEBSITE_ORGANIC','WEBSITE') THEN '60_website'
  WHEN ls = 'INSTAGRAM' THEN '61_channel_Instagram'
  WHEN ls = 'OTHER' AND detail = 'mulai_sales' THEN '70_dimulai_sales_(manual)'
  WHEN ls = 'WHATSAPP_DIRECT' AND konf THEN '71_input_manual_dikonfirmasi'
  WHEN ls = 'WHATSAPP_DIRECT' THEN '80_direct_WA_tanpa_referral'
  ELSE '99_unknown_lain' END AS kat FROM k
)
SELECT era, kat, count(*) cust, count(*) FILTER (WHERE pesan) cust_order FROM t WHERE NOT spam AND NOT staf GROUP BY 1,2 ORDER BY 1,2;
\echo == P3. total
WITH k AS (
SELECT c.id, c."createdAt", c."leadSource"::text AS ls, c."pipelineStage"::text = 'SPAM' AS spam,
  (c.is_internal_staff OR c.staff_user_id IS NOT NULL) AS staf,
  c."leadSourceConfirmed" AS konf,
  CASE WHEN c."leadSourceDetail" ILIKE 'Meta Ads - template%' THEN 'template' WHEN c."leadSourceDetail" ILIKE 'Dimulai manual oleh sales%' THEN 'mulai_sales' ELSE 'lain' END AS detail,
  c.ctwa_clid IS NOT NULL AS clid, c.ctwa_source_url IS NOT NULL AS url,
  EXISTS (SELECT 1 FROM "ClickEvent" e WHERE e."matchedCustomerId" = c.id) AS klik,
  EXISTS (SELECT 1 FROM "Order" od WHERE od."customerId" = c.id AND od.status::text NOT IN ('CANCELLED','PENDING') AND od.penjualan_karyawan_id IS NULL) AS pesan,
  CASE WHEN (c."createdAt" + interval '7 hours') < timestamp '2026-08-13' THEN '1_pra_13Agu'
       WHEN (c."createdAt" + interval '7 hours') < timestamp '2026-10-10 11:48' THEN '2_13Agu_s.d._10Okt'
       ELSE '3_sejak_capture_Fase0' END AS era
  FROM "Customer" c
), t AS (
SELECT k.*, CASE
  WHEN staf THEN '90_staf_internal'
  WHEN ls = 'B2B_DIRECT' THEN '91_b2b_langsung'
  WHEN clid THEN '30_sinyal_iklan_CTWA_clid_tanpa_AdID'
  WHEN url THEN '31_referral_URL_tanpa_clid'
  WHEN ls = 'META_ADS' AND klik THEN '40_Meta_via_klik_tautan_terlacak'
  WHEN ls = 'META_ADS' AND detail = 'template' THEN '41_Meta_via_pola_teks_(inferensi)'
  WHEN ls = 'META_ADS' THEN '42_Meta_sinyal_lain_tanpa_clid'
  WHEN ls IN ('GOOGLE_ADS','TIKTOK_ADS') THEN '50_iklan_non_Meta_(tag/tautan)'
  WHEN ls IN ('WEBSITE_ORGANIC','WEBSITE') THEN '60_website'
  WHEN ls = 'INSTAGRAM' THEN '61_channel_Instagram'
  WHEN ls = 'OTHER' AND detail = 'mulai_sales' THEN '70_dimulai_sales_(manual)'
  WHEN ls = 'WHATSAPP_DIRECT' AND konf THEN '71_input_manual_dikonfirmasi'
  WHEN ls = 'WHATSAPP_DIRECT' THEN '80_direct_WA_tanpa_referral'
  ELSE '99_unknown_lain' END AS kat FROM k
)
SELECT count(*) total, count(*) FILTER (WHERE spam) spam, count(*) FILTER (WHERE staf) staf, count(*) FILTER (WHERE pesan) dgn_order, count(*) FILTER (WHERE era='1_pra_13Agu') pra_13agu, count(*) FILTER (WHERE era='3_sejak_capture_Fase0') sejak_fase0 FROM t;
\echo == E. Other: per kelas detail
WITH o AS (
SELECT c.id, c."createdAt", c."pipelineStage"::text AS stage, c."leadSource"::text AS ls, c."leadSourceConfirmed" AS konf,
       (c.is_internal_staff OR c.staff_user_id IS NOT NULL) AS staf, c.ctwa_clid IS NOT NULL AS ada_clid, c.ctwa_source_url IS NOT NULL AS ada_url,
       CASE WHEN c."leadSourceDetail" IS NULL OR btrim(c."leadSourceDetail") = '' THEN 'kosong'
            WHEN c."leadSourceDetail" ILIKE 'Dimulai manual oleh sales%' THEN 'mulai_chat_sales'
            WHEN c."leadSourceDetail" ILIKE 'Profil internal karyawan%' THEN 'profil_karyawan'
            WHEN c."leadSourceDetail" ILIKE 'Website - %' THEN 'website_tag_sumber_lain'
            WHEN c."leadSourceDetail" ILIKE 'Meta Ads%' THEN 'meta_ads_teks'
            ELSE 'teks_lain' END AS detail_kelas,
       (SELECT count(*) FROM "Conversation" v WHERE v."customerId" = c.id) AS n_conv,
       (SELECT v.channel::text FROM "Conversation" v WHERE v."customerId" = c.id ORDER BY v."createdAt" LIMIT 1) AS channel1,
       (SELECT m.direction::text FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" WHERE v."customerId" = c.id ORDER BY m."createdAt", m.id LIMIT 1) AS arah_pesan_pertama,
       (SELECT count(*) FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" WHERE v."customerId" = c.id AND m.direction::text = 'INBOUND') AS n_inbound,
       (SELECT count(*) FROM "Order" od WHERE od."customerId" = c.id AND od.status::text NOT IN ('CANCELLED','PENDING') AND od.penjualan_karyawan_id IS NULL) AS n_order,
       EXISTS (SELECT 1 FROM "ClickEvent" k WHERE k."matchedCustomerId" = c.id) AS ada_klik_terkait
  FROM "Customer" c WHERE c."leadSource"::text = 'OTHER' OR c."leadSource" IS NULL
)
SELECT detail_kelas, count(*) cust, count(*) FILTER (WHERE n_order > 0) cust_order, count(*) FILTER (WHERE stage='SPAM') spam, count(*) FILTER (WHERE staf) staf, count(*) FILTER (WHERE konf) konfirmasi_manual FROM o GROUP BY 1 ORDER BY 2 DESC;
\echo == F. Other: bukti awal
WITH o AS (
SELECT c.id, c."createdAt", c."pipelineStage"::text AS stage, c."leadSource"::text AS ls, c."leadSourceConfirmed" AS konf,
       (c.is_internal_staff OR c.staff_user_id IS NOT NULL) AS staf, c.ctwa_clid IS NOT NULL AS ada_clid, c.ctwa_source_url IS NOT NULL AS ada_url,
       CASE WHEN c."leadSourceDetail" IS NULL OR btrim(c."leadSourceDetail") = '' THEN 'kosong'
            WHEN c."leadSourceDetail" ILIKE 'Dimulai manual oleh sales%' THEN 'mulai_chat_sales'
            WHEN c."leadSourceDetail" ILIKE 'Profil internal karyawan%' THEN 'profil_karyawan'
            WHEN c."leadSourceDetail" ILIKE 'Website - %' THEN 'website_tag_sumber_lain'
            WHEN c."leadSourceDetail" ILIKE 'Meta Ads%' THEN 'meta_ads_teks'
            ELSE 'teks_lain' END AS detail_kelas,
       (SELECT count(*) FROM "Conversation" v WHERE v."customerId" = c.id) AS n_conv,
       (SELECT v.channel::text FROM "Conversation" v WHERE v."customerId" = c.id ORDER BY v."createdAt" LIMIT 1) AS channel1,
       (SELECT m.direction::text FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" WHERE v."customerId" = c.id ORDER BY m."createdAt", m.id LIMIT 1) AS arah_pesan_pertama,
       (SELECT count(*) FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" WHERE v."customerId" = c.id AND m.direction::text = 'INBOUND') AS n_inbound,
       (SELECT count(*) FROM "Order" od WHERE od."customerId" = c.id AND od.status::text NOT IN ('CANCELLED','PENDING') AND od.penjualan_karyawan_id IS NULL) AS n_order,
       EXISTS (SELECT 1 FROM "ClickEvent" k WHERE k."matchedCustomerId" = c.id) AS ada_klik_terkait
  FROM "Customer" c WHERE c."leadSource"::text = 'OTHER' OR c."leadSource" IS NULL
)
SELECT coalesce(arah_pesan_pertama,'<tanpa pesan>') AS pesan_pertama, coalesce(channel1,'<tanpa conv>') AS channel, count(*) cust, count(*) FILTER (WHERE n_inbound > 0) ada_inbound, count(*) FILTER (WHERE ada_clid) ada_clid, count(*) FILTER (WHERE ada_url) ada_url, count(*) FILTER (WHERE ada_klik_terkait) ada_klik, count(*) FILTER (WHERE n_order > 0) cust_order FROM o GROUP BY 1,2 ORDER BY 3 DESC;
\echo == G. Other per bulan WIB x kelas
WITH o AS (
SELECT c.id, c."createdAt", c."pipelineStage"::text AS stage, c."leadSource"::text AS ls, c."leadSourceConfirmed" AS konf,
       (c.is_internal_staff OR c.staff_user_id IS NOT NULL) AS staf, c.ctwa_clid IS NOT NULL AS ada_clid, c.ctwa_source_url IS NOT NULL AS ada_url,
       CASE WHEN c."leadSourceDetail" IS NULL OR btrim(c."leadSourceDetail") = '' THEN 'kosong'
            WHEN c."leadSourceDetail" ILIKE 'Dimulai manual oleh sales%' THEN 'mulai_chat_sales'
            WHEN c."leadSourceDetail" ILIKE 'Profil internal karyawan%' THEN 'profil_karyawan'
            WHEN c."leadSourceDetail" ILIKE 'Website - %' THEN 'website_tag_sumber_lain'
            WHEN c."leadSourceDetail" ILIKE 'Meta Ads%' THEN 'meta_ads_teks'
            ELSE 'teks_lain' END AS detail_kelas,
       (SELECT count(*) FROM "Conversation" v WHERE v."customerId" = c.id) AS n_conv,
       (SELECT v.channel::text FROM "Conversation" v WHERE v."customerId" = c.id ORDER BY v."createdAt" LIMIT 1) AS channel1,
       (SELECT m.direction::text FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" WHERE v."customerId" = c.id ORDER BY m."createdAt", m.id LIMIT 1) AS arah_pesan_pertama,
       (SELECT count(*) FROM "Message" m JOIN "Conversation" v ON v.id = m."conversationId" WHERE v."customerId" = c.id AND m.direction::text = 'INBOUND') AS n_inbound,
       (SELECT count(*) FROM "Order" od WHERE od."customerId" = c.id AND od.status::text NOT IN ('CANCELLED','PENDING') AND od.penjualan_karyawan_id IS NULL) AS n_order,
       EXISTS (SELECT 1 FROM "ClickEvent" k WHERE k."matchedCustomerId" = c.id) AS ada_klik_terkait
  FROM "Customer" c WHERE c."leadSource"::text = 'OTHER' OR c."leadSource" IS NULL
)
SELECT to_char(("createdAt" + interval '7 hours'),'YYYY-MM') bulan, detail_kelas, count(*) FROM o GROUP BY 1,2 ORDER BY 1,2;
\echo == H. total customer
SELECT count(*) total_customer, to_char(min("createdAt" + interval '7 hours'),'YYYY-MM-DD') pertama_wib, to_char(max("createdAt" + interval '7 hours'),'YYYY-MM-DD') terakhir_wib FROM "Customer";
COMMIT;
