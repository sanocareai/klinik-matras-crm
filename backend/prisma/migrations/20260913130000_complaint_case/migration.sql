-- CreateEnum
CREATE TYPE "ComplaintCategory" AS ENUM ('KUALITAS_PRODUK', 'KENYAMANAN', 'KETERLAMBATAN', 'KERUSAKAN_TRANSIT', 'SALAH_SPESIFIKASI', 'LAYANAN_STAF', 'LAINNYA');

-- CreateEnum
CREATE TYPE "ComplaintSeverity" AS ENUM ('RENDAH', 'SEDANG', 'TINGGI', 'KRITIS');

-- CreateEnum
CREATE TYPE "ComplaintWarrantyStatus" AS ENUM ('BELUM_DITENTUKAN', 'DALAM_GARANSI', 'DILUAR_GARANSI');

-- CreateEnum
CREATE TYPE "ComplaintOwner" AS ENUM ('SALES', 'DELIVERY', 'PRODUCTION', 'WAREHOUSE', 'QC');

-- CreateEnum
CREATE TYPE "ComplaintStatus" AS ENUM ('BARU', 'VERIFIKASI', 'INVESTIGASI', 'ACTION_REQUIRED', 'DIJADWALKAN', 'DALAM_PENANGANAN', 'QC', 'SIAP_DIKIRIM', 'DIKIRIM_ULANG', 'KONFIRMASI_CUSTOMER', 'SELESAI', 'MENUNGGU_CUSTOMER', 'MENUNGGU_MATERIAL', 'MENUNGGU_JADWAL', 'DIBATALKAN');

-- AlterEnum
ALTER TYPE "IssueSourceType" ADD VALUE 'COMPLAINT_REWORK';

-- AlterTable
ALTER TABLE "jobs" ADD COLUMN     "complaint_case_id" UUID;

-- AlterTable
ALTER TABLE "material_issues" ADD COLUMN     "complaint_case_id" UUID;

-- AlterTable
ALTER TABLE "unit_revisions" ADD COLUMN     "complaint_case_id" UUID;

-- CreateTable
CREATE TABLE "complaint_cases" (
    "id" UUID NOT NULL,
    "case_number" TEXT NOT NULL,
    "order_id" TEXT NOT NULL,
    "unit_id" UUID,
    "category" "ComplaintCategory" NOT NULL,
    "severity" "ComplaintSeverity" NOT NULL DEFAULT 'SEDANG',
    "warranty_status" "ComplaintWarrantyStatus" NOT NULL DEFAULT 'BELUM_DITENTUKAN',
    "description" TEXT NOT NULL,
    "root_cause" TEXT,
    "resolution" TEXT,
    "resolution_cost" INTEGER,
    "attachment_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ComplaintStatus" NOT NULL DEFAULT 'BARU',
    "current_owner" "ComplaintOwner" NOT NULL DEFAULT 'SALES',
    "target_completion_at" TIMESTAMP(3),
    "customer_confirmed_at" TIMESTAMP(3),
    "customer_confirmed_by" TEXT,
    "cancel_reason" TEXT,
    "qc_fit_test_id" UUID,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "complaint_cases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "complaint_cases_case_number_key" ON "complaint_cases"("case_number");

-- CreateIndex
CREATE INDEX "complaint_cases_order_id_idx" ON "complaint_cases"("order_id");

-- CreateIndex
CREATE INDEX "complaint_cases_unit_id_idx" ON "complaint_cases"("unit_id");

-- CreateIndex
CREATE INDEX "complaint_cases_status_idx" ON "complaint_cases"("status");

-- CreateIndex
CREATE INDEX "complaint_cases_current_owner_idx" ON "complaint_cases"("current_owner");

-- CreateIndex
CREATE INDEX "complaint_cases_created_at_idx" ON "complaint_cases"("created_at");

-- CreateIndex
CREATE INDEX "jobs_complaint_case_id_idx" ON "jobs"("complaint_case_id");

-- CreateIndex
CREATE INDEX "material_issues_complaint_case_id_idx" ON "material_issues"("complaint_case_id");

-- CreateIndex
CREATE INDEX "unit_revisions_complaint_case_id_idx" ON "unit_revisions"("complaint_case_id");

-- AddForeignKey
ALTER TABLE "jobs" ADD CONSTRAINT "jobs_complaint_case_id_fkey" FOREIGN KEY ("complaint_case_id") REFERENCES "complaint_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_revisions" ADD CONSTRAINT "unit_revisions_complaint_case_id_fkey" FOREIGN KEY ("complaint_case_id") REFERENCES "complaint_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_cases" ADD CONSTRAINT "complaint_cases_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_cases" ADD CONSTRAINT "complaint_cases_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_cases" ADD CONSTRAINT "complaint_cases_customer_confirmed_by_fkey" FOREIGN KEY ("customer_confirmed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_cases" ADD CONSTRAINT "complaint_cases_qc_fit_test_id_fkey" FOREIGN KEY ("qc_fit_test_id") REFERENCES "qc_fit_tests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "complaint_cases" ADD CONSTRAINT "complaint_cases_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "material_issues" ADD CONSTRAINT "material_issues_complaint_case_id_fkey" FOREIGN KEY ("complaint_case_id") REFERENCES "complaint_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;
