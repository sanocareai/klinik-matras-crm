// Uji terarah pemisahan tugas penyesuaian stok (Okt 2026) — Postgres SUNGGUHAN terisolasi, kode route ASLI.
// Aturan: (1) menyetujui = permission INVENTORY_ADJUSTMENT_APPROVE (OWNER, FINANCE), bukan peran penulis ledger;
//         (2) penyetuju ≠ pemohon / pembuat-penugas hitungan; (3) koreksi satu-langkah hanya penyetuju;
//         (4) post menolak request yang persetujuannya tidak sah (data lama).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ROLE_PERMISSIONS, PERMISSIONS as P } from "../../src/constants/permissions.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function akun(roles) { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; }
const saldo = async (id) => { const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`; return s; };
const ajukan = async (c, materialId, delta) => {
  const r = await c.post("/api/inventory/adjustments", { materialId, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: delta, reason: "uji pemisahan tugas" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await c.patch(`/api/inventory/adjustments/${r.body.id}`, { status: "WAITING_APPROVAL" });
  return r.body.id;
};

test("matriks peran: penyetuju = OWNER & FINANCE saja; ADMIN dan WAREHOUSE tidak; penyetuju Finance tidak menulis ledger", () => {
  const punya = (role, perm) => (ROLE_PERMISSIONS[role] || []).includes(perm);
  assert.equal(punya("OWNER", P.INVENTORY_ADJUSTMENT_APPROVE), true);
  assert.equal(punya("FINANCE", P.INVENTORY_ADJUSTMENT_APPROVE), true);
  assert.equal(punya("ADMIN", P.INVENTORY_ADJUSTMENT_APPROVE), false);
  assert.equal(punya("WAREHOUSE", P.INVENTORY_ADJUSTMENT_APPROVE), false);
  assert.equal(punya("FINANCE", P.INVENTORY_WRITE), false, "Finance menyetujui tetapi tidak menulis ledger");
  assert.equal(punya("WAREHOUSE", P.INVENTORY_WRITE), true);
});

test("Gudang tidak dapat menyetujui — termasuk permintaannya sendiri; status tetap WAITING_APPROVAL", async () => {
  const gudang = await akun(["WAREHOUSE"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(gudang.c, m.id, -3);
  const r = await gudang.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" });
  assert.equal(r.status, 403);
  assert.equal((await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } })).status, "WAITING_APPROVAL");
});

test("ADMIN biasa (tanpa OWNER/FINANCE) tidak dapat menyetujui permintaan orang lain", async () => {
  const gudang = await akun(["WAREHOUSE"]); const admin = await akun(["ADMIN"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(gudang.c, m.id, -3);
  assert.equal((await admin.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 403);
});

test("OWNER tidak dapat menyetujui permintaan yang ia ajukan sendiri; OWNER lain dapat; yang memposting tetap pemegang INVENTORY_WRITE", async () => {
  const ownerA = await akun(["OWNER"]); const ownerB = await akun(["OWNER"]); const gudang = await akun(["WAREHOUSE"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(ownerA.c, m.id, -4);
  const self = await ownerA.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" });
  assert.equal(self.status, 403); assert.match(self.body.error, /orang lain/);
  assert.equal((await ownerB.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 200);
  const post = await gudang.c.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(post.status, 200, JSON.stringify(post.body));
  const req = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } });
  assert.equal(req.requestedById, ownerA.user.id); assert.equal(req.approvedById, ownerB.user.id); assert.equal(req.postedById, gudang.user.id);
  assert.equal(new Set([req.requestedById, req.approvedById, req.postedById]).size, 3, "tiga aktor berbeda tercatat");
  assert.equal(await saldo(m.id), 6);
});

test("Finance menyetujui permintaan Gudang tetapi TIDAK dapat memposting (tidak memegang INVENTORY_WRITE)", async () => {
  const gudang = await akun(["WAREHOUSE"]); const fin = await akun(["FINANCE"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(gudang.c, m.id, 5);
  const approve = await fin.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  // penyetuju murni tidak boleh mengajukan/mengubah isi/memposting
  assert.equal((await fin.c.post(`/api/inventory/adjustments/${id}/post`, {})).status, 403);
  const ubah = await fin.c.patch(`/api/inventory/adjustments/${id}`, { reason: "ubah diam-diam" });
  assert.equal(ubah.status, 403);
  assert.equal(await saldo(m.id), 10, "belum diposting");
  assert.equal((await gudang.c.post(`/api/inventory/adjustments/${id}/post`, {})).status, 200);
  assert.equal(await saldo(m.id), 15);
  const req = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } });
  assert.equal(req.approvedById, fin.user.id); assert.equal(req.postedById, gudang.user.id);
});

test("Post menolak request yang persetujuannya tidak sah (data lama: pemohon = penyetuju atau tanpa penyetuju)", async () => {
  const gudang = await akun(["WAREHOUSE"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const req = await testPrisma.stockAdjustmentRequest.create({ data: {
    adjustmentNumber: "ADJ-LAMA-01", adjustmentType: "COUNT_DIFFERENCE", materialId: m.id, beforeQty: 10, adjustmentQty: -2, reason: "data lama",
    status: "APPROVED", requestedById: gudang.user.id, approvedById: gudang.user.id, approvedAt: new Date(),
  } });
  const p = await gudang.c.post(`/api/inventory/adjustments/${req.id}/post`, {});
  assert.equal(p.status, 403);
  assert.equal(await saldo(m.id), 10);
  const tanpa = await testPrisma.stockAdjustmentRequest.create({ data: {
    adjustmentNumber: "ADJ-LAMA-02", adjustmentType: "COUNT_DIFFERENCE", materialId: m.id, beforeQty: 10, adjustmentQty: -2, reason: "tanpa penyetuju", status: "APPROVED", requestedById: gudang.user.id,
  } });
  assert.equal((await gudang.c.post(`/api/inventory/adjustments/${tanpa.id}/post`, {})).status, 403);
});

test("Stock Count: pembuat hitungan tidak dapat menyelesaikan selisihnya sendiri; penyetuju lain dapat; tanpa selisih tidak perlu penyetuju", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const a = await createTestMaterial(); const b = await createTestMaterial();
  await seedBalance(a.id, 20); await seedBalance(b.id, 5);
  const buat = async (c, materialId, counted, reason) => {
    const cr = await c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId }] });
    const id = cr.body.id; const st = await c.post(`/api/inventory/stock-counts/${id}/start`, {});
    await c.patch(`/api/inventory/stock-counts/${id}/lines/${st.body.lines[0].id}`, { countedQty: counted, ...(reason ? { reason } : {}) });
    await c.post(`/api/inventory/stock-counts/${id}/submit`, {});
    return id;
  };
  const id = await buat(gudang.c, a.id, 15, "susut");
  const selfDone = await gudang.c.post(`/api/inventory/stock-counts/${id}/complete`, {});
  assert.equal(selfDone.status, 403);
  assert.equal(await saldo(a.id), 20, "tidak ada movement");
  assert.equal((await testPrisma.stockCount.findUnique({ where: { id } })).status, "WAITING_REVIEW");
  const ok = await owner.c.post(`/api/inventory/stock-counts/${id}/complete`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await saldo(a.id), 15);
  const adj = await testPrisma.stockMovement.findFirst({ where: { materialId: a.id, type: "ADJUSTMENT", stockCountId: id } });
  assert.equal(adj.createdById, owner.user.id);

  const id2 = await buat(gudang.c, b.id, 5);
  const noVar = await gudang.c.post(`/api/inventory/stock-counts/${id2}/complete`, {});
  assert.equal(noVar.status, 200, "tanpa selisih → tidak menulis ledger → tidak perlu penyetuju");
});

test("Stock Count dibuat OWNER tidak dapat diselesaikan OWNER yang sama", async () => {
  const ownerA = await akun(["OWNER"]); const ownerB = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 9);
  const cr = await ownerA.c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: m.id }] });
  const id = cr.body.id; const st = await ownerA.c.post(`/api/inventory/stock-counts/${id}/start`, {});
  await ownerA.c.patch(`/api/inventory/stock-counts/${id}/lines/${st.body.lines[0].id}`, { countedQty: 8, reason: "x" });
  await ownerA.c.post(`/api/inventory/stock-counts/${id}/submit`, {});
  assert.equal((await ownerA.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 403);
  assert.equal((await ownerB.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 200);
});

test("Koreksi satu-langkah (/movements/adjustment) DITUTUP untuk semua peran: tidak ada penulisan ledger, tidak ada jejak", async () => {
  const gudang = await akun(["WAREHOUSE"]); const admin = await akun(["ADMIN"]); const owner = await akun(["OWNER"]); const fin = await akun(["FINANCE"]); const sales = await akun(["SALES"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const body = { materialId: m.id, actualQty: 8, reason: "hitung ulang" };
  for (const [nama, a] of [["WAREHOUSE", gudang], ["ADMIN", admin], ["OWNER", owner]]) {
    const r = await a.c.post("/api/inventory/movements/adjustment", body);
    assert.equal(r.status, 409, nama + " " + JSON.stringify(r.body));
    assert.equal(r.body.code, "SATU_LANGKAH_DITUTUP");
  }
  assert.equal((await fin.c.post("/api/inventory/movements/adjustment", body)).status, 403, "bukan pemegang inventory:write");
  assert.equal((await sales.c.post("/api/inventory/movements/adjustment", body)).status, 403);
  assert.equal(await saldo(m.id), 10, "saldo tidak berubah");
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: m.id, type: "ADJUSTMENT" } }), 0, "tidak ada baris ADJUSTMENT");
});

test("Stock Count: pengisi hasil hitung (bukan pembuat/penugas) pun tidak boleh menyelesaikan selisihnya sendiri", async () => {
  const pembuat = await akun(["WAREHOUSE"]); const pengisi = await akun(["OWNER"]); const penyetuju = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 12);
  const cr = await pembuat.c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: m.id }] });
  const id = cr.body.id; const st = await pembuat.c.post(`/api/inventory/stock-counts/${id}/start`, {});
  const lineId = st.body.lines[0].id;
  // OWNER lain (bukan pembuat/penugas) mengisi hasil hitung — dicatat sebagai pelaku
  assert.equal((await pengisi.c.patch(`/api/inventory/stock-counts/${id}/lines/${lineId}`, { countedQty: 9, reason: "susut" })).status, 200);
  assert.equal((await pembuat.c.post(`/api/inventory/stock-counts/${id}/submit`, {})).status, 200);
  const sendiri = await pengisi.c.post(`/api/inventory/stock-counts/${id}/complete`, {});
  assert.equal(sendiri.status, 403, JSON.stringify(sendiri.body)); assert.match(sendiri.body.error, /orang lain/);
  assert.equal(await saldo(m.id), 12);
  assert.equal((await pembuat.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 403, "pembuat bukan penyetuju");
  const ok = await penyetuju.c.post(`/api/inventory/stock-counts/${id}/complete`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await saldo(m.id), 9);
});
