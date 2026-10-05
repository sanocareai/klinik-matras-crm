#!/usr/bin/env node
// Audit writer Eksekusi Workshop (Production Workshop + Warehouse V2, P5). Read-only.
//  1. production_operation_runs_v2: HANYA command owner P5 (eksekusi) dan P6 (penutupan/pembatalan run).
//  2. production_phase_runs_v2 / production_runs_v2: HANYA custody (P1-P2 buka intake; P6 keputusan Gudang atas barang jadi), command owner P5, dan command owner P6 (QC/handoff/rekonsiliasi);
//     transisi fase (update) hanya lewat productionPhaseLifecycle.js — dikunci lebih ketat oleh audit-phase-lifecycle-writers.js.
//  3. unit_stage_logs: HANYA stage engine (unitStageEngine.js) — P5 memakai varian *InTx-nya, tidak menulis ledger tahap sendiri.
//  4. P5 TIDAK boleh menyentuh stok/reservasi/HPP: tanpa stockMovement, postStockMovement, materialReservation, postMaterialIssueCost, jurnal.
//  5. Engine V1 wajib memagari (assertNotV2ExecutionOwned) SETIAP fungsi penulis ledger tahap V1, diperiksa PER FUNGSI (start/recordDone/complete/pause/resume/fail/skip/qc/adminBypass).
//   node scripts/production-delivery-v2/audit-workshop-execution-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const OPS = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";
const P5 = "src/services/productionWorkshopExecutionCommandService.js";
const CUSTODY = "src/services/unitCustodyCommandService.js";
const P6 = "src/services/productionQcHandoffCommandService.js";
const ENGINE = "src/services/unitStageEngine.js";
const LIFECYCLE = "src/services/productionPhaseLifecycle.js";
const writeRegex = (model) => new RegExp(String.raw`\.${model}\.${OPS}\s*\(`, "g");
const RULES = [
  { kind: "OPERATION_RUN_WRITER", regex: writeRegex("productionOperationRun"), owners: [P5, P6] },
  { kind: "PHASE_RUN_WRITER", regex: writeRegex("productionPhaseRun"), owners: [CUSTODY, P5, P6, LIFECYCLE] },
  { kind: "RUN_WRITER", regex: writeRegex("productionRun"), owners: [CUSTODY, P5, P6] },
  { kind: "STAGE_LOG_WRITER", regex: writeRegex("unitStageLog"), owners: [ENGINE] },
];
const FORBIDDEN_IN_P5 = [
  ["stockMovement", writeRegex("stockMovement")], ["postStockMovement", /\bpostStockMovement\b/], ["materialReservation", writeRegex("materialReservation")],
  ["postMaterialIssueCost", /\bpostMaterialIssueCost\b/], ["journal", /\bjournalEntry\b|\bpostJournal\b|\bbukukanPergerakan\b/],
];
// SETIAP fungsi penulis ledger tahap V1 wajib dipagari — diperiksa PER FUNGSI (bukan sekadar jumlah), dan pagar hanya sah di fungsi yang
// punya parameter unitId (pagar di fungsi tanpa unitId = ReferenceError saat runtime, mematahkan V1) serta tidak di varian *InTx.
const FENCED_ENGINE_FUNCTIONS = ["startStage", "recordStageDone", "completeStage", "pauseStage", "resumeStage", "failStage", "skipStage", "recordQcFitTest", "adminBypassProduction"];
// P12B.6: gerbang kini membawa konteks (apa yang ditulis + aktor) untuk penanda drift: assertNotV2ExecutionOwned(tx, unitId, "<apa>", actorId). Kontraknya TETAP:
// dipanggil dengan (tx, unitId, ...) di SETIAP fungsi penulis ledger V1. Pemanggilan bentuk lain (mis. resolveBlocker: existing.unitId, hanya-penanda) BUKAN pagar.
const FENCE_CALL = /await assertNotV2ExecutionOwned\(tx, unitId(?:, [^)]*)?\)/;

// Badan fungsi top-level: dari "function NAME(" sampai deklarasi top-level berikutnya (tanpa parser; cukup untuk engine ini).
function functionBodies(text) {
  const heads = [...text.matchAll(/^(?:export )?(?:async )?function (\w+)\(([^)]*)\)/gm)];
  return heads.map((match, index) => ({ name: match[1], params: match[2], body: text.slice(match.index, heads[index + 1]?.index ?? text.length) }));
}

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
export function auditWorkshopExecutionWriters(files) {
  const findings = [];
  for (const [rel, raw] of files) {
    const text = raw.replace(/\r\n/g, "\n");
    for (const { kind, regex, owners } of RULES) {
      for (const match of text.matchAll(regex)) {
        const ok = owners.includes(rel);
        findings.push({ file: rel, line: lineOf(text, match.index), kind, operation: match[1], disposition: ok ? "OWNER" : "UNOWNED_WRITER", ok });
      }
    }
  }
  const p5 = (files.get(P5) || "").replace(/\r\n/g, "\n");
  const code = p5.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");
  for (const [name, regex] of FORBIDDEN_IN_P5) {
    if (regex.test(code)) findings.push({ file: P5, line: 0, kind: "P5_FORBIDDEN_WRITE", disposition: `FORBIDDEN_${name}`, ok: false });
  }
  const usesEngine = ["startStageInTx", "pauseStageInTx", "resumeStageInTx", "completeStageInTx"].every((fn) => new RegExp(`\\b${fn}\\(`).test(code));
  if (!usesEngine) findings.push({ file: P5, line: 0, kind: "P5_CANONICAL_PATH", disposition: "MISSING_ENGINE_INTX_CALLS", ok: false });
  const engine = (files.get(ENGINE) || "").replace(/\r\n/g, "\n");
  const functions = functionBodies(engine);
  let fences = 0;
  for (const name of FENCED_ENGINE_FUNCTIONS) {
    const fn = functions.find((f) => f.name === name);
    if (fn && FENCE_CALL.test(fn.body)) fences += 1;
    else findings.push({ file: ENGINE, line: 0, kind: "ENGINE_FENCE", disposition: `MISSING_FENCE_${name}`, ok: false });
  }
  for (const fn of functions) {
    if (FENCE_CALL.test(fn.body) && !/\bunitId\b/.test(fn.params)) findings.push({ file: ENGINE, line: 0, kind: "ENGINE_FENCE", disposition: `FENCE_WITHOUT_UNITID_${fn.name}`, ok: false });
    if (/InTx$/.test(fn.name) && FENCE_CALL.test(fn.body)) findings.push({ file: ENGINE, line: 0, kind: "ENGINE_FENCE", disposition: `FENCE_IN_INTX_${fn.name}`, ok: false });
  }
  return { findings, usesEngine, engineFences: fences };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runWorkshopExecutionWriterAudit(root = backendRoot) {
  const { findings, usesEngine, engineFences } = auditWorkshopExecutionWriters(loadBackendSources(root));
  const count = (kind) => findings.filter((f) => f.kind === kind).length;
  return {
    reportType: "workshop-execution-writer-audit", generatedAt: new Date().toISOString(),
    totals: {
      operationRunWriters: count("OPERATION_RUN_WRITER"), phaseRunWriters: count("PHASE_RUN_WRITER"), runWriters: count("RUN_WRITER"),
      stageLogWriters: count("STAGE_LOG_WRITER"), violations: findings.filter((f) => !f.ok).length, usesEngine, engineFences,
    },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runWorkshopExecutionWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0) process.exitCode = 1;
}
