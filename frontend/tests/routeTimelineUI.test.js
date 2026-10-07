// Histori Waktu rute/stop (fase 2) — kontrak UI web: panel dipakai web admin + Driver Web, aksi eksekusi membawa sumber + waktu kejadian, koreksi wajib beralasan,
// "Tidak tersedia" tidak dikarang. Komponen diperiksa dari sumber (tanpa jsdom); fungsi murni dieksekusi langsung.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("api web: semua aksi eksekusi mengirim X-Action-Source + X-Event-Occurred-At; bawaan ADMIN_WEB; Driver Web = DRIVER_WEB", () => {
  const api = src("api.js");
  assert.match(api, /function execHeaders\(idempotencyKey, \{ occurredAt = null, source = "ADMIN_WEB" \} = \{\}\)/);
  for (const fn of ["startRoute", "startArmadaJob", "arriveArmadaJob", "completeArmadaJob", "failArmadaJob"]) {
    const line = api.split("\n").find((l) => l.includes(`${fn}: (`));
    assert.ok(line && line.includes("execHeaders(idempotencyKey, opts)"), `${fn} memakai execHeaders`);
  }
  assert.match(api, /getRouteTimeline: \(routeId\)/);
  assert.match(api, /correctRouteTime: \(routeId, data, idempotencyKey = mutationKey\("timeline-fix"\)\)/);
  const submit = src("utils", "submitJobAction.js");
  assert.match(submit, /source: "DRIVER_WEB"/);
  assert.match(submit, /occurredAt: payload\.occurredAt \|\| new Date\(\)\.toISOString\(\)/, "waktu kejadian dicatat saat tombol ditekan dan tahan antrean (durablePayload)");
  assert.equal((submit.match(/idempotencyKey, timeOpts\)/g) || []).length, 4, "start/arrive/complete/fail membawa timeOpts");
  assert.match(src("pages", "DriverJobs.jsx"), /api\.startRoute\(route\.id, \{ proofPhotoUrls: urls \}, undefined, \{ source: "DRIVER_WEB" \}\)/);
});

test("panel timeline: dipakai di web admin (RouteCard) dan Driver Web; 'Tidak tersedia' dari server; penanda sinkron terlambat & jam janggal; koreksi hanya bila canCorrect", () => {
  const panel = src("features", "armada", "components", "RouteTimelinePanel.jsx");
  assert.match(panel, /api\.getRouteTimeline\(routeId\)/);
  assert.match(panel, /data-testid="badge-late-sync"/); assert.match(panel, /data-testid="badge-clock-suspect"/);
  assert.match(panel, /data-testid="timeline-missing"/);
  assert.match(panel, /canCorrect && event\.id && !fixing/);
  assert.match(panel, /Alasan koreksi wajib diisi \(minimal 5 karakter\)/);
  // Satu-satunya `new Date(x)` = konversi isian koreksi (datetime-local -> ISO). Tidak ada "sekarang" / hitung durasi sendiri.
  assert.doesNotMatch(panel, /new Date\(\)|Date\.now\(|toLocale|Intl\./, "panel tidak menghitung/mengarang waktu sendiri — semua dari server");
  assert.equal((panel.match(/new Date\(/g) || []).length, 1);
  assert.match(src("features", "armada", "components", "RouteCard.jsx"), /<RouteTimelinePanel routeId=\{route\.id\}/);
  assert.match(src("features", "armada", "components", "RouteCard.jsx"), /data-testid="route-timeline-open"/);
  assert.match(src("pages", "DriverJobs.jsx"), /<RouteTimelinePanel routeId=\{route\.id\}/);
});

test("toIsoOrNull: datetime-local -> ISO; kosong/tidak valid -> null", async () => {
  const mod = await import("data:text/javascript," + encodeURIComponent(
    src("features", "armada", "components", "RouteTimelinePanel.jsx").match(/export function toIsoOrNull[\s\S]*?\n}\n/)[0],
  ));
  assert.equal(mod.toIsoOrNull(""), null); assert.equal(mod.toIsoOrNull("bukan-tanggal"), null);
  assert.match(mod.toIsoOrNull("2026-10-07T10:05"), /^2026-10-07T\d{2}:05:00\.000Z$|^2026-10-0[67]T/);
});
