-- Pemakaian sementara tertaut ke bahan KATALOG (material_id diisi saat DICATAT, stok belum diketahui): tautan itu bagian dari fakta asal catatan dan TIDAK boleh diubah lewat SQL langsung.
-- Sebelumnya trigger unit_provisional_usages_guard hanya mengunci material_id SESUDAH status DIREKONSILIASI; selama PERLU_REKONSILIASI kolom ini masih bisa diubah.
-- Aturan baru (satu-satunya perubahan): material_id TIDAK boleh berubah, KECUALI rekonsiliasi TAUTKAN_ISSUE pada catatan yang belum bertaut bahan (NULL -> bahan milik pergerakan resmi yang ditautkan; wajib bersama stock_movement_id).
-- Koreksi tetap memakai catatan versi baru (baris lama dibatalkan, baris baru membawa material_id yang sama) — tidak mengubah baris lama.
-- Hanya mengganti isi fungsi penjaga (CREATE OR REPLACE); trigger, tabel, kolom, indeks, dan data TIDAK diubah. Aditif dan tanpa penulisan data.
CREATE OR REPLACE FUNCTION unit_provisional_usages_guard() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN RAISE EXCEPTION 'unit_provisional_usages tidak boleh dihapus (riwayat asal catatan)'; END IF;
  IF OLD.status = 'DIBATALKAN' OR (OLD.status = 'DIREKONSILIASI' AND NOT (OLD.resolution = 'TANPA_STOK' AND NEW.status = 'DIBATALKAN')) THEN RAISE EXCEPTION 'catatan pemakaian sementara sudah % : baris final', OLD.status; END IF;
  IF OLD.status = 'DIREKONSILIASI' AND (NEW.resolution IS DISTINCT FROM OLD.resolution OR NEW.resolved_by IS DISTINCT FROM OLD.resolved_by OR NEW.resolved_at IS DISTINCT FROM OLD.resolved_at OR NEW.resolution_note IS DISTINCT FROM OLD.resolution_note OR NEW.stock_movement_id IS DISTINCT FROM OLD.stock_movement_id OR NEW.material_id IS DISTINCT FROM OLD.material_id) THEN RAISE EXCEPTION 'riwayat penyelesaian tidak boleh berubah saat dibatalkan'; END IF;
  IF NEW.id <> OLD.id OR NEW.unit_id <> OLD.unit_id OR NEW.proposal_id IS DISTINCT FROM OLD.proposal_id OR NEW.name <> OLD.name OR NEW.name_key <> OLD.name_key OR NEW.qty <> OLD.qty OR NEW.uom <> OLD.uom
     OR NEW.origin_note IS DISTINCT FROM OLD.origin_note OR NEW.note IS DISTINCT FROM OLD.note OR NEW.used_at <> OLD.used_at OR NEW.recorded_by <> OLD.recorded_by OR NEW.recorded_at <> OLD.recorded_at
     OR NEW.idempotency_key IS DISTINCT FROM OLD.idempotency_key OR NEW.corrected_from_id IS DISTINCT FROM OLD.corrected_from_id THEN RAISE EXCEPTION 'kolom asal catatan pemakaian sementara tidak boleh diubah'; END IF;
  IF NEW.material_id IS DISTINCT FROM OLD.material_id
     AND NOT (OLD.material_id IS NULL AND NEW.status = 'DIREKONSILIASI' AND NEW.resolution = 'TAUTKAN_ISSUE' AND NEW.stock_movement_id IS NOT NULL) THEN
    RAISE EXCEPTION 'tautan bahan katalog (material_id) catatan pemakaian sementara tidak boleh diubah; koreksi memakai catatan versi baru';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;
