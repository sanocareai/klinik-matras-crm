-- Pengajuan Biaya Lintas Divisi (ExpenseSubmission) — pilot Delivery.
-- Aditif murni: enum baru, 2 nilai enum FinDivision baru (MARKETING, HR_GA), 4 tabel baru.
-- TIDAK menyentuh kolom/tabel yang sudah ada (fin_expenses, vehicle_expenses, dst) selain
-- menambah relasi FK yang MENUNJUK ke tabel lama (arahnya masuk, bukan keluar/mengubah).
-- Hand-crafted dari `prisma migrate diff` dan disaring HANYA untuk statement milik slice
-- ini — drift lain yang ikut muncul di diff mentah (DROP INDEX/ALTER COLUMN DROP DEFAULT
-- di tabel tak terkait) SENGAJA tidak disertakan di sini, bukan bagian dari perubahan ini.

-- CreateEnum
CREATE TYPE "ExpenseSubmissionStatus" AS ENUM ('DRAFT', 'DIAJUKAN', 'MENUNGGU_PERSETUJUAN', 'DISETUJUI', 'DIBAYAR', 'DITOLAK', 'DIBATALKAN');

-- AlterEnum
ALTER TYPE "FinDivision" ADD VALUE 'MARKETING';
ALTER TYPE "FinDivision" ADD VALUE 'HR_GA';

-- CreateTable
CREATE TABLE "expense_submissions" (
    "id" UUID NOT NULL,
    "submission_number" TEXT NOT NULL,
    "division" "FinDivision" NOT NULL,
    "cost_center" TEXT,
    "requested_by" TEXT NOT NULL,
    "pic_user_id" TEXT,
    "pic_name_snapshot" TEXT,
    "expense_type" VARCHAR(40) NOT NULL,
    "date" DATE NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "notes" TEXT,
    "job_id" UUID,
    "route_id" UUID,
    "vehicle_id" UUID,
    "driver_id" TEXT,
    "helper_id" TEXT,
    "order_id" TEXT,
    "vehicle_expense_id" UUID,
    "vehicle_plate_snapshot" TEXT,
    "driver_name_snapshot" TEXT,
    "helper_name_snapshot" TEXT,
    "route_name_snapshot" TEXT,
    "metadata" JSONB,
    "payment_method" TEXT,
    "vendor_name" TEXT,
    "status" "ExpenseSubmissionStatus" NOT NULL DEFAULT 'DRAFT',
    "submitted_at" TIMESTAMP(3),
    "withdrawn_at" TIMESTAMP(3),
    "fin_expense_id" UUID,
    "idempotency_key" TEXT,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "expense_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_submission_proofs" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "uploaded_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "expense_submission_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_submission_audits" (
    "id" UUID NOT NULL,
    "submission_id" UUID NOT NULL,
    "field" TEXT NOT NULL,
    "before" TEXT,
    "after" TEXT,
    "reason" TEXT,
    "actor_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_submission_audits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expense_submission_templates" (
    "id" UUID NOT NULL,
    "owner_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "division" "FinDivision" NOT NULL,
    "payload" JSONB NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expense_submission_templates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "expense_submissions_submission_number_key" ON "expense_submissions"("submission_number");

-- CreateIndex
CREATE UNIQUE INDEX "expense_submissions_vehicle_expense_id_key" ON "expense_submissions"("vehicle_expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_submissions_fin_expense_id_key" ON "expense_submissions"("fin_expense_id");

-- CreateIndex
CREATE UNIQUE INDEX "expense_submissions_idempotency_key_key" ON "expense_submissions"("idempotency_key");

-- CreateIndex
CREATE INDEX "expense_submissions_division_status_idx" ON "expense_submissions"("division", "status");

-- CreateIndex
CREATE INDEX "expense_submissions_division_date_idx" ON "expense_submissions"("division", "date");

-- CreateIndex
CREATE INDEX "expense_submissions_status_date_idx" ON "expense_submissions"("status", "date");

-- CreateIndex
CREATE INDEX "expense_submissions_job_id_idx" ON "expense_submissions"("job_id");

-- CreateIndex
CREATE INDEX "expense_submissions_route_id_idx" ON "expense_submissions"("route_id");

-- CreateIndex
CREATE INDEX "expense_submissions_vehicle_id_idx" ON "expense_submissions"("vehicle_id");

-- CreateIndex
CREATE INDEX "expense_submissions_requested_by_idx" ON "expense_submissions"("requested_by");

-- CreateIndex
CREATE INDEX "expense_submission_proofs_submission_id_superseded_at_idx" ON "expense_submission_proofs"("submission_id", "superseded_at");

-- CreateIndex
CREATE INDEX "expense_submission_audits_submission_id_created_at_idx" ON "expense_submission_audits"("submission_id", "created_at");

-- CreateIndex
CREATE INDEX "expense_submission_templates_owner_id_division_idx" ON "expense_submission_templates"("owner_id", "division");

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_pic_user_id_fkey" FOREIGN KEY ("pic_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_vehicle_id_fkey" FOREIGN KEY ("vehicle_id") REFERENCES "vehicles"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_driver_id_fkey" FOREIGN KEY ("driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_helper_id_fkey" FOREIGN KEY ("helper_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_vehicle_expense_id_fkey" FOREIGN KEY ("vehicle_expense_id") REFERENCES "vehicle_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_fin_expense_id_fkey" FOREIGN KEY ("fin_expense_id") REFERENCES "fin_expenses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submissions" ADD CONSTRAINT "expense_submissions_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submission_proofs" ADD CONSTRAINT "expense_submission_proofs_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "expense_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submission_proofs" ADD CONSTRAINT "expense_submission_proofs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submission_audits" ADD CONSTRAINT "expense_submission_audits_submission_id_fkey" FOREIGN KEY ("submission_id") REFERENCES "expense_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submission_audits" ADD CONSTRAINT "expense_submission_audits_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expense_submission_templates" ADD CONSTRAINT "expense_submission_templates_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
