// Opname Penuh (cutover): identitas penghitung & pemeriksa diturunkan dari akun yang login; Complete ditolak tanpa pemeriksa atau bila pemeriksa mencoba menyetujui.
// Cycle Count rutin tidak dikenai syarat pemeriksa (perilaku lama tetap).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const akun = async (roles) => { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; };
async function sesiSelesaiHitung(penghitung, materialId, { tipe = "FULL_STOCK_OPNAME", counted = 18 } = {}) {
  const cr = await penghitung.c.post("/api/inventory/stock-counts", { countType: tipe, countMethod: "BY_ITEM", lines: [{ materialId }] });
  assert.equal(cr.status, 201, JSON.stringify(cr.body));
  const st = await penghitung.c.post(`/api/inventory/stock-counts/${cr.body.id}/start`, {});
  assert.equal(st.status, 200, JSON.stringify(st.body));
  const line = st.body.lines[0];
  const isi = await penghitung.c.patch(`/api/inventory/stock-counts/${cr.body.id}/lines/${line.id}`, { countedQty: counted, reason: "selisih uji" });
  assert.equal(isi.status, 200, JSON.stringify(isi.body));
  assert.equal((await penghitung.c.post(`/api/inventory/stock-counts/${cr.body.id}/submit`, {})).status, 200);
  return { id: cr.body.id, lineId: line.id };
}

test("Opname Penuh: Complete ditolak 409 PEMERIKSA_BELUM_ADA; setelah pemeriksa lain memeriksa, penyetuju berbeda bisa Complete", async () => {
  const gudang = await akun(["WAREHOUSE"]); const pemeriksa = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const s = await sesiSelesaiHitung(gudang, m.id);

  const tolak = await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "PEMERIKSA_BELUM_ADA");

  const sendiri = await gudang.c.post(`/api/inventory/stock-counts/${s.id}/periksa`, {});
  assert.equal(sendiri.status, 403); assert.equal(sendiri.body.code, "PEMERIKSA_SAMA_DENGAN_PENGHITUNG");

  const ok = await pemeriksa.c.post(`/api/inventory/stock-counts/${s.id}/periksa`, { catatan: "hitung ulang rak A" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.deepEqual(ok.body.identitas.penghitung.map((p) => p.id), [gudang.user.id]);
  assert.deepEqual(ok.body.identitas.pemeriksa.map((p) => p.id), [pemeriksa.user.id]);

  const detail = await owner.c.get(`/api/inventory/stock-counts/${s.id}`);
  assert.equal(detail.body.identitas.pemeriksa[0].nama, pemeriksa.user.name);
  assert.equal(detail.body.identitas.penghitungPerBaris[s.lineId].length, 1);

  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
  const adj = await testPrisma.stockMovement.findMany({ where: { stockCountId: s.id, type: "ADJUSTMENT" } });
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -2);
});

test("pemeriksa tidak boleh menjadi penyetuju; penyetuju lain boleh", async () => {
  const gudang = await akun(["WAREHOUSE"]); const ownerA = await akun(["OWNER"]); const ownerB = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const s = await sesiSelesaiHitung(gudang, m.id);
  assert.equal((await ownerA.c.post(`/api/inventory/stock-counts/${s.id}/periksa`, {})).status, 200);
  const dilarang = await ownerA.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(dilarang.status, 403, "pemeriksa tidak boleh menyetujui hasil yang ia periksa");
  assert.equal((await ownerB.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
});

test("angka diubah / hitung ulang setelah diperiksa → pemeriksaan batal; harus diperiksa lagi", async () => {
  const gudang = await akun(["WAREHOUSE"]); const pemeriksa = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const s = await sesiSelesaiHitung(gudang, m.id);
  assert.equal((await pemeriksa.c.post(`/api/inventory/stock-counts/${s.id}/periksa`, {})).status, 200);

  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${s.id}/recount`, {})).status, 200);
  assert.equal((await gudang.c.patch(`/api/inventory/stock-counts/${s.id}/lines/${s.lineId}`, { countedQty: 17, reason: "dihitung ulang" })).status, 200);
  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${s.id}/submit`, {})).status, 200);

  const tolak = await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {});
  assert.equal(tolak.status, 409); assert.equal(tolak.body.code, "PEMERIKSA_BELUM_ADA");
  const detail = await owner.c.get(`/api/inventory/stock-counts/${s.id}`);
  assert.equal(detail.body.identitas.pemeriksa.length, 0, "pemeriksaan lama basi");

  assert.equal((await pemeriksa.c.post(`/api/inventory/stock-counts/${s.id}/periksa`, {})).status, 200);
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${s.id}/complete`, {})).status, 200);
});

test("periksa hanya pada hitungan yang sudah diserahkan; Cycle Count rutin tidak butuh pemeriksa", async () => {
  const gudang = await akun(["WAREHOUSE"]); const pemeriksa = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 20);
  const cr = await gudang.c.post("/api/inventory/stock-counts", { countType: "FULL_STOCK_OPNAME", countMethod: "BY_ITEM", lines: [{ materialId: m.id }] });
  const belumMulai = await pemeriksa.c.post(`/api/inventory/stock-counts/${cr.body.id}/periksa`, {});
  assert.equal(belumMulai.status, 400, "belum diserahkan");

  const m2 = await createTestMaterial(); await seedBalance(m2.id, 10);
  const rutin = await sesiSelesaiHitung(gudang, m2.id, { tipe: "CYCLE_COUNT", counted: 9 });
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${rutin.id}/complete`, {})).status, 200, "Cycle Count: perilaku lama");
});
