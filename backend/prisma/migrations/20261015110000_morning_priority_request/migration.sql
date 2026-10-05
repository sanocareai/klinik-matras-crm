-- CreateEnum
CREATE TYPE "MorningPriorityStatus" AS ENUM ('PENDING', 'APPROVED', 'DISMISSED');

-- CreateTable
CREATE TABLE "morning_priority_requests" (
    "id"                   UUID    NOT NULL,
    "order_id"             TEXT    NOT NULL,
    "requested_by_id"      TEXT    NOT NULL,
    "note"                 TEXT,
    "suggested_priority"   "ProductionPriority" NOT NULL DEFAULT 'HIGH',
    "status"               "MorningPriorityStatus" NOT NULL DEFAULT 'PENDING',
    "decided_by_id"        TEXT,
    "decided_at"           TIMESTAMP(3),
    "applied_priority"     "ProductionPriority",
    "created_at"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "morning_priority_requests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "morning_priority_requests_order_id_idx" ON "morning_priority_requests"("order_id");

-- CreateIndex
CREATE INDEX "morning_priority_requests_status_idx" ON "morning_priority_requests"("status");

-- AddForeignKey (Restrict — sama alasan dengan FK Unit/ScopeRevision -> Order: order dengan riwayat
-- usulan prioritas tidak boleh terhapus diam-diam).
ALTER TABLE "morning_priority_requests" ADD CONSTRAINT "morning_priority_requests_order_id_fkey"
    FOREIGN KEY ("order_id") REFERENCES "Order"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "morning_priority_requests" ADD CONSTRAINT "morning_priority_requests_requested_by_id_fkey"
    FOREIGN KEY ("requested_by_id") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "morning_priority_requests" ADD CONSTRAINT "morning_priority_requests_decided_by_id_fkey"
    FOREIGN KEY ("decided_by_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
