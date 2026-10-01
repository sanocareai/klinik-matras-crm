-- P9D — Diagnosis Produksi + Planned BOM Terpadu. Murni ADDITIVE: reuse diagnosis_reports_v2 (dormant sejak
-- P8, tidak pernah ditulis kode apa pun) apa adanya + 2 kolom baru (revision, recorded_at) + FK yang sebelumnya
-- cuma UUID lepas (recommended_service_id) + 1 tabel baru (diagnosis_manual_materials_v2, bahan noncatalog).
-- TIDAK ADA ALTER/DROP terhadap tabel/kolom/index/constraint apa pun di luar yang disebut di atas.
--
-- CATATAN: `prisma migrate dev --create-only` terhadap schema.prisma di commit basis P9C (7afc1709) juga
-- menghasilkan sejumlah DROP CONSTRAINT/DROP INDEX/ALTER COLUMN di tabel LAIN yang P9D sama sekali tidak
-- sentuh (production_step_evidence_v2, production_material_shortages_v2, fin_journal_lines, material_issues,
-- planned_bom_lines_v2 index lama, quality_inspections_v2, activity_events, job_position_pings,
-- vehicle_expenses/incidents/services) — diverifikasi ULANG di database scratch yang BENAR-BENAR baru (bukan
-- sisa sesi lama), hasilnya SAMA persis. Ini DRIFT PRA-ADA antara schema.prisma dan riwayat migrasi yang
-- sudah ada SEBELUM P9D (kemungkinan perubahan skema yang pernah diterapkan langsung ke produksi di luar
-- jalur migrasi resmi). SENGAJA DIBUANG dari migration ini — P9D tidak berwenang/tidak diminta memperbaiki
-- drift itu, dan mengikutkannya diam-diam akan memutasi tabel yang eksplisit dilarang disentuh tugas ini.
-- Dilaporkan terpisah ke pemilik repo, bukan diperbaiki di sini.

-- CreateEnum
CREATE TYPE "DiagnosisManualMaterialStatus" AS ENUM ('NEEDS_MAPPING', 'MAPPED');

-- AlterTable
ALTER TABLE "diagnosis_reports_v2" ADD COLUMN     "recorded_at" TIMESTAMP(3),
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1;

-- CreateTable
CREATE TABLE "diagnosis_manual_materials_v2" (
    "id" UUID NOT NULL,
    "diagnosis_report_id" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "estimated_unit" TEXT,
    "qty" DECIMAL(12,4) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "DiagnosisManualMaterialStatus" NOT NULL DEFAULT 'NEEDS_MAPPING',
    "mapped_material_id" UUID,
    "mapped_qty" DECIMAL(12,4),
    "mapped_by_id" TEXT,
    "mapped_at" TIMESTAMP(3),
    "bom_line_id" UUID,
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "diagnosis_manual_materials_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "diagnosis_manual_materials_v2_diagnosis_report_id_status_idx" ON "diagnosis_manual_materials_v2"("diagnosis_report_id", "status");

-- AddForeignKey
ALTER TABLE "diagnosis_reports_v2" ADD CONSTRAINT "diagnosis_reports_v2_recommended_service_id_fkey" FOREIGN KEY ("recommended_service_id") REFERENCES "service_catalog"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_manual_materials_v2" ADD CONSTRAINT "diagnosis_manual_materials_v2_diagnosis_report_id_fkey" FOREIGN KEY ("diagnosis_report_id") REFERENCES "diagnosis_reports_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_manual_materials_v2" ADD CONSTRAINT "diagnosis_manual_materials_v2_mapped_material_id_fkey" FOREIGN KEY ("mapped_material_id") REFERENCES "materials"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_manual_materials_v2" ADD CONSTRAINT "diagnosis_manual_materials_v2_bom_line_id_fkey" FOREIGN KEY ("bom_line_id") REFERENCES "planned_bom_lines_v2"("id") ON DELETE SET NULL ON UPDATE CASCADE;
