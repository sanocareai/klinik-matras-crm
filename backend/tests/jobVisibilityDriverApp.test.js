// Tes regresi bug Alwan (22 September 2026, laporan owner: "rute yang
// tidak ada di Route Planner muncul di Driver App") — lihat catatan akar
// masalah lengkap di services/jobStatus.js#isJobVisibleToDriverApp. Fungsi
// murni, tanpa database, sama pola dengan tes STALE_UNSCHEDULED_JOB lain di
// folder ini.

import test from "node:test";
import assert from "node:assert/strict";

import { isJobVisibleToDriverApp } from "../src/services/jobStatus.js";

function job(overrides = {}) {
  return { status: "ASSIGNED", route: { id: "route1", status: "PUBLISHED" }, ...overrides };
}

test("job aktif di rute PUBLISHED tetap tampil", () => {
  assert.equal(isJobVisibleToDriverApp(job()), true);
});

test("job aktif di rute IN_PROGRESS tetap tampil", () => {
  assert.equal(isJobVisibleToDriverApp(job({ route: { id: "r", status: "IN_PROGRESS" } })), true);
});

test("job aktif di rute COMPLETED tetap tampil (rute selesai lewat sisi lain)", () => {
  assert.equal(isJobVisibleToDriverApp(job({ route: { id: "r", status: "COMPLETED" } })), true);
});

test("job aktif di rute CANCELLED DISEMBUNYIKAN — akar bug Alwan", () => {
  assert.equal(isJobVisibleToDriverApp(job({ route: { id: "r", status: "CANCELLED" } })), false);
});

test("job aktif di rute DRAFT (belum diterbitkan) DISEMBUNYIKAN", () => {
  assert.equal(isJobVisibleToDriverApp(job({ route: { id: "r", status: "DRAFT" } })), false);
});

test("job tanpa rute sama sekali (ditugaskan langsung, bukan lewat Route Planner) tetap tampil", () => {
  assert.equal(isJobVisibleToDriverApp(job({ route: null })), true);
});

test("job COMPLETED tetap tampil walau rutenya sekarang CANCELLED — riwayat nyata bukan rencana batal", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "COMPLETED", route: { id: "r", status: "CANCELLED" } })), true);
});

test("job FAILED tetap tampil walau rutenya sekarang DRAFT (mis. dilepas rute lalu rute lamanya dibuat ulang jadi draft)", () => {
  assert.equal(isJobVisibleToDriverApp(job({ status: "FAILED", route: { id: "r", status: "DRAFT" } })), true);
});
