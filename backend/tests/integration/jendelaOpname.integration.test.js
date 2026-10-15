// Jendela opname: jalur cepat receipt/issue/return/waste ditutup SELAMA jendela yang diatur; dokumen resmi dan transaksi di luar jendela tidak berubah.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { KUNCI_JENDELA_OPNAME, parseJendela } from "../../src/services/jendelaOpname.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const klien = async (roles = ["WAREHOUSE"]) => makeClient(server.baseUrl, (await createTestUser({ roles })).token);
const setJendela = (v) => testPrisma.finSetting.upsert({ where: { key: KUNCI_JENDELA_OPNAME }, create: { key: KUNCI_JENDELA_OPNAME, value: JSON.stringify(v) }, update: { value: JSON.stringify(v) } });
const jam = (offMenit) => new Date(Date.now() + offMenit * 60000).toISOString();
const saldo = async (id) => { const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${id}::uuid`; return s; };

test("parseJendela: kosong/rusak/terbalik = tidak aktif (gagal-buka)", () => {
  assert.equal(parseJendela(null), null);
  assert.equal(parseJendela("bukan json"), null);
  assert.equal(parseJendela(JSON.stringify({ mulai: "2026-10-31T10:00:00Z", selesai: "2026-10-31T09:00:00Z" })), null);
  assert.ok(parseJendela(JSON.stringify({ mulai: "2026-10-31T01:00:00Z", selesai: "2026-10-31T10:00:00Z", catatan: "x" })));
});

test("tanpa pengaturan: jalur cepat berjalan seperti biasa (transaksi harian tidak berubah)", async () => {
  const c = await klien(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const r = await c.post("/api/inventory/movements/receipt", { materialId: m.id, qty: 5 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldo(m.id), 15);
});

test("di dalam jendela: receipt/issue/return/waste ditolak 409 JENDELA_OPNAME_AKTIF tanpa menulis; GR resmi tetap jalan", async () => {
  const c = await klien(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  await setJendela({ mulai: jam(-30), selesai: jam(60), catatan: "Opname uji" });
  for (const [p, b] of [["receipt", { qty: 1 }], ["issue", { qty: 1, unitId: "00000000-0000-4000-8000-000000000000" }], ["return", { qty: 1 }], ["waste", { qty: 1, reason: "uji" }]]) {
    const r = await c.post(`/api/inventory/movements/${p}`, { materialId: m.id, ...b });
    assert.equal(r.status, 409, `${p} ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, "JENDELA_OPNAME_AKTIF");
    assert.match(r.body.error, /Jendela opname fisik/);
  }
  assert.equal(await saldo(m.id), 10, "tidak ada penulisan");
  // dokumen resmi: Goods Receipt → putaway TIDAK dipengaruhi jendela (pergerakan tercatat berdokumen)
  const g = await c.post("/api/inventory/goods-receipts", { sourceType: "SUPPLIER_DELIVERY", supplier: "Supplier Tes", lines: [{ materialId: m.id, orderedQty: 3 }] });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) assert.equal((await c.patch(`/api/inventory/goods-receipts/${g.body.id}`, { status })).status, 200);
  assert.equal((await c.patch(`/api/inventory/goods-receipts/${g.body.id}/lines/${g.body.lines[0].id}`, { acceptedQty: 3 })).status, 200);
  const put = await c.post(`/api/inventory/goods-receipts/${g.body.id}/putaway`, {});
  assert.equal(put.status, 200, JSON.stringify(put.body));
  assert.equal(await saldo(m.id), 13);
});

test("di luar jendela (sudah lewat / belum mulai): jalur cepat berjalan", async () => {
  const c = await klien(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  await setJendela({ mulai: jam(-120), selesai: jam(-60) });
  assert.equal((await c.post("/api/inventory/movements/receipt", { materialId: m.id, qty: 1 })).status, 201);
  await setJendela({ mulai: jam(60), selesai: jam(120) });
  assert.equal((await c.post("/api/inventory/movements/receipt", { materialId: m.id, qty: 1 })).status, 201);
  assert.equal(await saldo(m.id), 12);
});

test("pengaturan rusak tidak menghentikan Gudang (gagal-buka)", async () => {
  const c = await klien(); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  await testPrisma.finSetting.upsert({ where: { key: KUNCI_JENDELA_OPNAME }, create: { key: KUNCI_JENDELA_OPNAME, value: "{rusak" }, update: { value: "{rusak" } });
  assert.equal((await c.post("/api/inventory/movements/receipt", { materialId: m.id, qty: 1 })).status, 201);
});

test("respons galat pemisahan tugas ikut membawa kode mesin", async () => {
  const gudang = await klien(["WAREHOUSE"]); const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const r = await gudang.post("/api/inventory/movements/adjustment", { materialId: m.id, actualQty: 1, reason: "x" });
  assert.equal(r.status, 409); assert.equal(r.body.code, "SATU_LANGKAH_DITUTUP");
});
