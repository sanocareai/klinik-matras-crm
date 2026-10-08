// Kandidat rilis gabungan — matriks izin Catatan Komponen vs endpoint INDUK, per SEMUA peran di ROLE_PERMISSIONS (HTTP nyata), termasuk OWNER sesuai kontrak yang berlaku
// (ADMIN/OWNER memegang UNIT_STAGE_WRITE + PRODUCTION_EXECUTE_ANY + PRODUCTION_DOCUMENTATION_WRITE sejak 65e7e1f5).
//   BACA   komponen  <=> baca kartu run (GET /runs/:id/card) <=> baca Unit 360 (GET /units/:id/overview) <=> baca dokumentasi
//   TULIS  komponen  <=> boleh mencatat bukti tahap (POST /runs/:id/steps/:n) ATAU mengirim dokumentasi (POST /documentation/runs/:id/submit)
//   UNGGAH komponen  <=> unggah bukti tahap (POST /evidence/upload) ATAU unggah dokumentasi (POST /documentation/upload)
// Penolakan izin = 403 SEBELUM validasi/aturan lain, jadi "diizinkan" = status != 403 (400/409/422 dari validasi sah tetap berarti lolos pagar izin).
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../../src/constants/permissions.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);
const up = (path, token, fields) => {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.append(k, v);
  fd.append("files", new Blob([PNG], { type: "image/png" }), "x.png");
  return fetch(`${server.baseUrl}${path}`, { method: "POST", headers: { Authorization: `Bearer ${token}` }, body: fd }).then(async (r) => ({ status: r.status }));
};

test("izin komponen selaras endpoint induk untuk SETIAP peran (baca, tulis, unggah); OWNER = ADMIN; peran tanpa izin produksi ditolak di semua pintu", async () => {
  const { unit } = await createTestUnit({ unitCode: "PERM-UNIT-1", status: "IN_PRODUCTION" });
  const run = await testPrisma.productionRun.create({
    data: { unitId: unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 2, startedAt: new Date(),
      phases: { create: ["INTAKE", "DIAGNOSIS", "PROCESS", "QC", "HANDOFF"].map((phase, i) => ({ phase, sequence: i + 1, status: i < 2 ? "COMPLETED" : i === 2 ? "ACTIVE" : "NOT_STARTED" })) } },
  });
  for (const flagKey of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    const data = { enabled: true, scope: "GLOBAL", config: { unitIds: [unit.id] }, reason: "perm test" };
    await testPrisma.v2FeatureFlag.upsert({ where: { key: flagKey }, create: { key: flagKey, ...data }, update: data });
  }
  const V2 = "/api/production-v2"; const CN = `${V2}/component-notes`;
  const KEY = (t) => ({ "Idempotency-Key": `perm-${t}-0000000001` });
  const rows = [];
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    const u = await createTestUser({ roles: [role] }); const c = makeClient(server.baseUrl, u.token);
    const parentRead = (await c.get(`${V2}/runs/${run.id}/card`)).status !== 403;
    const overviewRead = (await c.get(`${V2}/units/${unit.id}/overview`)).status !== 403;
    const compRead = (await c.get(`${CN}/units/${unit.id}`)).status !== 403;
    const stepWrite = (await c.post(`${V2}/runs/${run.id}/steps/1`, {}, KEY(`s-${role}`))).status !== 403;
    const docWrite = (await c.post(`${V2}/documentation/runs/${run.id}/submit`, { category: "X", items: [] }, KEY(`d-${role}`))).status !== 403;
    const compWrite = (await c.post(`${CN}/units/${unit.id}/sections/AFTER`, { expectedVersion: 0, data: {} }, KEY(`c-${role}`))).status !== 403;
    const stepUpload = (await up(`${V2}/evidence/upload`, u.token, { runId: run.id })).status !== 403;
    const docUpload = (await up(`${V2}/documentation/upload`, u.token, { runId: run.id })).status !== 403;
    const compUpload = (await up(`${CN}/units/${unit.id}/upload`, u.token, {})).status !== 403;
    const compCatalog = (await c.get(`${CN}/materials?q=a`)).status !== 403;
    rows.push({ role, parentRead, overviewRead, compRead, stepWrite, docWrite, compWrite, stepUpload, docUpload, compUpload, compCatalog });
    assert.equal(compRead, parentRead, `${role}: baca komponen = baca kartu`);
    assert.equal(compRead, overviewRead, `${role}: baca komponen = baca Unit 360`);
    assert.equal(compWrite, stepWrite || docWrite, `${role}: tulis komponen = tulis tahap ATAU dokumentasi (step=${stepWrite} doc=${docWrite} comp=${compWrite})`);
    assert.equal(compUpload, stepUpload || docUpload, `${role}: unggah komponen = unggah bukti tahap ATAU dokumentasi`);
    assert.equal(compCatalog, compWrite, `${role}: katalog komponen hanya untuk penulis`);
  }
  const by = Object.fromEntries(rows.map((r) => [r.role, r]));
  // OWNER sesuai kontrak berlaku (sama dengan ADMIN): semua pintu terbuka
  for (const r of ["OWNER", "ADMIN"]) assert.deepEqual([by[r].compRead, by[r].compWrite, by[r].compUpload, by[r].compCatalog], [true, true, true, true], `${r} penuh`);
  assert.deepEqual(by.OWNER, { ...by.ADMIN, role: "OWNER" }, "OWNER = ADMIN pada semua pintu");
  // kontrak izin sumber (bukan hanya turunan HTTP): ADMIN/OWNER memegang tiga izin pemicu
  for (const r of ["ADMIN", "OWNER"]) for (const p of [P.UNIT_STAGE_WRITE, P.PRODUCTION_EXECUTE_ANY, P.PRODUCTION_DOCUMENTATION_WRITE]) assert.ok(ROLE_PERMISSIONS[r].includes(p), `${r} memegang ${p}`);
  // peran yang HANYA membaca / tanpa produksi
  for (const r of ["SALES", "WAREHOUSE", "DISPATCHER", "FINANCE"]) assert.deepEqual([by[r].compRead, by[r].compWrite, by[r].compUpload], [true, false, false], `${r} hanya baca`);
  for (const r of ["DRIVER", "HELPER", "LEADER_DRIVER", "ACCOUNTANT", "APPROVER"]) assert.deepEqual([by[r].compRead, by[r].compWrite, by[r].compUpload], [false, false, false], `${r} tanpa akses`);
  for (const r of ["PRODUCTION_WORKER", "PRODUCTION_LEAD", "QC_LEAD", "PRODUCTION_DOCUMENTER"]) assert.deepEqual([by[r].compRead, by[r].compWrite, by[r].compUpload], [true, true, true], `${r} baca+tulis`);
  console.log("MATRIKS IZIN (komponen vs induk):\n" + rows.map((r) => `${r.role.padEnd(22)} baca=${+r.compRead}/${+r.parentRead} tulis=${+r.compWrite}/(tahap ${+r.stepWrite}|dok ${+r.docWrite}) unggah=${+r.compUpload}/(${+r.stepUpload}|${+r.docUpload})`).join("\n"));
});
