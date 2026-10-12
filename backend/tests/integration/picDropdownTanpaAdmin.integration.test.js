// Daftar pilihan PIC (GET /api/production-v2/planning/refs) — akun ADMIN/OWNER TIDAK ditawarkan (keputusan Owner 11 Okt 2026). Hanya PILIHAN yang disaring:
// profil operator ADMIN tidak dihapus/dinonaktifkan; akun produksi non-admin (termasuk Kepala Produksi yang didaftarkan sebagai operator) tetap muncul.
import "./setup/env.js";
import "./setup/productionEvidenceTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

const V2 = "/api/production-v2";
let server; let seq = 0;

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.beforeEach(async () => { await truncateAll(); });

async function operator(roles, { profile = true, name } = {}) {
  const u = await createTestUser({ roles, ...(name ? { name } : {}) });
  for (const r of roles) if (!(await testPrisma.userRole.findFirst({ where: { userId: u.user.id, role: r } }))) await testPrisma.userRole.create({ data: { userId: u.user.id, role: r } });
  const wc = (await testPrisma.workCenter.findFirst()) || (await testPrisma.workCenter.create({ data: { code: `WC-PIC-${++seq}`, name: "Workshop Utama" } }));
  const op = profile ? await testPrisma.productionOperator.create({ data: { workLanes: ["TABLE", "CORNER"], userId: u.user.id, primaryWorkCenterId: wc.id, active: true } }) : null;
  return { ...u, op };
}

test("PIC dropdown: ADMIN/OWNER (walau punya profil operator atau peran PRODUCTION_WORKER) tidak muncul; operator biasa dan Kepala Produksi terdaftar tetap muncul; profil ADMIN tidak berubah", async () => {
  const lead = await operator(["PRODUCTION_LEAD"], { profile: false });
  const worker = await operator(["PRODUCTION_WORKER"]);
  const leadAsPic = await operator(["PRODUCTION_LEAD", "QC_LEAD"]);            // Kepala Produksi didaftarkan sebagai PIC (mis. Imam)
  const adminPic = await operator(["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"]); // meniru Nadya
  const ownerPic = await operator(["OWNER", "PRODUCTION_WORKER"]);
  const adminCandidate = await operator(["ADMIN", "PRODUCTION_WORKER"], { profile: false }); // akun produksi ADMIN belum terdaftar -> juga tidak ditawarkan
  const workerCandidate = await operator(["PRODUCTION_WORKER"], { profile: false });

  const api = makeClient(server.baseUrl, lead.token);
  const r = await api.get(`${V2}/planning/refs`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const userIds = r.body.operators.map((o) => o.userId);
  assert.ok(userIds.includes(worker.user.id), "operator biasa muncul");
  assert.ok(userIds.includes(leadAsPic.user.id), "Kepala Produksi terdaftar sebagai PIC muncul");
  assert.ok(!userIds.includes(adminPic.user.id), "ADMIN (punya profil) tidak muncul");
  assert.ok(!userIds.includes(ownerPic.user.id), "OWNER tidak muncul");
  const candIds = r.body.candidates.map((c) => c.userId);
  assert.ok(candIds.includes(workerCandidate.user.id), "kandidat PRODUCTION_WORKER non-admin ditawarkan untuk didaftarkan");
  assert.ok(!candIds.includes(adminCandidate.user.id), "kandidat ADMIN tidak ditawarkan");
  // pembatasan hanya pada pilihan: profil admin utuh & aktif
  const still = await testPrisma.productionOperator.findUnique({ where: { id: adminPic.op.id } });
  assert.equal(still.active, true);
});

test("PIC dropdown: bila SATU-SATUNYA profil adalah ADMIN, daftar kosong dengan alasan (bukan diam-diam menampilkan ADMIN)", async () => {
  const lead = await operator(["PRODUCTION_LEAD"], { profile: false });
  await operator(["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"]);
  const r = await makeClient(server.baseUrl, lead.token).get(`${V2}/planning/refs`);
  assert.equal(r.status, 200);
  assert.equal(r.body.operators.length, 0);
  assert.ok(r.body.problems.some((p) => /^NO_PIC/.test(p.code)), JSON.stringify(r.body.problems));
});

test("GET /api/production/operators: ?pilihan=1 (dropdown PIC V1/Planner) tanpa ADMIN/OWNER; tanpa parameter = daftar penuh untuk halaman Operator (profil admin tetap terlihat)", async () => {
  const lead = await operator(["PRODUCTION_LEAD"], { profile: false });
  const worker = await operator(["PRODUCTION_WORKER"]);
  const adminPic = await operator(["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"]);
  const ownerPic = await operator(["OWNER"]);
  const api = makeClient(server.baseUrl, lead.token);
  const pilihan = await api.get("/api/production/operators?pilihan=1");
  assert.equal(pilihan.status, 200, JSON.stringify(pilihan.body));
  const idsP = pilihan.body.operators.map((o) => o.user.id);
  assert.ok(idsP.includes(worker.user.id));
  assert.ok(!idsP.includes(adminPic.user.id) && !idsP.includes(ownerPic.user.id), "ADMIN/OWNER tidak ditawarkan di dropdown");
  const penuh = await api.get("/api/production/operators");
  assert.equal(penuh.status, 200);
  const idsF = penuh.body.operators.map((o) => o.user.id);
  assert.ok(idsF.includes(adminPic.user.id) && idsF.includes(ownerPic.user.id), "halaman Operator tetap menampilkan seluruh profil");
  assert.ok(idsF.includes(worker.user.id));
});

test("permission: /production/operators (penuh dan ?pilihan=1) dan /production-v2/planning/refs ditolak untuk peran tanpa izin dan tanpa login; ADMIN melihat daftar penuh tetapi dropdown tanpa ADMIN/OWNER", async () => {
  const admin = await operator(["ADMIN", "PRODUCTION_WORKER"]);
  const worker = await operator(["PRODUCTION_WORKER"]);
  const sales = await operator(["SALES"], { profile: false });
  const anon = makeClient(server.baseUrl, null);
  for (const url of ["/api/production/operators", "/api/production/operators?pilihan=1", `${V2}/planning/refs`]) {
    assert.equal((await anon.get(url)).status, 401, `anonim ${url}`);
    assert.equal((await makeClient(server.baseUrl, sales.token).get(url)).status, 403, `SALES ${url}`);
  }
  // ADMIN: daftar penuh memuat profil admin; dropdown (pilihan & planning/refs) tidak
  const a = makeClient(server.baseUrl, admin.token);
  const penuh = await a.get("/api/production/operators");
  assert.equal(penuh.status, 200);
  assert.ok(penuh.body.operators.some((o) => o.user.id === admin.user.id), "Admin bisa mengelola profil admin di halaman Operator");
  const pilihan = await a.get("/api/production/operators?pilihan=1");
  assert.equal(pilihan.status, 200);
  assert.ok(!pilihan.body.operators.some((o) => o.user.id === admin.user.id));
  assert.ok(pilihan.body.operators.some((o) => o.user.id === worker.user.id));
  const refs = await a.get(`${V2}/planning/refs`);
  assert.equal(refs.status, 200, JSON.stringify(refs.body));
  assert.ok(!refs.body.operators.some((o) => o.userId === admin.user.id));
  assert.ok(refs.body.operators.some((o) => o.userId === worker.user.id));
});
