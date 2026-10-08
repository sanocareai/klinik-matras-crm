// P12C.2 — keputusan murni penegakan penugasan V1 untuk aksi operator Meja/Corner. Tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { decideV1StageActor, isOperatorGatedStage, V1_ACTOR_CODES as C } from "../src/lib/domain/v1StageActor.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../src/constants/permissions.js";

const stage = (code, extra = {}) => ({ id: `id-${code}`, code, labelId: `Label ${code}`, phase: "MODULE", sequence: 1, requiresQc: false, ...extra });
const TEARDOWN = stage("teardown", { phase: "INTAKE" });
const QC = stage("fit_test", { phase: "FINISH", requiresQc: true });
const CORNER = stage("corner_sewing", { phase: "FINISH", sequence: 2 });
const A = { id: "op-A", active: true }; const B = { id: "op-B", active: true };
const decide = (o) => decideV1StageActor({ target: { stage: TEARDOWN, state: "READY" }, requestedStageId: null, assignment: { operatorId: A.id }, operator: A, override: false, ...o });

test("PIC yang ditugaskan lolos (mulai: tanpa stageId; selesai/jeda/lanjut/hambatan: stageId = tahap sekarang)", () => {
  assert.deepEqual(decide({}), { ok: true, via: "ASSIGNED" });
  assert.deepEqual(decide({ requestedStageId: TEARDOWN.id }), { ok: true, via: "ASSIGNED" });
  assert.deepEqual(decide({ target: { stage: CORNER, state: "READY" }, requestedStageId: CORNER.id }), { ok: true, via: "ASSIGNED" });
});

test("operator lain / bukan operator / operator nonaktif ditolak 403 (tanpa efek); penugasan berubah ke PIC lain ditolak", () => {
  const other = decide({ operator: B });
  assert.equal(other.ok, false); assert.equal(other.status, 403); assert.equal(other.code, C.NOT_YOURS); assert.match(other.message, /dialihkan/);
  const none = decide({ operator: null });
  assert.equal(none.status, 403); assert.equal(none.code, C.NOT_OPERATOR);
  const inactive = decide({ operator: { id: A.id, active: false } });
  assert.equal(inactive.status, 403); assert.equal(inactive.code, C.NOT_OPERATOR);
  const reassigned = decide({ assignment: { operatorId: B.id } }); // dulu milik A, kini B
  assert.equal(reassigned.status, 403); assert.equal(reassigned.code, C.NOT_YOURS);
});

test("tahap belum ditugaskan -> 409 untuk SEMUA (termasuk pemegang izin override); operator dengan tahap hilir saja tidak bisa menembus tahap sekarang", () => {
  for (const assignment of [null, { operatorId: null }]) {
    for (const override of [false, true]) {
      const r = decide({ assignment, override });
      assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, C.NOT_ASSIGNED);
    }
  }
  // B hanya ditugaskan di tahap hilir; tahap sekarang milik A -> aksi B ke tahap sekarang ditolak
  assert.equal(decide({ operator: B, assignment: { operatorId: A.id } }).code, C.NOT_YOURS);
});

test("tahap yang dituju tidak sama dengan tahap kanonik sekarang -> 409 CHANGED (basi/hilir), apa pun perannya", () => {
  for (const override of [false, true]) {
    const r = decide({ requestedStageId: "id-hilir", override });
    assert.equal(r.ok, false); assert.equal(r.status, 409); assert.equal(r.code, C.CHANGED);
  }
});

test("ADMIN/OWNER (PRODUCTION_EXECUTE_ANY) boleh mengerjakan tahap yang DITUGASKAN ke PIC lain; bukan operator pun boleh; tahap tak terselesaikan tetap ditolak", () => {
  assert.deepEqual(decide({ override: true, operator: null }), { ok: true, via: "OVERRIDE" });
  assert.deepEqual(decide({ override: true, operator: B }), { ok: true, via: "OVERRIDE" });
  assert.equal(decide({ override: true, target: { stage: null, state: "MISMATCH" } }).code, C.UNRESOLVED);
  assert.equal(decide({ target: { stage: TEARDOWN, state: "MISMATCH" } }).code, C.UNRESOLVED);
});

test("gerbang QC tidak diatur penugasan PIC (kontrak QC tetap); hanya tahap Meja/Corner yang dijaga", () => {
  assert.equal(isOperatorGatedStage(QC), false); assert.equal(isOperatorGatedStage(TEARDOWN), true); assert.equal(isOperatorGatedStage(CORNER), true);
  assert.deepEqual(decide({ target: { stage: QC, state: "READY" }, assignment: null, operator: null }), { ok: true, via: "QC_GATE" });
  // ...tetapi tahap yang dituju tetap harus tahap sekarang
  assert.equal(decide({ target: { stage: QC, state: "READY" }, requestedStageId: "lain", assignment: null, operator: null }).code, C.CHANGED);
});

test("kontrak izin: hanya peran yang memegang PRODUCTION_EXECUTE_ANY yang melewati pagar PIC — guard tidak memberi/menambah izin apa pun", () => {
  const holders = Object.entries(ROLE_PERMISSIONS).filter(([, perms]) => perms.includes(P.PRODUCTION_EXECUTE_ANY)).map(([r]) => r).sort();
  assert.deepEqual(holders, ["ADMIN", "OWNER"]);
  for (const role of ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD", "WAREHOUSE", "SALES", "FINANCE", "DRIVER"]) {
    assert.ok(!(ROLE_PERMISSIONS[role] || []).includes(P.PRODUCTION_EXECUTE_ANY), `${role} tidak boleh override`);
  }
});

test("statis: seluruh rute eksekusi tahap V1 meminta penegakan penugasan (start/complete/fail/pause/resume + catat-selesai); engine memanggil guard di transaksi yang sama setelah kunci unit", () => {
  const dir = path.dirname(fileURLToPath(import.meta.url));
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const units = strip(fs.readFileSync(path.join(dir, "../src/routes/units.js"), "utf8"));
  for (const fn of ["startStage", "completeStage", "failStage", "pauseStage", "resumeStage"]) {
    const m = units.match(new RegExp(`await ${fn}\\([^;]*?requireAssignedOperator: true`, "s"));
    assert.ok(m, `rute ${fn} wajib requireAssignedOperator: true`);
  }
  const prod = strip(fs.readFileSync(path.join(dir, "../src/routes/production.js"), "utf8"));
  assert.match(prod, /recordStageDone\([^)]*requireAssignedOperator: true/);
  const engine = strip(fs.readFileSync(path.join(dir, "../src/services/unitStageEngine.js"), "utf8"));
  for (const fn of ["startStage", "recordStageDone", "completeStage", "pauseStage", "resumeStage"]) {
    const body = engine.slice(engine.indexOf(`export async function ${fn}(`));
    const head = body.slice(0, body.indexOf("EXECUTION_TX_OPTIONS") > 0 ? Math.min(body.indexOf("EXECUTION_TX_OPTIONS"), 900) : 900);
    assert.match(head, /assertNotV2ExecutionOwned[\s\S]*if \(requireAssignedOperator\) await assertV1StageActorInTx/, `${fn}: guard setelah kunci unit, di transaksi yang sama`);
  }
  assert.match(engine, /failStage[\s\S]*assertNotV2ExecutionOwned\(tx, unitId, "hambatan\/gagal tahap", actorId\);\s*if \(requireAssignedOperator\) await assertV1StageActorInTx/);
});
