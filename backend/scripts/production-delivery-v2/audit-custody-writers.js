#!/usr/bin/env node
// Audit writer custody unit (Production Workshop + Warehouse V2, P1–P2). Read-only.
//  1. `unitCustodyHandoff` hanya boleh ditulis oleh command owner (services/unitCustodyCommandService.js).
//  2. Setiap penulis Unit pada jalur pickup/receive/return (status RECEIVED, IN_TRANSIT_IN, READY_FOR_DELIVERY,
//     READY_ON_CUSTOMER_HOLD, atau pembuatan unit) harus TERKLASIFIKASI. Dua jalur di armada.js (pickup selesai dan pengiriman
//     gagal) wajib memanggil offerUnitCustody(...) tepat setelah mutasi V1; penulis lain diberi status jujur
//     "PENDING_LATER_SLICE" (bukan dianggap aman) supaya gap terlihat dan penulis BARU yang tak terklasifikasi menggagalkan audit.
//   node scripts/production-delivery-v2/audit-custody-writers.js [--output=file.json]
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const backendRoot = path.resolve(here, "../..");

const HANDOFF_WRITE = /\.unitCustodyHandoff\.(create|createMany|update|updateMany|upsert|delete|deleteMany)\s*\(/g;
const UNIT_WRITE = /\.unit\.(create|createMany|update|updateMany|upsert)\s*\(/g;
const PATH_STATUS = /"(RECEIVED|IN_TRANSIT_IN|READY_FOR_DELIVERY|READY_ON_CUSTOMER_HOLD)"/;
const HANDOFF_OWNER = "src/services/unitCustodyCommandService.js";

// Klasifikasi penulis Unit di luar slice ini. Nilai = jalur yang akan menutupnya (dokumen P0 §11).
const PENDING = new Map([
  ["src/routes/orders.js", "P7: kaskade status Order dari Sales harus di-fence (Sales bukan owner state Unit)"],
  ["src/services/orderStatusSync.js", "P7: buka-kembali DELIVERED oleh sinkron Order->Unit"],
  ["src/services/unitStageEngine.js", "P3: stage engine menjadi projector V1 di bawah writer run produksi"],
  ["src/services/armadaAutoJob.js", "P6: pembuatan job pengiriman dari status unit"],
  ["src/services/unitProvisioning.js", "P2b: unit lahir di workshop (BARU/SEWA) butuh custody eksplisit"],
  ["src/services/scopeRevision.js", "P3: revisi scope mengubah unit"],
  ["src/services/productionRouting.js", "P3: routing/penugasan tahap"],
  ["src/routes/units.js", "P3/P5: endpoint unit"],
  ["src/lib/ukuranKasur.js", "di luar custody: koreksi ukuran"],
]);

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
export function auditCustodyWriters(files) {
  const findings = [];
  for (const [rel, raw] of files) {
    const text = raw.replace(/\r\n/g, "\n");
    for (const match of text.matchAll(HANDOFF_WRITE)) {
      const ok = rel === HANDOFF_OWNER;
      findings.push({ file: rel, line: lineOf(text, match.index), kind: "HANDOFF_WRITER", operation: match[1], disposition: ok ? "V2_COMMAND_OWNER" : "UNOWNED_HANDOFF_WRITER", ok });
    }
    for (const match of text.matchAll(UNIT_WRITE)) {
      const window = text.slice(match.index, match.index + 700);
      const line = lineOf(text, match.index);
      const create = match[1].startsWith("create");
      const relevant = rel === "src/services/unitProvisioning.js" ? create : PATH_STATUS.test(window.split("\n").slice(0, 7).join("\n"));
      if (!relevant) continue;
      if (rel === "src/routes/armada.js") {
        const after = text.split("\n").slice(line - 1, line + 30).join("\n");
        const hooked = /offerUnitCustody\(tx,\s*\{\s*direction:\s*"(INBOUND|RETURN)"/.test(after);
        findings.push({ file: rel, line, kind: "UNIT_PATH_WRITER", operation: match[1], disposition: hooked ? "CUSTODY_HOOKED" : "PICKUP_RETURN_PATH_WITHOUT_CUSTODY", ok: hooked });
      } else if (PENDING.has(rel)) {
        findings.push({ file: rel, line, kind: "UNIT_PATH_WRITER", operation: match[1], disposition: "PENDING_LATER_SLICE", ok: true, note: PENDING.get(rel) });
      } else {
        findings.push({ file: rel, line, kind: "UNIT_PATH_WRITER", operation: match[1], disposition: "UNOWNED_UNIT_PATH_WRITER", ok: false });
      }
    }
  }
  const armada = findings.filter((item) => item.file === "src/routes/armada.js" && item.kind === "UNIT_PATH_WRITER");
  const hooks = armada.filter((item) => item.disposition === "CUSTODY_HOOKED").length;
  return { findings, armadaHooks: hooks };
}

export function loadBackendSources(root = backendRoot) {
  const files = new Map();
  for (const file of walk(path.join(root, "src"))) files.set(path.relative(root, file).replaceAll("\\", "/"), fs.readFileSync(file, "utf8"));
  return files;
}

export function runCustodyWriterAudit(root = backendRoot) {
  const { findings, armadaHooks } = auditCustodyWriters(loadBackendSources(root));
  const count = (disposition) => findings.filter((item) => item.disposition === disposition).length;
  return {
    reportType: "unit-custody-writer-audit",
    generatedAt: new Date().toISOString(),
    totals: {
      handoffWriters: findings.filter((item) => item.kind === "HANDOFF_WRITER").length,
      unitPathWriters: findings.filter((item) => item.kind === "UNIT_PATH_WRITER").length,
      custodyHooked: count("CUSTODY_HOOKED"),
      pendingLaterSlice: count("PENDING_LATER_SLICE"),
      violations: findings.filter((item) => !item.ok).length,
      armadaHooks,
    },
    findings,
  };
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const report = runCustodyWriterAudit();
  const output = process.argv.find((arg) => arg.startsWith("--output="))?.slice(9);
  if (output) fs.writeFileSync(output, `${JSON.stringify(report, null, 2)}\n`);
  console.log(JSON.stringify(report.totals));
  if (report.totals.violations > 0 || report.totals.armadaHooks < 2) process.exitCode = 1;
}
