-- Fase 3 Produksi LAYANAN (analisis & racikan): seksi RENCANA (PLAN_RACIKAN) ditambahkan ke Catatan Komponen. ADITIF — hanya MELEBARKAN CHECK seksi; tidak ada data diubah/dihapus.
-- (DROP CONSTRAINT hanya menggantikan aturan CHECK yang sama dengan daftar lebih lebar dalam satu transaksi migrasi; baris yang ada tetap valid.)
ALTER TABLE "unit_component_entries_v2" DROP CONSTRAINT "unit_component_entries_v2_section_check";
ALTER TABLE "unit_component_entries_v2" ADD CONSTRAINT "unit_component_entries_v2_section_check"
  CHECK ("section" IN ('LAYERS_BEFORE', 'FOUNDATION_BEFORE', 'AFTER', 'WHOLE_TEST_BEFORE', 'FOUNDATION_TEST_BEFORE', 'PLAN_RACIKAN'));
