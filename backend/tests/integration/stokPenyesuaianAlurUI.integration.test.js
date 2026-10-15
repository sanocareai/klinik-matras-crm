// Alur persis yang dipakai UI Gudang "Ajukan Penyesuaian": POST /adjustments (COUNT_DIFFERENCE, selisih = hasil hitung − saldo) → PATCH WAITING_APPROVAL
// (pemohon) → PATCH APPROVED (orang lain, OWNER/FINANCE) → POST /post (petugas Gudang). Memakai role akun production yang sebenarnya:
// pemohon = WAREHOUSE (Nadya: ADMIN+PRODUCTION_WORKER+WAREHOUSE), penyetuju = OWNER+FINANCE+ADMIN (Gilang/Juri/Kemal) atau ADMIN+FINANCE (Natasha),
// dan akun ADMIN-saja ("OWNER (Admin)", Gulam, Novi, Yadi) TIDAK boleh menyetujui.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const akun = async (roles) => { const u = await createTestUser({ roles }); return { ...u, c: makeClient(server.baseUrl, u.token) }; };
const saldo = async (id) => { const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`; return s; };
const ajukan = async (c, materialId, hasilHitung, saldoCatatan, alasan = "opname fisik") => {
  const selisih = Math.round((hasilHitung - saldoCatatan) * 10000) / 10000;
  const r = await c.post("/api/inventory/adjustments", { materialId, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: selisih, reason: alasan });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const w = await c.patch(`/api/inventory/adjustments/${r.body.id}`, { status: "WAITING_APPROVAL" });
  assert.equal(w.status, 200, JSON.stringify(w.body));
  return r.body.id;
};

test("alur UI penuh dengan role production: Nadya mengajukan → Natasha (FINANCE) menyetujui → Nadya memposting; ledger berubah tepat sekali", async () => {
  const nadya = await akun(["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"]); const natasha = await akun(["ADMIN", "FINANCE"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 27);
  const id = await ajukan(nadya.c, m.id, 20, 27);
  assert.equal(await saldo(m.id), 27, "mengajukan tidak menyentuh ledger");
  const approve = await natasha.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(await saldo(m.id), 27, "menyetujui tidak menyentuh ledger");
  const post = await nadya.c.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(post.status, 200, JSON.stringify(post.body));
  assert.equal(await saldo(m.id), 20);
  const adj = await testPrisma.stockMovement.findMany({ where: { materialId: m.id, type: "ADJUSTMENT", stockAdjustmentRequestId: id } });
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -7);
  const req = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } });
  assert.equal(req.requestedById, nadya.user.id); assert.equal(req.approvedById, natasha.user.id); assert.equal(req.postedById, nadya.user.id);
});

test("akun ADMIN-saja (Gulam/Novi/Yadi/'OWNER (Admin)') dan pemohon sendiri TIDAK dapat menyetujui; Owner-pemohon juga tidak", async () => {
  const nadya = await akun(["ADMIN", "PRODUCTION_WORKER", "WAREHOUSE"]); const adminSaja = await akun(["ADMIN"]); const gilang = await akun(["ADMIN", "FINANCE", "OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(nadya.c, m.id, 8, 10);
  assert.equal((await adminSaja.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 403);
  assert.equal((await nadya.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 403);
  const idOwner = await ajukan(gilang.c, m.id, 9, 10, "diajukan owner");
  const sendiri = await gilang.c.patch(`/api/inventory/adjustments/${idOwner}`, { status: "APPROVED" });
  assert.equal(sendiri.status, 403); assert.match(sendiri.body.error, /orang lain/);
  assert.equal(await saldo(m.id), 10);
});

test("replay: setujui dua kali dan posting dua kali ditolak; hasil tetap satu ADJUSTMENT", async () => {
  const nadya = await akun(["WAREHOUSE"]); const juri = await akun(["ADMIN", "FINANCE", "OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(nadya.c, m.id, 12, 10);
  assert.equal((await juri.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await juri.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 400, "status APPROVED tidak bisa disetujui lagi");
  assert.equal((await nadya.c.post(`/api/inventory/adjustments/${id}/post`, {})).status, 200);
  assert.equal((await nadya.c.post(`/api/inventory/adjustments/${id}/post`, {})).status, 400);
  const serentak = await Promise.all([nadya.c.post(`/api/inventory/adjustments/${id}/post`, {}), nadya.c.post(`/api/inventory/adjustments/${id}/post`, {})]);
  assert.ok(serentak.every((r) => r.status === 400));
  assert.equal(await saldo(m.id), 12);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: m.id, type: "ADJUSTMENT", stockAdjustmentRequestId: id } }), 1);
});

test("rollback transaksi: saldo berubah di antara persetujuan dan posting sehingga hasil negatif → posting ditolak, tidak ada jejak ledger, status tetap APPROVED, lalu retry sah setelah dikoreksi", async () => {
  const nadya = await akun(["WAREHOUSE"]); const kemal = await akun(["ADMIN", "FINANCE", "OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const id = await ajukan(nadya.c, m.id, 2, 10); // selisih -8
  assert.equal((await kemal.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 200);
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "ISSUE", qty: -5, note: "pemakaian di sela" } }); // saldo 5; -8 → -3
  const gagal = await nadya.c.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(gagal.status, 400, JSON.stringify(gagal.body));
  assert.equal(await saldo(m.id), 5);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: m.id, type: "ADJUSTMENT", stockAdjustmentRequestId: id } }), 0);
  assert.equal((await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } })).status, "APPROVED");
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 5, note: "penerimaan menyusul" } }); // saldo 10
  assert.equal((await nadya.c.post(`/api/inventory/adjustments/${id}/post`, {})).status, 200);
  assert.equal(await saldo(m.id), 2);
});

test("saldo catatan MINUS (kasus LIST-WIBING-ABU): penyesuaian naik ke hasil hitung diterima; ISSUE/WASTE pada saldo minus tetap ditolak", async () => {
  const nadya = await akun(["WAREHOUSE"]); const gilang = await akun(["ADMIN", "FINANCE", "OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, -388.5);
  const id = await ajukan(nadya.c, m.id, 5, -388.5, "opname: fisik 5 ROLL");
  const req = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } });
  assert.equal(Number(req.adjustmentQty), 393.5);
  assert.equal((await gilang.c.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 200);
  assert.equal((await nadya.c.post(`/api/inventory/adjustments/${id}/post`, {})).status, 200);
  assert.equal(await saldo(m.id), 5);
  const m2 = await createTestMaterial(); await seedBalance(m2.id, -3);
  const { unit } = await createTestUnit();
  const issue = await nadya.c.post("/api/inventory/movements/issue", { materialId: m2.id, qty: 1, unitId: unit.id });
  assert.equal(issue.status, 400); assert.match(issue.body.error, /tidak cukup/);
  assert.equal(await saldo(m2.id), -3);
});

test("koreksi satu langkah lama tidak lagi mengubah stok untuk siapa pun (UI lama / klien basi mendapat 409)", async () => {
  const nadya = await akun(["WAREHOUSE"]); const gilang = await akun(["ADMIN", "FINANCE", "OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  for (const a of [nadya, gilang]) {
    const r = await a.c.post("/api/inventory/movements/adjustment", { materialId: m.id, actualQty: 3, reason: "klien lama" });
    assert.equal(r.status, 409); assert.equal(r.body.code, "SATU_LANGKAH_DITUTUP");
  }
  assert.equal(await saldo(m.id), 10);
});
