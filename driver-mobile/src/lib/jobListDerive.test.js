// Tes regresi murni untuk deriveJobList (22 September 2026) — dijalankan
// dengan `node --test` biasa, TIDAK butuh React Native/jest (file ini &
// jobListDerive.js sengaja bebas import RN). Fokus: tidak ada job
// duplikat/hilang/hantu di daftar Aktif vs Riwayat, dan kartu "Mulai
// Perjalanan" per rute terhitung benar.
import test from "node:test";
import assert from "node:assert/strict";

import { deriveJobList } from "./jobListDerive.js";

test("job SCHEDULED/ASSIGNED/EN_ROUTE/ARRIVED masuk Aktif, COMPLETED/FAILED masuk Riwayat — tidak ada yang hilang atau dobel", () => {
  const jobs = [
    { id: "0", status: "SCHEDULED", route: null },
    { id: "1", status: "ASSIGNED", route: null },
    { id: "2", status: "EN_ROUTE", route: null },
    { id: "3", status: "ARRIVED", route: null },
    { id: "4", status: "COMPLETED", route: null },
    { id: "5", status: "FAILED", route: null },
    { id: "6", status: "UNSCHEDULED", route: null },
  ];
  const aktif = deriveJobList(jobs, { showHistory: false });
  const riwayat = deriveJobList(jobs, { showHistory: true });

  assert.deepEqual(aktif.listData.map((j) => j.id), ["0", "1", "2", "3"]);
  assert.deepEqual(riwayat.listData.map((j) => j.id), ["4", "5"]);
  // UNSCHEDULED tidak muncul di keduanya — bukan hilang diam-diam, itu
  // memang belum layak tampil ke driver (belum resmi ditugaskan rute).
});

test("REGRESI RTE-220926-01/02 (Agung/Apriansyah): stop berstatus SCHEDULED (sudah masuk rute published, belum ditap driver) TIDAK hilang dari tab Aktif", () => {
  // AKAR MASALAH 22 September 2026: ACTIVE_STATUSES SEBELUMNYA cuma
  // ["ASSIGNED","EN_ROUTE","ARRIVED"] — 3 dari 8 stop RTE-220926-01
  // berstatus SCHEDULED (job.driverId sudah terisi cascade publish, tapi
  // statusnya nyangkut SCHEDULED, bug backend terpisah yang JUGA sudah
  // diperbaiki) langsung lenyap dari Aktif walau server sudah balas benar.
  const jobs = [
    { id: "a", status: "SCHEDULED", route: { id: "r1", code: "RTE-220926-01" } },
    { id: "b", status: "SCHEDULED", route: { id: "r1", code: "RTE-220926-01" } },
    { id: "c", status: "ASSIGNED", route: { id: "r1", code: "RTE-220926-01" } },
  ];
  const { listData } = deriveJobList(jobs, { showHistory: false });
  assert.equal(listData.length, 3, "ketiga stop harus tampil di Aktif, bukan cuma yang ASSIGNED");
});

test("array jobs kosong/null tidak melempar — listData & rutes kosong, bukan crash", () => {
  assert.deepEqual(deriveJobList(null).listData, []);
  assert.deepEqual(deriveJobList(undefined).listData, []);
  assert.deepEqual(deriveJobList([]).rutes, []);
});

test("kartu Mulai Perjalanan: satu rute dengan 2 job ASSIGNED → assignedCount 2, sampleJobId job PERTAMA", () => {
  const jobs = [
    { id: "a", status: "ASSIGNED", route: { id: "r1", code: "RTE-1" } },
    { id: "b", status: "ASSIGNED", route: { id: "r1", code: "RTE-1" } },
  ];
  const { rutes } = deriveJobList(jobs, { showHistory: false });
  assert.equal(rutes.length, 1);
  assert.equal(rutes[0].assignedCount, 2);
  assert.equal(rutes[0].sampleJobId, "a");
});

test("2 rute berbeda TIDAK tercampur jadi satu kartu (bug 'phantom merge')", () => {
  const jobs = [
    { id: "a", status: "ASSIGNED", route: { id: "r1", code: "RTE-1" } },
    { id: "b", status: "ASSIGNED", route: { id: "r2", code: "RTE-2" } },
  ];
  const { rutes } = deriveJobList(jobs, { showHistory: false });
  assert.equal(rutes.length, 2);
});

test("job yang SUDAH tuntas (COMPLETED/FAILED) TIDAK ikut kartu Mulai Perjalanan walau punya route", () => {
  const jobs = [{ id: "a", status: "COMPLETED", route: { id: "r1", code: "RTE-1" } }];
  const { rutes } = deriveJobList(jobs, { showHistory: false });
  assert.equal(rutes.length, 0);
});

test("job tanpa route (ditugaskan langsung) tidak memunculkan kartu rute, tapi tetap masuk listData", () => {
  const jobs = [{ id: "a", status: "ASSIGNED", route: null }];
  const { rutes, listData } = deriveJobList(jobs, { showHistory: false });
  assert.equal(rutes.length, 0);
  assert.deepEqual(listData.map((j) => j.id), ["a"]);
});

test("tab Riwayat tidak pernah menghitung rutes (kartu Mulai Perjalanan cuma relevan di Aktif)", () => {
  const jobs = [{ id: "a", status: "ASSIGNED", route: { id: "r1", code: "RTE-1" } }];
  assert.deepEqual(deriveJobList(jobs, { showHistory: true }).rutes, []);
});
