// Histori waktu rute/stop — aturan murni: kualitas waktu perangkat, format WIB/Indonesia, durasi hanya bila bukti waktu ada, histori lama "Tidak tersedia", koreksi append-only.
import test from "node:test";
import assert from "node:assert/strict";
import {
  TIME_QUALITY, classifyEventTime, readTimeMeta, normalizeSource, formatWib, formatDuration, buildRouteTimeline, validateCorrectionInput, EXEC_ACTIONS,
} from "../src/services/deliveryTimeline.js";

const NOW = new Date("2026-10-07T03:00:00.000Z"); // 10:00 WIB
const iso = (minutesAgo) => new Date(NOW.getTime() - minutesAgo * 60000).toISOString();

test("classifyEventTime: langsung / sinkron terlambat / jam janggal / tanpa waktu / tidak valid", () => {
  assert.equal(classifyEventTime(iso(0.5), NOW).timeQuality, TIME_QUALITY.LIVE);
  assert.equal(classifyEventTime(iso(30), NOW).timeQuality, TIME_QUALITY.LATE_SYNC);
  assert.equal(classifyEventTime(iso(-30), NOW).timeQuality, TIME_QUALITY.CLOCK_FUTURE, "30 menit di depan server = janggal");
  assert.equal(classifyEventTime(iso(-3), NOW).timeQuality, TIME_QUALITY.LIVE, "selisih kecil ke depan masih ditoleransi");
  assert.equal(classifyEventTime(iso(60 * 24 * 8), NOW).timeQuality, TIME_QUALITY.CLOCK_STALE, "> 7 hari = janggal");
  const none = classifyEventTime(null, NOW); assert.equal(none.timeQuality, TIME_QUALITY.SERVER_TIME); assert.equal(none.occurredAt.getTime(), NOW.getTime());
  for (const bad of ["kemarin", "2026-10-07 10:00:00", "2026-13-45T99:00:00Z", "12345"]) {
    const r = classifyEventTime(bad, NOW); assert.equal(r.timeQuality, TIME_QUALITY.CLOCK_INVALID, bad); assert.equal(r.occurredAt.getTime(), NOW.getTime(), "waktu tak valid tidak dipakai");
  }
  assert.equal(classifyEventTime("2026-10-07T09:59:40+07:00", NOW).timeQuality, TIME_QUALITY.LIVE, "offset zona diterima");
});

test("readTimeMeta: header sumber + waktu kejadian; klien tanpa header = KLIEN_LAMA (tidak mengarang sumber)", () => {
  const req = (h, body = {}) => ({ get: (n) => h[n], body });
  assert.deepEqual(readTimeMeta(req({ "X-Event-Occurred-At": iso(10), "X-Action-Source": "driver_app" }), NOW), { occurredAt: new Date(iso(10)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LATE_SYNC });
  assert.equal(readTimeMeta(req({}), NOW).source, "KLIEN_LAMA");
  assert.equal(readTimeMeta(req({ "X-Action-Source": "hacker" }), NOW).source, "KLIEN_LAMA", "sumber di luar daftar tidak dipercaya");
  assert.equal(normalizeSource("ADMIN_WEB"), "ADMIN_WEB");
});

test("format WIB & durasi berbahasa Indonesia", () => {
  assert.equal(formatWib("2026-10-07T03:05:00.000Z"), "7 Okt 2026 10:05 WIB");
  assert.equal(formatWib("2026-12-31T17:30:00.000Z"), "1 Jan 2027 00:30 WIB", "lintas hari/tahun mengikuti WIB");
  assert.equal(formatWib(null), null);
  assert.equal(formatDuration(30_000), "kurang dari 1 menit"); assert.equal(formatDuration(25 * 60000), "25 menit"); assert.equal(formatDuration(120 * 60000), "2 jam"); assert.equal(formatDuration(135 * 60000), "2 jam 15 menit");
  assert.equal(formatDuration(-1), null);
});

const ev = (id, action, over = {}) => ({ id, action, jobId: null, routeId: "r1", actorId: "u1", actor: { name: "Budi Driver" }, payload: {}, createdAt: new Date(NOW), occurredAt: null, source: null, timeQuality: null, ...over });
const job = (over = {}) => ({ id: "j1", type: "DELIVERY", status: "COMPLETED", sequence: 1, orderNumber: "RES-1", customerName: "Ibu A", arrivedAt: null, completedAt: null, ...over });

test("timeline: event lengkap -> label Indonesia, WIB, durasi perjalanan & layanan, sumber & actor", () => {
  const t = buildRouteTimeline({
    route: { id: "r1", code: "RTE-1", status: "COMPLETED" }, jobs: [job()],
    events: [
      ev("e1", EXEC_ACTIONS.ROUTE_STARTED, { occurredAt: new Date(iso(120)), createdAt: new Date(iso(119.9)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
      ev("e2", EXEC_ACTIONS.JOB_STARTED, { jobId: "j1", occurredAt: new Date(iso(100)), createdAt: new Date(iso(100)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
      ev("e3", EXEC_ACTIONS.JOB_ARRIVED, { jobId: "j1", occurredAt: new Date(iso(70)), createdAt: new Date(iso(70)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
      ev("e4", EXEC_ACTIONS.JOB_COMPLETED, { jobId: "j1", occurredAt: new Date(iso(40)), createdAt: new Date(iso(40)), source: "DRIVER_WEB", timeQuality: TIME_QUALITY.LIVE }),
      ev("e5", EXEC_ACTIONS.ROUTE_COMPLETED, { occurredAt: new Date(iso(40)), createdAt: new Date(iso(40)), source: "SYSTEM", timeQuality: TIME_QUALITY.SERVER_TIME }),
    ],
  });
  const stop = t.stops[0];
  assert.deepEqual(stop.events.map((e) => e.label), ["Menuju lokasi", "Tiba di lokasi", "Pengiriman selesai"]);
  assert.equal(stop.travelDurationText, "30 menit"); assert.equal(stop.serviceDurationText, "30 menit");
  assert.equal(stop.events[2].sourceLabel, "Driver Web"); assert.equal(stop.events[0].actorName, "Budi Driver");
  assert.match(stop.events[0].atText, /WIB$/);
  assert.deepEqual(t.routeEvents.map((e) => e.label), ["Berangkat dari Sano", "Rute selesai"]);
  assert.equal(t.routeDurationText, "1 jam 20 menit"); assert.deepEqual(stop.missing, []);
});

test("histori lama tanpa bukti waktu: 'Tidak tersedia', tanpa durasi, tanpa mengarang waktu", () => {
  const t = buildRouteTimeline({ route: { id: "r1", code: "RTE-0", status: "COMPLETED", startedAt: null, completedAt: null }, jobs: [job({ arrivedAt: null, completedAt: null })], events: [] });
  assert.deepEqual(t.stops[0].missing.map((m) => [m.label, m.atText]), [["Menuju lokasi", "Tidak tersedia"], ["Tiba di lokasi", "Tidak tersedia"], ["Pengiriman selesai", "Tidak tersedia"]]);
  assert.equal(t.stops[0].travelDurationText, null); assert.equal(t.stops[0].serviceDurationText, null); assert.equal(t.routeDurationText, null);
  assert.deepEqual(t.routeMissing.map((m) => m.atText), ["Tidak tersedia", "Tidak tersedia"]);
  assert.equal(t.stops[0].events.length, 0, "tidak ada tonggak yang dikarang");
});

test("kolom lama (arrivedAt/completedAt) dipakai sebagai cadangan, ditandai sumbernya — bukan seolah event perangkat", () => {
  const t = buildRouteTimeline({ route: { id: "r1", status: "COMPLETED", startedAt: new Date(iso(90)), completedAt: new Date(iso(10)) }, jobs: [job({ arrivedAt: new Date(iso(60)), completedAt: new Date(iso(30)) })], events: [] });
  const arrive = t.stops[0].events.find((e) => e.action === EXEC_ACTIONS.JOB_ARRIVED);
  assert.equal(arrive.origin, "KOLOM_LAMA"); assert.match(arrive.sourceLabel, /tanpa log aksi/); assert.ok(arrive.flags.length);
  assert.equal(t.stops[0].serviceDurationText, "30 menit");
  assert.equal(t.routeEvents[0].origin, "KOLOM_LAMA");
});

test("offline: waktu kejadian dipertahankan, dilabeli sinkron terlambat; jam janggal memakai waktu server & tanpa durasi", () => {
  const late = buildRouteTimeline({ route: { id: "r1", status: "IN_PROGRESS" }, jobs: [job({ status: "ARRIVED" })], events: [
    ev("e2", EXEC_ACTIONS.JOB_STARTED, { jobId: "j1", occurredAt: new Date(iso(50)), createdAt: new Date(iso(5)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LATE_SYNC }),
    ev("e3", EXEC_ACTIONS.JOB_ARRIVED, { jobId: "j1", occurredAt: new Date(iso(20)), createdAt: new Date(iso(5)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LATE_SYNC }),
  ] });
  const [s, a] = late.stops[0].events;
  assert.equal(s.at, iso(50), "waktu kejadian dari antrean, bukan waktu terima"); assert.equal(s.lateSync, true); assert.match(s.flags.join(" "), /terlambat/);
  assert.notEqual(s.receivedAt, s.at); assert.equal(late.stops[0].travelDurationText, "30 menit");
  const odd = buildRouteTimeline({ route: { id: "r1", status: "IN_PROGRESS" }, jobs: [job({ status: "ARRIVED" })], events: [
    ev("e2", EXEC_ACTIONS.JOB_STARTED, { jobId: "j1", occurredAt: new Date(iso(-600)), createdAt: new Date(iso(30)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.CLOCK_FUTURE }),
    ev("e3", EXEC_ACTIONS.JOB_ARRIVED, { jobId: "j1", occurredAt: new Date(iso(10)), createdAt: new Date(iso(10)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
  ] });
  const o = odd.stops[0].events[0];
  assert.equal(o.suspect, true); assert.equal(o.at, iso(30), "waktu server dipakai untuk jam perangkat janggal"); assert.ok(o.deviceAtText); assert.match(o.flags.join(" "), /janggal/);
  assert.equal(odd.stops[0].travelDurationText, null); assert.match(odd.stops[0].travelDurationNote, /janggal/);
});

test("urutan waktu janggal (tiba sebelum berangkat) -> durasi tidak ditampilkan", () => {
  const t = buildRouteTimeline({ route: { id: "r1", status: "IN_PROGRESS" }, jobs: [job({ status: "ARRIVED" })], events: [
    ev("e2", EXEC_ACTIONS.JOB_STARTED, { jobId: "j1", occurredAt: new Date(iso(10)), createdAt: new Date(iso(10)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
    ev("e3", EXEC_ACTIONS.JOB_ARRIVED, { jobId: "j1", occurredAt: new Date(iso(30)), createdAt: new Date(iso(30)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
  ] });
  assert.equal(t.stops[0].travelDurationText, null); assert.match(t.stops[0].travelDurationNote, /urutan/);
});

test("event lama tanpa kolom waktu kejadian: memakai waktu server dan DITANDAI (tidak dianggap waktu perangkat)", () => {
  const t = buildRouteTimeline({ route: { id: "r1", status: "IN_PROGRESS" }, jobs: [job({ status: "EN_ROUTE" })], events: [ev("e2", EXEC_ACTIONS.JOB_STARTED, { jobId: "j1", createdAt: new Date(iso(20)) })] });
  const e = t.stops[0].events[0]; assert.equal(e.at, iso(20)); assert.equal(e.sourceLabel, "Tidak tercatat"); assert.ok(e.flags.some((f) => /diterima server/.test(f)));
});

test("koreksi append-only: event asli tetap, koreksi terbaru menentukan waktu efektif, jejak lengkap (actor + alasan)", () => {
  const events = [
    ev("e3", EXEC_ACTIONS.JOB_ARRIVED, { jobId: "j1", occurredAt: new Date(iso(60)), createdAt: new Date(iso(60)), source: "DRIVER_APP", timeQuality: TIME_QUALITY.LIVE }),
    ev("c1", EXEC_ACTIONS.TIME_CORRECTED, { jobId: "j1", actor: { name: "Admin Rani" }, createdAt: new Date(iso(5)), payload: { targetEventId: "e3", previousEffectiveAt: iso(60), correctedOccurredAt: iso(55), reason: "Driver lupa menekan tiba" } }),
    ev("c2", EXEC_ACTIONS.TIME_CORRECTED, { jobId: "j1", actor: { name: "Admin Rani" }, createdAt: new Date(iso(2)), payload: { targetEventId: "e3", previousEffectiveAt: iso(55), correctedOccurredAt: iso(50), reason: "Sesuai foto muatan" } }),
  ];
  const t = buildRouteTimeline({ route: { id: "r1", status: "IN_PROGRESS" }, jobs: [job({ status: "ARRIVED" })], events });
  const e = t.stops[0].events.find((x) => x.action === EXEC_ACTIONS.JOB_ARRIVED);
  assert.equal(e.at, iso(50)); assert.equal(e.effectiveSource, "KOREKSI"); assert.equal(e.corrections.length, 2);
  assert.deepEqual(e.corrections.map((c) => [c.actorName, c.reason]), [["Admin Rani", "Driver lupa menekan tiba"], ["Admin Rani", "Sesuai foto muatan"]]);
  assert.equal(t.stops[0].events.filter((x) => x.action === EXEC_ACTIONS.TIME_CORRECTED).length, 0, "koreksi bukan tonggak sendiri");
});

test("reschedule: job yang dilepas dari rute tetap punya riwayat (event atau JobIssueLog), tanpa dobel", () => {
  const withEvent = buildRouteTimeline({ route: { id: "r1", status: "PUBLISHED" }, jobs: [], events: [
    ev("e9", EXEC_ACTIONS.JOB_RESCHEDULED, { jobId: "j9", occurredAt: new Date(iso(5)), createdAt: new Date(iso(5)), source: "ADMIN_WEB", timeQuality: TIME_QUALITY.LIVE, payload: { reason: "Customer minta" } }),
  ], issueLogs: [{ id: "l1", jobId: "j9", createdAt: new Date(iso(5)), createdByName: "Admin", rescheduleReason: "Customer minta" }] });
  assert.equal(withEvent.stops[0].events.length, 1, "event ledger menang atas JobIssueLog (tidak dobel)");
  const legacy = buildRouteTimeline({ route: { id: "r1", status: "PUBLISHED" }, jobs: [job({ id: "j9", status: "RESCHEDULED" })], events: [], issueLogs: [{ id: "l1", jobId: "j9", createdAt: new Date(iso(5)), createdByName: "Admin", rescheduleReason: "Customer minta" }] });
  assert.equal(legacy.stops[0].events[0].label, "Dijadwalkan ulang"); assert.equal(legacy.stops[0].events[0].detail, "Customer minta"); assert.equal(legacy.stops[0].events[0].origin, "KOLOM_LAMA");
});

test("validateCorrectionInput: alasan & waktu wajib, bukan masa depan", () => {
  const ok = { eventId: "e1", reason: "Driver lupa menekan", correctedOccurredAt: iso(10) };
  assert.equal(validateCorrectionInput(ok, { now: NOW }).reason, "Driver lupa menekan");
  for (const [bad, code] of [[{ ...ok, reason: "x" }, "TIMELINE_REASON_REQUIRED"], [{ ...ok, eventId: "" }, "TIMELINE_EVENT_REQUIRED"], [{ ...ok, correctedOccurredAt: "kemarin" }, "TIMELINE_TIME_INVALID"], [{ ...ok, correctedOccurredAt: iso(-60) }, "TIMELINE_TIME_FUTURE"], [{ ...ok, reason: "a".repeat(501) }, "TIMELINE_REASON_TOO_LONG"]]) {
    assert.throws(() => validateCorrectionInput(bad, { now: NOW }), (e) => e.code === code && e.statusCode === 400, code);
  }
});
