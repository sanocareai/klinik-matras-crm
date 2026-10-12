// Tampilan Corner di Rencana — fungsi murni: kelompok dari cornerStatusOf, hambatan + aktor, keadaan QC, aturan pengalihan PIC Corner.
import test from "node:test";
import assert from "node:assert/strict";
import { CORNER_GROUPS, canReassignCorner, cornerBlockersOf, cornerGroupOf, qcStateOf } from "../src/lib/domain/productionCornerBoard.js";
import { cornerStatusOf } from "../src/lib/domain/productionCorner.js";

test("empat kelompok dari cornerStatusOf; TIDAK_BERLAKU tidak masuk papan Corner (tetap di Meja)", () => {
  assert.deepEqual(CORNER_GROUPS.map((g) => g.label), ["Menunggu prasyarat", "Siap Corner", "Sedang dikerjakan", "Selesai"]);
  const g = (opts) => cornerGroupOf(cornerStatusOf({ cornerApplies: true, ...opts }).status);
  assert.equal(g({ decision: true }), "MENUNGGU_PRASYARAT");
  assert.equal(g({ decision: true, qcPassed: true }), "SIAP_CORNER");
  assert.equal(g({ decision: true, steps: new Set([9]) }), "SIAP_CORNER");
  assert.equal(g({ decision: true, steps: new Set([9, 10]) }), "SEDANG_DIKERJAKAN");
  assert.equal(g({ decision: true, steps: new Set([9, 10, 11]) }), "SEDANG_DIKERJAKAN");
  assert.equal(g({ decision: true, steps: new Set([9, 10, 11, 12]) }), "SELESAI");
  assert.equal(g({ decision: false }), null);
  assert.equal(cornerGroupOf(cornerStatusOf({ cornerApplies: false, decision: null }).status), null, "jalur tanpa tahap Corner");
});

test("keadaan QC: menunggu / gagal / lulus / dilewati / tidak dilakukan / belum", () => {
  assert.equal(qcStateOf({ qcIndicator: "LULUS" }).key, "LULUS");
  assert.equal(qcStateOf({ qcIndicator: "REWORK" }).key, "GAGAL");
  assert.equal(qcStateOf({ qcIndicator: "WAIVED" }).key, "DIABAIKAN");
  assert.equal(qcStateOf({ qcIndicator: "TIDAK_DILAKUKAN" }).key, "TIDAK_DILAKUKAN");
  assert.equal(qcStateOf({ qcIndicator: "BELUM", next: { actor: "QC", action: "WAIT", wait: "AWAITING_QC" } }).key, "MENUNGGU");
  assert.equal(qcStateOf({ qcIndicator: "BELUM", next: { actor: "TABLE", action: "START" } }).key, "BELUM");
});

const base = { runStatus: "ACTIVE", qc: { key: "BELUM" }, picCornerName: "Citra", request: { needsSalesConfirmation: false, missing: [] }, buildTrack: true, cornerRequired: true };

test("hambatan + aktor dari SATU model server: unit belum tiba, kebutuhan Corner belum diputuskan, QC menunggu/gagal, bahan, jenis produk, PIC kosong, konfirmasi Sales", () => {
  const pending = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", runStatus: "PENDING_ARRIVAL", next: { action: "WAIT", wait: "PENDING_ARRIVAL", actor: "NONE" } });
  assert.equal(pending.primary.code, "PENDING_ARRIVAL"); assert.equal(pending.primary.actor.label, "Petugas penerima unit");
  const undecided = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", cornerRequired: null, next: { action: "START", actor: "TABLE" } });
  assert.equal(undecided.primary.code, "CORNER_NOT_CONFIRMED"); assert.equal(undecided.needsAction.actor.label, "Kepala Produksi");
  const qcWait = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", qc: { key: "MENUNGGU" }, next: { action: "WAIT", wait: "AWAITING_QC", actor: "QC" } });
  assert.equal(qcWait.primary.actor.key, "QC"); assert.match(qcWait.needsAction.text, /PIC QC/);
  const qcFail = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", qc: { key: "GAGAL" }, next: { action: "START", actor: "TABLE" } });
  assert.equal(qcFail.primary.code, "QC_FAILED"); assert.equal(qcFail.primary.actor.key, "TABLE"); assert.match(qcFail.primary.text, /tidak boleh|belum boleh/);
  const material = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", next: { action: "WAIT", wait: "MATERIAL_SHORTAGE", actor: "WAREHOUSE" } });
  assert.equal(material.primary.actor.label, "Gudang");
  const product = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", next: { action: "EVIDENCE", hold: "PRODUCT_TYPE_UNCONFIRMED", actor: "TABLE" } });
  assert.ok(product.blockers.some((b) => b.code === "PRODUCT_TYPE_UNCONFIRMED" && b.actor.key === "SALES"));
  const noPic = cornerBlockersOf({ ...base, group: "SIAP_CORNER", picCornerName: null, next: { action: "START_CORNER", actor: "CORNER" } });
  assert.equal(noPic.primary.code, "PIC_CORNER_UNSET"); assert.equal(noPic.primary.severity, "block"); assert.equal(noPic.needsAction.actor.key, "PLANNER");
  const prereqNoPic = cornerBlockersOf({ ...base, group: "MENUNGGU_PRASYARAT", picCornerName: null, next: { action: "START", actor: "TABLE" } });
  assert.equal(prereqNoPic.primary.severity, "info", "PIC kosong belum menahan selagi prasyarat Meja/QC belum selesai");
  assert.equal(prereqNoPic.needsAction.actor.key, "TABLE");
  const sales = cornerBlockersOf({ ...base, group: "SIAP_CORNER", request: { needsSalesConfirmation: true, missing: ["motif", "warna"] }, next: { action: "START_CORNER", actor: "CORNER" } });
  assert.ok(sales.blockers.some((b) => b.code === "SALES_CONFIRM" && b.actor.key === "SALES" && b.severity === "warn"));
  assert.equal(sales.needsAction.actor.key, "CORNER", "konfirmasi Sales bersifat peringatan, bukan penahan");
  const ready = cornerBlockersOf({ ...base, group: "SIAP_CORNER", next: { action: "START_CORNER", actor: "CORNER" } });
  assert.deepEqual(ready.blockers, []); assert.equal(ready.needsAction.actor.label, "PIC Corner");
  const done = cornerBlockersOf({ ...base, group: "SELESAI", picCornerName: null });
  assert.deepEqual([done.blockers, done.primary, done.needsAction], [[], null, null]);
});

test("aturan pengalihan PIC Corner: hanya sebelum pekerjaan Corner berjalan; keputusan Corner wajib; run/rencana aktif", () => {
  const ok = { cornerStatus: "MENUNGGU_CORNER", buildTrack: true, cornerRequired: true, runStatus: "ACTIVE", planStatus: "PLANNED", hasPlan: true };
  assert.equal(canReassignCorner(ok).allowed, true);
  assert.equal(canReassignCorner({ ...ok, cornerStatus: "BELUM_SAMPAI" }).allowed, true);
  for (const s of ["DIKERJAKAN", "JAHIT_SELESAI", "SELESAI"]) { const r = canReassignCorner({ ...ok, cornerStatus: s }); assert.equal(r.allowed, false); assert.equal(r.code, "CORNER_WORK_STARTED"); }
  assert.equal(canReassignCorner({ ...ok, cornerStatus: "TIDAK_BERLAKU" }).code, "CORNER_NOT_REQUIRED");
  assert.equal(canReassignCorner({ ...ok, cornerRequired: null }).code, "CORNER_DECISION_PENDING");
  assert.equal(canReassignCorner({ ...ok, runStatus: "COMPLETED" }).code, "CORNER_RUN_TERMINAL");
  assert.equal(canReassignCorner({ ...ok, hasPlan: false }).code, "CORNER_PLAN_MISSING");
  assert.equal(canReassignCorner({ ...ok, planStatus: "CANCELLED" }).code, "CORNER_PLAN_MISSING");
});
