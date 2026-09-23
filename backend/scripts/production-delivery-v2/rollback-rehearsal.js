#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase, jsonForOutput, parseArgs, writeReport } from "./common.js";
import { ensureV2Flags, loadV2Flags, V2_FLAGS } from "../../src/services/v2FeatureFlags.js";

const prisma = new PrismaClient();
const args = parseArgs();

async function counts() {
  const [orders, units, jobs, routes, productionRuns, publications, commands, outbox] = await Promise.all([
    prisma.order.count(), prisma.unit.count(), prisma.job.count(), prisma.route.count(),
    prisma.productionRun.count(), prisma.routePublication.count(), prisma.v2Command.count(), prisma.domainOutbox.count(),
  ]);
  return { orders, units, jobs, routes, productionRuns, publications, commands, outbox };
}

async function main() {
  const database = assertSafeTestDatabase();
  if (!args.apply || process.env.ALLOW_V2_ROLLBACK_REHEARSAL !== "YES") {
    throw new Error("Rollback rehearsal wajib memakai --apply dan ALLOW_V2_ROLLBACK_REHEARSAL=YES pada database test/scratch.");
  }
  await prisma.$transaction((tx) => ensureV2Flags(tx));
  const before = await counts();

  // Simulasikan cohort aktif hanya di database test. Reader dimatikan lebih
  // dahulu, lalu writer, sesuai runbook. Row V2 tidak dihapus.
  await prisma.v2FeatureFlag.updateMany({
    where: { key: { in: [V2_FLAGS.DELIVERY_ROUTE_WRITER, V2_FLAGS.DELIVERY_EXECUTION_WRITER, V2_FLAGS.DRIVER_SNAPSHOT_READER, V2_FLAGS.DELIVERY_WEB_READER] } },
    data: { enabled: true, reason: "Rollback rehearsal test only" },
  });
  await prisma.v2FeatureFlag.updateMany({
    where: { key: { in: [V2_FLAGS.DRIVER_SNAPSHOT_READER, V2_FLAGS.DELIVERY_WEB_READER, V2_FLAGS.PRODUCTION_READER] } },
    data: { enabled: false, reason: "Rollback rehearsal: readers off first" },
  });
  await prisma.v2FeatureFlag.updateMany({
    where: { key: { in: [V2_FLAGS.DELIVERY_ROUTE_WRITER, V2_FLAGS.DELIVERY_EXECUTION_WRITER, V2_FLAGS.PRODUCTION_WRITER] } },
    data: { enabled: false, reason: "Rollback rehearsal: writers off after readers" },
  });

  const after = await counts();
  const flags = await loadV2Flags(prisma);
  const enabled = Object.values(flags).filter((flag) => flag.enabled);
  const v1Unchanged = ["orders", "units", "jobs", "routes"].every((key) => before[key] === after[key]);
  const v2Retained = ["productionRuns", "publications", "commands", "outbox"].every((key) => before[key] === after[key]);
  const report = { reportType: "production-delivery-v2-rollback-rehearsal", generatedAt: new Date().toISOString(), database, before, after, enabledFlags: enabled, v1Unchanged, v2Retained, passed: enabled.length === 0 && v1Unchanged && v2Retained };
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
  if (!report.passed) process.exitCode = 2;
}

main().catch((error) => {
  console.error("[v2-rollback] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
