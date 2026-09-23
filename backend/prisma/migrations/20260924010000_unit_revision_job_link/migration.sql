-- Provenance UnitRevision -> Job, APPEND-ONLY (audit insentif, 24 September
-- 2026). Lihat komentar panjang di schema.prisma model UnitRevisionJobLink.
-- CreateTable
CREATE TABLE "unit_revision_job_links" (
    "id" UUID NOT NULL,
    "unit_revision_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "role" "JobType" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unit_revision_job_links_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "unit_revision_job_links_job_id_key" ON "unit_revision_job_links"("job_id");

-- CreateIndex
CREATE INDEX "unit_revision_job_links_unit_revision_id_idx" ON "unit_revision_job_links"("unit_revision_id");

-- CreateIndex
CREATE UNIQUE INDEX "unit_revision_job_links_unit_revision_id_job_id_key" ON "unit_revision_job_links"("unit_revision_id", "job_id");

-- AddForeignKey
ALTER TABLE "unit_revision_job_links" ADD CONSTRAINT "unit_revision_job_links_unit_revision_id_fkey" FOREIGN KEY ("unit_revision_id") REFERENCES "unit_revisions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unit_revision_job_links" ADD CONSTRAINT "unit_revision_job_links_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
