#!/usr/bin/env node
// Audit writer QC V2 / barang jadi / status unit / penyelesaian run (Production Workshop + Warehouse V2, P6). Read-only, statis atas src/.
//  1. quality_inspections_v2: HANYA command owner P6 dan HANYA create (immutable: update/delete di mana pun = pelanggaran).
//  2. quality_inspection_items_v2: tidak ada penulisan langsung (hanya nested create di dalam inspeksi).
//  3. qc_fit_tests (proyeksi V1): HANYA stage engine (recordQcFitTestInTx) — command V2 memakai varian *InTx-nya, bukan menulis sendiri.
//  4. production_run_exceptions_v2: HANYA command owner P6.
//  5. unit_custody_handoffs_v2 (termasuk FINISHED_GOODS): HANYA custody service.
//  6. Penyelesaian run (productionRun.update ... status: "COMPLETED"): HANYA custody service (Gudang menerima barang jadi) dan P6 (ACCEPT_OVERRIDE).
//  7. markUnitReadyForDeliveryInTx (unit READY_FOR_DELIVERY untuk unit V2) dipanggil HANYA dari custody service.
//  8. Penulis Unit.status di src/: hanya engine (primitive *InTx) + jalur V1 yang DIKENAL (orders/armada/orderStatusSync); jalur Order V1 wajib
//     memakai pagar assertOrderUnitsNotV2Owned (>= 4 pemanggilan); antrean QC V1 wajib menyaring unit yang QC-nya dimiliki V2.
//  9. P6 tidak menulis stok/reservasi/HPP/jurnal sendiri (bahan tambahan lewat fungsi P3/P4), dan wajib memakai primitive engine QC.
// 10. P5 wajib memakai deferReady:true saat menyelesaikan tahap (unit V2 tidak pernah READY_FOR_DELIVERY dari engine).
//   node scripts/production-delivery-v2/audit-qc-handoff-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");
const OPS = "(create|createMany|update|updateMany|upsert|delete|deleteMany)";
const P6 = "src/services/productionQcHandoffCommandService.js";
const P5 = "src/services/productionWorkshopExecutionCommandService.js";
const CUSTODY = "src/services/unitCustodyCommandService.js";
const ENGINE = "src/services/unitStageEngine.js";
const ORDERS = "src/routes/orders.js";
const PRODUCTION_ROUTE = "src/routes/production.js";
// Penulis Unit.status yang dikenal (perubahan status di luar produksi/QC: pengiriman, sinkron order, provisioning).
const KNOWN_UNIT_STATUS_WRITERS = new Set([ENGINE, ORDERS, "src/routes/armada.js", "src/services/orderStatusSync.js", "src/services/unitProvisioning.js", "src/services/complaintCase.js"]);

const writeRegex = (model) => new RegExp(String.raw`\.${model}\.${OPS}\s*\(`, "g");
const RULES = [
  { kind: "QC_INSPECTION_WRITER", regex: writeRegex("qualityInspection"), owners: [P6] },
  { kind: "QC_INSPECTION_ITEM_WRITER", regex: writeRegex("qualityInspectionItem"), owners: [] },
  { kind: "FIT_TEST_WRITER", regex: writeRegex("qcFitTest"), owners: [ENGINE] },
  { kind: "RUN_EXCEPTION_WRITER", regex: writeRegex("productionRunException"), owners: [P6] },
  { kind: "CUSTODY_HANDOFF_WRITER", regex: writeRegex("unitCustodyHandoff"), owners: [CUSTODY] },
];
const IMMUTABLE_OPS = /\.qualityInspection(?:Item)?\.(update|updateMany|upsert|delete|deleteMany)\s*\(/g;
const RUN_COMPLETION = /\.productionRun\.update\s*\(\s*\{[^)]{0,300}status:\s*"COMPLETED"/g;
const FORBIDDEN_IN_P6 = [
  ["stockMovement", writeRegex("stockMovement")], ["materialReservation", writeRegex("materialReservation")], ["postStockMovement", /\bpostStockMovement\b/],
  ["postMaterialIssueCost", /\bpostMaterialIssueCost\b/], ["journal", /\bjournalEntry\b|\bpostJournal\b|\bbukukanPergerakan\b/],
];
const REQUIRED_ENGINE_CALLS_P6 = ["recordQcFitTestInTx", "waiveQcGateInTx", "startStageInTx", "reopenStageBeforeQcInTx", "restoreUnitStatusInTx", "isUnitPathDoneInTx"];
const REQUIRED_ORDER_FENCES = 4;

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
const stripComments = (text) => text.split("\n").filter((line) => !line.trim().startsWith("//")).join("\n");

// files: Map<relativePath, text> (dapat diganti di tes).
export function auditQcHandoffWriters(files) {
  const findings = [];
  const add = (file, line, kind, disposition, ok) => findings.push({ file, line, kind, disposition, ok });

  for (const [rel, raw] of files) {
    const text = raw.replace(/\r\n/g, "\n");
    for (const { kind, regex, owners } of RULES) {
      for (const match of text.matchAll(regex)) {
        const ok = owners.includes(rel);
        add(rel, lineOf(text, match.index), kind, ok ? "OWNER" : "UNOWNED_WRITER", ok);
      }
    }
    for (const match of text.matchAll(IMMUTABLE_OPS)) add(rel, lineOf(text, match.index), "IMMUTABLE_INSPECTION_MUTATION", `FORBIDDEN_${match[1]}`, false);
    for (const match of text.matchAll(RUN_COMPLETION)) {
      const ok = rel === CUSTODY || rel === P6;
      add(rel, lineOf(text, match.index), "RUN_COMPLETION_WRITER", ok ? "OWNER" : "UNOWNED_WRITER", ok);
    }
    if (rel !== CUSTODY && rel !== ENGINE && /\bmarkUnitReadyForDeliveryInTx\s*\(/.test(stripComments(text))) add(rel, 0, "READY_FOR_DELIVERY_WRITER", "UNOWNED_CALLER", false);
    for (const match of text.matchAll(/\.unit\.(update|updateMany)\s*\(/g)) {
      if (!/\bstatus\s*:/.test(text.slice(match.index, match.index + 260))) continue;
      const ok = KNOWN_UNIT_STATUS_WRITERS.has(rel);
      add(rel, lineOf(text, match.index), "UNIT_STATUS_WRITER", ok ? "KNOWN_PATH" : "UNKNOWN_UNIT_STATUS_WRITER", ok);
    }
  }

  const p6 = stripComments((files.get(P6) || "").replace(/\r\n/g, "\n"));
  for (const [name, regex] of FORBIDDEN_IN_P6) {
    if (regex.test(p6)) add(P6, 0, "P6_FORBIDDEN_WRITE", `FORBIDDEN_${name}`, false);
  }
  for (const fn of REQUIRED_ENGINE_CALLS_P6) {
    if (!new RegExp(`\\b${fn}\\(`).test(p6)) add(P6, 0, "P6_CANONICAL_PATH", `MISSING_${fn}`, false);
  }
  const orders = (files.get(ORDERS) || "").replace(/\r\n/g, "\n");
  const orderFences = (orders.match(/await assertOrderUnitsNotV2Owned\(tx,/g) || []).length;
  if (orderFences < REQUIRED_ORDER_FENCES) add(ORDERS, 0, "ORDER_FENCE", `FENCES_${orderFences}_LT_${REQUIRED_ORDER_FENCES}`, false);
  const productionRoute = (files.get(PRODUCTION_ROUTE) || "").replace(/\r\n/g, "\n");
  if (!productionRoute.includes("productionRunsV2: { none: { origin: { not: null } } }")) add(PRODUCTION_ROUTE, 0, "QC_QUEUE_FILTER", "MISSING_V2_FILTER", false);
  const p5 = (files.get(P5) || "").replace(/\r\n/g, "\n");
  if (!/completeStageInTx\([^)]*deferReady:\s*true/.test(p5)) add(P5, 0, "P5_DEFER_READY", "MISSING_DEFER_READY", false);
  return { findings, orderFences };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runQcHandoffWriterAudit(root = backendRoot) {
  const { findings, orderFences } = auditQcHandoffWriters(loadBackendSources(root));
  const count = (kind) => findings.filter((f) => f.kind === kind).length;
  return {
    reportType: "qc-handoff-writer-audit", generatedAt: new Date().toISOString(),
    totals: {
      inspectionWriters: count("QC_INSPECTION_WRITER"), fitTestWriters: count("FIT_TEST_WRITER"), exceptionWriters: count("RUN_EXCEPTION_WRITER"), custodyHandoffWriters: count("CUSTODY_HANDOFF_WRITER"),
      runCompletionWriters: count("RUN_COMPLETION_WRITER"), unitStatusWriters: count("UNIT_STATUS_WRITER"), orderFences: orderFences, violations: findings.filter((f) => !f.ok).length,
    },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runQcHandoffWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0) {
    for (const f of report.findings.filter((x) => !x.ok)) console.error(`  ! ${f.kind} ${f.file}:${f.line} ${f.disposition}`);
    process.exitCode = 1;
  }
}
