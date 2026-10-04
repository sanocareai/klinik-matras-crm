// P12C.1 — read-model antrean V1 (murni): lini kanonik per tahap, keadaan per PIC, dan urutan server. Tanpa DB.
import test from "node:test";
import assert from "node:assert/strict";
import { V1_WORK_STATES as S, deriveV1WorkItem, lastPicOperatorId, laneOfStage, rankV1Items } from "../src/lib/domain/v1WorkerQueue.js";

const stage = (code, extra = {}) => ({ id: `id-${code}`, code, labelId: `Label ${code}`, phase: "MODULE", sequence: 1, requiresQc: false, ...extra });
// Jalur nyata (kode & fase dari routing_stages): intake 4 + modul + finish (QC -> corner_sewing -> finished).
const PATH = [
  stage("pre_teardown_test", { phase: "INTAKE" }), stage("teardown", { phase: "INTAKE" }), stage("foundation_test", { phase: "INTAKE" }), stage("diagnosis", { phase: "INTAKE" }),
  stage("foundation_upgrade", { sequence: 10 }), stage("comfort_layer_upgrade", { sequence: 20 }),
  stage("fit_test", { phase: "FINISH", sequence: 1, requiresQc: true }), stage("corner_sewing", { phase: "FINISH", sequence: 2 }), stage("finished", { phase: "FINISH", sequence: 3 }),
];
const byCode = (c) => PATH.find((s) => s.code === c);
const A = "op-A"; const B = "op-B"; const K = "op-K";
const asg = (pairs) => new Map(pairs.map(([code, op, name]) => [byCode(code).id, { operatorId: op, operatorName: name ?? op }]));
const T = (code, state) => ({ stage: byCode(code), state });
const derive = (o) => deriveV1WorkItem({ path: PATH, ...o });

test("lini kanonik per tahap: pasca-QC corner_sewing/finished = CORNER; gerbang QC = QC (bukan lantai); sisanya TABLE; tidak bergantung nama/label/layanan", () => {
  const lanes = Object.fromEntries(PATH.map((s) => [s.code, laneOfStage(s)]));
  assert.deepEqual(lanes, {
    pre_teardown_test: "TABLE", teardown: "TABLE", foundation_test: "TABLE", diagnosis: "TABLE", foundation_upgrade: "TABLE", comfort_layer_upgrade: "TABLE",
    fit_test: "QC", corner_sewing: "CORNER", finished: "CORNER",
  });
  // label "Jahit Corner" pada tahap dengan kode lain TIDAK dianggap Corner (tidak menebak dari nama).
  assert.equal(laneOfStage({ code: "custom_stage", labelId: "Jahit Corner Premium", phase: "MODULE", sequence: 5 }), "TABLE");
  assert.equal(laneOfStage(null), null);
});

test("READY: penugasan sah yang BELUM dimulai (unit baru / tahap berikutnya belum disentuh) tampil sebagai siap dikerjakan", () => {
  const r = derive({ target: T("pre_teardown_test", "FIRST"), assignments: asg([["pre_teardown_test", A]]), operatorId: A });
  assert.equal(r.state, S.READY); assert.equal(r.stage.code, "pre_teardown_test"); assert.equal(r.lane, "TABLE");
  const r2 = derive({ target: T("teardown", "READY"), assignments: asg([["teardown", A]]), operatorId: A });
  assert.equal(r2.state, S.READY);
});

test("keadaan berjalan mengikuti engine: IN_PROGRESS / PAUSED / BLOCKED hanya untuk pemegang tahap target", () => {
  for (const st of ["IN_PROGRESS", "PAUSED", "BLOCKED"]) assert.equal(derive({ target: T("teardown", st), assignments: asg([["teardown", A]]), operatorId: A }).state, st);
  assert.equal(derive({ target: T("teardown", "IN_PROGRESS"), assignments: asg([["teardown", A]]), operatorId: B }), null, "PIC lain tidak melihatnya");
});

test("WAITING_PREREQUISITE: tahap hilir milik saya, target milik orang lain/belum ditugaskan -> menunggu prasyarat dengan pemegangnya", () => {
  const r = derive({ target: T("teardown", "READY"), assignments: asg([["teardown", A, "Operator A"], ["foundation_test", B]]), operatorId: B });
  assert.equal(r.state, S.WAITING_PREREQUISITE); assert.equal(r.stage.code, "foundation_test");
  assert.equal(r.prerequisite.stage.code, "teardown"); assert.equal(r.prerequisite.state, "READY"); assert.equal(r.prerequisite.assignee, "Operator A"); assert.equal(r.prerequisite.assigned, true);
  const none = derive({ target: T("teardown", "READY"), assignments: asg([["foundation_test", B]]), operatorId: B });
  assert.equal(none.prerequisite.assigned, false); assert.equal(none.prerequisite.assignee, null);
  const first = derive({ target: T("pre_teardown_test", "FIRST"), assignments: asg([["teardown", B]]), operatorId: B });
  assert.equal(first.prerequisite.state, "READY", "FIRST dilaporkan sebagai READY");
});

test("WAITING_ASSIGNMENT: PIC terakhir tetap melihat unitnya sampai tahap berikutnya ditugaskan; setelah dialihkan kartunya hilang", () => {
  const waiting = derive({ target: T("teardown", "READY"), assignments: asg([["pre_teardown_test", A]]), operatorId: A, lastPicOperatorId: A });
  assert.equal(waiting.state, S.WAITING_ASSIGNMENT); assert.equal(waiting.waitingFor.code, "teardown"); assert.equal(waiting.lastDone.code, "pre_teardown_test"); assert.equal(waiting.lane, "TABLE");
  const handedOff = derive({ target: T("teardown", "READY"), assignments: asg([["pre_teardown_test", A], ["teardown", B]]), operatorId: A, lastPicOperatorId: A });
  assert.equal(handedOff, null, "dialihkan ke PIC lain: tidak ada kartu untuk A");
  assert.equal(derive({ target: T("teardown", "READY"), assignments: asg([["pre_teardown_test", A], ["teardown", B]]), operatorId: B }).state, S.READY, "penerima melihat siap dikerjakan");
  assert.equal(derive({ target: T("teardown", "READY"), assignments: asg([["pre_teardown_test", A]]), operatorId: B, lastPicOperatorId: A }), null, "bukan PIC terakhir");
  assert.equal(derive({ target: T("teardown", "IN_PROGRESS"), assignments: asg([["pre_teardown_test", A]]), operatorId: A, lastPicOperatorId: A }), null, "sedang dikerjakan orang lain tanpa penugasan: bukan 'menunggu penugasan'");
  assert.equal(derive({ target: T("pre_teardown_test", "FIRST"), assignments: new Map(), operatorId: A, lastPicOperatorId: A }), null, "unit belum pernah dikerjakan: tak ada PIC terakhir");
});

test("selesai / tak cocok / tanpa operator: bukan antrean kerja", () => {
  assert.equal(derive({ target: T("finished", "DONE"), assignments: asg([["finished", K]]), operatorId: K }), null);
  assert.equal(derive({ target: { stage: null, state: "MISMATCH" }, assignments: new Map(), operatorId: K }), null);
  assert.equal(derive({ target: T("teardown", "READY"), assignments: asg([["teardown", A]]), operatorId: null }), null);
});

test("Corner membaca penugasan tahap Corner: lini item mengikuti tahap yang jadi tanggung jawab (target / hilir / PIC terakhir)", () => {
  assert.equal(derive({ target: T("corner_sewing", "READY"), assignments: asg([["corner_sewing", K]]), operatorId: K }).lane, "CORNER");
  const wait = derive({ target: T("fit_test", "READY"), assignments: asg([["corner_sewing", K]]), operatorId: K });
  assert.equal(wait.state, S.WAITING_PREREQUISITE); assert.equal(wait.lane, "CORNER", "menunggu QC sebelum Corner: tetap di lini Corner");
  const afterSewing = derive({ target: T("finished", "READY"), assignments: asg([["corner_sewing", K]]), operatorId: K, lastPicOperatorId: K });
  assert.equal(afterSewing.state, S.WAITING_ASSIGNMENT); assert.equal(afterSewing.lane, "CORNER", "lini mengikuti tahap terakhir yang dikerjakan PIC (Corner)");
  assert.equal(derive({ target: T("fit_test", "IN_PROGRESS"), assignments: asg([["fit_test", A]]), operatorId: A }).lane, "QC", "tahap QC bukan lini Meja/Corner");
});

test("PIC terakhir: penugasan tahap sebelumnya; fallback aktor log COMPLETE -> operator; tidak ada tebakan", () => {
  const target = T("teardown", "READY");
  assert.equal(lastPicOperatorId({ path: PATH, target, assignments: asg([["pre_teardown_test", A]]), completedActorByStage: new Map(), operatorByUser: new Map() }), A);
  const actors = new Map([[byCode("pre_teardown_test").id, "user-b"]]);
  assert.equal(lastPicOperatorId({ path: PATH, target, assignments: new Map(), completedActorByStage: actors, operatorByUser: new Map([["user-b", B]]) }), B);
  assert.equal(lastPicOperatorId({ path: PATH, target, assignments: new Map(), completedActorByStage: actors, operatorByUser: new Map() }), null, "aktor bukan operator");
  assert.equal(lastPicOperatorId({ path: PATH, target: T("pre_teardown_test", "FIRST"), assignments: new Map(), completedActorByStage: new Map(), operatorByUser: new Map() }), null);
});

test("urutan server: keadaan (berjalan > siap > menunggu), prioritas, lalu umur; stabil", () => {
  const it = (code, state, priority, createdAt) => ({ state, unit: { unitCode: code, priority, createdAt } });
  const ranked = rankV1Items([
    it("W2", S.WAITING_ASSIGNMENT, "URGENT", "2026-01-01"), it("R-old", S.READY, "NORMAL", "2026-01-01"), it("R-hi", S.READY, "URGENT", "2026-03-01"), it("IP", S.IN_PROGRESS, "NORMAL", "2026-05-01"),
    it("W1", S.WAITING_PREREQUISITE, "NORMAL", "2026-01-01"), it("PA", S.PAUSED, "NORMAL", "2026-01-01"), it("R-new", S.READY, "NORMAL", "2026-02-01"),
  ]);
  assert.deepEqual(ranked.map((x) => x.unit.unitCode), ["IP", "PA", "R-hi", "R-old", "R-new", "W1", "W2"]);
  assert.deepEqual(rankV1Items(ranked).map((x) => x.unit.unitCode), ranked.map((x) => x.unit.unitCode), "deterministik");
});
