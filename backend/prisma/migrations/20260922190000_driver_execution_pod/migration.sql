ALTER TABLE "jobs"
  ADD COLUMN "proof_recipient_name" TEXT,
  ADD COLUMN "proof_note" TEXT,
  ADD COLUMN "proof_lat" DOUBLE PRECISION,
  ADD COLUMN "proof_lng" DOUBLE PRECISION,
  ADD COLUMN "proof_accuracy" DOUBLE PRECISION,
  ADD COLUMN "completed_by" TEXT;

ALTER TABLE "routes"
  ADD COLUMN "started_at" TIMESTAMP(3),
  ADD COLUMN "completed_at" TIMESTAMP(3);

ALTER TABLE "User"
  ADD COLUMN "driver_pending_sync_count" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "driver_pending_sync_at" TIMESTAMP(3);

CREATE TABLE "delivery_execution_events" (
  "id" UUID NOT NULL,
  "idempotency_key" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "actor_id" TEXT,
  "job_id" UUID,
  "route_id" UUID,
  "payload" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "delivery_execution_events_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "delivery_execution_events_idempotency_key_key"
  ON "delivery_execution_events"("idempotency_key");
CREATE INDEX "delivery_execution_events_job_id_created_at_idx"
  ON "delivery_execution_events"("job_id", "created_at");
CREATE INDEX "delivery_execution_events_route_id_created_at_idx"
  ON "delivery_execution_events"("route_id", "created_at");
CREATE INDEX "delivery_execution_events_actor_id_created_at_idx"
  ON "delivery_execution_events"("actor_id", "created_at");

ALTER TABLE "jobs"
  ADD CONSTRAINT "jobs_completed_by_fkey"
  FOREIGN KEY ("completed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "delivery_execution_events"
  ADD CONSTRAINT "delivery_execution_events_actor_id_fkey"
  FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_execution_events"
  ADD CONSTRAINT "delivery_execution_events_job_id_fkey"
  FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "delivery_execution_events"
  ADD CONSTRAINT "delivery_execution_events_route_id_fkey"
  FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE SET NULL ON UPDATE CASCADE;
