#!/usr/bin/env node
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { revokeConfirmedRescheduledAssignment } from "../../src/services/historicalAssignmentRevocation.js";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

export const PENDING_JOB_ID = "7d34e05d-b7f2-43cd-8842-31e13645492f";
const FINAL_DATE = "2026-09-27";
const CONFIRMATION = `RESCHEDULE_${FINAL_DATE}_FINAL`;

export async function runConfirmedRescheduleRevocation(prisma, { apply = false, confirmation = null } = {}) {
  if (!apply) {
    const job = await prisma.job.findUnique({
      where: { id: PENDING_JOB_ID },
      select: {
        id: true, status: true, routeId: true, driverId: true, helperId: true, vehicleId: true, scheduledDate: true,
        stopAssignmentsV2: {
          where: { status: "ACTIVE" },
          select: {
            id: true, publicationId: true,
            publication: { select: { routeId: true, route: { select: { status: true } } } },
          },
        },
      },
    });
    return {
      mode: "DRY_RUN",
      opsConfirmationRequired: CONFIRMATION,
      found: Boolean(job),
      job,
      wouldPreserve: ["JOB", "ROUTE", "ORDER", "PUBLICATION", "EVENTS", "AUDIT_TRAIL"],
    };
  }
  return {
    mode: "APPLY",
    ...(await revokeConfirmedRescheduledAssignment(prisma, {
      jobId: PENDING_JOB_ID,
      actorId: "OPS_CONFIRMATION_20260927",
      idempotencyKey: "ops-confirmed-reschedule-7d34e05d-20260927",
      reason: "Ops confirmed pickup reschedule 27 September as final; revoke stale assignment from terminal route",
      confirmedScheduledDate: FINAL_DATE,
      opsConfirmation: confirmation,
    })),
  };
}

async function main() {
  const args = parseArgs();
  const apply = Boolean(args.apply);
  if (apply && args.confirm !== CONFIRMATION) throw new Error(`Belum ada konfirmasi Ops; apply memerlukan --confirm=${CONFIRMATION}`);
  const prisma = new PrismaClient();
  try {
    const report = await runConfirmedRescheduleRevocation(prisma, { apply, confirmation: args.confirm || null });
    writeReport(args.output, report);
    console.log(jsonForOutput(report));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
