// Histori Waktu Route & Stop (7 Okt 2026) — logika MURNI (tanpa database),
// lihat src/services/routeTimeline.js untuk alasan desain (occurredAt vs
// createdAt, "jangan mengarang" utk milestone tanpa event).
import test from "node:test";
import assert from "node:assert/strict";
import {
  evaluateEventTiming, durationBetweenMs, buildRouteTimeline,
  LATE_SYNC_THRESHOLD_MS, SUSPICIOUS_FUTURE_TOLERANCE_MS,
} from "../src/services/routeTimeline.js";

test("evaluateEventTiming: tanpa occurredAt -> hasDeviceTime false, pakai createdAt sebagai displayAt, tidak pernah mengarang", () => {
  const r = evaluateEventTiming({ createdAt: "2026-10-07T10:00:00.000Z", occurredAt: null });
  assert.equal(r.hasDeviceTime, false);
  assert.equal(r.displayAt.toISOString(), "2026-10-07T10:00:00.000Z");
  assert.equal(r.isLateSync, false);
  assert.equal(r.isSuspiciousClock, false);
});

test("evaluateEventTiming: occurredAt dekat createdAt (aksi online normal) -> tidak late-sync, tidak janggal", () => {
  const r = evaluateEventTiming({ createdAt: "2026-10-07T10:00:00.500Z", occurredAt: "2026-10-07T10:00:00.000Z" });
  assert.equal(r.hasDeviceTime, true);
  assert.equal(r.isLateSync, false);
  assert.equal(r.isSuspiciousClock, false);
});

test("evaluateEventTiming: selisih melewati ambang -> isLateSync true (sinkronisasi terlambat, sempat offline)", () => {
  const createdAt = new Date("2026-10-07T10:10:00.000Z");
  const occurredAt = new Date(createdAt.getTime() - (LATE_SYNC_THRESHOLD_MS + 60_000)); // 1 menit di atas ambang
  const r = evaluateEventTiming({ createdAt, occurredAt });
  assert.equal(r.isLateSync, true);
  assert.equal(r.isSuspiciousClock, false);
  assert.equal(r.lateSyncMs, LATE_SYNC_THRESHOLD_MS + 60_000);
});

test("evaluateEventTiming: occurredAt di MASA DEPAN relatif server -> isSuspiciousClock true (jam perangkat janggal)", () => {
  const createdAt = new Date("2026-10-07T10:00:00.000Z");
  const occurredAt = new Date(createdAt.getTime() + SUSPICIOUS_FUTURE_TOLERANCE_MS + 60_000);
  const r = evaluateEventTiming({ createdAt, occurredAt });
  assert.equal(r.isSuspiciousClock, true);
  assert.ok(r.lateSyncMs < 0);
});

test("evaluateEventTiming: occurredAt jauh di masa lampau (>7 hari) -> isSuspiciousClock true, BUKAN late-sync biasa", () => {
  const createdAt = new Date("2026-10-07T10:00:00.000Z");
  const occurredAt = new Date(createdAt.getTime() - 10 * 24 * 3600 * 1000);
  const r = evaluateEventTiming({ createdAt, occurredAt });
  assert.equal(r.isSuspiciousClock, true);
});

test("evaluateEventTiming: selisih wajar (<ambang) TIDAK dilabeli late-sync walau occurredAt sedikit lebih awal", () => {
  const createdAt = new Date("2026-10-07T10:00:30.000Z");
  const occurredAt = new Date("2026-10-07T10:00:00.000Z"); // 30 detik, jauh di bawah ambang 2 menit
  const r = evaluateEventTiming({ createdAt, occurredAt });
  assert.equal(r.isLateSync, false);
});

test("durationBetweenMs: null kalau SALAH SATU sisi tidak ada (tidak pernah menebak satu sisi dari sisi lain)", () => {
  assert.equal(durationBetweenMs(null, { createdAt: "2026-10-07T10:00:00.000Z" }), null);
  assert.equal(durationBetweenMs({ createdAt: "2026-10-07T10:00:00.000Z" }, null), null);
});

test("durationBetweenMs: menghitung selisih occurredAt (diprioritaskan) dibanding createdAt", () => {
  const a = { occurredAt: "2026-10-07T10:00:00.000Z", createdAt: "2026-10-07T10:05:00.000Z" };
  const b = { occurredAt: "2026-10-07T10:20:00.000Z", createdAt: "2026-10-07T10:25:00.000Z" };
  assert.equal(durationBetweenMs(a, b), 20 * 60 * 1000); // pakai occurredAt (10:00 -> 10:20), bukan createdAt
});

test("durationBetweenMs: urutan terbalik (B lebih awal dari A, jam janggal) -> null, tidak menampilkan durasi negatif palsu", () => {
  const a = { occurredAt: "2026-10-07T10:20:00.000Z" };
  const b = { occurredAt: "2026-10-07T10:00:00.000Z" };
  assert.equal(durationBetweenMs(a, b), null);
});

test("buildRouteTimeline: milestone TANPA baris event sama sekali -> absen dari job.events (pemanggil UI yang menampilkan 'Tidak tersedia'), bukan dikarang", () => {
  const route = { id: "r1", code: "RTE-1" };
  const jobs = [{ id: "j1", sequence: 1, orderNumber: "ORD-1", customerName: "Budi", type: "DELIVERY", status: "ARRIVED" }];
  // Job PUNYA JOB_STARTED & JOB_ARRIVED, TIDAK PUNYA JOB_COMPLETED (belum selesai).
  const events = [
    { id: "e1", action: "JOB_STARTED", jobId: "j1", routeId: "r1", actorId: "u1", actor: { name: "Driver A" }, createdAt: "2026-10-07T09:00:00.000Z", occurredAt: "2026-10-07T09:00:00.000Z", source: "DRIVER_APP" },
    { id: "e2", action: "JOB_ARRIVED", jobId: "j1", routeId: "r1", actorId: "u1", actor: { name: "Driver A" }, createdAt: "2026-10-07T09:30:00.000Z", occurredAt: "2026-10-07T09:30:00.000Z", source: "DRIVER_APP" },
  ];
  const tl = buildRouteTimeline({ route, jobs, events, podEdits: [] });
  const job = tl.jobs[0];
  const actions = job.events.map((e) => e.action);
  assert.deepEqual(actions, ["JOB_STARTED", "JOB_ARRIVED"]);
  assert.equal(job.travelMs, 30 * 60 * 1000); // started -> arrived tersedia
  assert.equal(job.serviceMs, null); // arrived -> selesai TIDAK tersedia (belum terjadi)
});

test("buildRouteTimeline: route tanpa event sama sekali -> routeEvents kosong, jobs tetap muncul (hanya milestone yang kosong)", () => {
  const route = { id: "r2", code: "RTE-2" };
  const jobs = [{ id: "j2", sequence: 1, orderNumber: "ORD-2", customerName: "Ani", type: "PICKUP", status: "ASSIGNED" }];
  const tl = buildRouteTimeline({ route, jobs, events: [], podEdits: [] });
  assert.deepEqual(tl.routeEvents, []);
  assert.equal(tl.jobs.length, 1);
  assert.deepEqual(tl.jobs[0].events, []);
});

test("buildRouteTimeline: koreksi POD_EDITED (completedAt) muncul di job.corrections, field lain (driver/helper) DIABAIKAN (tidak relevan utk waktu)", () => {
  const route = { id: "r3", code: "RTE-3" };
  const jobs = [{ id: "j3", sequence: 1, orderNumber: "ORD-3", customerName: "Citra", type: "DELIVERY", status: "COMPLETED" }];
  const podEdits = [
    {
      entityId: "j3", actorId: "admin1", actor: { name: "Admin Satu" }, createdAt: "2026-10-07T12:00:00.000Z",
      metadata: { reason: "Waktu salah input", changes: { completedAt: { from: "2026-10-06T10:00:00.000Z", to: "2026-10-07T09:00:00.000Z" } } },
    },
    {
      entityId: "j3", actorId: "admin1", actor: { name: "Admin Satu" }, createdAt: "2026-10-07T08:00:00.000Z",
      metadata: { reason: "Ganti driver saja", changes: { driverId: { from: "d1", to: "d2" } } }, // TIDAK menyentuh completedAt
    },
  ];
  const tl = buildRouteTimeline({ route, jobs, events: [], podEdits });
  assert.equal(tl.jobs[0].corrections.length, 1); // hanya yang mengubah completedAt
  assert.equal(tl.jobs[0].corrections[0].reason, "Waktu salah input");
  assert.equal(tl.jobs[0].corrections[0].actorName, "Admin Satu");
});

test("buildRouteTimeline: event ROUTE_STARTED/ROUTE_COMPLETED masuk routeEvents, BUKAN ke job manapun", () => {
  const route = { id: "r4", code: "RTE-4" };
  const jobs = [{ id: "j4", sequence: 1, orderNumber: "ORD-4", customerName: "Dedi", type: "DELIVERY", status: "COMPLETED" }];
  const events = [
    { id: "e1", action: "ROUTE_STARTED", jobId: null, routeId: "r4", actorId: "u1", actor: { name: "Driver" }, createdAt: "2026-10-07T08:00:00.000Z", occurredAt: "2026-10-07T08:00:00.000Z", source: "DRIVER_APP" },
    { id: "e2", action: "ROUTE_COMPLETED", jobId: null, routeId: "r4", actorId: "u1", actor: { name: "Driver" }, createdAt: "2026-10-07T11:00:00.000Z", occurredAt: "2026-10-07T11:00:00.000Z", source: "DRIVER_APP" },
  ];
  const tl = buildRouteTimeline({ route, jobs, events, podEdits: [] });
  assert.equal(tl.routeEvents.length, 2);
  assert.equal(tl.jobs[0].events.length, 0);
});
