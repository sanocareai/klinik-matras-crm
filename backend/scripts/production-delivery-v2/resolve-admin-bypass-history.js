#!/usr/bin/env node
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

export const ADMIN_BYPASS_HISTORY_UNIT_IDS = Object.freeze([
  "34d3d6d6-cca8-4c66-b397-e597b607a412",
  "8052716f-d30a-4421-a265-c7a6061bdb75",
  "97dd6710-0f4a-4872-9deb-c7440a0f73a8",
  "c54c7a5b-6149-479e-91b1-0c86b62753e7",
  "d4e4f0ae-a008-4913-ad68-3da6e1839a55",
]);

const EXCEPTION_CODE = "CURRENT_STAGE_WITHOUT_SERVICE";
const CONFIRMATION = "RESOLVE-PRODUCTION-ADMIN-BYPASS-5";

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

function resolutionFor(activity) {
  return {
    disposition: "HISTORICAL_ADMINISTRATIVE_BYPASS",
    provenance: "PRODUCTION_ADMIN_BYPASS",
    sourceActivityEventId: activity.id,
    preserve: ["V1", "V2", "AUDIT_TRAIL"],
    fabricatedFields: [],
    note: "Owner classified this migrated exception as administrative history; no missing business evidence was inferred.",
  };
}

export async function resolveAdminBypassHistory(prisma, { apply = false } = {}) {
  return prisma.$transaction(async (tx) => {
    const run = await tx.v2MigrationRun.findFirst({
      where: { kind: "INITIAL_BACKFILL", status: "VERIFIED" },
      orderBy: { createdAt: "desc" },
    });
    invariant(run, "Tidak ada INITIAL_BACKFILL VERIFIED yang dapat diselesaikan");
    await tx.$queryRaw`SELECT id FROM v2_migration_runs WHERE id = ${run.id}::uuid FOR UPDATE`;

    const exceptions = await tx.v2MigrationException.findMany({
      where: { runId: run.id, code: EXCEPTION_CODE },
      orderBy: { aggregateId: "asc" },
    });
    const expectedIds = [...ADMIN_BYPASS_HISTORY_UNIT_IDS].sort();
    const actualIds = exceptions.map((item) => item.aggregateId).sort();
    invariant(JSON.stringify(actualIds) === JSON.stringify(expectedIds),
      `Exception ${EXCEPTION_CODE} pada run terbaru tidak tepat lima ID yang disetujui`);
    invariant(exceptions.every((item) => item.domain === "PRODUCTION" && item.aggregateType === "Unit"),
      "Domain/type exception tidak sesuai Production Unit");
    invariant(exceptions.every((item) => ["KEEP_V1", "RESOLVED"].includes(item.status)),
      "Ada exception dengan status di luar KEEP_V1/RESOLVED");

    const units = await tx.unit.findMany({
      where: { id: { in: expectedIds } },
      select: {
        id: true,
        unitCode: true,
        status: true,
        serviceId: true,
        currentStageId: true,
        order: { select: { id: true, orderNumber: true, status: true } },
        productionRunsV2: {
          where: { migrationSource: "UNIT_V1" },
          select: {
            id: true,
            status: true,
            migrationConfidence: true,
            diagnoses: { select: { id: true } },
            inspections: { select: { id: true } },
            handoff: { select: { id: true } },
          },
        },
      },
      orderBy: { id: "asc" },
    });
    invariant(units.length === expectedIds.length, "Satu atau lebih Unit target tidak ditemukan");

    const activities = await tx.activityEvent.findMany({
      where: {
        entityType: "unit",
        entityId: { in: expectedIds },
        eventType: "PRODUCTION_ADMIN_BYPASS",
      },
      orderBy: { createdAt: "desc" },
    });
    const activityByUnit = new Map();
    for (const activity of activities) {
      if (!activityByUnit.has(activity.entityId)) activityByUnit.set(activity.entityId, activity);
    }

    for (const unit of units) {
      invariant(unit.status === "DELIVERED" && unit.order.status === "DELIVERED",
        `Unit/order ${unit.id} bukan histori DELIVERED`);
      invariant(unit.serviceId == null && unit.currentStageId != null,
        `Unit ${unit.id} tidak lagi cocok dengan exception tanpa service`);
      invariant(activityByUnit.has(unit.id), `Unit ${unit.id} tidak memiliki provenance PRODUCTION_ADMIN_BYPASS`);
      invariant(unit.productionRunsV2.length === 1, `Unit ${unit.id} tidak memiliki tepat satu baseline ProductionRun V2`);
      const productionRun = unit.productionRunsV2[0];
      invariant(productionRun.status === "COMPLETED" && productionRun.migrationConfidence === "REVIEW",
        `Baseline ProductionRun ${unit.id} bukan COMPLETED/REVIEW`);
      invariant(productionRun.diagnoses.length === 0 && productionRun.inspections.length === 0 && !productionRun.handoff,
        `Unit ${unit.id} memiliki bukti bisnis tambahan; jangan klasifikasikan otomatis`);
    }

    let updated = 0;
    if (apply) {
      for (const exception of exceptions) {
        const activity = activityByUnit.get(exception.aggregateId);
        const resolution = resolutionFor(activity);
        if (exception.status === "RESOLVED") {
          invariant(exception.resolution?.provenance === "PRODUCTION_ADMIN_BYPASS",
            `Exception resolved ${exception.aggregateId} memiliki provenance berbeda`);
          continue;
        }
        await tx.v2MigrationException.update({
          where: { id: exception.id },
          data: {
            status: "RESOLVED",
            resolution,
            resolvedById: activity.actorId,
            resolvedAt: new Date(),
          },
        });
        updated += 1;
      }
    }

    const after = apply ? await tx.v2MigrationException.findMany({
      where: { id: { in: exceptions.map((item) => item.id) } },
      orderBy: { aggregateId: "asc" },
    }) : exceptions;
    const searchableHistory = after.map((item) => ({
      id: item.id,
      aggregateId: item.aggregateId,
      status: apply ? "RESOLVED" : item.status,
      provenance: apply ? "PRODUCTION_ADMIN_BYPASS" : item.resolution?.provenance ?? null,
    }));
    const activeExceptionCount = apply ? await tx.v2MigrationException.count({
      where: { id: { in: exceptions.map((item) => item.id) }, status: { in: ["OPEN", "KEEP_V1"] } },
    }) : exceptions.filter((item) => ["OPEN", "KEEP_V1"].includes(item.status)).length;

    if (apply) {
      invariant(activeExceptionCount === 0, "Exception target masih muncul di daftar aktif");
    }
    return {
      mode: apply ? "APPLY" : "DRY_RUN",
      migrationRunId: run.id,
      targetCount: exceptions.length,
      updated,
      activeExceptionCount,
      searchableHistory,
      units: units.map((unit) => ({
        unitId: unit.id,
        unitCode: unit.unitCode,
        orderNumber: unit.order.orderNumber,
        unitStatus: unit.status,
        orderStatus: unit.order.status,
        provenanceEventId: activityByUnit.get(unit.id).id,
      })),
    };
  }, { isolationLevel: "Serializable", timeout: 30_000 });
}

async function main() {
  const args = parseArgs();
  const apply = Boolean(args.apply);
  if (apply && args.confirm !== CONFIRMATION) {
    throw new Error(`Mode apply memerlukan --confirm=${CONFIRMATION}`);
  }
  const prisma = new PrismaClient();
  try {
    const report = await resolveAdminBypassHistory(prisma, { apply });
    writeReport(args.output, report);
    console.log(jsonForOutput(report));
  } finally {
    await prisma.$disconnect();
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error("[resolve-admin-bypass-history] GAGAL:", error.message);
    process.exitCode = 1;
  });
}
