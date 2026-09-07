-- Production Core Slice 1 (6 September 2026) — activity_events: linimasa +
-- audit LINTAS ENTITAS. Lihat catatan panjang di schema.prisma model
-- ActivityEvent untuk kenapa ini TIDAK menggantikan unit_stage_logs dkk.
--
-- Tabel BARU, tidak menyentuh data yang sudah ada. entityType/entityId
-- generik (bukan FK) SENGAJA — lihat lib/activityLog.js.
--
-- Rollback manual:
--   DROP TABLE "activity_events";

-- CreateTable
CREATE TABLE "activity_events" (
    "id"          UUID NOT NULL DEFAULT gen_random_uuid(),
    "entity_type" TEXT NOT NULL,
    "entity_id"   TEXT NOT NULL,
    "event_type"  TEXT NOT NULL,
    "actor_type"  TEXT NOT NULL DEFAULT 'USER',
    "actor_id"    TEXT,
    "metadata"    JSONB NOT NULL DEFAULT '{}',
    "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "activity_events_entity_type_entity_id_created_at_idx" ON "activity_events"("entity_type", "entity_id", "created_at");

-- CreateIndex
CREATE INDEX "activity_events_event_type_created_at_idx" ON "activity_events"("event_type", "created_at");
