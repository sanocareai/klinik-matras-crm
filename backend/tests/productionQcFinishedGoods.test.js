// P6 — aturan murni QC V2 / rekonsiliasi override / jalur eksekusi, boundary migration, dan audit writer. Tanpa database.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { auditQcHandoffWriters, loadBackendSources, runQcHandoffWriterAudit } from "../scripts/production-delivery-v2/audit-qc-handoff-writers.js";
import { validateInspectionInput, assertRunRevision, assertExpectedRevision } from "../src/services/productionQcHandoffCommandService.js";
import { ALLOWED_RESOLUTIONS, detectRunInconsistency } from "../src/services/productionRunGuards.js";
import { workshopPathOf } from "../src/services/productionWorkshopExecutionCommandService.js";
import { PERMISSIONS as P, ROLE_PERMISSIONS } from "../src/constants/permissions.js";

const backendRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const MIGRATION = "20261003080000_production_qc_finished_goods_v2";
const sql = fs.readFileSync(path.join(backendRoot, "prisma", "migrations", MIGRATION, "migration.sql"), "utf8");
const executable = sql.replace(/\r\n/g, "\n").split("\n").filter((line) => !line.trim().startsWith("--")).join("\n");
const PHOTO = ["/media/a.jpg"];
const pass = (extra = {}) => ({ result: "PASS", photoUrls: PHOTO, referenceWeightKg: 60, ...extra });
const fail = (extra = {}) => ({ result: "FAIL", photoUrls: PHOTO, referenceWeightKg: 60, fitVerdict: "TERLALU_KERAS", note: "terlalu keras", reworkStageId: "stage-1", ...extra });
const code = (fn) => { try { fn(); return null; } catch (error) { return error.code; } };

test("validateInspectionInput: PASS/FAIL wajib foto + berat acuan; PASS hanya untuk PAS atau override+edukasi; FAIL wajib catatan, hasil uji, dan tahap rework eksplisit", () => {
  assert.equal(code(() => validateInspectionInput(pass({ photoUrls: [] }))), "QC_EVIDENCE_REQUIRED");
  assert.equal(code(() => validateInspectionInput(pass({ referenceWeightKg: 0 }))), "QC_WEIGHT_REQUIRED");
  assert.equal(code(() => validateInspectionInput(pass({ referenceWeightKg: 60.5 }))), "QC_WEIGHT_REQUIRED");
  assert.equal(code(() => validateInspectionInput(pass({ fitVerdict: "TERLALU_KERAS" }))), "QC_VERDICT_NOT_PASSING");
  assert.equal(code(() => validateInspectionInput(pass({ fitVerdict: "TERLALU_KERAS", customerPreferenceOverride: "LEBIH_KERAS" }))), "QC_VERDICT_NOT_PASSING", "override tanpa edukasi ditolak");
  assert.equal(validateInspectionInput(pass({ fitVerdict: "TERLALU_KERAS", customerPreferenceOverride: "LEBIH_KERAS", educationGiven: true })).fitVerdict, "TERLALU_KERAS");
  assert.equal(code(() => validateInspectionInput(pass({ customerPreferenceOverride: "LEBIH_KERAS" }))), "QC_VERDICT_INVALID", "override tidak berlaku untuk hasil PAS");
  assert.equal(validateInspectionInput(pass()).fitVerdict, "PAS");
  assert.equal(code(() => validateInspectionInput(pass({ items: [{ itemCode: "JAHITAN", label: "Jahitan", result: "NOT_OK" }] }))), "QC_ITEM_CONTRADICTS");
  assert.equal(code(() => validateInspectionInput(pass({ items: [{ itemCode: "OVERALL", label: "x", result: "OK" }] }))), "QC_ITEMS_INVALID");
  assert.equal(code(() => validateInspectionInput(pass({ items: [{ itemCode: "A1", label: "x", result: "OK" }, { itemCode: "A1", label: "y", result: "OK" }] }))), "QC_ITEMS_INVALID");
  assert.equal(code(() => validateInspectionInput(pass({ photoUrls: Array.from({ length: 13 }, (_, i) => `/p${i}.jpg`) }))), "QC_EVIDENCE_TOO_MANY");

  assert.equal(code(() => validateInspectionInput(fail({ note: "  " }))), "QC_NOTE_REQUIRED");
  assert.equal(code(() => validateInspectionInput(fail({ fitVerdict: "PAS" }))), "QC_FAIL_VERDICT_REQUIRED");
  assert.equal(code(() => validateInspectionInput(fail({ reworkStageId: null }))), "QC_REWORK_STAGE_REQUIRED");
  assert.equal(code(() => validateInspectionInput(fail({ customerPreferenceOverride: "LEBIH_EMPUK" }))), "QC_VERDICT_INVALID");
  assert.equal(code(() => validateInspectionInput(fail({ supplementalMaterials: [{ materialId: "m1", qty: 0 }] }))), "PLAN_BOM_QTY_INVALID");
  assert.equal(code(() => validateInspectionInput({ result: "MAYBE" })), "QC_RESULT_INVALID");
  const ok = validateInspectionInput(fail({ supplementalMaterials: [{ materialId: "m1", qty: "2" }] }));
  assert.deepEqual(ok.supplementalMaterials, [{ materialId: "m1", qty: 2 }]);
});

test("QC_WAIVED: alasan >= 10 karakter, tanpa bahan tambahan, tanpa syarat foto/berat; tidak pernah menjadi PASS", () => {
  assert.equal(code(() => validateInspectionInput({ result: "WAIVED", reason: "singkat" })), "QC_WAIVE_REASON_REQUIRED");
  assert.equal(code(() => validateInspectionInput({ result: "WAIVED", reason: "Alasan yang cukup panjang", supplementalMaterials: [{ materialId: "m", qty: 1 }] })), "QC_WAIVE_NO_MATERIAL");
  const waived = validateInspectionInput({ result: "WAIVED", reason: "Alasan yang cukup panjang" });
  assert.equal(waived.result, "WAIVED"); assert.equal(waived.reason, "Alasan yang cukup panjang");
  assert.equal(code(() => validateInspectionInput({ result: "waived", reason: "Alasan yang cukup panjang" })), null, "huruf kecil dinormalkan");
});

test("permission QC_WAIVE hanya untuk ADMIN/OWNER (bukan QC_LEAD/PRODUCTION_LEAD); QC_WRITE hak QC_LEAD + (sejak 4 Okt 2026, keputusan owner) ADMIN/OWNER", () => {
  const holders = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(P.QC_WAIVE)).map(([role]) => role).sort();
  assert.deepEqual(holders, ["ADMIN", "OWNER"]);
  assert.equal(ROLE_PERMISSIONS.ADMIN.includes(P.QC_WRITE), true);
  assert.equal(ROLE_PERMISSIONS.OWNER.includes(P.QC_WRITE), true);
  assert.equal(ROLE_PERMISSIONS.QC_LEAD.includes(P.QC_WRITE), true);
});

test("detectRunInconsistency: hanya run ACTIVE/BLOCKED dengan status unit yang diubah manual; resolusi sah per jenis konflik", () => {
  const run = (status = "ACTIVE") => ({ status, currentPhase: "QC", revision: 4 });
  assert.equal(detectRunInconsistency({ run: run(), unit: { status: "IN_PRODUCTION" } }), null);
  assert.equal(detectRunInconsistency({ run: run(), unit: { status: "RECEIVED" } }), null);
  assert.equal(detectRunInconsistency({ run: run("COMPLETED"), unit: { status: "READY_FOR_DELIVERY" } }), null, "run selesai + unit siap kirim = normal");
  assert.equal(detectRunInconsistency({ run: run("CANCELLED"), unit: { status: "CANCELLED" } }), null);
  assert.equal(detectRunInconsistency({ run: run(), unit: { status: "CANCELLED" } }).kind, "UNIT_CANCELLED");
  for (const status of ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"]) assert.equal(detectRunInconsistency({ run: run(), unit: { status } }).kind, "UNIT_MARKED_READY");
  for (const status of ["IN_TRANSIT_OUT", "DELIVERED"]) assert.equal(detectRunInconsistency({ run: run("BLOCKED"), unit: { status } }).kind, "UNIT_SHIPPED");
  assert.deepEqual(ALLOWED_RESOLUTIONS.UNIT_SHIPPED, ["ACCEPT_OVERRIDE"], "unit sudah keluar gudang: tidak boleh 'dipulihkan' dengan menebak");
  assert.ok(ALLOWED_RESOLUTIONS.UNIT_CANCELLED.includes("CANCEL_RUN"));
  assert.ok(ALLOWED_RESOLUTIONS.UNIT_MARKED_READY.includes("RESTORE_UNIT_STATUS"));
});

test("workshopPathOf: jalur dipisah oleh gerbang QC (pre-gate, gerbang, post-gate) dan executable = pre + post", () => {
  const path = [{ id: "a" }, { id: "b" }, { id: "qc", requiresQc: true }, { id: "corner" }, { id: "finish" }];
  const result = workshopPathOf(path);
  assert.deepEqual(result.stages.map((s) => s.id), ["a", "b"]);
  assert.equal(result.qcStage.id, "qc");
  assert.deepEqual(result.postQcStages.map((s) => s.id), ["corner", "finish"]);
  assert.deepEqual(result.executable.map((s) => s.id), ["a", "b", "corner", "finish"]);
  assert.equal(workshopPathOf([{ id: "a" }, { id: "qc", requiresQc: true }]).postQcStages.length, 0);
});

test("revisi run + expectedRevision wajib: 409 QC_REVISION_CONFLICT bila basi", () => {
  assert.equal(code(() => assertRunRevision({ revision: 5 }, 4)), "QC_REVISION_CONFLICT");
  assert.equal(code(() => assertRunRevision({ revision: 5 }, 5)), null);
  assert.equal(code(() => assertExpectedRevision(undefined)), "EXPECTED_REVISION_REQUIRED");
  assert.equal(code(() => assertExpectedRevision("x")), "EXPECTED_REVISION_REQUIRED");
});

test("migration P6 additif: enum value, kolom nullable, tabel baru, trigger, CHECK; satu DROP INDEX (dibuat ulang) + satu DROP NOT NULL; tanpa DROP TABLE/COLUMN/UPDATE/DELETE; LF; urutan terbaru", () => {
  assert.equal(/\b(DROP TABLE|DROP COLUMN|TRUNCATE|DELETE FROM|UPDATE\s+"|INSERT INTO|RENAME)\b/i.test(executable), false);
  assert.deepEqual([...executable.matchAll(/DROP INDEX "([^"]+)"/g)].map((m) => m[1]), ["planned_bom_lines_v2_active_material_key"]);
  assert.match(executable, /CREATE UNIQUE INDEX "planned_bom_lines_v2_active_material_key" ON "planned_bom_lines_v2"/);
  assert.deepEqual([...executable.matchAll(/ALTER COLUMN "([^"]+)" (DROP NOT NULL|SET NOT NULL|TYPE)/g)].map((m) => `${m[1]}:${m[2]}`), ["delivery_job_id:DROP NOT NULL"]);
  assert.equal(/SET NOT NULL/i.test(executable), false);
  assert.match(executable, /ALTER TYPE "UnitCustodyDirection" ADD VALUE 'FINISHED_GOODS'/);
  assert.match(executable, /CHECK \(\("direction"::text = 'FINISHED_GOODS'\) = \("delivery_job_id" IS NULL\)\)/, "INBOUND/RETURN tetap wajib Job; FINISHED_GOODS tanpa Job");
  assert.match(executable, /CREATE TRIGGER "quality_inspections_v2_immutable" BEFORE UPDATE OR DELETE ON "quality_inspections_v2"/);
  assert.match(executable, /CREATE TRIGGER "quality_inspection_items_v2_immutable" BEFORE UPDATE OR DELETE ON "quality_inspection_items_v2"/);
  assert.match(executable, /CREATE UNIQUE INDEX "production_run_exceptions_v2_open_run_key" ON "production_run_exceptions_v2"\("run_id"\) WHERE "status" = 'OPEN'/);
  assert.match(executable, /CREATE UNIQUE INDEX "material_issues_active_rework_key"/);
  assert.equal([...executable.matchAll(/ADD COLUMN\s+"([^"]+)"/g)].map((m) => m[1]).sort().join(","), "qc_fit_test_id,rework_inspection_id,supplemental_inspection_id");
  assert.equal(sql.includes("\r"), false, "migration harus LF (checksum stabil)");
  const names = fs.readdirSync(path.join(backendRoot, "prisma", "migrations"), { withFileTypes: true }).filter((e) => e.isDirectory()).map((e) => e.name).sort();
  assert.ok(names.indexOf(MIGRATION) > names.indexOf("20261001080000_production_workshop_execution_v2"), "migration P6 sesudah P5 (P8 boleh menyusul)");
  // Kontrak sebenarnya: migration P6 BERSTEMPEL UNIK dan tidak ada tabrakan stempel BARU. Versi lama menghitung "unik >= total - 3" (3 = tabrakan yang kebetulan ada
  // saat P6 ditulis) sehingga gagal begitu sesi lain menambah tabrakan sah. Kini daftar tabrakan DIKENAL eksplisit: tiap pasangan menyentuh objek DB yang terpisah
  // (diperiksa 4 Okt 2026), diurutkan deterministik oleh Prisma lewat nama folder penuh, dan TIDAK BOLEH di-rename (sudah dipakai database yang sudah migrate).
  // Tabrakan stempel BARU di luar daftar ini tetap menggagalkan tes.
  const KNOWN_SHARED_STAMPS = new Set(["20260801140000", "20260906150000", "20260928090000", "20261013090000", "20261014090000", "20261021100000", "20261102090000"]);
  // 20261102090000: production_station_pic_target_history (Produksi, LIVE 10 Okt 2026) + retur_supplier_debit_note (Finance, LIVE 10 Okt 2026). Menyentuh objek DB yang terpisah (tabel baru + 1 kolom
  // nullable di production_run_plans_v2 vs tabel retur/debit note + kolom credit_applied); diuji 10 Okt 2026 pada tiga urutan penerapan (produksi→finance, finance→produksi, sekaligus): semuanya berhasil dan
  // sidik skema identik. Sudah terpasang di production — TIDAK boleh di-rename. // 20261021100000: route_completeness_proof (live, Delivery) + production_component_qc_sections (Produksi) — nama penuh berbeda, aditif, sudah dilatih di rehearsal
  const byStamp = new Map();
  for (const n of names) byStamp.set(n.slice(0, 14), [...(byStamp.get(n.slice(0, 14)) ?? []), n]);
  const shared = [...byStamp].filter(([, v]) => v.length > 1);
  assert.deepEqual(shared.filter(([stamp]) => !KNOWN_SHARED_STAMPS.has(stamp)).map(([stamp, v]) => `${stamp}: ${v.join(" + ")}`), [], "tabrakan stempel migration BARU (selain yang dikenal)");
  assert.equal(byStamp.get(MIGRATION.slice(0, 14)).length, 1, "stempel migration P6 unik");
  for (const [, v] of shared) assert.equal(new Set(v).size, v.length, "nama folder penuh berbeda (urutan deterministik)");
});

test("writer audit P6 pada source aktual: 0 pelanggaran (inspeksi/fit test/exception/custody/completion hanya owner; pagar Order; filter antrean QC V1)", () => {
  const report = runQcHandoffWriterAudit(backendRoot);
  assert.equal(report.totals.violations, 0, JSON.stringify(report.findings.filter((f) => !f.ok)));
  assert.equal(report.totals.inspectionWriters, 1);
  assert.equal(report.totals.fitTestWriters, 1);
  assert.ok(report.totals.orderFences >= 4);
  assert.ok(report.findings.filter((f) => f.kind === "RUN_COMPLETION_WRITER").every((f) => f.file.endsWith("unitCustodyCommandService.js") || f.file.endsWith("productionQcHandoffCommandService.js")));
});

test("writer audit P6 gagal untuk: inspeksi diubah/dihapus, fit test/exception/custody ditulis pihak lain, run di-COMPLETED pihak lain, pagar Order dihapus, P6 menulis stok", () => {
  const sources = loadBackendSources(backendRoot);
  const kinds = (files) => auditQcHandoffWriters(files).findings.filter((f) => !f.ok).map((f) => f.kind).sort();
  const liar = new Map(sources);
  liar.set("src/routes/liar.js", [
    "await tx.qualityInspection.update({ where: {}, data: {} });", "await tx.qualityInspection.delete({ where: {} });",
    "await tx.qcFitTest.create({ data: {} });", "await tx.productionRunException.update({ where: {}, data: {} });",
    "await tx.unitCustodyHandoff.update({ where: {}, data: {} });", "await tx.productionRun.update({ where: {}, data: { status: \"COMPLETED\" } });",
    "await markUnitReadyForDeliveryInTx(tx, unitId);", "await tx.unit.update({ where: {}, data: { status: \"READY_FOR_DELIVERY\" } });",
  ].join("\n"));
  const found = kinds(liar);
  for (const expected of ["CUSTODY_HANDOFF_WRITER", "FIT_TEST_WRITER", "IMMUTABLE_INSPECTION_MUTATION", "QC_INSPECTION_WRITER", "READY_FOR_DELIVERY_WRITER", "RUN_COMPLETION_WRITER", "RUN_EXCEPTION_WRITER", "UNIT_STATUS_WRITER"]) {
    assert.ok(found.includes(expected), `${expected} harus terdeteksi: ${found.join(",")}`);
  }
  const noFence = new Map(sources); noFence.set("src/routes/orders.js", sources.get("src/routes/orders.js").replaceAll("await assertOrderUnitsNotV2Owned(tx,", "await noop(tx,"));
  assert.ok(kinds(noFence).includes("ORDER_FENCE"));
  const noFilter = new Map(sources); noFilter.set("src/routes/production.js", sources.get("src/routes/production.js").replace("productionRunsV2: { none: { origin: { not: null } } }", "x: 1"));
  assert.ok(kinds(noFilter).includes("QC_QUEUE_FILTER"));
  const noDefer = new Map(sources); noDefer.set("src/services/productionWorkshopExecutionCommandService.js", sources.get("src/services/productionWorkshopExecutionCommandService.js").replace("deferReady: true", "deferReady: false"));
  assert.ok(kinds(noDefer).includes("P5_DEFER_READY"));
  const stock = new Map(sources); stock.set("src/services/productionQcHandoffCommandService.js", `${sources.get("src/services/productionQcHandoffCommandService.js")}\nawait tx.stockMovement.create({ data: {} });\nawait postMaterialIssueCost(tx, {});\n`);
  const p6 = auditQcHandoffWriters(stock).findings.filter((f) => f.kind === "P6_FORBIDDEN_WRITE").map((f) => f.disposition).sort();
  assert.deepEqual(p6, ["FORBIDDEN_postMaterialIssueCost", "FORBIDDEN_stockMovement"]);
});
