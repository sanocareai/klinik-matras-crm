-- C1 Pengajuan Biaya Produksi & Warehouse — ADITIF (kolom opsional + FK SET NULL + indeks). Tidak mengubah data/kolom lama.
ALTER TABLE "expense_submissions"
  ADD COLUMN "unit_id" UUID,
  ADD COLUMN "work_center_id" UUID,
  ADD COLUMN "warehouse_id" UUID,
  ADD COLUMN "material_id" UUID,
  ADD COLUMN "document_ref" TEXT;

CREATE INDEX "expense_submissions_unit_id_idx" ON "expense_submissions"("unit_id");
CREATE INDEX "expense_submissions_work_center_id_idx" ON "expense_submissions"("work_center_id");
CREATE INDEX "expense_submissions_warehouse_id_idx" ON "expense_submissions"("warehouse_id");
CREATE INDEX "expense_submissions_document_ref_idx" ON "expense_submissions"("document_ref");

ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_work_center_id_fkey" FOREIGN KEY ("work_center_id") REFERENCES "work_centers"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_warehouse_id_fkey" FOREIGN KEY ("warehouse_id") REFERENCES "warehouses"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_material_id_fkey" FOREIGN KEY ("material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Kategori pengeluaran bawaan untuk Pengajuan Biaya Gudang (C1). Memakai akun resmi 6-1900 yang SUDAH ada — tidak membuat akun baru.
-- Idempoten (hanya bila kode belum ada dan akun tujuan ada). Finance boleh mengarahkan kategori ini ke akun lain lewat Pengaturan.
INSERT INTO "fin_expense_categories" ("id", "code", "name", "account_id", "division", "active", "created_at", "updated_at")
SELECT gen_random_uuid(), v.code, v.name, a."id", 'GUDANG'::"FinDivision", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM (VALUES
  ('BONGKAR_MUAT_GUDANG', 'Bongkar Muat Gudang'),
  ('PERAWATAN_FASILITAS_GUDANG', 'Perawatan Fasilitas Gudang'),
  ('BIAYA_GUDANG_MENDESAK', 'Biaya Operasional Gudang Mendesak')
) AS v(code, name)
JOIN "fin_accounts" a ON a."code" = '6-1900'
WHERE NOT EXISTS (SELECT 1 FROM "fin_expense_categories" c WHERE c."code" = v.code);
