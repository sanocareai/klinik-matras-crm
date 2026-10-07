// Fase 2 Produksi LAYANAN — matriks izin pengujian awal (QC) PER ROLE lewat HTTP.
// Kontrak: yang boleh mencatat uji kasur utuh / uji fondasi + melihat antrean PIC QC = pemegang izin QC_WRITE atau PRODUCTION_EXECUTE_ANY, TITIK.
// Tidak diperluas (mis. Sales/Gudang/Meja/Dokumentasi) dan tidak dibatasi berdasarkan NAMA (Risdi/Risdy): peran/izin yang menentukan, bukan nama akun.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import * as PT from "./setup/preTeardown.js";
import { V2_FLAGS } from "../../src/services/v2FeatureFlags.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../../src/constants/permissions.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
const key = (v) => ({ "Idempotency-Key": `qm-${v}-${++seq}-kunci-0001` });
const CN = "/api/production-v2/component-notes";

async function cohortUnit() {
  const customer = await testPrisma.customer.create({ data: { name: `Bu Matriks ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `QM-${++seq}`, value: 1_000_000, category: "LAYANAN", status: "PROCESSING", productLine: "KASUR", beratBadan: 70 } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `QM-${seq}-U1`, orderId: order.id, seq: 1, status: "RECEIVED", merk: "King Koil", ukuran: "180x200" } });
  const data = { enabled: true, scope: "GLOBAL", config: { unitIds: [unit.id] }, reason: "matriks izin" };
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, ...data }, update: data });
  return unit;
}
const as = async (roles, name) => {
  const u = await createTestUser({ roles });
  if (name) await testPrisma.user.update({ where: { id: u.user.id }, data: { name } }); // nama akun TIDAK boleh memengaruhi izin
  return { ...u, api: makeClient(server.baseUrl, u.token) };
};
const has = (role, perm) => (ROLE_PERMISSIONS[role] || []).includes(perm);
const holdsQc = (role) => has(role, P.QC_WRITE) || has(role, P.PRODUCTION_EXECUTE_ANY);

test("daftar pemegang izin QC dibekukan: hanya ADMIN, OWNER, QC_LEAD (bukan Meja/Lead/Gudang/Sales/Dokumentasi/Driver/Finance)", () => {
  const holders = Object.keys(ROLE_PERMISSIONS).filter(holdsQc).sort();
  assert.deepEqual(holders, ["ADMIN", "OWNER", "QC_LEAD"], "perluasan izin QC harus disengaja & terlihat di tes ini");
});

test("matriks HTTP per role: tulis uji (WHOLE_TEST_BEFORE & FOUNDATION_TEST_BEFORE), antrean PIC QC, flag canWriteQc — sesuai izin, bukan nama", async () => {
  const rows = [];
  for (const role of Object.keys(ROLE_PERMISSIONS)) {
    const unit = await cohortUnit(); const who = await as([role]); const expectQc = holdsQc(role);
    // Antrean PIC QC
    const q = await who.api.get(`${CN}/qc-queue`);
    assert.equal(q.status, expectQc ? 200 : 403, `${role} GET qc-queue -> ${q.status}`);
    if (!expectQc) assert.equal(q.body.code, "COMPONENT_QC_ONLY");
    // Tulis kedua seksi uji
    const results = {};
    for (const [section, data] of [["WHOLE_TEST_BEFORE", PT.WHOLE], ["FOUNDATION_TEST_BEFORE", PT.FOUNDATION]]) {
      let media = [];
      if (expectQc) media = await PT.uploadVideo(server, who, unit.id);
      const res = await who.api.post(`${CN}/units/${unit.id}/sections/${section}`, { expectedVersion: 0, data, media }, key(`${role}-${section}`));
      assert.equal(res.status, expectQc ? 201 : 403, `${role} POST ${section} -> ${res.status} ${JSON.stringify(res.body)}`);
      results[section] = res.status;
    }
    const written = await testPrisma.unitComponentEntry.count({ where: { unitId: unit.id } });
    assert.equal(written, expectQc ? 2 : 0, `${role}: baris tertulis`);
    // Flag canWriteQc pada bacaan (bila role boleh membaca)
    const g = await who.api.get(`${CN}/units/${unit.id}`);
    if (g.status === 200) assert.equal(g.body.canWriteQc, expectQc, `${role} canWriteQc`);
    rows.push({ role, qcQueue: q.status, wholeTest: results.WHOLE_TEST_BEFORE, foundationTest: results.FOUNDATION_TEST_BEFORE, readNotes: g.status, canWriteQc: g.status === 200 ? g.body.canWriteQc : null });
  }
  console.log("MATRIKS_IZIN_QC " + JSON.stringify(rows));
  assert.ok(rows.length >= 10, "semua role terdaftar teruji");
});

test("tanpa token = 401; nama akun tidak menentukan izin (akun bernama 'Risdi' ber-role SALES tetap 403; akun bernama lain ber-role QC_LEAD tetap 201)", async () => {
  const unit = await cohortUnit();
  const anon = makeClient(server.baseUrl, null);
  assert.equal((await anon.get(`${CN}/qc-queue`)).status, 401);
  assert.equal((await anon.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, { expectedVersion: 0, data: PT.WHOLE, media: [] }, key("anon"))).status, 401);

  const risdiSales = await as(["SALES"], "Risdi");
  const r1 = await risdiSales.api.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, { expectedVersion: 0, data: PT.WHOLE, media: [] }, key("risdi-sales"));
  assert.equal(r1.status, 403, "nama Risdi tidak memberi izin");
  const risdiMeja = await as(["PRODUCTION_WORKER"], "Risdy");
  assert.equal((await risdiMeja.api.get(`${CN}/qc-queue`)).status, 403);

  const other = await as(["QC_LEAD"], "Siapa Saja");
  const media = await PT.uploadVideo(server, other, unit.id);
  const r2 = await other.api.post(`${CN}/units/${unit.id}/sections/WHOLE_TEST_BEFORE`, { expectedVersion: 0, data: PT.WHOLE, media }, key("other-qc"));
  assert.equal(r2.status, 201, JSON.stringify(r2.body));
  assert.equal((await testPrisma.unitComponentEntry.findFirstOrThrow({ where: { unitId: unit.id } })).actorId, other.user.id);
});
