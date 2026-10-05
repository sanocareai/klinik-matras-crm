// Simplifikasi Production slice 2 — kontrak MURNI flow adaptasi (tanpa DB): derivasi aksi, tahap yang ditutup per tahap routing, bukti SKIPPED, penghalang Selesaikan Produksi,
// pemisahan kepemilikan penutup run, dan larangan nilai palsu (QC PASS/WAIVED, custody ACCEPTED, foto).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { SKIP_OUTCOME, SKIP_REASON, deriveNextAction, isSkippedEvidence, skippedEvidencePayload, stepsCoveredByStage } from "../src/lib/domain/productionSteps.js";
import { finishBlockersOf, isAdaptationRun } from "../src/services/productionWorkshopExecutionCommandService.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");
const base = { runStatus: "ACTIVE", currentPhase: "PROCESS", unitStatus: "IN_PRODUCTION", activeOp: null, opEvidence: [], step9SinceQc: false, serviceSet: true, pathHasModules: true, materialReady: true, diagnosisManualMapped: true, diagnosisBomHasLines: true };

test("derivasi: adaptasi — di gerbang QC, Meja LANJUT ke Corner lewat tahap 9 (QC tidak dilakukan); tanpa adaptasi tetap menunggu QC resmi", () => {
  const gate = { code: "fit_test", phase: "MODULE", sequence: 90, requiresQc: true, isPostQc: false, done: false };
  assert.deepEqual(deriveNextAction({ ...base, target: gate, adaptation: true }), { actor: "TABLE", stepNo: 9, action: "HANDOFF", qcNotPerformed: true });
  const legacy = deriveNextAction({ ...base, target: gate, adaptation: false });
  assert.deepEqual([legacy.action, legacy.wait, legacy.actor], ["WAIT", "AWAITING_QC", "QC"]);
});

test("derivasi: adaptasi — setelah Corner (tahap 9 tercatat) lanjut 10 -> 12; semua tahap tuntas = siap Selesaikan Produksi (bukan FINISH berulang)", () => {
  const corner = { code: "corner_sewing", phase: "FINISH", sequence: 100, requiresQc: false, isPostQc: true, done: false };
  assert.deepEqual([deriveNextAction({ ...base, target: corner, adaptation: true, step9SinceQc: true }).stepNo, deriveNextAction({ ...base, target: corner, adaptation: true, step9SinceQc: true }).action], [10, "START_CORNER"]);
  assert.equal(deriveNextAction({ ...base, target: corner, adaptation: true, step9SinceQc: false }).stepNo, 9);
  const finished = { code: "finished", phase: "FINISH", sequence: 110, requiresQc: false, isPostQc: true, done: true };
  const next = deriveNextAction({ ...base, target: finished, adaptation: true, step9SinceQc: true });
  assert.deepEqual([next.action, next.wait], ["WAIT", "READY_TO_FINISH"]);
  assert.equal(deriveNextAction({ ...base, target: { ...finished, done: false }, adaptation: true, step9SinceQc: true }).action, "FINISH");
});

test("tahap routing -> nomor tahap yang ditutup saat dilewati (modul terakhir sebelum QC juga menutup uji tekstur 8)", () => {
  assert.deepEqual(stepsCoveredByStage({ code: "pre_teardown_test" }), [1, 2]);
  assert.deepEqual(stepsCoveredByStage({ code: "teardown" }), [3]); assert.deepEqual(stepsCoveredByStage({ code: "foundation_test" }), [4]); assert.deepEqual(stepsCoveredByStage({ code: "diagnosis" }), [5]);
  assert.deepEqual(stepsCoveredByStage({ code: "foundation_upgrade", phase: "MODULE", sequence: 10 }), [6]);
  assert.deepEqual(stepsCoveredByStage({ code: "comfort_layer_upgrade", phase: "MODULE", sequence: 20 }), [7]);
  assert.deepEqual(stepsCoveredByStage({ code: "comfort_layer_upgrade", phase: "MODULE", sequence: 20 }, { isLastPreQc: true }), [7, 8]);
  assert.deepEqual(stepsCoveredByStage({ code: "corner_sewing" }), [10, 11]); assert.deepEqual(stepsCoveredByStage({ code: "finished" }), [12]);
  assert.deepEqual(stepsCoveredByStage({ code: "fit_test", requiresQc: true }), [], "gerbang QC tidak menghasilkan 'tahap dikerjakan'");
});

test("bukti SKIPPED: tanpa media/hasil uji; alasan 'Adaptasi sistem'; dibedakan dari bukti nyata", () => {
  const p = skippedEvidencePayload("catatan"); assert.equal(p.outcome, SKIP_OUTCOME); assert.equal(p.reason, SKIP_REASON); assert.equal(p.reason, "Adaptasi sistem");
  assert.equal(p.verdict, undefined, "tidak ada hasil uji"); assert.equal(isSkippedEvidence({ payload: p }), true); assert.equal(isSkippedEvidence({ payload: { verdict: "PAS" } }), false);
});

test("penghalang Selesaikan Produksi: kebijakan, tiba, rencana, operasi aktif, kekurangan bahan, exception, fase terhenti — tiap penghalang berkode", () => {
  const run = { adaptationPolicy: "ADAPTATION_V1", status: "ACTIVE", plan: { status: "PLANNED" }, unit: { status: "IN_PRODUCTION" }, operations: [], phases: [] };
  assert.deepEqual(finishBlockersOf(run), []);
  const codes = (r, o) => finishBlockersOf(r, o).map((b) => b.code);
  assert.deepEqual(codes({ ...run, adaptationPolicy: null }), ["ADAPTATION_NOT_ENABLED"]);
  assert.deepEqual(codes({ ...run, status: "PENDING_ARRIVAL" }), ["PENDING_ARRIVAL"]);
  assert.deepEqual(codes({ ...run, status: "COMPLETED" }), ["RUN_TERMINAL"]);
  assert.deepEqual(codes({ ...run, plan: null }), ["NO_PLAN"]);
  assert.deepEqual(codes({ ...run, operations: [{ status: "PAUSED" }] }), ["ACTIVE_OPERATION"]);
  assert.deepEqual(codes(run, { openShortage: true }), ["OPEN_SHORTAGE"]);
  assert.deepEqual(codes(run, { exceptionOpen: true }), ["EXCEPTION_OPEN"]);
  assert.deepEqual(codes({ ...run, phases: [{ phase: "PROCESS", status: "BLOCKED" }] }), ["PHASE_BLOCKED"]);
  assert.equal(isAdaptationRun(run), true); assert.equal(isAdaptationRun({}), false);
});

test("KEPEMILIKAN: penutup run (COMPLETED) dan pelepasan ke Delivery hanya di custody service; command adaptasi tidak menulis stok/QC/custody/jurnal; tidak ada PASS/WAIVED/ACCEPTED palsu", () => {
  const custody = read("services", "unitCustodyCommandService.js"); const step = read("services", "productionStepCommandService.js"); const ws = read("services", "productionWorkshopExecutionCommandService.js"); const engine = read("services", "unitStageEngine.js");
  assert.match(custody, /export async function completeAdaptationRunInTx/);
  assert.match(custody, /adaptationPolicy !== "ADAPTATION_V1"/);
  assert.match(custody, /assertRunPhasesTerminal\(tx, run\.id, \{ requireHandoffCompleted: false \}\)/);
  for (const [name, src] of [["step", step], ["workshop", ws]]) {
    assert.doesNotMatch(src, /\.productionRun\.update\([^)]{0,300}status:\s*"COMPLETED"/, `${name}: tidak menutup run sendiri`);
    assert.doesNotMatch(src, /markUnitReadyForDeliveryInTx\s*\(/, `${name}: tidak melepas unit ke Delivery sendiri`);
    assert.doesNotMatch(src, /\.qualityInspection\.(create|update|upsert)|\.qcFitTest\.(create|upsert)|\.unitCustodyHandoff\.(create|update)|postStockMovement|\.stockMovement\.(create|update)/, `${name}: tidak menulis QC/custody/stok`);
    assert.doesNotMatch(src, /result:\s*"(PASS|OVERRIDDEN)"|status:\s*"ACCEPTED"/, `${name}: tanpa nilai palsu`);
  }
  assert.match(engine, /QC TIDAK DILAKUKAN — mode adaptasi \(bukan lulus, bukan di-waive/);
  assert.doesNotMatch(engine.slice(engine.indexOf("export async function skipStageForAdaptationInTx"), engine.indexOf("export async function isUnitPathDoneInTx")), /qcFitTest\.create|QC_WAIVED/);
});

test("migration aditif: kolom nullable + tabel baru; tanpa DROP/UPDATE/DELETE/TRUNCATE; LF", () => {
  const dir = path.join(here, "..", "prisma", "migrations");
  const name = fs.readdirSync(dir).find((d) => d.endsWith("production_adaptation_slice2"));
  const sql = fs.readFileSync(path.join(dir, name, "migration.sql"), "utf8");
  assert.doesNotMatch(sql, /\b(DROP|DELETE|TRUNCATE|UPDATE)\b(?!.*--)/i.test(sql.replace(/--.*$/gm, "")) ? /x^/ : /^$/);
  const code = sql.replace(/--.*$/gm, "");
  assert.doesNotMatch(code, /\b(DROP|DELETE\s+FROM|TRUNCATE|UPDATE\s+"?\w+"?\s+SET)\b/i);
  assert.match(code, /ADD COLUMN "adaptation_policy" VARCHAR\(40\);/); assert.match(code, /ADD COLUMN "delay_kind" VARCHAR\(20\), ADD COLUMN "delay_note" TEXT;/); assert.match(code, /CREATE TABLE "production_settings"/);
  assert.equal(/\r/.test(sql), false, "LF");
});

function walkSrc(dir, out = []) { for (const e of fs.readdirSync(dir, { withFileTypes: true })) { const p = path.join(dir, e.name); if (e.isDirectory()) walkSrc(p, out); else if (/\.js$/.test(e.name)) out.push(p); } return out; }

test("OWNERSHIP penulis slice 2: production_settings & price_items.production_service_id hanya productionSettingsService; adaptationPolicy hanya dibuat saat run lahir (custody/P5) atau lewat command P5; delayKind hanya P5", () => {
  const files = walkSrc(path.join(here, "..", "src")).map((p) => [path.relative(path.join(here, ".."), p).split(path.sep).join("/"), fs.readFileSync(p, "utf8")]);
  const writers = (re) => files.filter(([, t]) => re.test(t.split("\n").filter((l) => !l.trim().startsWith("//")).join("\n"))).map(([f]) => f);
  assert.deepEqual(writers(/\.productionSetting\.(create|update|upsert|delete|deleteMany|createMany)\s*\(/), ["src/services/productionSettingsService.js"]);
  assert.deepEqual(writers(/\.priceItem\.update\s*\([^)]*productionServiceId/), ["src/services/productionSettingsService.js"]);
  assert.deepEqual(writers(/productionOperationRun\.update\s*\([^)]*delayKind/).sort(), ["src/services/productionWorkshopExecutionCommandService.js"]);
  assert.deepEqual(writers(/adaptationPolicy:\s*(await defaultAdaptationPolicy|ADAPTATION_POLICY)/).sort(), ["src/services/productionWorkshopExecutionCommandService.js", "src/services/unitCustodyCommandService.js"]);
  assert.deepEqual(writers(/skipStageForAdaptationInTx\s*\(/).sort(), ["src/services/productionWorkshopExecutionCommandService.js", "src/services/unitStageEngine.js"], "tahap dilewati hanya dari owner eksekusi V2 + engine");
  assert.deepEqual(writers(/completeAdaptationRunInTx\s*\(/).sort(), ["src/services/productionWorkshopExecutionCommandService.js", "src/services/unitCustodyCommandService.js"]);
});
