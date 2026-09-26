#!/usr/bin/env node
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { checksum, jsonForOutput, parseArgs, requireApplyConfirmation, writeReport } from "./common.js";
import {
  RULE_VERSION, applyPlan, buildExceptions, loadSource, routeSnapshot, unitPlan,
} from "./backfill-core.js";

const prisma = new PrismaClient();
const args = parseArgs();
const apply = requireApplyConfirmation(args);

async function main() {
  const source = await loadSource(prisma);
  const productionPlans = source.units.map(unitPlan);
  const exceptions = buildExceptions(source.units, source.routes, source.jobs);
  const report = {
    reportType: "production-delivery-v2-backfill",
    mode: apply ? "APPLY" : "DRY_RUN",
    generatedAt: new Date().toISOString(), ruleVersion: RULE_VERSION,
    counts: { units: source.units.length, routes: source.routes.length, jobs: source.jobs.length, exceptions: exceptions.length },
    sourceChecksum: checksum(source),
    planChecksum: checksum({ productionPlans, routes: source.routes.map(routeSnapshot), jobs: source.jobs, exceptions }),
    exceptions,
  };
  if (apply) {
    report.applyResult = await applyPlan(prisma, source, productionPlans, exceptions);
    // Kegagalan per-item (route/exception) tidak menggagalkan batch, tetapi harus terlihat: exit code 3.
    if (report.applyResult.failures.length) process.exitCode = 3;
  }
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
}

main().catch((error) => {
  console.error("[v2-backfill] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
