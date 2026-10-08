-- CreateEnum
CREATE TYPE "RoutePrepChecklistScope" AS ENUM ('ROUTE', 'STOP');

-- AlterTable
ALTER TABLE "routes" ADD COLUMN     "prep_checklist_locked_at" TIMESTAMP(3),
ADD COLUMN     "prep_checklist_revision" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "route_prep_checklist_items" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "quantity" INTEGER,
    "scope" "RoutePrepChecklistScope" NOT NULL DEFAULT 'ROUTE',
    "job_id" UUID,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "photo_required" BOOLEAN NOT NULL DEFAULT true,
    "sort_order" INTEGER NOT NULL DEFAULT 0,
    "archived_at" TIMESTAMP(3),
    "revision" INTEGER NOT NULL DEFAULT 1,
    "created_by" TEXT,
    "updated_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "route_prep_checklist_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_prep_checklist_proofs" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "item_revision" INTEGER NOT NULL,
    "photo_url" TEXT,
    "note" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "idempotency_key" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "route_prep_checklist_proofs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "route_prep_checklist_items_route_id_archived_at_idx" ON "route_prep_checklist_items"("route_id", "archived_at");

-- CreateIndex
CREATE INDEX "route_prep_checklist_items_job_id_idx" ON "route_prep_checklist_items"("job_id");

-- CreateIndex
CREATE UNIQUE INDEX "route_prep_checklist_proofs_idempotency_key_key" ON "route_prep_checklist_proofs"("idempotency_key");

-- CreateIndex
CREATE INDEX "route_prep_checklist_proofs_item_id_item_revision_created_a_idx" ON "route_prep_checklist_proofs"("item_id", "item_revision", "created_at");

-- CreateIndex
CREATE INDEX "route_prep_checklist_proofs_route_id_idx" ON "route_prep_checklist_proofs"("route_id");

-- AddForeignKey
ALTER TABLE "route_prep_checklist_items" ADD CONSTRAINT "route_prep_checklist_items_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_prep_checklist_items" ADD CONSTRAINT "route_prep_checklist_items_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_prep_checklist_items" ADD CONSTRAINT "route_prep_checklist_items_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_prep_checklist_items" ADD CONSTRAINT "route_prep_checklist_items_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_prep_checklist_proofs" ADD CONSTRAINT "route_prep_checklist_proofs_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_prep_checklist_proofs" ADD CONSTRAINT "route_prep_checklist_proofs_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "route_prep_checklist_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_prep_checklist_proofs" ADD CONSTRAINT "route_prep_checklist_proofs_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
