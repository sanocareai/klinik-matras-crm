#!/usr/bin/env node
// Audit writer Pengambilan Bahan Produksi (Production Workshop + Warehouse V2, P4). Read-only.
//  1. material_issues / material_issue_lines: HANYA V1 (routes/materialIssue.js, yang menolak memutasi dokumen milik V2)
//     dan command owner P4 (services/productionMaterialIssueCommandService.js).
//  2. material_reservations_v2: HANYA command owner P3 (planning) dan P4 (transisi CONSUMED).
//  3. stock_movements: HANYA lewat inventoryLedger.postStockMovement (satu-satunya penulis ledger) — tidak ada ledger paralel.
//  4. Command owner P4 wajib memanggil postStockMovement dan postMaterialIssueCost (HPP kanonis), dan TIDAK boleh menulis
//     jurnal/HPP sendiri (tanpa journalEntry.create / postJournal langsung).
//   node scripts/production-delivery-v2/audit-material-issue-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const OPS = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";
const V1 = "src/routes/materialIssue.js";
const P4 = "src/services/productionMaterialIssueCommandService.js";
const P3 = "src/services/productionPlanningCommandService.js";
const LEDGER = "src/services/inventoryLedger.js";
const writeRegex = (model) => new RegExp(String.raw`\.${model}\.${OPS}\s*\(`, "g");
const RULES = [
  { kind: "MATERIAL_ISSUE_WRITER", regex: writeRegex("materialIssue"), owners: [V1, P4] },
  { kind: "MATERIAL_ISSUE_LINE_WRITER", regex: writeRegex("materialIssueLine"), owners: [V1, P4] },
  { kind: "RESERVATION_WRITER", regex: writeRegex("materialReservation"), owners: [P3, P4] },
  { kind: "STOCK_MOVEMENT_WRITER", regex: writeRegex("stockMovement"), owners: [LEDGER] },
];

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
export function auditMaterialIssueWriters(files) {
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
  // Command owner P4 harus memakai jalur kanonis dan tidak boleh menulis jurnal/HPP sendiri.
  const p4 = (files.get(P4) || "").replace(/\r\n/g, "\n");
  const usesLedger = /postStockMovement\(tx,/.test(p4);
  const usesHpp = /postMaterialIssueCost\(tx,/.test(p4);
  const ownJournal = /\.journalEntry\.(create|createMany)|\bpostJournal\(|\bbukukanPergerakan\(/.test(p4);
  if (!usesLedger) findings.push({ file: P4, line: 0, kind: "P4_CANONICAL_PATH", disposition: "MISSING_postStockMovement", ok: false });
  if (!usesHpp) findings.push({ file: P4, line: 0, kind: "P4_CANONICAL_PATH", disposition: "MISSING_postMaterialIssueCost", ok: false });
  if (ownJournal) findings.push({ file: P4, line: 0, kind: "P4_CANONICAL_PATH", disposition: "OWN_JOURNAL_WRITE_FORBIDDEN", ok: false });
  return { findings, canonical: { usesLedger, usesHpp, ownJournal } };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runMaterialIssueWriterAudit(root = backendRoot) {
  const { findings, canonical } = auditMaterialIssueWriters(loadBackendSources(root));
  const count = (kind) => findings.filter((f) => f.kind === kind).length;
  return {
    reportType: "material-issue-writer-audit", generatedAt: new Date().toISOString(),
    totals: {
      issueWriters: count("MATERIAL_ISSUE_WRITER"), lineWriters: count("MATERIAL_ISSUE_LINE_WRITER"),
      reservationWriters: count("RESERVATION_WRITER"), stockMovementDirectWriters: count("STOCK_MOVEMENT_WRITER"),
      violations: findings.filter((f) => !f.ok).length, ...canonical,
    },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runMaterialIssueWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0) process.exitCode = 1;
}
