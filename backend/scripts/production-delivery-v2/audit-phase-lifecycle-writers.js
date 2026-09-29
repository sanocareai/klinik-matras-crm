#!/usr/bin/env node
// Audit writer fase Production Run V2 (production_phase_runs_v2) untuk P1–P6. Read-only, statis atas src/.
//  1. Mutasi fase (update/updateMany/delete/deleteMany): HANYA productionPhaseLifecycle.js (transitionPhases) — command lain wajib lewat helper itu.
//  2. Pembuatan fase (create/createMany/upsert langsung, atau nested `phases: { create`): HANYA custody (buka intake / run dari pickup) dan P5 (run lahir di workshop).
//  3. SQL mentah INSERT/UPDATE/DELETE ke production_phase_runs_v2 di src/: dilarang.
//  4. Custody, P5 dan P6 wajib memakai transitionPhases dari helper.
//  5. Setiap `productionRun.update(... status: "COMPLETED")` wajib didahului assertRunPhasesTerminal(...) (semua fase terminal + HANDOFF selesai; tanpa auto-close).
//  6. Helper wajib mengekspor transitionPhases dan assertRunPhasesTerminal.
//   node scripts/production-delivery-v2/audit-phase-lifecycle-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const LIFECYCLE = "src/services/productionPhaseLifecycle.js";
const CUSTODY = "src/services/unitCustodyCommandService.js";
const P5 = "src/services/productionWorkshopExecutionCommandService.js";
const P6 = "src/services/productionQcHandoffCommandService.js";
const MUTATION = /\.productionPhaseRun\.(update|updateMany|delete|deleteMany)\s*\(/g;
const CREATION = /\.productionPhaseRun\.(create|createMany|upsert)\s*\(/g;
const NESTED_CREATION = /\bphases:\s*\{\s*create\b/g;
const RAW_SQL = /\b(?:insert\s+into|update|delete\s+from)\s+"?production_phase_runs_v2\b/gi;
const RUN_COMPLETION = /\.productionRun\.update\s*\(\s*\{[^)]{0,300}status:\s*"COMPLETED"/g;
const COMPLETION_GUARD = /assertRunPhasesTerminal\s*\(/;
const GUARD_WINDOW = 1600;

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
const stripComments = (text) => text.split("\n").map((line) => (line.trim().startsWith("//") ? "" : line)).join("\n");

// files: Map<relativePath, text> (dapat diganti di tes).
export function auditPhaseLifecycleWriters(files) {
  const findings = [];
  const add = (file, index, text, kind, disposition, ok) => findings.push({ file, line: index == null ? 0 : lineOf(text, index), kind, disposition, ok });
  for (const [rel, raw] of files) {
    const text = stripComments(raw.replace(/\r\n/g, "\n"));
    for (const match of text.matchAll(MUTATION)) add(rel, match.index, text, "PHASE_MUTATION", rel === LIFECYCLE ? "OWNER" : `UNOWNED_MUTATION_${match[1]}`, rel === LIFECYCLE);
    for (const match of text.matchAll(CREATION)) add(rel, match.index, text, "PHASE_CREATION", [CUSTODY, P5].includes(rel) ? "OWNER" : `UNOWNED_CREATION_${match[1]}`, [CUSTODY, P5].includes(rel));
    for (const match of text.matchAll(NESTED_CREATION)) add(rel, match.index, text, "PHASE_NESTED_CREATION", [CUSTODY, P5].includes(rel) ? "OWNER" : "UNOWNED_NESTED_CREATION", [CUSTODY, P5].includes(rel));
    for (const match of text.matchAll(RAW_SQL)) add(rel, match.index, text, "PHASE_RAW_SQL", "FORBIDDEN_RAW_SQL_WRITE", false);
    for (const match of text.matchAll(RUN_COMPLETION)) {
      const before = text.slice(Math.max(0, match.index - GUARD_WINDOW), match.index);
      const guarded = COMPLETION_GUARD.test(before);
      add(rel, match.index, text, "RUN_COMPLETION", guarded ? "GUARDED" : "MISSING_PHASE_TERMINAL_GUARD", guarded);
    }
  }
  for (const owner of [CUSTODY, P5, P6]) {
    const text = files.get(owner) || "";
    if (!/\btransitionPhases\b/.test(text) || !/productionPhaseLifecycle\.js/.test(text)) add(owner, null, "", "LIFECYCLE_HELPER", "OWNER_DOES_NOT_USE_TRANSITION_HELPER", false);
  }
  const lifecycle = files.get(LIFECYCLE) || "";
  for (const name of ["transitionPhases", "assertRunPhasesTerminal"]) {
    if (!new RegExp(String.raw`export (?:async )?function ${name}\(`).test(lifecycle)) add(LIFECYCLE, null, "", "LIFECYCLE_HELPER", `MISSING_EXPORT_${name}`, false);
  }
  return { findings };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runPhaseLifecycleWriterAudit(root = backendRoot) {
  const { findings } = auditPhaseLifecycleWriters(loadBackendSources(root));
  const count = (kind) => findings.filter((f) => f.kind === kind).length;
  return {
    reportType: "phase-lifecycle-writer-audit", generatedAt: new Date().toISOString(),
    totals: {
      mutations: count("PHASE_MUTATION"), creations: count("PHASE_CREATION") + count("PHASE_NESTED_CREATION"), rawSqlWrites: count("PHASE_RAW_SQL"),
      runCompletions: count("RUN_COMPLETION"), violations: findings.filter((f) => !f.ok).length,
    },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runPhaseLifecycleWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0) process.exitCode = 1;
}
