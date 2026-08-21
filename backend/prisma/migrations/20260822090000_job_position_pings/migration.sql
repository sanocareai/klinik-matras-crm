-- D-034 — Live Tracking nyata: ping GPS driver per job, menggantikan
-- simulasi trackingMock.js. Lihat komentar panjang di schema.prisma.
CREATE TABLE "job_position_pings" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "job_id" UUID NOT NULL,
    "driver_id" TEXT,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "accuracy" DOUBLE PRECISION,
    "recorded_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "job_position_pings_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "job_position_pings_job_id_recorded_at_idx" ON "job_position_pings"("job_id", "recorded_at");
CREATE INDEX "job_position_pings_driver_id_recorded_at_idx" ON "job_position_pings"("driver_id", "recorded_at");

ALTER TABLE "job_position_pings" ADD CONSTRAINT "job_position_pings_job_id_fkey"
    FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "job_position_pings" ADD CONSTRAINT "job_position_pings_driver_id_fkey"
    FOREIGN KEY ("driver_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
