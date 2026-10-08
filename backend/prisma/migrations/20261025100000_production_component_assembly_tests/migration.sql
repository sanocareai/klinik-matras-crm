-- Fase 4 Produksi LAYANAN (perakitan -> uji hasil): seksi UJI SETELAH PERBAIKAN (FOUNDATION_TEST_AFTER, WHOLE_TEST_AFTER) ditambahkan ke Catatan Komponen. ADITIF — hanya MELEBARKAN CHECK seksi; tidak ada data diubah/dihapus.
-- (DROP CONSTRAINT hanya menggantikan aturan CHECK yang sama dengan daftar lebih lebar dalam satu transaksi migrasi; baris yang ada tetap valid.)
ALTER TABLE "unit_component_entries_v2" DROP CONSTRAINT "unit_component_entries_v2_section_check";
ALTER TABLE "unit_component_entries_v2" ADD CONSTRAINT "unit_component_entries_v2_section_check"
  CHECK ("section" IN ('LAYERS_BEFORE', 'FOUNDATION_BEFORE', 'AFTER', 'WHOLE_TEST_BEFORE', 'FOUNDATION_TEST_BEFORE', 'PLAN_RACIKAN', 'FOUNDATION_TEST_AFTER', 'WHOLE_TEST_AFTER'));
