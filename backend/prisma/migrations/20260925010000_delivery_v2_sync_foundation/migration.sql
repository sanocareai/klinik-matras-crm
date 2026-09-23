-- Chunk 1 additive extension: canonical route draft state.
-- No V1 column/table is changed or removed.
ALTER TABLE "delivery_route_states_v2"
  ADD COLUMN "lifecycle_status" TEXT NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "draft_snapshot" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "draft_checksum" TEXT;

ALTER TABLE "delivery_job_states_v2"
  ADD COLUMN "migration_source" TEXT;
