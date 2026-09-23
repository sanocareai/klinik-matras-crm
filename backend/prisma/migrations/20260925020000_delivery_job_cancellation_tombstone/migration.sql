-- Immutable Delivery Job cancellation ledger.
-- V1 jobs and every historical proof/reference remain in place.
CREATE TABLE "delivery_job_cancellations_v2" (
  "id" UUID NOT NULL,
  "job_id" UUID NOT NULL,
  "order_id" TEXT NOT NULL,
  "previous_status" TEXT NOT NULL,
  "previous_route_id" UUID,
  "previous_driver_id" TEXT,
  "previous_helper_id" TEXT,
  "previous_vehicle_id" UUID,
  "reason" TEXT NOT NULL,
  "actor_id" TEXT,
  "cancelled_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "delivery_job_cancellations_v2_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "delivery_job_cancellations_v2_job_id_key" UNIQUE ("job_id"),
  CONSTRAINT "delivery_job_cancellations_v2_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE INDEX "delivery_job_cancellations_v2_order_id_cancelled_at_idx"
  ON "delivery_job_cancellations_v2"("order_id", "cancelled_at");
CREATE INDEX "delivery_job_cancellations_v2_actor_id_cancelled_at_idx"
  ON "delivery_job_cancellations_v2"("actor_id", "cancelled_at");

CREATE OR REPLACE FUNCTION prevent_delivery_job_cancellation_mutation()
RETURNS TRIGGER AS $$
BEGIN
  RAISE EXCEPTION 'delivery_job_cancellations_v2 is immutable';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "delivery_job_cancellations_v2_immutable"
BEFORE UPDATE OR DELETE ON "delivery_job_cancellations_v2"
FOR EACH ROW EXECUTE FUNCTION prevent_delivery_job_cancellation_mutation();
