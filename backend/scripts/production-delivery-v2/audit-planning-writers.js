#!/usr/bin/env node
// Audit writer Planning Produksi H-1 (Production Workshop + Warehouse V2, P3). Read-only.
// production_run_plans_v2 / planned_bom_lines_v2 / material_reservations_v2 HANYA boleh ditulis oleh
// productionPlanningCommandService.js (command owner tunggal) — penulis lain = pelanggaran.
//   node scripts/production-delivery-v2/audit-planning-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");

const WRITE_OPS = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";
const WRITERS = [
  { kind: "PLAN_WRITER", regex: new RegExp(`\\.productionRunPlan\\.${WRITE_OPS}\\s*\\(`, "g") },
  { kind: "BOM_LINE_WRITER", regex: new RegExp(`\\.plannedBOMLine\\.${WRITE_OPS}\\s*\\(`, "g") },
  { kind: "RESERVATION_WRITER", regex: new RegExp(`\\.materialReservation\\.${WRITE_OPS}\\s*\\(`, "g") },
];
const OWNER = "src/services/productionPlanningCommandService.js";

function walk(root) {
  const files = [];
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const absolute = path.join(root, entry.name);
    if (entry.isDirectory()) files.push(...walk(absolute));
    else if (/\.(?:js|mjs)$/.test(entry.name) && !/\.test\./.test(entry.name)) files.push(absolute);
  }
  return files;
}

const lineOf = (text, index) => text.slice(0, index).split("\n").length;

// files: Map<relativePath, text> (dapat diganti di tes).
export function auditPlanningWriters(files) {
  const findings = [];
  for (const [rel, raw] of files) {
    const text = raw.replace(/\r\n/g, "\n");
    for (const { kind, regex } of WRITERS) {
      for (const match of text.matchAll(regex)) {
        const ok = rel === OWNER;
        findings.push({ file: rel, line: lineOf(text, match.index), kind, operation: match[1], disposition: ok ? "V2_COMMAND_OWNER" : "UNOWNED_PLANNING_WRITER", ok });
      }
    }
  }
  return { findings };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runPlanningWriterAudit(root = backendRoot) {
  const { findings } = auditPlanningWriters(loadBackendSources(root));
  return {
    reportType: "production-planning-writer-audit",
    generatedAt: new Date().toISOString(),
    totals: {
      planWriters: findings.filter((item) => item.kind === "PLAN_WRITER").length,
      bomLineWriters: findings.filter((item) => item.kind === "BOM_LINE_WRITER").length,
      reservationWriters: findings.filter((item) => item.kind === "RESERVATION_WRITER").length,
      violations: findings.filter((item) => !item.ok).length,
    },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runPlanningWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0) process.exitCode = 1;
}
