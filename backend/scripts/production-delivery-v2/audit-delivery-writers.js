#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { jsonForOutput, parseArgs, writeReport } from "./common.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const args = parseArgs();

const MUTATION = /\.(job|route)\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\s*\(/g;

const sourcePolicy = new Map([
  ["src/routes/armada.js", { disposition: "ROUTER_GATED_COMMAND_OWNER", marker: "executeDeliveryRouteCommand" }],
  ["src/routes/orders.js", { disposition: "CROSS_BOUNDARY_ADAPTER", marker: "executeDeliveryCrossBoundaryCommand" }],
  ["src/services/armadaAutoJob.js", { disposition: "CROSS_BOUNDARY_ADAPTER", marker: "executeDeliveryCrossBoundaryCommand" }],
  ["src/services/complaintCase.js", { disposition: "CROSS_BOUNDARY_ADAPTER", marker: "executeDeliveryCrossBoundaryCommand" }],
  ["src/services/deliveryHandoff.js", { disposition: "CROSS_BOUNDARY_ADAPTER", marker: "executeDeliveryCrossBoundaryCommand" }],
  ["src/services/orderStatusSync.js", { disposition: "CROSS_BOUNDARY_ADAPTER", marker: "executeDeliveryCrossBoundaryCommand" }],
  ["src/services/rescheduleCase.js", { disposition: "ARMADA_COMMAND_CALLBACK", marker: "openOrAdvanceCase" }],
  ["src/services/deliveryRouteCommandService.js", { disposition: "V2_COMMAND_OWNER", marker: "executeDeliveryRouteCommand" }],
  ["src/services/deliveryJobCommandService.js", { disposition: "V2_COMMAND_OWNER", marker: "executeDeliveryJobCommand" }],
  ["src/services/deliveryExecutionCommandService.js", { disposition: "V2_COMMAND_OWNER", marker: "executeDeliveryExecutionCommand" }],
  ["src/services/deliveryJobBatchCommandService.js", { disposition: "V2_COMMAND_OWNER", marker: "executeDeliveryJobBatchCommand" }],
  ["src/services/deliveryCrossBoundaryCommandService.js", { disposition: "V2_CROSS_BOUNDARY_COMMAND_OWNER", marker: "executeDeliveryCrossBoundaryCommand" }],
  ["src/services/deliveryJobCancellationService.js", { disposition: "V2_CANCELLATION_COMMAND_OWNER", marker: "cancelOrderDeliveryJobs" }],
]);

const indirectRepairScripts = new Set([
  "scripts/backfill-route-completion.js",
]);

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (/\.(?:js|mjs)$/.test(entry.name)) files.push(absolute);
  }
  return files;
}

function relative(file) {
  return path.relative(backendRoot, file).replaceAll("\\", "/");
}

function lineNumber(text, index) {
  return text.slice(0, index).split("\n").length;
}

function auditSource(file, text, matches) {
  const rel = relative(file);
  const policy = sourcePolicy.get(rel);
  if (!policy) return matches.map((match) => ({ ...match, disposition: "UNOWNED_WRITER", ok: false }));
  const markerPresent = text.includes(policy.marker);
  return matches.map((match) => ({
    ...match,
    disposition: markerPresent ? policy.disposition : "OWNER_MARKER_MISSING",
    ok: markerPresent,
  }));
}

function auditScript(file, text, matches) {
  const rel = relative(file);
  if (rel.startsWith("scripts/production-delivery-v2/")) {
    return matches.map((match) => ({ ...match, disposition: "V2_MIGRATION_OR_REHEARSAL_HARNESS", ok: true }));
  }
  const guarded = text.includes("assertLegacyDeliveryRepairAllowed") && text.includes("if (APPLY)");
  return matches.map((match) => ({
    ...match,
    disposition: guarded ? "LEGACY_REPAIR_APPLY_GUARDED" : "UNGUARDED_REPAIR_WRITER",
    ok: guarded,
  }));
}

const findings = [];
for (const rootName of ["src", "scripts"]) {
  for (const file of walk(path.join(backendRoot, rootName))) {
    const text = fs.readFileSync(file, "utf8");
    const matches = [...text.matchAll(MUTATION)].map((match) => ({
      file: relative(file),
      line: lineNumber(text, match.index),
      aggregate: match[1],
      operation: match[2],
    }));
    if (matches.length === 0 && !indirectRepairScripts.has(relative(file))) continue;
    if (matches.length === 0) {
      const guarded = text.includes("assertLegacyDeliveryRepairAllowed") && text.includes("if (APPLY)");
      findings.push({
        file: relative(file), line: null, aggregate: "route", operation: "indirect mutation",
        disposition: guarded ? "LEGACY_REPAIR_APPLY_GUARDED" : "UNGUARDED_REPAIR_WRITER",
        ok: guarded,
      });
      continue;
    }
    findings.push(...(rootName === "src" ? auditSource(file, text, matches) : auditScript(file, text, matches)));
  }
}

const failures = findings.filter((item) => !item.ok);
const report = {
  reportType: "delivery-v2-writer-ownership-audit",
  generatedAt: new Date().toISOString(),
  totals: {
    mutationSites: findings.length,
    ownedOrGuarded: findings.length - failures.length,
    unowned: failures.length,
  },
  findings,
};
writeReport(args.output, report);
console.log(jsonForOutput(report));
if (failures.length > 0) process.exitCode = 2;
