// Tes regresi bug Alwan (22 September 2026, laporan owner: "rute yang
// tidak ada di Route Planner muncul di Driver App") — lihat catatan akar
// masalah lengkap di services/jobStatus.js#isJobVisibleToDriverApp. Fungsi
// murni, tanpa database, sama pola dengan tes STALE_UNSCHEDULED_JOB lain di
// folder ini.
//
// DIPERLUAS 22 September 2026 (audit QA produksi, permintaan eksplisit:
// "test seluruh kombinasi status, termasuk status selesai dan status
// baru/tidak dikenal") — matriks penuh JobStatus × (RouteStatus | tanpa
// rute), termasuk nilai enum yang ADA tapi tidak pernah ditulis kode
// (RESCHEDULED) dan string sembarang yang MENIRU status masa depan/data
// rusak (bukan bagian enum Prisma sama sekali).

import test from "node:test";
import assert from "node:assert/strict";

import {
  isJobVisibleToDriverApp,
  VISIBLE_ROUTE_STATUSES_FOR_DRIVER_APP,
  JOB_STATUS_SETTLED_FOR_DRIVER_APP,
} from "../src/services/jobStatus.js";

function job(overrides = {}) {
  return { status: "ASSIGNED", route: { id: "route1", status: "PUBLISHED" }, ...overrides };
}

// ── Kombinasi RouteStatus (5 nilai Prisma) × job status AKTIF (belum tuntas) ──
const SEMUA_ROUTE_STATUS = ["DRAFT", "PUBLISHED", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
const JOB_STATUS_AKTIF = ["UNSCHEDULED", "SCHEDULED", "ASSIGNED", "EN_ROUTE", "ARRIVED"];

for (const routeStatus of SEMUA_ROUTE_STATUS) {
  const seharusnyaTampil = VISIBLE_ROUTE_STATUSES_FOR_DRIVER_APP.includes(routeStatus);
  for (const jobStatus of JOB_STATUS_AKTIF) {
    test(`job ${jobStatus} di rute ${routeStatus} → ${seharusnyaTampil ? "TAMPIL" : "DISEMBUNYIKAN"}`, () => {
      const hasil = isJobVisibleToDriverApp(job({ status: jobStatus, route: { id: "r", status: routeStatus } }));
      assert.equal(hasil, seharusnyaTampil);
    });
  }
}

// ── Job status SETTLED (COMPLETED/FAILED/RESCHEDULED) — tampil apa pun rutenya ──
for (const jobStatus of JOB_STATUS_SETTLED_FOR_DRIVER_APP) {
  for (const routeStatus of [...SEMUA_ROUTE_STATUS, null]) {
    test(`job ${jobStatus} (settled) di rute ${routeStatus ?? "(tanpa rute)"} tetap TAMPIL`, () => {
      const route = routeStatus ? { id: "r", status: routeStatus } : null;
      assert.equal(isJobVisibleToDriverApp(job({ status: jobStatus, route })), true);
    });
  }
}

// ── Job tanpa Route — KEBIJAKAN DIBALIK 22 September 2026 (audit RTE-220926,
// job orphan Arman) — sekarang DISEMBUNYIKAN kalau belum tuntas, TETAP
// tampil kalau sudah tuntas (riwayat nyata). Lihat catatan panjang di
// jobStatus.js#isJobVisibleToDriverApp.
for (const jobStatus of JOB_STATUS_AKTIF) {
  test(`REGRESI Arman: job ${jobStatus} tanpa rute (routeId null) → DISEMBUNYIKAN (job orphan, bukan penugasan sah)`, () => {
    assert.equal(isJobVisibleToDriverApp(job({ status: jobStatus, route: null })), false);
  });
}
for (const jobStatus of JOB_STATUS_SETTLED_FOR_DRIVER_APP) {
  test(`job ${jobStatus} (settled) tanpa rute tetap TAMPIL — riwayat nyata`, () => {
    assert.equal(isJobVisibleToDriverApp(job({ status: jobStatus, route: null })), true);
  });
}

// ── Status TIDAK DIKENAL (bukan bagian enum Prisma sama sekali) — jaring pengaman ──
test("job.status STRING SEMBARANG (bukan enum) + rute PUBLISHED → tetap TAMPIL (gerbang driverId sudah cukup)", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "STATUS_BARU_DARI_MASA_DEPAN", route: { id: "r", status: "PUBLISHED" } })), true);
});

test("job.status STRING SEMBARANG + rute DRAFT → DISEMBUNYIKAN (rute belum committed tetap menang)", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "STATUS_BARU_DARI_MASA_DEPAN", route: { id: "r", status: "DRAFT" } })), false);
});

test("job.status STRING SEMBARANG tanpa rute → DISEMBUNYIKAN (bukan status settled dikenal, dan tanpa rute = anomali sekarang)", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "STATUS_BARU_DARI_MASA_DEPAN", route: null })), false);
});

test("route.status STRING SEMBARANG (bukan enum, mis. migrasi data rusak) + job aktif → DISEMBUNYIKAN (allowlist default-deny)", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "ASSIGNED", route: { id: "r", status: "ENTAH_APA" } })), false);
});

test("route.status null/undefined (data cacat) + job aktif → DISEMBUNYIKAN, bukan crash", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "ASSIGNED", route: { id: "r", status: null } })), false);
  assert.equal(isJobVisibleToDriverApp(job({ status: "ASSIGNED", route: { id: "r", status: undefined } })), false);
});

// ── Regresi eksplisit: skenario nyata bug Alwan & audit produksi 22 Sep 2026 ──
test("REGRESI Alwan: job ASSIGNED di rute CANCELLED (job SENGAJA tidak dilepas backend) → DISEMBUNYIKAN", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "ASSIGNED", route: { id: "r", status: "CANCELLED" } })), false);
});

test("REGRESI Alwan: job ASSIGNED di rute DRAFT (kebagian driver sebelum diterbitkan) → DISEMBUNYIKAN", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "ASSIGNED", route: { id: "r", status: "DRAFT" } })), false);
});

test("job COMPLETED tetap tampil walau rutenya sekarang CANCELLED — riwayat nyata bukan rencana batal", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "COMPLETED", route: { id: "r", status: "CANCELLED" } })), true);
});
