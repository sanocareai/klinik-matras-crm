#!/usr/bin/env node
// Audit writer Production Experience V2 (P8). Read-only, statis atas src/.
//  1. production_step_evidence_v2: HANYA command owner P8 (bukti tahap) dan command owner P10B (dokumentasi, stepCode DOC_*), HANYA create
//     (immutable: update/upsert/delete di mana pun = pelanggaran). Command dokumentasi TIDAK boleh menulis lifecycle (run/operasi/fase/unit/stok/
//     revisi) dan loadStepContext WAJIB memisahkan baris DOC_ dari lifecycle (isDocumentationRow).
//  2. production_material_shortages_v2: HANYA command owner P8.
//  3. Command P8 TIDAK menulis langsung operasi/run/fase/ledger tahap/unit/stok/reservasi/HPP/jurnal — transisi lewat helper P5 (apply*InTx).
//  4. Command P8 wajib memakai deriveNextAction + validateStepEvidence + helper P5 (applyStartInTx/applyCompleteInTx/applyPauseInTx/applyResumeInTx).
//  5. Read-model & router P8 tidak menulis apa pun (hanya memanggil command owner).
//  6. Tidak ada kode P8 yang menandai outbox terkirim (status DELIVERED/SENT) — consumer broadcast belum ada; status tetap PENDING.
//   node scripts/production-delivery-v2/audit-production-experience-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const OPS = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";
const STEP = "src/services/productionStepCommandService.js";
const READ = "src/services/productionExperienceReadService.js";
const ROUTE = "src/routes/productionExperience.js";
const MEDIA = "src/routes/productionEvidenceMedia.js";
const DOC_SERVICE = "src/services/productionDocumentationService.js";
const DOC_READ = "src/services/productionDocumentationRead.js";
const DOC_ROUTE = "src/routes/productionDocumentation.js";
const LIFECYCLE_HELPERS = /\b(applyStartInTx|applyCompleteInTx|applyPauseInTx|applyResumeInTx|prepareStartInTx|bumpRunRevisionInTx|transitionPhases)\b/;
const writeRegex = (model) => new RegExp(String.raw`\.${model}\.${OPS}\s*\(`, "g");
const FORBIDDEN_IN_STEP = [
  ["productionOperationRun", writeRegex("productionOperationRun")], ["productionRun", writeRegex("productionRun")],
  ["productionPhaseRun", writeRegex("productionPhaseRun")], ["unitStageLog", writeRegex("unitStageLog")], ["unit", writeRegex("unit")],
  ["stockMovement", writeRegex("stockMovement")], ["materialReservation", writeRegex("materialReservation")], ["materialIssue", writeRegex("materialIssue")],
  ["postStockMovement", /\bpostStockMovement\b/], ["postMaterialIssueCost", /\bpostMaterialIssueCost\b/], ["journal", /\bjournalEntry\b|\bpostJournal\b|\bbukukanPergerakan\b/],
];
const REQUIRED_IN_STEP = ["deriveNextAction", "validateStepEvidence", "applyStartInTx", "applyCompleteInTx", "applyPauseInTx", "applyResumeInTx", "prepareStartInTx"];
const ANY_WRITE = new RegExp(String.raw`\.[a-zA-Z]+\.${OPS}\s*\(|\$executeRaw`, "g");
const OUTBOX_DELIVERED = /domainOutbox\.[a-zA-Z]+\([^)]*status:\s*"(DELIVERED|SENT|PUBLISHED)"/;

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
export function auditProductionExperienceWriters(files) {
  const findings = [];
  const add = (file, index, text, kind, disposition, ok) => findings.push({ file, line: index == null ? 0 : lineOf(text, index), kind, disposition, ok });
  for (const [rel, raw] of files) {
    const text = stripComments(raw.replace(/\r\n/g, "\n"));
    for (const match of text.matchAll(writeRegex("productionStepEvidence"))) {
      const ok = (rel === STEP || rel === DOC_SERVICE) && match[1] === "create";
      add(rel, match.index, text, "STEP_EVIDENCE_WRITER", ok ? (rel === DOC_SERVICE ? "DOCUMENTATION_OWNER_CREATE" : "OWNER_CREATE") : match[1] === "create" ? "UNOWNED_WRITER" : `IMMUTABLE_VIOLATION_${match[1]}`, ok);
    }
    for (const match of text.matchAll(writeRegex("productionMaterialShortage"))) {
      add(rel, match.index, text, "SHORTAGE_WRITER", rel === STEP ? "OWNER" : "UNOWNED_WRITER", rel === STEP);
    }
    if ([STEP, READ, ROUTE, MEDIA].includes(rel) && OUTBOX_DELIVERED.test(text)) add(rel, null, "", "OUTBOX_STATUS", "P8_MARKS_OUTBOX_DELIVERED", false);
  }
  const step = stripComments((files.get(STEP) || "").replace(/\r\n/g, "\n"));
  for (const [name, regex] of FORBIDDEN_IN_STEP) {
    for (const match of step.matchAll(new RegExp(regex.source, "g"))) add(STEP, match.index, step, "STEP_FORBIDDEN_WRITE", `FORBIDDEN_${name}`, false);
  }
  for (const name of REQUIRED_IN_STEP) {
    if (!new RegExp(String.raw`\b${name}\(`).test(step)) add(STEP, null, "", "STEP_CANONICAL_PATH", `MISSING_${name}`, false);
  }
  // Command dokumentasi: tidak menulis lifecycle, tidak memanggil helper lifecycle, dan menulis HANYA baris DOC_ (docStepCode).
  const docSvc = stripComments((files.get(DOC_SERVICE) || "").replace(/\r\n/g, "\n"));
  if (docSvc) {
    for (const [name, regex] of FORBIDDEN_IN_STEP) for (const match of docSvc.matchAll(new RegExp(regex.source, "g"))) add(DOC_SERVICE, match.index, docSvc, "DOC_FORBIDDEN_WRITE", `FORBIDDEN_${name}`, false);
    const helper = LIFECYCLE_HELPERS.exec(docSvc);
    if (helper) add(DOC_SERVICE, helper.index, docSvc, "DOC_LIFECYCLE_HELPER", `FORBIDDEN_${helper[1]}`, false);
    if (!/docStepCode\(/.test(docSvc)) add(DOC_SERVICE, null, "", "DOC_MARKER", "MISSING_docStepCode", false);
    if (!/deriveDocSource\(/.test(docSvc)) add(DOC_SERVICE, null, "", "DOC_SOURCE", "MISSING_deriveDocSource", false);
  }
  if (files.has(DOC_SERVICE) && !/isDocumentationRow\(/.test(step)) add(STEP, null, "", "DOC_LIFECYCLE_ISOLATION", "MISSING_isDocumentationRow_in_loadStepContext", false);
  for (const rel of [READ, ROUTE, DOC_READ, DOC_ROUTE]) {
    const text = stripComments((files.get(rel) || "").replace(/\r\n/g, "\n"));
    for (const match of text.matchAll(ANY_WRITE)) add(rel, match.index, text, "READ_MODEL_WRITE", "READ_MODEL_MUST_NOT_WRITE", false);
  }
  return { findings };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runProductionExperienceWriterAudit(root = backendRoot) {
  const { findings } = auditProductionExperienceWriters(loadBackendSources(root));
  const count = (kind) => findings.filter((f) => f.kind === kind).length;
  return {
    reportType: "production-experience-writer-audit", generatedAt: new Date().toISOString(),
    totals: { evidenceWriters: count("STEP_EVIDENCE_WRITER"), shortageWriters: count("SHORTAGE_WRITER"), violations: findings.filter((f) => !f.ok).length },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runProductionExperienceWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0) process.exitCode = 1;
}
