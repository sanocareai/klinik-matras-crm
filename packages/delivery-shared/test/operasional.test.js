import test from "node:test";
import assert from "node:assert/strict";
import {
  jobStatusInfo, routeStatusInfo, trackingPhaseInfo, ringkasPapan, ringkasRute, gabungKru, periodeBulanIni,
  umurPosisiMenit, tautanPeta, validasiReschedule, tanggalWIBPlus,
} from "../src/operasional/domain.js";
import { createOperasionalApi } from "../src/operasional/api.js";
import { controlModules } from "../src/rbac.js";

test("status tidak dikenal tampil aman", () => {
  assert.equal(jobStatusInfo("COMPLETED").label, "Selesai");
  assert.match(jobStatusInfo("XYZ").label, /tidak dikenal/);
  assert.equal(routeStatusInfo("IN_PROGRESS").label, "Berjalan");
  assert.equal(trackingPhaseInfo("WAITING").label, "Menunggu berangkat");
  assert.equal(trackingPhaseInfo("EN_ROUTE").tone, "cyan");
});

test("ringkasPapan menghitung status, tipe, dan job aktif tanpa driver", () => {
  const r = ringkasPapan([
    { type: "DELIVERY", status: "COMPLETED", driverId: "d" },
    { type: "DELIVERY", status: "EN_ROUTE", driverId: "d" },
    { type: "PICKUP", status: "SCHEDULED", driverId: null },
    { type: "PICKUP", status: "FAILED", driverId: "d" },
    { type: "DELIVERY", status: "UNSCHEDULED", driverId: null, isExternalCourier: true },
  ]);
  assert.deepEqual([r.total, r.selesai, r.berjalan, r.menunggu, r.gagal, r.belumDriver, r.pickup, r.delivery], [5, 1, 1, 2, 1, 1, 2, 3]);
  assert.equal(r.persenSelesai, 20);
  assert.equal(ringkasPapan([]).persenSelesai, 0);
});

test("ringkasRute & gabungKru", () => {
  assert.deepEqual(ringkasRute({ jobs: [{ status: "COMPLETED" }, { status: "FAILED" }, { status: "ASSIGNED" }] }), { stop: 3, selesai: 1, gagal: 1, sisa: 1 });
  const k = gabungKru([{ id: "a", name: "Budi" }, { id: "b", name: "Andi" }], [{ id: "a", name: "Budi" }]);
  assert.deepEqual(k.map((x) => [x.name, x.peran.join("+")]), [["Andi", "Driver"], ["Budi", "Driver+Helper"]]);
});

test("tanggal & periode WIB, umur posisi, tautan peta", () => {
  const now = Date.UTC(2026, 8, 26, 20, 0); // 27 Sep 03.00 WIB
  assert.equal(tanggalWIBPlus(0, now), "2026-09-27");
  assert.deepEqual(periodeBulanIni(now), { from: "2026-09-01", to: "2026-09-27" });
  assert.equal(umurPosisiMenit({ recordedAt: new Date(now - 5 * 60000).toISOString() }, now), 5);
  assert.equal(umurPosisiMenit(null, now), null);
  assert.match(tautanPeta(-6.2, 106.8), /query=-6\.2,106\.8$/);
  assert.equal(tautanPeta(null, 1), null);
});

test("validasi reschedule", () => {
  assert.equal(validasiReschedule({ scheduledDate: "2026-09-28", reason: "Customer minta" }, "2026-09-27").ok, true);
  assert.ok(validasiReschedule({ scheduledDate: "2026-09-20", reason: "ok ok" }, "2026-09-27").errors.scheduledDate);
  assert.ok(validasiReschedule({ scheduledDate: "", reason: "" }).errors.reason);
});

test("API operasional memakai endpoint yang ada; reschedule wajib Idempotency-Key", async () => {
  const calls = [];
  const api = createOperasionalApi({ request: async (p, o = {}) => { calls.push([p, o]); return {}; } });
  await api.papan("2026-09-27", "DELIVERY");
  await api.rute({ date: "2026-09-27" });
  await api.tracking();
  await api.masalah("OPEN");
  await api.insentif("2026-09-01", "2026-09-27");
  await api.reschedule("j1", { scheduledDate: "2026-09-28", reason: "x" }, "k-12345678");
  assert.deepEqual(calls.map((c) => c[0]), [
    "/armada/board?date=2026-09-27&type=DELIVERY", "/armada/routes?date=2026-09-27", "/armada/tracking",
    "/armada/issues?status=OPEN", "/armada/incentive-summary?from=2026-09-01&to=2026-09-27", "/armada/issues/j1/reschedule",
  ]);
  assert.equal(calls[5][1].headers["Idempotency-Key"], "k-12345678");
  assert.throws(() => api.reschedule("j1", {}, ""), /Idempotency-Key/);
});

test("controlModules: default false, mengikuti server", () => {
  assert.equal(controlModules(null).dashboard, false);
  assert.equal(controlModules({ deliveryControl: { tracking: true } }).tracking, true);
  assert.equal(controlModules({ deliveryControl: { tracking: "ya" } }).tracking, false);
});
