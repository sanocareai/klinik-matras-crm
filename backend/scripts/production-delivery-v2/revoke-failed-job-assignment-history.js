#!/usr/bin/env node
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { revokeHistoricalFailedJobAssignment } from "../../src/services/historicalAssignmentRevocation.js";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

export const APPROVED_JOB_ID = "fbe92f99-db20-400c-ae8c-b61a42b01df6";
const ACTOR_ID = "OWNER_DECISION_20260924";
const IDEMPOTENCY_KEY = "owner-20260924-revoke-fbe92f99-assignment";
const CONFIRMATION = "REVOKE-FBE92F99-HISTORICAL-ASSIGNMENT";
const REASON = "Owner-approved historical cleanup: cancelled order, FAILED job, terminal route; preserve all business records";

export async function runApprovedHistoricalRevocation(prisma, { apply = false } = {}) {
  if (!apply) {
    const job = await prisma.job.findUnique({
      where: { id: APPROVED_JOB_ID },
      select: {
        id: true, status: true, routeId: true,
        order: { select: { status: true } }, route: { select: { status: true } },
        stopAssignmentsV2: { where: { status: "ACTIVE" }, select: { id: true, driverId: true, helperId: true } },
      },
    });
    return {
      mode: "DRY_RUN", jobId: APPROVED_JOB_ID, found: Boolean(job),
      jobStatus: job?.status ?? null, orderStatus: job?.order?.status ?? null,
      routeStatus: job?.route?.status ?? null, activeAssignmentCount: job?.stopAssignmentsV2.length ?? null,
      wouldPreserve: ["JOB", "ROUTE", "ORDER", "EVENTS", "AUDIT_TRAIL"],
    };
  }
  return { mode: "APPLY", ...(await revokeHistoricalFailedJobAssignment(prisma, {
    jobId: APPROVED_JOB_ID, actorId: ACTOR_ID, idempotencyKey: IDEMPOTENCY_KEY,
    reason: REASON, provenance: "PRODUCTION_ADMIN_BYPASS",
  })) };
}

async function main() {
  const args = parseArgs();
  const apply = Boolean(args.apply);
  if (apply && args.confirm !== CONFIRMATION) throw new Error(`Mode apply memerlukan --confirm=${CONFIRMATION}`);
  const prisma = new PrismaClient();
  try {
    const report = await runApprovedHistoricalRevocation(prisma, { apply });
    writeReport(args.output, report);
    console.log(jsonForOutput(report));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
