// Bukti tertulis bahwa productionStatus/exception TIDAK menjadi 1+N query
// seiring bertambahnya jumlah unit (Production Core Slice 2, STEP 0 —
// audit performa sebelum membangun Command Center).
//
// Pendekatan: setiap loader batch di unitStageEngine.js menerima `client`
// opsional (default `prisma` singleton) — pola YANG SAMA dengan
// findOrdersWithoutUnits() di services/unitProvisioning.js. Di sini kita
// suntik STUB yang menghitung berapa kali metode Prisma-nya benar-benar
// dipanggil, lalu jalankan dengan 5 unit dan 500 unit — jumlah PANGGILAN
// harus identik (1), walau jumlah BARIS di WHERE membesar. Ini TIDAK
// membutuhkan database sungguhan (konsisten dengan filosofi tes repo ini:
// logika murni/terukur diuji langsung, bagian yang benar-benar menyentuh
// Postgres diverifikasi lewat pemeriksaan kode + deploy — lihat header
// tests/scopeRevision.test.js).

import test from "node:test";
import assert from "node:assert/strict";

import {
  loadLastCurrentStageLogs, loadOpenBlockersByUnit, loadLatestQcFitTestByUnit,
} from "../src/services/unitStageEngine.js";
import { loadCurrentStageAssignments } from "../src/services/productionRouting.js";

function makeUnits(n) {
  return Array.from({ length: n }, (_, i) => ({ id: `unit-${i}`, currentStageId: `stage-${i % 3}` }));
}

function countingStub(modelName, resultRows = []) {
  let calls = 0;
  const client = {
    [modelName]: {
      findMany: async () => { calls++; return resultRows; },
    },
  };
  return { client, getCalls: () => calls };
}

test("loadLastCurrentStageLogs: SATU panggilan findMany, baik untuk 5 maupun 500 unit", async () => {
  const small = countingStub("unitStageLog");
  await loadLastCurrentStageLogs(makeUnits(5), small.client);
  assert.equal(small.getCalls(), 1);

  const big = countingStub("unitStageLog");
  await loadLastCurrentStageLogs(makeUnits(500), big.client);
  assert.equal(big.getCalls(), 1, "500 unit HARUS tetap 1 query, bukan 500 (N+1)");
});

test("loadOpenBlockersByUnit: SATU panggilan findMany untuk berapa pun unitId", async () => {
  const big = countingStub("productionBlocker");
  const unitIds = makeUnits(300).map((u) => u.id);
  await loadOpenBlockersByUnit(unitIds, big.client);
  assert.equal(big.getCalls(), 1);
});

test("loadLatestQcFitTestByUnit: SATU panggilan findMany untuk berapa pun unitId", async () => {
  const big = countingStub("qcFitTest");
  const unitIds = makeUnits(300).map((u) => u.id);
  await loadLatestQcFitTestByUnit(unitIds, big.client);
  assert.equal(big.getCalls(), 1);
});

test("loader batch TIDAK memanggil database sama sekali untuk input kosong (jaring pengaman filter UUID)", async () => {
  const stub = countingStub("unitStageLog");
  const result = await loadLastCurrentStageLogs([], stub.client);
  assert.deepEqual(result, {});
  assert.equal(stub.getCalls(), 0, "array unit kosong tidak boleh sampai membentuk query filter kosong/tidak valid");

  const blockerStub = countingStub("productionBlocker");
  assert.deepEqual(await loadOpenBlockersByUnit([], blockerStub.client), {});
  assert.equal(blockerStub.getCalls(), 0);

  const qcStub = countingStub("qcFitTest");
  assert.deepEqual(await loadLatestQcFitTestByUnit([], qcStub.client), {});
  assert.equal(qcStub.getCalls(), 0);
});

test("loadLastCurrentStageLogs: unit TANPA currentStageId dikecualikan dari filter, tapi tidak menggagalkan batch lain", async () => {
  const stub = countingStub("unitStageLog");
  const units = [{ id: "a", currentStageId: null }, { id: "b", currentStageId: "stage-1" }];
  await loadLastCurrentStageLogs(units, stub.client);
  assert.equal(stub.getCalls(), 1);
});

// Production Core Slice 4Y — loadCurrentStageAssignments (services/
// productionRouting.js) dipakai Work Order list, Command Center
// (Unassigned Active Units), dan Work Centers page (currentUnitCount).
// Pola tes SAMA PERSIS dengan tiga loader di atas.
test("loadCurrentStageAssignments: SATU panggilan findMany, baik untuk 5 maupun 500 unit", async () => {
  const small = countingStub("stageAssignment");
  await loadCurrentStageAssignments(makeUnits(5), small.client);
  assert.equal(small.getCalls(), 1);

  const big = countingStub("stageAssignment");
  await loadCurrentStageAssignments(makeUnits(500), big.client);
  assert.equal(big.getCalls(), 1, "500 unit HARUS tetap 1 query, bukan 500 (N+1)");
});

test("loadCurrentStageAssignments: input kosong TIDAK memanggil database sama sekali", async () => {
  const stub = countingStub("stageAssignment");
  assert.deepEqual(await loadCurrentStageAssignments([], stub.client), {});
  assert.equal(stub.getCalls(), 0);
});

test("loadCurrentStageAssignments: hasil dipetakan per unitId dengan benar", async () => {
  const rows = [
    { unitId: "unit-1", stageId: "s1", operatorId: "op-1" },
    { unitId: "unit-2", stageId: "s2", operatorId: null },
  ];
  const client = { stageAssignment: { findMany: async () => rows } };
  const result = await loadCurrentStageAssignments(
    [{ id: "unit-1", currentStageId: "s1" }, { id: "unit-2", currentStageId: "s2" }],
    client
  );
  assert.equal(result["unit-1"].operatorId, "op-1");
  assert.equal(result["unit-2"].operatorId, null);
});

test("hasil loader batch DIPETAKAN per unitId dengan benar (bentuk data untuk pemanggil)", async () => {
  const rows = [
    { unitId: "unit-1", action: "START", createdAt: new Date("2026-09-06T10:00:00Z") },
    { unitId: "unit-1", action: "PAUSE", createdAt: new Date("2026-09-06T09:00:00Z") }, // lebih lama, harus KALAH
    { unitId: "unit-2", action: "FAIL", createdAt: new Date("2026-09-06T08:00:00Z") },
  ];
  const client = { unitStageLog: { findMany: async () => rows } };
  const result = await loadLastCurrentStageLogs(
    [{ id: "unit-1", currentStageId: "s1" }, { id: "unit-2", currentStageId: "s2" }],
    client
  );
  assert.equal(result["unit-1"].action, "START", "harus mengambil baris TERBARU (order by createdAt desc dari sisi DB), bukan yang pertama muncul di array");
  assert.equal(result["unit-2"].action, "FAIL");
});
