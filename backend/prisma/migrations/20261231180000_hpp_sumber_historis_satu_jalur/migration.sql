-- SATU SUMBER HISTORIS = SATU JALUR (Nov 2026). ADITIF: dua fungsi + dua trigger; tidak mengubah kolom, data, stok, jurnal, saldo, atau cutover.
-- (1) Catatan pemakaian historis yang menjadi sumber biaya tanpa stok AKTIF (DIAJUKAN/DISETUJUI) tidak boleh diposting menjadi pengeluaran stok (link POSTING_HISTORIS),
--     apa pun keadaan pengaman SO-nya (tautan dibatalkan / dinyatakan belum tercermin).
-- (2) Biaya tanpa stok bersumber catatan tidak boleh menjadi aktif bila catatannya sudah tertaut ke pengeluaran stok. Baris catatan DIKUNCI (FOR UPDATE) sehingga pencatatan
--     biaya dan posting historis yang bersamaan saling menunggu: hanya satu jalur yang berhasil.
CREATE OR REPLACE FUNCTION uun_tolak_posting_sumber_biaya() RETURNS trigger AS $$
BEGIN
  IF NEW.stock_movement_id IS NOT NULL AND OLD.stock_movement_id IS NULL AND NEW.link_kind = 'POSTING_HISTORIS'
     AND EXISTS (SELECT 1 FROM "order_biaya_tanpa_stok" b WHERE b.sumber_jenis = 'CATATAN_HISTORIS' AND b.sumber_ref = NEW.id::text AND b.status IN ('DIAJUKAN','DISETUJUI')) THEN
    RAISE EXCEPTION 'catatan % sudah menjadi sumber biaya tanpa stok aktif; tidak boleh diposting ke stok (satu sumber satu jalur)', NEW.id;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER uun_tolak_posting_sumber_biaya BEFORE UPDATE OF stock_movement_id ON "unit_usage_notes" FOR EACH ROW EXECUTE FUNCTION uun_tolak_posting_sumber_biaya();

CREATE OR REPLACE FUNCTION obts_tolak_sumber_tertaut() RETURNS trigger AS $$
DECLARE tertaut UUID;
BEGIN
  IF NEW.sumber_jenis = 'CATATAN_HISTORIS' AND NEW.status IN ('DIAJUKAN','DISETUJUI') AND (TG_OP = 'INSERT' OR OLD.status IS DISTINCT FROM NEW.status) THEN
    SELECT n.stock_movement_id INTO tertaut FROM "unit_usage_notes" n WHERE n.id = NEW.sumber_ref::uuid FOR UPDATE;
    IF tertaut IS NOT NULL THEN
      RAISE EXCEPTION 'catatan sumber % sudah tertaut ke pengeluaran stok; biaya tanpa stok tidak boleh aktif (satu sumber satu jalur)', NEW.sumber_ref;
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
CREATE TRIGGER obts_tolak_sumber_tertaut BEFORE INSERT OR UPDATE OF status ON "order_biaya_tanpa_stok" FOR EACH ROW EXECUTE FUNCTION obts_tolak_sumber_tertaut();
