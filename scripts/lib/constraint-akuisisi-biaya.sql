-- Uji constraint migrasi biaya sumber pada RESTORE disposable. Tiap pernyataan melanggar satu aturan; PASS = ditolak DB. Semua di pg_temp + dibatalkan (ROLLBACK).
BEGIN;
CREATE FUNCTION pg_temp.tolak(nama text, stmt text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE stmt; RAISE NOTICE 'FAIL   % (tidak ditolak)', nama;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'PASS   % [%]', nama, SQLSTATE; END;
END $f$;
CREATE FUNCTION pg_temp.terima(nama text, stmt text) RETURNS void LANGUAGE plpgsql AS $f$
BEGIN
  BEGIN EXECUTE stmt; RAISE NOTICE 'PASS   % (diterima)', nama;
  EXCEPTION WHEN OTHERS THEN RAISE NOTICE 'FAIL   % (ditolak: %)', nama, SQLERRM; END;
END $f$;

SELECT pg_temp.terima('entri HARIAN sah', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES ('00000000-0000-4000-8000-000000000001','TIKTOK','HARIAN','2026-08-01','2026-08-01',150000,'FIXTURE uji',now())$$);
SELECT pg_temp.tolak('sumber organik (WHATSAPP)', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'WHATSAPP','HARIAN','2026-08-02','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('sumber huruf kecil', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'tiktok','HARIAN','2026-08-02','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('jenis tidak dikenal', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','BULANAN','2026-08-02','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('status tidak dikenal', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,status,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02',1,'HAPUS','x',now())$$);
SELECT pg_temp.tolak('nominal negatif', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02',-1,'x',now())$$);
SELECT pg_temp.tolak('mata uang selain IDR', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,currency,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02','USD',1,'x',now())$$);
SELECT pg_temp.tolak('tanggal terbalik', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','TOTAL_RENTANG','2026-08-05','2026-08-02',1,'x',now())$$);
SELECT pg_temp.tolak('HARIAN dengan dua tanggal', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-03',1,'x',now())$$);
SELECT pg_temp.tolak('override untuk sumber non-META', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,override_ad_detail,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-02','2026-08-02',1,true,'x',now())$$);
SELECT pg_temp.terima('override META sah', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,override_ad_detail,reason,updated_at) VALUES ('00000000-0000-4000-8000-000000000002','META','HARIAN','2026-08-02','2026-08-02',1,true,'FIXTURE uji',now())$$);
SELECT pg_temp.tolak('kunci unik ganda (sumber,jenis,dari,sampai,akun)', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-01','2026-08-01',9,'x',now())$$);
SELECT pg_temp.terima('akun berbeda = kunci berbeda', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,account_id,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-01','2026-08-01','123456',9,'FIXTURE uji',now())$$);
SELECT pg_temp.tolak('alasan kosong (NOT NULL)', $$INSERT INTO ad_source_spend_entries (id,source_id,kind,date_from,date_to,amount,reason,updated_at) VALUES (gen_random_uuid(),'TIKTOK','HARIAN','2026-08-09','2026-08-09',1,NULL,now())$$);
SELECT pg_temp.terima('revisi sah (BUAT)', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,prev_amount,new_amount,prev_status,new_status,prev_override,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000001',1,'BUAT',NULL,150000,NULL,'AKTIF',NULL,false,'FIXTURE uji')$$);
SELECT pg_temp.tolak('revisi ganda nomor sama (unik entry,revisi)', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,prev_amount,new_amount,prev_status,new_status,prev_override,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000001',1,'UBAH',150000,1,'AKTIF','AKTIF',false,false,'x')$$);
SELECT pg_temp.tolak('revisi yatim (FK entry tidak ada)', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,new_amount,new_status,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-0000000000ff',1,'BUAT',1,'AKTIF',false,'x')$$);
SELECT pg_temp.tolak('aksi revisi tidak dikenal', $$INSERT INTO ad_source_spend_revisions (id,entry_id,revision,action,new_amount,new_status,new_override,reason) VALUES (gen_random_uuid(),'00000000-0000-4000-8000-000000000001',2,'HAPUS',1,'AKTIF',false,'x')$$);
SELECT pg_temp.tolak('UPDATE revisi (append-only)', $$UPDATE ad_source_spend_revisions SET reason='diubah'$$);
SELECT pg_temp.tolak('DELETE revisi (append-only)', $$DELETE FROM ad_source_spend_revisions$$);
SELECT pg_temp.tolak('hapus entri yang punya revisi ditolak (FK RESTRICT)', $$DELETE FROM ad_source_spend_entries WHERE id='00000000-0000-4000-8000-000000000001'$$);
SELECT pg_temp.terima('hapus entri TANPA revisi (tidak ada jejak yang hilang)', $$DELETE FROM ad_source_spend_entries WHERE id='00000000-0000-4000-8000-000000000002'$$);
ROLLBACK;
