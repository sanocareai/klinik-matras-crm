#!/usr/bin/env node
import "dotenv/config";
import { pathToFileURL } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase, jsonForOutput } from "./common.js";

function safeError(error) {
  return String(error?.message || error || "delivery failed").slice(0, 500);
}

// Rehearsal-only dispatcher. It deliberately refuses a non-test database.
// The conditional claim lets competing workers inspect the same candidate set
// while only one of them performs the synthetic delivery for each dedupe key.
export async function drainPendingOutboxRehearsal(prisma, {
  workerId,
  deliver,
  batchSize = 500,
  now = new Date(),
  databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
} = {}) {
  assertSafeTestDatabase(databaseUrl);
  if (!workerId || typeof deliver !== "function") {
    throw new TypeError("workerId dan deliver wajib diisi");
  }
  const candidates = await prisma.domainOutbox.findMany({
    where: { status: "PENDING", availableAt: { lte: now } },
    orderBy: { id: "asc" },
    take: Math.max(1, Math.min(Number(batchSize) || 500, 5_000)),
  });
  const report = { workerId, candidates: candidates.length, claimed: 0, delivered: 0, failed: 0 };
  for (const event of candidates) {
    const claim = await prisma.domainOutbox.updateMany({
      where: { id: event.id, status: "PENDING", availableAt: { lte: now } },
      data: { status: "PROCESSING", lockedAt: now, lockedBy: workerId, attempts: { increment: 1 }, lastError: null },
    });
    if (claim.count !== 1) continue;
    report.claimed += 1;
    try {
      await deliver(event);
      const completed = await prisma.domainOutbox.updateMany({
        where: { id: event.id, status: "PROCESSING", lockedBy: workerId },
        data: { status: "DELIVERED", deliveredAt: new Date(), lockedAt: null, lockedBy: null, lastError: null },
      });
      if (completed.count !== 1) throw new Error(`Outbox ${event.id} kehilangan ownership saat complete`);
      report.delivered += 1;
    } catch (error) {
      report.failed += 1;
      await prisma.domainOutbox.updateMany({
        where: { id: event.id, status: "PROCESSING", lockedBy: workerId },
        data: { status: "FAILED", lockedAt: null, lockedBy: null, lastError: safeError(error) },
      });
      throw error;
    }
  }
  return report;
}

export async function rehearseExactOnceOutboxDrain(prisma, {
  workerIds = ["rehearsal-a", "rehearsal-b"],
  databaseUrl = process.env.TEST_DATABASE_URL || process.env.DATABASE_URL,
} = {}) {
  const database = assertSafeTestDatabase(databaseUrl);
  const pendingBefore = await prisma.domainOutbox.count({ where: { status: "PENDING" } });
  const deliveredKeys = new Set();
  let duplicateDeliveries = 0;
  const deliver = async (event) => {
    if (deliveredKeys.has(event.dedupeKey)) duplicateDeliveries += 1;
    deliveredKeys.add(event.dedupeKey);
  };
  const workers = await Promise.all(workerIds.map((workerId) => drainPendingOutboxRehearsal(prisma, {
    workerId, deliver, batchSize: Math.max(1, pendingBefore), databaseUrl,
  })));
  const replay = await drainPendingOutboxRehearsal(prisma, {
    workerId: "rehearsal-replay", deliver, batchSize: Math.max(1, pendingBefore), databaseUrl,
  });
  const [pendingAfter, processingAfter, failedAfter, deliveredAfter] = await Promise.all([
    prisma.domainOutbox.count({ where: { status: "PENDING" } }),
    prisma.domainOutbox.count({ where: { status: "PROCESSING" } }),
    prisma.domainOutbox.count({ where: { status: "FAILED" } }),
    prisma.domainOutbox.count({ where: { status: "DELIVERED" } }),
  ]);
  const report = {
    reportType: "production-delivery-v2-outbox-drain-rehearsal",
    database,
    pendingBefore,
    pendingAfter,
    processingAfter,
    failedAfter,
    deliveredAfter,
    uniqueDeliveries: deliveredKeys.size,
    duplicateDeliveries,
    workers,
    replay,
  };
  const passed = pendingBefore > 0
    && pendingAfter === 0
    && processingAfter === 0
    && failedAfter === 0
    && deliveredAfter === pendingBefore
    && deliveredKeys.size === pendingBefore
    && duplicateDeliveries === 0
    && replay.claimed === 0
    && replay.delivered === 0;
  if (!passed) throw Object.assign(new Error("Outbox rehearsal tidak memenuhi exact-once gate"), { report });
  return report;
}

async function main() {
  const prisma = new PrismaClient();
  try {
    console.log(jsonForOutput(await rehearseExactOnceOutboxDrain(prisma)));
  } finally {
    await prisma.$disconnect();
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((error) => {
    console.error(jsonForOutput(error.report || { error: safeError(error) }));
    process.exitCode = 1;
  });
}
