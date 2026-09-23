#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

const prisma = new PrismaClient();
const args = parseArgs();

async function main() {
  const latestRun = await prisma.v2MigrationRun.findFirst({ where: { kind: "INITIAL_BACKFILL" }, orderBy: { createdAt: "desc" } });
  const exceptions = latestRun ? await prisma.v2MigrationException.findMany({ where: { runId: latestRun.id }, orderBy: [{ severity: "asc" }, { code: "asc" }] }) : [];
  const unresolved = exceptions.filter((item) => item.status === "OPEN");
  const report = {
    reportType: "production-delivery-v2-exceptions",
    generatedAt: new Date().toISOString(),
    migrationRunId: latestRun?.id || null,
    totals: {
      all: exceptions.length,
      open: unresolved.length,
      keepV1: exceptions.filter((item) => item.status === "KEEP_V1").length,
      resolved: exceptions.filter((item) => item.status === "RESOLVED").length,
      excluded: exceptions.filter((item) => item.status === "EXCLUDED_WITH_REASON").length,
    },
    cutoverBlockedAggregateIds: exceptions.filter((item) => ["OPEN", "KEEP_V1"].includes(item.status)).map((item) => item.aggregateId),
    exceptions,
  };
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
  if (unresolved.length > 0) process.exitCode = 2;
}

main().catch((error) => {
  console.error("[v2-exceptions] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
