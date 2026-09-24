#!/usr/bin/env node
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import {
  DELIVERY_ROUTE_RECONCILIATION_MODE,
  reconcileDeliveryRouteFromV1,
} from "../../src/services/deliveryRouteReconciliation.js";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

export const RECONCILIATION_TARGETS = Object.freeze({
  terminalRoute: {
    id: "452e15c8-78cd-432e-b650-48a34ca75a45",
    code: "RTE-240926-02",
    expected: { v1JobCount: 6, v2AssignmentCount: 8 },
  },
  publishedCatchUp: {
    id: "24ac2eb4-293c-40f4-b25e-2ee1e0d40a56",
    code: "RTE-250926-01",
    exceptionId: "a0d121fb-3d52-44b3-856d-db54c54dfc76",
    expected: { v1JobCount: 8 },
  },
});

const ACTOR_ID = "OWNER_DECISION_20260925";
const CONFIRMATION = "RECONCILE-RTE-240926-02-AND-RTE-250926-01";

async function readTarget(prisma, target) {
  return prisma.route.findUnique({
    where: { id: target.id },
    select: {
      id: true, code: true, status: true, date: true,
      driverId: true, helperId: true, vehicleId: true,
      jobs: {
        orderBy: [{ sequence: "asc" }, { id: "asc" }],
        select: {
          id: true, status: true, routeId: true, sequence: true,
          scheduledDate: true, driverId: true, helperId: true, vehicleId: true,
          cancellationV2: { select: { id: true } },
        },
      },
      deliveryStateV2: { select: { routeRevision: true, currentPublicationVersion: true, lifecycleStatus: true } },
      publicationsV2: {
        where: { status: "ACTIVE" },
        select: {
          id: true, publicationVersion: true, routeRevision: true,
          assignments: {
            orderBy: [{ sequence: "asc" }, { id: "asc" }],
            select: {
              id: true, jobId: true, status: true,
              job: { select: { status: true, routeId: true } },
            },
          },
        },
      },
    },
  });
}

export async function runApprovedRouteReconciliation(prisma, { apply = false } = {}) {
  if (!apply) {
    const [terminalRoute, publishedCatchUp, exception] = await Promise.all([
      readTarget(prisma, RECONCILIATION_TARGETS.terminalRoute),
      readTarget(prisma, RECONCILIATION_TARGETS.publishedCatchUp),
      prisma.v2MigrationException.findUnique({
        where: { id: RECONCILIATION_TARGETS.publishedCatchUp.exceptionId },
        select: { id: true, aggregateId: true, code: true, status: true, evidence: true },
      }),
    ]);
    return { mode: "DRY_RUN", terminalRoute, publishedCatchUp, exception };
  }

  const terminal = await reconcileDeliveryRouteFromV1(prisma, {
    routeId: RECONCILIATION_TARGETS.terminalRoute.id,
    actorId: ACTOR_ID,
    idempotencyKey: "owner-20260925-reconcile-rte-240926-02",
    mode: DELIVERY_ROUTE_RECONCILIATION_MODE.TERMINAL_ASSIGNMENTS,
    reason: "Reconcile six completed V1 jobs; revoke five stale active and two foreign-route assignments via superseding publication",
    expected: RECONCILIATION_TARGETS.terminalRoute.expected,
  });
  const catchUp = await reconcileDeliveryRouteFromV1(prisma, {
    routeId: RECONCILIATION_TARGETS.publishedCatchUp.id,
    actorId: ACTOR_ID,
    idempotencyKey: "owner-20260925-catch-up-rte-250926-01",
    mode: DELIVERY_ROUTE_RECONCILIATION_MODE.PUBLISHED_CATCH_UP,
    reason: "Canonical catch-up from latest PUBLISHED V1 route with exact crew/date equality",
    exceptionId: RECONCILIATION_TARGETS.publishedCatchUp.exceptionId,
    expected: RECONCILIATION_TARGETS.publishedCatchUp.expected,
  });
  return { mode: "APPLY", terminal, catchUp };
}

async function main() {
  const args = parseArgs();
  const apply = Boolean(args.apply);
  if (apply && args.confirm !== CONFIRMATION) throw new Error(`Mode apply memerlukan --confirm=${CONFIRMATION}`);
  const prisma = new PrismaClient();
  try {
    const report = await runApprovedRouteReconciliation(prisma, { apply });
    writeReport(args.output, report);
    console.log(jsonForOutput(report));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => { console.error(error); process.exitCode = 1; });
}
