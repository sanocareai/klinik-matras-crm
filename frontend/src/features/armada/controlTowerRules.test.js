// Tes regresi murni untuk Delivery Control Tower (22 September 2026) —
// `node --test` biasa, TANPA React/JSX/DOM (lihat catatan panjang di
// controlTowerRules.js soal kenapa file itu bebas dependency alias).
import test from "node:test";
import assert from "node:assert/strict";

import {
  deriveRouteProgress, deriveRouteCity, deriveRouteExceptions,
  summarizeRoutes, rankRouteExceptions, filterRoutes, distinctCities,
  distinctDrivers, distinctVehicles,
} from "./controlTowerRules.js";

const NOW = new Date("2026-09-22T10:00:00.000Z"); // 17:00 WIB

function job(overrides = {}) {
  return {
    id: "job1", status: "ASSIGNED", updatedAt: NOW.toISOString(),
    order: { orderNumber: "RES-1", deliveryCity: "Jakarta Selatan" },
    ...overrides,
  };
}

function route(overrides = {}) {
  return {
    id: "r1", code: "RTE-1", status: "PUBLISHED", date: NOW.toISOString(),
    driverId: "d1", vehicleId: "v1", helperId: null,
    driver: { id: "d1", name: "Budi", lastAppSyncAt: NOW.toISOString() },
    publishedAt: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
    updatedAt: NOW.toISOString(),
    jobs: [job()],
    ...overrides,
  };
}

// ─── deriveRouteProgress ────────────────────────────────────────────────
test("deriveRouteProgress: hitung done/total dari jobs, activeJob dari EN_ROUTE/ARRIVED", () => {
  const r = route({
    jobs: [
      job({ id: "a", status: "COMPLETED" }),
      job({ id: "b", status: "EN_ROUTE" }),
      job({ id: "c", status: "SCHEDULED" }),
    ],
  });
  const p = deriveRouteProgress(r);
  assert.equal(p.done, 1);
  assert.equal(p.total, 3);
  assert.equal(p.activeJob.id, "b");
});

test("deriveRouteProgress: rute tanpa jobs tidak crash", () => {
  const p = deriveRouteProgress({ jobs: [] });
  assert.equal(p.done, 0);
  assert.equal(p.total, 0);
  assert.equal(p.activeJob, null);
});

test("deriveRouteProgress: lastUpdatedAt ambil yang PALING BARU antara Route.updatedAt dan job manapun", () => {
  const lebihBaru = new Date(NOW.getTime() + 3600_000).toISOString();
  const r = route({ updatedAt: NOW.toISOString(), jobs: [job({ updatedAt: lebihBaru })] });
  const p = deriveRouteProgress(r);
  assert.equal(p.lastUpdatedAt.toISOString(), lebihBaru);
});

// ─── deriveRouteCity ────────────────────────────────────────────────────
test("deriveRouteCity: kota TERBANYAK di antara stop menang", () => {
  const r = route({
    jobs: [
      job({ order: { deliveryCity: "Bandung" } }),
      job({ order: { deliveryCity: "Bandung" } }),
      job({ order: { deliveryCity: "Jakarta Selatan" } }),
    ],
  });
  assert.equal(deriveRouteCity(r), "Bandung");
});

test("deriveRouteCity: null kalau tidak ada satu pun stop dengan kota diketahui (bukan ditebak)", () => {
  const r = route({ jobs: [job({ order: { deliveryCity: null } })] });
  assert.equal(deriveRouteCity(r), null);
});

// ─── deriveRouteExceptions — satu per jenis ────────────────────────────
test("TANPA_DRIVER_KENDARAAN: DRAFT tanpa driver/kendaraan, ada stop", () => {
  const r = route({ status: "DRAFT", driverId: null, vehicleId: null });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "TANPA_DRIVER_KENDARAAN"));
});

test("TANPA_DRIVER_KENDARAAN: TIDAK muncul kalau DRAFT tapi belum ada stop sama sekali", () => {
  const r = route({ status: "DRAFT", driverId: null, vehicleId: null, jobs: [] });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "TANPA_DRIVER_KENDARAAN"));
});

test("TANPA_DRIVER_KENDARAAN: tetap muncul pada rute aktif jika assignment hilang", () => {
  const r = route({ status: "PUBLISHED", driverId: null, driver: null });
  assert.ok(deriveRouteExceptions(r, { now: NOW }).some((e) => e.type === "TANPA_DRIVER_KENDARAAN"));
});

test("BELUM_PUBLISH: DRAFT dengan driver+kendaraan+stop lengkap", () => {
  const r = route({ status: "DRAFT", driverId: "d1", vehicleId: "v1" });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "BELUM_PUBLISH"));
});

test("BELUM_PUBLISH dan TANPA_DRIVER_KENDARAAN saling eksklusif (tidak pernah muncul bersamaan)", () => {
  const lengkap = deriveRouteExceptions(route({ status: "DRAFT" }), { now: NOW });
  const kurang = deriveRouteExceptions(route({ status: "DRAFT", driverId: null }), { now: NOW });
  assert.ok(lengkap.some((e) => e.type === "BELUM_PUBLISH") && !lengkap.some((e) => e.type === "TANPA_DRIVER_KENDARAAN"));
  assert.ok(kurang.some((e) => e.type === "TANPA_DRIVER_KENDARAAN") && !kurang.some((e) => e.type === "BELUM_PUBLISH"));
});

test("DRIVER_BELUM_SINKRON: PUBLISHED, lastAppSyncAt null", () => {
  const r = route({ status: "PUBLISHED", driver: { id: "d1", name: "Budi", lastAppSyncAt: null } });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "DRIVER_BELUM_SINKRON"));
});

test("DRIVER_BELUM_SINKRON: PUBLISHED, lastAppSyncAt SEBELUM publishedAt (belum sinkron SEJAK terbit)", () => {
  const r = route({
    status: "PUBLISHED",
    publishedAt: NOW.toISOString(),
    driver: { id: "d1", name: "Budi", lastAppSyncAt: new Date(NOW.getTime() - 3600_000).toISOString() },
  });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "DRIVER_BELUM_SINKRON"));
});

test("DRIVER_BELUM_SINKRON: TIDAK muncul kalau lastAppSyncAt SETELAH publishedAt", () => {
  const r = route({
    status: "PUBLISHED",
    publishedAt: new Date(NOW.getTime() - 3600_000).toISOString(),
    driver: { id: "d1", name: "Budi", lastAppSyncAt: NOW.toISOString() },
  });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "DRIVER_BELUM_SINKRON"));
});

test("TERLAMBAT_BERANGKAT: PUBLISHED hari ini, terbit >=2 jam lalu, belum ada stop bergerak", () => {
  const r = route({
    status: "PUBLISHED", date: NOW.toISOString(),
    publishedAt: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
    jobs: [job({ status: "SCHEDULED" }), job({ status: "ASSIGNED" })],
  });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "TERLAMBAT_BERANGKAT"));
});

test("TERLAMBAT_BERANGKAT: TIDAK muncul kalau SATU stop pun sudah EN_ROUTE", () => {
  const r = route({
    status: "PUBLISHED", date: NOW.toISOString(),
    publishedAt: new Date(NOW.getTime() - 3 * 3600_000).toISOString(),
    jobs: [job({ status: "EN_ROUTE" }), job({ status: "SCHEDULED" })],
  });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "TERLAMBAT_BERANGKAT"));
});

test("TERLAMBAT_BERANGKAT: TIDAK muncul kalau baru terbit < 2 jam lalu", () => {
  const r = route({
    status: "PUBLISHED", date: NOW.toISOString(),
    publishedAt: new Date(NOW.getTime() - 30 * 60_000).toISOString(),
    jobs: [job({ status: "SCHEDULED" })],
  });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "TERLAMBAT_BERANGKAT"));
});

test("TERLAMBAT_BERANGKAT: TIDAK muncul untuk rute BUKAN hari ini (tanggal beda)", () => {
  const r = route({
    status: "PUBLISHED", date: new Date(NOW.getTime() + 2 * 86400_000).toISOString(),
    publishedAt: new Date(NOW.getTime() - 5 * 3600_000).toISOString(),
    jobs: [job({ status: "SCHEDULED" })],
  });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "TERLAMBAT_BERANGKAT"));
});

test("TERLAMBAT_BERANGKAT: kalender hari ini memakai WIB sebelum 07.00 WIB", () => {
  const diniHariWib = new Date("2026-09-21T19:30:00.000Z"); // 22 Sep 02.30 WIB
  const r = route({
    status: "PUBLISHED",
    date: "2026-09-22T00:00:00.000Z",
    publishedAt: new Date(diniHariWib.getTime() - 3 * 3600_000).toISOString(),
    jobs: [job({ status: "ASSIGNED" })],
  });
  assert.ok(deriveRouteExceptions(r, { now: diniHariWib }).some((e) => e.type === "TERLAMBAT_BERANGKAT"));
});

test("GAGAL_ANTAR: job FAILED tanpa rescheduleReason/rescheduleCase → OPEN, jadi exception", () => {
  const r = route({ jobs: [job({ status: "FAILED" })] });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "GAGAL_ANTAR"));
});

test("GAGAL_ANTAR: TIDAK muncul kalau job FAILED SUDAH dijadwalkan ulang (rescheduleReason terisi)", () => {
  const r = route({ jobs: [job({ status: "FAILED", rescheduleReason: "Customer minta besok" })] });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "GAGAL_ANTAR"));
});

test("MASALAH_AKTIF: complaint case aktif ikut exception, yang selesai tidak", () => {
  const aktif = route({ jobs: [job({ complaintCase: { caseNumber: "CMP-1", status: "DALAM_PENANGANAN", severity: "TINGGI" } })] });
  const selesai = route({ jobs: [job({ complaintCase: { caseNumber: "CMP-2", status: "SELESAI", severity: "TINGGI" } })] });
  assert.ok(deriveRouteExceptions(aktif, { now: NOW }).some((e) => e.type === "MASALAH_AKTIF"));
  assert.ok(!deriveRouteExceptions(selesai, { now: NOW }).some((e) => e.type === "MASALAH_AKTIF"));
});

test("TERTINGGAL: rute sudah lewat tanggal, status belum COMPLETED/CANCELLED", () => {
  const r = route({ status: "PUBLISHED", date: new Date(NOW.getTime() - 2 * 86400_000).toISOString() });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(exc.some((e) => e.type === "TERTINGGAL"));
});

test("TERTINGGAL: TIDAK muncul kalau sudah COMPLETED walau tanggalnya lampau", () => {
  const r = route({ status: "COMPLETED", date: new Date(NOW.getTime() - 2 * 86400_000).toISOString() });
  const exc = deriveRouteExceptions(r, { now: NOW });
  assert.ok(!exc.some((e) => e.type === "TERTINGGAL"));
});

test("Rute CANCELLED/COMPLETED sehat tidak menghasilkan exception apa pun", () => {
  const cancelled = deriveRouteExceptions(route({ status: "CANCELLED" }), { now: NOW });
  const selesai = deriveRouteExceptions(
    route({ status: "COMPLETED", jobs: [job({ status: "COMPLETED" })] }),
    { now: NOW }
  );
  assert.deepEqual(cancelled, []);
  assert.deepEqual(selesai, []);
});

// ─── summarizeRoutes ────────────────────────────────────────────────────
test("summarizeRoutes: hitungan per status + BERMASALAH (rute dgn >=1 exception, status apa pun kecuali CANCELLED)", () => {
  const routes = [
    route({ id: "a", status: "DRAFT", driverId: null, vehicleId: null }), // TANPA_DRIVER_KENDARAAN
    route({ id: "b", status: "PUBLISHED", driver: { id: "d1", name: "Budi", lastAppSyncAt: null } }), // DRIVER_BELUM_SINKRON
    route({ id: "c", status: "COMPLETED", jobs: [job({ status: "COMPLETED" })] }), // sehat
    route({ id: "d", status: "CANCELLED" }), // tidak dihitung Bermasalah walau berpotensi
  ];
  const s = summarizeRoutes(routes, { now: NOW });
  assert.equal(s.DRAFT, 1);
  assert.equal(s.PUBLISHED, 1);
  assert.equal(s.COMPLETED, 1);
  assert.equal(s.CANCELLED, 1);
  assert.equal(s.BERMASALAH, 2, "a dan b bermasalah, c sehat, d dikecualikan (CANCELLED)");
});

test("summarizeRoutes: array kosong tidak crash, semua nol", () => {
  const s = summarizeRoutes([], { now: NOW });
  assert.deepEqual(s, { DRAFT: 0, PUBLISHED: 0, IN_PROGRESS: 0, COMPLETED: 0, CANCELLED: 0, BERMASALAH: 0 });
});

// ─── rankRouteExceptions — prioritas dampak operasional ────────────────
test("rankRouteExceptions: GAGAL_ANTAR/TERTINGGAL di atas BELUM_PUBLISH (dampak lebih tinggi)", () => {
  const routes = [
    route({ id: "ringan", status: "DRAFT" }), // BELUM_PUBLISH
    route({ id: "berat", jobs: [job({ status: "FAILED" })] }), // GAGAL_ANTAR
  ];
  const ranked = rankRouteExceptions(routes, { now: NOW });
  assert.equal(ranked[0].type, "GAGAL_ANTAR");
  assert.equal(ranked[ranked.length - 1].type, "BELUM_PUBLISH");
});

test("rankRouteExceptions: setiap entri membawa referensi route asalnya untuk tindakan cepat", () => {
  const r = route({ id: "target-route", status: "DRAFT" });
  const ranked = rankRouteExceptions([r], { now: NOW });
  assert.equal(ranked[0].route.id, "target-route");
});

test("rankRouteExceptions: rute CANCELLED tidak pernah ikut", () => {
  const r = route({ status: "CANCELLED", driverId: null, vehicleId: null });
  const ranked = rankRouteExceptions([r], { now: NOW });
  assert.deepEqual(ranked, []);
});

// ─── filterRoutes ───────────────────────────────────────────────────────
test("filterRoutes: status", () => {
  const routes = [route({ id: "a", status: "DRAFT" }), route({ id: "b", status: "PUBLISHED" })];
  assert.deepEqual(filterRoutes(routes, { status: "PUBLISHED" }).map((r) => r.id), ["b"]);
});

test("filterRoutes: driverId cocok driver ATAU helper", () => {
  const routes = [
    route({ id: "a", driverId: "d1", helperId: null }),
    route({ id: "b", driverId: "d2", helperId: "d1" }),
    route({ id: "c", driverId: "d3", helperId: "d3" }),
  ];
  assert.deepEqual(filterRoutes(routes, { driverId: "d1" }).map((r) => r.id).sort(), ["a", "b"]);
});

test("filterRoutes: vehicleId", () => {
  const routes = [route({ id: "a", vehicleId: "v1" }), route({ id: "b", vehicleId: "v2" })];
  assert.deepEqual(filterRoutes(routes, { vehicleId: "v2" }).map((r) => r.id), ["b"]);
});

test("filterRoutes: city (turunan deriveRouteCity)", () => {
  const routes = [
    route({ id: "a", jobs: [job({ order: { deliveryCity: "Bandung" } })] }),
    route({ id: "b", jobs: [job({ order: { deliveryCity: "Depok" } })] }),
  ];
  assert.deepEqual(filterRoutes(routes, { city: "Depok" }).map((r) => r.id), ["b"]);
});

test("filterRoutes: onlyProblem menyaring rute tanpa exception & rute CANCELLED", () => {
  const routes = [
    route({ id: "bermasalah", status: "DRAFT" }),
    route({ id: "sehat", status: "COMPLETED", jobs: [job({ status: "COMPLETED" })] }),
    route({ id: "dibatalkan", status: "CANCELLED", driverId: null, vehicleId: null }),
  ];
  assert.deepEqual(filterRoutes(routes, { onlyProblem: true }, { now: NOW }).map((r) => r.id), ["bermasalah"]);
});

test("filterRoutes: filter kosong/tidak diisi mengembalikan semua rute apa adanya", () => {
  const routes = [route({ id: "a" }), route({ id: "b" })];
  assert.equal(filterRoutes(routes, {}).length, 2);
});

// ─── distinctCities ─────────────────────────────────────────────────────
test("distinctCities: unik & terurut, tanpa null", () => {
  const routes = [
    route({ jobs: [job({ order: { deliveryCity: "Depok" } })] }),
    route({ jobs: [job({ order: { deliveryCity: "Bandung" } })] }),
    route({ jobs: [job({ order: { deliveryCity: "Depok" } })] }),
    route({ jobs: [job({ order: { deliveryCity: null } })] }),
  ];
  assert.deepEqual(distinctCities(routes), ["Bandung", "Depok"]);
});

// ─── distinctDrivers / distinctVehicles ────────────────────────────────
test("distinctDrivers: gabungan driver DAN helper dari semua rute, unik by id, terurut nama", () => {
  const routes = [
    route({ driver: { id: "d1", name: "Zaki" }, helper: { id: "d2", name: "Agus" } }),
    route({ driver: { id: "d1", name: "Zaki" }, helper: null }),
  ];
  assert.deepEqual(distinctDrivers(routes), [{ id: "d2", name: "Agus" }, { id: "d1", name: "Zaki" }]);
});

test("distinctVehicles: unik by id, terurut plat nomor", () => {
  const routes = [
    route({ vehicle: { id: "v1", plateNumber: "B 1234 CD" } }),
    route({ vehicle: { id: "v2", plateNumber: "B 1000 AB" } }),
    route({ vehicle: { id: "v1", plateNumber: "B 1234 CD" } }),
  ];
  assert.deepEqual(distinctVehicles(routes), [{ id: "v2", plateNumber: "B 1000 AB" }, { id: "v1", plateNumber: "B 1234 CD" }]);
});
