#!/usr/bin/env node
import "dotenv/config";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { PrismaClient } from "@prisma/client";
import { assertSafeTestDatabase, jsonForOutput, parseArgs, writeReport } from "./common.js";

const prisma = new PrismaClient();
const args = parseArgs();
const here = path.dirname(fileURLToPath(import.meta.url));

function runCatchup() {
  const result = spawnSync(process.execPath, [path.join(here, "backfill.js"), "--apply"], {
    env: { ...process.env, ALLOW_V2_BACKFILL_APPLY: "YES" }, encoding: "utf8", maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) throw new Error(`Catch-up gagal (${result.status}): ${result.stderr || result.stdout}`);
}

async function main() {
  const database = assertSafeTestDatabase();
  if (!args.apply || process.env.ALLOW_V2_CATCHUP_REHEARSAL !== "YES") {
    throw new Error("Catch-up rehearsal wajib memakai --apply dan ALLOW_V2_CATCHUP_REHEARSAL=YES pada database test/scratch.");
  }
  const route = await prisma.route.findFirst({ orderBy: { id: "asc" } });
  if (!route) throw new Error("Tidak ada Route fixture untuk catch-up rehearsal");
  const stateBefore = await prisma.deliveryRouteState.findUnique({ where: { routeId: route.id } });
  const publicationBefore = await prisma.routePublication.findUnique({ where: { routeId_publicationVersion: { routeId: route.id, publicationVersion: 1 } } });
  const marker = `[V2_CATCHUP_REHEARSAL_${Date.now()}]`;
  let changedState;
  let changedPublication;
  try {
    await prisma.route.update({ where: { id: route.id }, data: { notes: [route.notes, marker].filter(Boolean).join(" ") } });
    runCatchup();
    changedState = await prisma.deliveryRouteState.findUnique({ where: { routeId: route.id } });
    changedPublication = await prisma.routePublication.findUnique({ where: { routeId_publicationVersion: { routeId: route.id, publicationVersion: 1 } } });
  } finally {
    await prisma.route.update({ where: { id: route.id }, data: { notes: route.notes } });
    runCatchup();
  }
  const stateAfterRestore = await prisma.deliveryRouteState.findUnique({ where: { routeId: route.id } });
  const publicationAfterRestore = await prisma.routePublication.findUnique({ where: { routeId_publicationVersion: { routeId: route.id, publicationVersion: 1 } } });
  const report = {
    reportType: "production-delivery-v2-catchup-rehearsal", generatedAt: new Date().toISOString(), database, routeId: route.id,
    changedDetected: stateBefore?.sourceChecksum !== changedState?.sourceChecksum && publicationBefore?.checksum !== changedPublication?.checksum,
    restoredParity: stateBefore?.sourceChecksum === stateAfterRestore?.sourceChecksum && publicationBefore?.checksum === publicationAfterRestore?.checksum,
  };
  report.passed = report.changedDetected && report.restoredParity;
  writeReport(args.output, report);
  console.log(jsonForOutput(report));
  if (!report.passed) process.exitCode = 2;
}

main().catch((error) => {
  console.error("[v2-catchup] GAGAL:", error);
  process.exitCode = 1;
}).finally(() => prisma.$disconnect());
