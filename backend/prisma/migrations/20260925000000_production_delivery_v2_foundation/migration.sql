-- Production + Delivery V2 foundation.
-- ADDITIVE ONLY: tidak ada DROP/RENAME dan tidak mengubah kontrak Sales,
-- Warehouse, atau Finance. Semua feature flag dibuat OFF oleh seed terpisah.

-- CreateEnum
CREATE TYPE "V2MigrationRunStatus" AS ENUM ('PLANNED', 'RUNNING', 'VERIFIED', 'FAILED', 'ROLLED_BACK');

-- CreateEnum
CREATE TYPE "V2MigrationExceptionStatus" AS ENUM ('OPEN', 'RESOLVED', 'KEEP_V1', 'EXCLUDED_WITH_REASON');

-- CreateEnum
CREATE TYPE "V2ShadowComparisonStatus" AS ENUM ('MATCH', 'MISMATCH', 'ERROR');

-- CreateEnum
CREATE TYPE "DomainOutboxStatus" AS ENUM ('PENDING', 'PROCESSING', 'DELIVERED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProductionRunKind" AS ENUM ('RESTORATION', 'NEW_PRODUCT', 'FULFILLMENT_ONLY', 'REWORK');

-- CreateEnum
CREATE TYPE "ProductionRunStatus" AS ENUM ('PENDING_ARRIVAL', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'CANCELLED', 'MIGRATION_REVIEW');

-- CreateEnum
CREATE TYPE "ProductionPhaseKind" AS ENUM ('INTAKE', 'DIAGNOSIS', 'PROCESS', 'QC', 'HANDOFF');

-- CreateEnum
CREATE TYPE "ProductionPhaseRunStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'BLOCKED', 'COMPLETED', 'NOT_APPLICABLE', 'CANCELLED', 'MIGRATION_REVIEW');

-- CreateEnum
CREATE TYPE "ProductionOperationStatus" AS ENUM ('NOT_STARTED', 'ACTIVE', 'PAUSED', 'BLOCKED', 'COMPLETED', 'SKIPPED', 'FAILED');

-- CreateEnum
CREATE TYPE "DiagnosisReportStatus" AS ENUM ('DRAFT', 'RECORDED', 'APPROVED', 'SUPERSEDED');

-- CreateEnum
CREATE TYPE "QualityInspectionResult" AS ENUM ('PENDING', 'PASS', 'FAIL_REWORK', 'OVERRIDDEN');

-- CreateEnum
CREATE TYPE "ProductionHandoffStatus" AS ENUM ('DRAFT', 'OFFERED', 'ACCEPTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RoutePublicationStatus" AS ENUM ('ACTIVE', 'SUPERSEDED', 'REVOKED');

-- CreateEnum
CREATE TYPE "RouteStopAssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'REVOKED');

-- CreateEnum
CREATE TYPE "DriverSyncChangeKind" AS ENUM ('UPSERT_ROUTE', 'REMOVE_ROUTE', 'UPSERT_JOB', 'REMOVE_JOB', 'FULL_REFRESH_REQUIRED');

-- CreateEnum
CREATE TYPE "V2CommandStatus" AS ENUM ('PROCESSING', 'APPLIED', 'ALREADY_APPLIED', 'REJECTED_CONFLICT', 'REQUIRES_REVIEW');

-- CreateTable
CREATE TABLE "v2_feature_flags" (
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'GLOBAL',
    "config" JSONB NOT NULL DEFAULT '{}',
    "reason" TEXT,
    "updated_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "v2_feature_flags_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "v2_migration_runs" (
    "id" UUID NOT NULL,
    "kind" TEXT NOT NULL,
    "status" "V2MigrationRunStatus" NOT NULL DEFAULT 'PLANNED',
    "baseline_watermark" BIGINT,
    "catchup_watermark" BIGINT,
    "source_checksum" TEXT,
    "result_checksum" TEXT,
    "counts" JSONB NOT NULL DEFAULT '{}',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "v2_migration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v2_migration_exceptions" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT,
    "code" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" "V2MigrationExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "resolution" JSONB,
    "resolved_by_id" TEXT,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "v2_migration_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v2_shadow_comparisons" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "status" "V2ShadowComparisonStatus" NOT NULL,
    "v1_checksum" TEXT,
    "v2_checksum" TEXT,
    "differences" JSONB NOT NULL DEFAULT '[]',
    "compared_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "v2_shadow_comparisons_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "domain_outbox" (
    "id" BIGSERIAL NOT NULL,
    "event_id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_revision" INTEGER,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "DomainOutboxStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "available_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "locked_at" TIMESTAMP(3),
    "locked_by" TEXT,
    "delivered_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "domain_outbox_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "v2_commands" (
    "id" UUID NOT NULL,
    "domain" TEXT NOT NULL,
    "actor_id" TEXT,
    "idempotency_key" TEXT NOT NULL,
    "command_type" TEXT NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "expected_revision" INTEGER,
    "applied_revision" INTEGER,
    "request_hash" TEXT NOT NULL,
    "status" "V2CommandStatus" NOT NULL DEFAULT 'PROCESSING',
    "response" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "v2_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_runs_v2" (
    "id" UUID NOT NULL,
    "unit_id" UUID NOT NULL,
    "kind" "ProductionRunKind" NOT NULL,
    "status" "ProductionRunStatus" NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 1,
    "current_phase" "ProductionPhaseKind",
    "parent_run_id" UUID,
    "route_snapshot" JSONB,
    "route_checksum" TEXT,
    "migration_source" TEXT,
    "migration_source_id" TEXT,
    "migration_rule_version" TEXT,
    "migration_confidence" TEXT,
    "source_checksum" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_runs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_phase_runs_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "phase" "ProductionPhaseKind" NOT NULL,
    "status" "ProductionPhaseRunStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "sequence" INTEGER NOT NULL,
    "reason" TEXT,
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_phase_runs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "diagnosis_reports_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "status" "DiagnosisReportStatus" NOT NULL DEFAULT 'DRAFT',
    "findings" JSONB NOT NULL DEFAULT '{}',
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "recommended_service_id" UUID,
    "diagnosed_by_id" TEXT,
    "approved_by_id" TEXT,
    "override_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "approved_at" TIMESTAMP(3),

    CONSTRAINT "diagnosis_reports_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_operation_runs_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "stage_id" UUID,
    "stage_code" TEXT NOT NULL,
    "stage_label" TEXT NOT NULL,
    "sequence" INTEGER NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "status" "ProductionOperationStatus" NOT NULL DEFAULT 'NOT_STARTED',
    "plan_snapshot" JSONB NOT NULL DEFAULT '{}',
    "started_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_operation_runs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspections_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "version" INTEGER NOT NULL,
    "checklist_version" TEXT NOT NULL,
    "result" "QualityInspectionResult" NOT NULL DEFAULT 'PENDING',
    "inspector_id" TEXT,
    "disposition" TEXT,
    "override_reason" TEXT,
    "inspected_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "quality_inspections_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "quality_inspection_items_v2" (
    "id" UUID NOT NULL,
    "inspection_id" UUID NOT NULL,
    "item_code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "result" TEXT NOT NULL,
    "note" TEXT,
    "photo_urls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sort_order" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "quality_inspection_items_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "production_handoffs_v2" (
    "id" UUID NOT NULL,
    "run_id" UUID NOT NULL,
    "status" "ProductionHandoffStatus" NOT NULL DEFAULT 'DRAFT',
    "revision" INTEGER NOT NULL DEFAULT 1,
    "readiness" JSONB NOT NULL DEFAULT '{}',
    "offered_by_id" TEXT,
    "offered_at" TIMESTAMP(3),
    "accepted_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "delivery_job_id" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "production_handoffs_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_route_states_v2" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "route_revision" INTEGER NOT NULL DEFAULT 1,
    "current_publication_version" INTEGER,
    "migration_source" TEXT,
    "source_checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_route_states_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_publications_v2" (
    "id" UUID NOT NULL,
    "route_id" UUID NOT NULL,
    "publication_version" INTEGER NOT NULL,
    "route_revision" INTEGER NOT NULL,
    "status" "RoutePublicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "snapshot" JSONB NOT NULL,
    "checksum" TEXT NOT NULL,
    "reason" TEXT,
    "migration_baseline" BOOLEAN NOT NULL DEFAULT false,
    "published_by_id" TEXT,
    "published_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "superseded_at" TIMESTAMP(3),

    CONSTRAINT "route_publications_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "route_stop_assignments_v2" (
    "id" UUID NOT NULL,
    "publication_id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "sequence" INTEGER NOT NULL,
    "driver_id" TEXT,
    "helper_id" TEXT,
    "vehicle_id" UUID,
    "status" "RouteStopAssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "effective_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revoked_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),
    "source_checksum" TEXT,

    CONSTRAINT "route_stop_assignments_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "delivery_job_states_v2" (
    "id" UUID NOT NULL,
    "job_id" UUID NOT NULL,
    "job_revision" INTEGER NOT NULL DEFAULT 1,
    "current_status" TEXT NOT NULL,
    "source_checksum" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "delivery_job_states_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_feed_states_v2" (
    "user_id" TEXT NOT NULL,
    "next_sequence" BIGINT NOT NULL DEFAULT 1,
    "retention_floor" BIGINT NOT NULL DEFAULT 1,
    "feed_version" INTEGER NOT NULL DEFAULT 1,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_feed_states_v2_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "driver_sync_events_v2" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "sequence" BIGINT NOT NULL,
    "feed_version" INTEGER NOT NULL DEFAULT 1,
    "kind" "DriverSyncChangeKind" NOT NULL,
    "aggregate_type" TEXT NOT NULL,
    "aggregate_id" TEXT NOT NULL,
    "aggregate_revision" INTEGER,
    "publication_version" INTEGER,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "driver_sync_events_v2_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "driver_devices_v2" (
    "id" UUID NOT NULL,
    "user_id" TEXT NOT NULL,
    "device_id" TEXT NOT NULL,
    "platform" TEXT,
    "app_version" TEXT,
    "build_number" TEXT,
    "runtime_version" TEXT,
    "push_token_ref" TEXT,
    "last_seen_at" TIMESTAMP(3),
    "last_applied_cursor" BIGINT,
    "last_applied_route_revision" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "driver_devices_v2_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "v2_migration_runs_kind_created_at_idx" ON "v2_migration_runs"("kind", "created_at");

-- CreateIndex
CREATE INDEX "v2_migration_runs_status_idx" ON "v2_migration_runs"("status");

-- CreateIndex
CREATE INDEX "v2_migration_exceptions_status_severity_idx" ON "v2_migration_exceptions"("status", "severity");

-- CreateIndex
CREATE INDEX "v2_migration_exceptions_aggregate_type_aggregate_id_idx" ON "v2_migration_exceptions"("aggregate_type", "aggregate_id");

-- CreateIndex
CREATE UNIQUE INDEX "v2_migration_exceptions_run_id_domain_aggregate_type_aggreg_key" ON "v2_migration_exceptions"("run_id", "domain", "aggregate_type", "aggregate_id", "code");

-- CreateIndex
CREATE INDEX "v2_shadow_comparisons_domain_status_compared_at_idx" ON "v2_shadow_comparisons"("domain", "status", "compared_at");

-- CreateIndex
CREATE INDEX "v2_shadow_comparisons_aggregate_type_aggregate_id_compared__idx" ON "v2_shadow_comparisons"("aggregate_type", "aggregate_id", "compared_at");

-- CreateIndex
CREATE UNIQUE INDEX "domain_outbox_event_id_key" ON "domain_outbox"("event_id");

-- CreateIndex
CREATE UNIQUE INDEX "domain_outbox_dedupe_key_key" ON "domain_outbox"("dedupe_key");

-- CreateIndex
CREATE INDEX "domain_outbox_status_available_at_id_idx" ON "domain_outbox"("status", "available_at", "id");

-- CreateIndex
CREATE INDEX "domain_outbox_aggregate_type_aggregate_id_id_idx" ON "domain_outbox"("aggregate_type", "aggregate_id", "id");

-- CreateIndex
CREATE INDEX "v2_commands_aggregate_type_aggregate_id_created_at_idx" ON "v2_commands"("aggregate_type", "aggregate_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "v2_commands_actor_id_idempotency_key_key" ON "v2_commands"("actor_id", "idempotency_key");

-- CreateIndex
CREATE INDEX "production_runs_v2_unit_id_status_idx" ON "production_runs_v2"("unit_id", "status");

-- CreateIndex
CREATE INDEX "production_runs_v2_kind_status_idx" ON "production_runs_v2"("kind", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_runs_v2_migration_source_migration_source_id_key" ON "production_runs_v2"("migration_source", "migration_source_id");

-- CreateIndex
CREATE INDEX "production_phase_runs_v2_phase_status_idx" ON "production_phase_runs_v2"("phase", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_phase_runs_v2_run_id_phase_key" ON "production_phase_runs_v2"("run_id", "phase");

-- CreateIndex
CREATE INDEX "diagnosis_reports_v2_run_id_status_idx" ON "diagnosis_reports_v2"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "diagnosis_reports_v2_run_id_version_key" ON "diagnosis_reports_v2"("run_id", "version");

-- CreateIndex
CREATE INDEX "production_operation_runs_v2_run_id_status_idx" ON "production_operation_runs_v2"("run_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "production_operation_runs_v2_run_id_sequence_key" ON "production_operation_runs_v2"("run_id", "sequence");

-- CreateIndex
CREATE INDEX "quality_inspections_v2_result_created_at_idx" ON "quality_inspections_v2"("result", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspections_v2_run_id_version_key" ON "quality_inspections_v2"("run_id", "version");

-- CreateIndex
CREATE UNIQUE INDEX "quality_inspection_items_v2_inspection_id_item_code_key" ON "quality_inspection_items_v2"("inspection_id", "item_code");

-- CreateIndex
CREATE UNIQUE INDEX "production_handoffs_v2_run_id_key" ON "production_handoffs_v2"("run_id");

-- CreateIndex
CREATE INDEX "production_handoffs_v2_status_offered_at_idx" ON "production_handoffs_v2"("status", "offered_at");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_route_states_v2_route_id_key" ON "delivery_route_states_v2"("route_id");

-- CreateIndex
CREATE INDEX "route_publications_v2_route_id_status_idx" ON "route_publications_v2"("route_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "route_publications_v2_route_id_publication_version_key" ON "route_publications_v2"("route_id", "publication_version");

-- CreateIndex
CREATE INDEX "route_stop_assignments_v2_driver_id_status_idx" ON "route_stop_assignments_v2"("driver_id", "status");

-- CreateIndex
CREATE INDEX "route_stop_assignments_v2_helper_id_status_idx" ON "route_stop_assignments_v2"("helper_id", "status");

-- CreateIndex
CREATE INDEX "route_stop_assignments_v2_job_id_status_idx" ON "route_stop_assignments_v2"("job_id", "status");

-- CreateIndex
CREATE UNIQUE INDEX "route_stop_assignments_v2_publication_id_job_id_key" ON "route_stop_assignments_v2"("publication_id", "job_id");

-- CreateIndex
CREATE UNIQUE INDEX "delivery_job_states_v2_job_id_key" ON "delivery_job_states_v2"("job_id");

-- CreateIndex
CREATE INDEX "delivery_job_states_v2_current_status_idx" ON "delivery_job_states_v2"("current_status");

-- CreateIndex
CREATE INDEX "driver_sync_events_v2_user_id_created_at_idx" ON "driver_sync_events_v2"("user_id", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_sync_events_v2_user_id_sequence_key" ON "driver_sync_events_v2"("user_id", "sequence");

-- CreateIndex
CREATE INDEX "driver_devices_v2_user_id_last_seen_at_idx" ON "driver_devices_v2"("user_id", "last_seen_at");

-- CreateIndex
CREATE UNIQUE INDEX "driver_devices_v2_user_id_device_id_key" ON "driver_devices_v2"("user_id", "device_id");

-- CreateIndex
-- AddForeignKey
ALTER TABLE "v2_migration_exceptions" ADD CONSTRAINT "v2_migration_exceptions_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "v2_migration_runs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs_v2" ADD CONSTRAINT "production_runs_v2_unit_id_fkey" FOREIGN KEY ("unit_id") REFERENCES "units"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_runs_v2" ADD CONSTRAINT "production_runs_v2_parent_run_id_fkey" FOREIGN KEY ("parent_run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_phase_runs_v2" ADD CONSTRAINT "production_phase_runs_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "diagnosis_reports_v2" ADD CONSTRAINT "diagnosis_reports_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_operation_runs_v2" ADD CONSTRAINT "production_operation_runs_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspections_v2" ADD CONSTRAINT "quality_inspections_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "quality_inspection_items_v2" ADD CONSTRAINT "quality_inspection_items_v2_inspection_id_fkey" FOREIGN KEY ("inspection_id") REFERENCES "quality_inspections_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "production_handoffs_v2" ADD CONSTRAINT "production_handoffs_v2_run_id_fkey" FOREIGN KEY ("run_id") REFERENCES "production_runs_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_route_states_v2" ADD CONSTRAINT "delivery_route_states_v2_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_publications_v2" ADD CONSTRAINT "route_publications_v2_route_id_fkey" FOREIGN KEY ("route_id") REFERENCES "routes"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop_assignments_v2" ADD CONSTRAINT "route_stop_assignments_v2_publication_id_fkey" FOREIGN KEY ("publication_id") REFERENCES "route_publications_v2"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "route_stop_assignments_v2" ADD CONSTRAINT "route_stop_assignments_v2_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "delivery_job_states_v2" ADD CONSTRAINT "delivery_job_states_v2_job_id_fkey" FOREIGN KEY ("job_id") REFERENCES "jobs"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
