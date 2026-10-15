// (1) Jalur cepat /movements/receipt|return|waste DITUTUP PERMANEN: 410 + pesan Bahasa Indonesia, tanpa movement/jurnal/dokumen; /movements/issue dan semua dokumen resmi tetap.
// (2) Sesi hitung (Stock Count): snapshot saldo + waktu direkam saat Start; pergerakan ledger selama sesi ditampilkan; penghitung menandai sudah/belum masuk hitungan
//     fisik; Complete ditolak selama ada yang belum ditandai; selisih memakai tanda (tidak menebak). Tanpa pengaturan apa pun — tidak ada kondisi gagal-buka.
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
const hitungTabel = async () => ({
  mov: await testPrisma.stockMovement.count(), jv: await testPrisma.finJournalEntry.count(), gr: await testPrisma.goodsReceipt.count(),
  ret: await testPrisma.returnRecord.count(), dmg: await testPrisma.damagedStockRecord.count(), adj: await testPrisma.stockAdjustmentRequest.count(),
});

test("jalur cepat receipt/return/waste: 410 JALUR_CEPAT_DITUTUP untuk semua peran penulis, pesan mengarahkan ke dokumen resmi, tanpa movement/jurnal/dokumen", async () => {
  const m = await createTestMaterial(); await seedBalance(m.id, 10);
  const { unit } = await createTestUnit();
  const sebelum = await hitungTabel();
  const arah = { receipt: /Penerimaan Barang/, return: /Retur resmi|Retur/, waste: /Barang Rusak/ };
  for (const roles of [["WAREHOUSE"], ["ADMIN"], ["OWNER"]]) {
    const a = await akun(roles);
    for (const [jalur, body] of [["receipt", { qty: 5, unitCost: 1000 }], ["return", { qty: 1, unitId: unit.id }], ["waste", { qty: 1, reason: "uji", unitId: unit.id }]]) {
      const r = await a.c.post(`/api/inventory/movements/${jalur}`, { materialId: m.id, ...body });
      assert.equal(r.status, 410, `${roles} ${jalur} ${JSON.stringify(r.body)}`);
      assert.equal(r.body.code, "JALUR_CEPAT_DITUTUP");
      assert.match(r.body.error, /ditutup permanen/);
      assert.match(r.body.error, arah[jalur]);
    }
  }
  assert.deepEqual(await hitungTabel(), sebelum, "tidak ada movement, jurnal, GR, retur, damaged, adjustment");
  assert.equal(await saldo(m.id), 10);
  // peran tanpa izin tulis tidak membocorkan apa pun; tanpa token 401
  const finance = await akun(["FINANCE"]);
  assert.equal((await finance.c.post("/api/inventory/movements/receipt", { materialId: m.id, qty: 1 })).status, 403);
  assert.equal((await makeClient(server.baseUrl, null).post("/api/inventory/movements/receipt", { materialId: m.id, qty: 1 })).status, 401);
});

test("yang dipertahankan: /movements/issue (Keluar ke Unit), GR putaway, Damaged Stock DISPOSE — masing-masing tepat sekali (Material Issue, Return, Transfer, Adjustment, Count: lihat documentFlows)", async () => {
  const gudang = await akun(["WAREHOUSE"]);
  const { unit } = await createTestUnit();
  // issue cepat tetap berfungsi
  const mi = await createTestMaterial(); await seedBalance(mi.id, 10);
  assert.equal((await gudang.c.post("/api/inventory/movements/issue", { materialId: mi.id, qty: 2, unitId: unit.id })).status, 201);
  assert.equal(await saldo(mi.id), 8);

  // Goods Receipt → putaway sekali
  const mg = await createTestMaterial();
  const g = await gudang.c.post("/api/inventory/goods-receipts", { sourceType: "SUPPLIER_DELIVERY", supplier: "Supplier Tes", lines: [{ materialId: mg.id, orderedQty: 4 }] });
  assert.equal(g.status, 201, JSON.stringify(g.body));
  for (const status of ["SCHEDULED", "ARRIVED", "INSPECTION", "READY_FOR_PUTAWAY"]) assert.equal((await gudang.c.patch(`/api/inventory/goods-receipts/${g.body.id}`, { status })).status, 200);
  assert.equal((await gudang.c.patch(`/api/inventory/goods-receipts/${g.body.id}/lines/${g.body.lines[0].id}`, { acceptedQty: 4 })).status, 200);
  assert.equal((await gudang.c.post(`/api/inventory/goods-receipts/${g.body.id}/putaway`, {})).status, 200);
  assert.equal((await gudang.c.post(`/api/inventory/goods-receipts/${g.body.id}/putaway`, {})).status, 400);
  assert.equal(await saldo(mg.id), 4);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: mg.id, type: "RECEIPT", goodsReceiptId: g.body.id } }), 1);

  // Damaged stock → DISPOSE menulis WASTE sekali
  const md = await createTestMaterial(); await seedBalance(md.id, 6);
  const d = await gudang.c.post("/api/inventory/damaged-stock", { materialId: md.id, qty: 2, damageCategory: "TORN" });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  await gudang.c.patch(`/api/inventory/damaged-stock/${d.body.id}/inspect`, {});
  const res = await gudang.c.post(`/api/inventory/damaged-stock/${d.body.id}/resolve`, { resolution: "DISPOSE" });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal((await gudang.c.post(`/api/inventory/damaged-stock/${d.body.id}/resolve`, { resolution: "DISPOSE" })).status, 400);
  assert.equal(await saldo(md.id), 4);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: md.id, type: "WASTE" } }), 1);
});

// ───────── sesi hitung ─────────
async function sesi(materialIds, { gudang, owner }) {
  const cr = await gudang.c.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: materialIds.map((materialId) => ({ materialId })) });
  assert.equal(cr.status, 201, JSON.stringify(cr.body));
  const st = await gudang.c.post(`/api/inventory/stock-counts/${cr.body.id}/start`, {});
  assert.equal(st.status, 200);
  return { id: cr.body.id, lines: st.body.lines };
}
const isi = async (gudang, id, line, counted, reason) => assert.equal((await gudang.c.patch(`/api/inventory/stock-counts/${id}/lines/${line.id}`, { countedQty: counted, ...(reason ? { reason } : {}) })).status, 200);

test("sesi hitung: snapshot + waktu terekam; pergerakan selama sesi tampil; Complete ditolak sampai ditandai; tanda YA/TIDAK menentukan selisih", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const a = await createTestMaterial(); const b = await createTestMaterial();
  await seedBalance(a.id, 20); await seedBalance(b.id, 20);
  const { id, lines } = await sesi([a.id, b.id], { gudang, owner });
  const la = lines.find((l) => l.materialId === a.id), lb = lines.find((l) => l.materialId === b.id);
  assert.equal(la.systemQty, 20);
  const detail0 = (await gudang.c.get(`/api/inventory/stock-counts/${id}`)).body;
  assert.ok(detail0.sesi.snapshotPada, "waktu snapshot terekam"); assert.deepEqual(detail0.pergerakanSesi, []);

  // selama sesi: material A menerima +5 (dokumen apa pun), material B dikeluarkan -3
  const ma = await testPrisma.stockMovement.create({ data: { materialId: a.id, type: "RECEIPT", qty: 5, note: "penerimaan selama sesi" } });
  const mb = await testPrisma.stockMovement.create({ data: { materialId: b.id, type: "ISSUE", qty: -3, note: "pemakaian selama sesi" } });
  const detail1 = (await gudang.c.get(`/api/inventory/stock-counts/${id}`)).body;
  assert.equal(detail1.pergerakanSesi.length, 2); assert.equal(detail1.sesi.belumDitandai, 2);
  assert.ok(detail1.pergerakanSesi.every((p) => p.tanda === null), "tidak ada tanda bawaan");

  await isi(gudang, id, la, 25); await isi(gudang, id, lb, 15, "selisih pemakaian");
  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${id}/submit`, {})).status, 200);
  // belum ditandai → ditolak, tanpa movement
  const tolak = await owner.c.post(`/api/inventory/stock-counts/${id}/complete`, {});
  assert.equal(tolak.status, 409, JSON.stringify(tolak.body)); assert.equal(tolak.body.code, "PERGERAKAN_SESI_BELUM_DITANDAI");
  assert.equal(await testPrisma.stockMovement.count({ where: { stockCountId: id } }), 0);

  // tanda harus boolean eksplisit; pergerakan lain/asing ditolak
  const bukanBoolean = await gudang.c.post(`/api/inventory/stock-counts/${id}/pergerakan/${ma.id}/tanda`, { tercermin: "ya" });
  assert.equal(bukanBoolean.status, 400);
  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${id}/pergerakan/00000000-0000-4000-8000-000000000000/tanda`, { tercermin: true })).status, 404);
  // A: sudah masuk hitungan fisik (fisik 25 = 20 + 5) ; B: sudah masuk (fisik 15, seharusnya 17 → selisih -2)
  const t1 = await gudang.c.post(`/api/inventory/stock-counts/${id}/pergerakan/${ma.id}/tanda`, { tercermin: true });
  assert.equal(t1.status, 200, JSON.stringify(t1.body)); assert.equal(t1.body.belumDitandai, 1);
  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${id}/pergerakan/${mb.id}/tanda`, { tercermin: true })).status, 200);

  // pengisi/penanda tidak boleh menyelesaikan sendiri; penyetuju lain boleh
  const penanda = await akun(["OWNER"]);
  assert.equal((await penanda.c.post(`/api/inventory/stock-counts/${id}/pergerakan/${ma.id}/tanda`, { tercermin: true })).status, 200);
  assert.equal((await penanda.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 403, "penanda tidak boleh menyelesaikan");
  const ok = await owner.c.post(`/api/inventory/stock-counts/${id}/complete`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const adjA = await testPrisma.stockMovement.findMany({ where: { materialId: a.id, type: "ADJUSTMENT", stockCountId: id } });
  const adjB = await testPrisma.stockMovement.findMany({ where: { materialId: b.id, type: "ADJUSTMENT", stockCountId: id } });
  assert.equal(adjA.length, 0, "A: fisik 25 sudah memuat +5 → tanpa selisih");
  assert.equal(adjB.length, 1); assert.equal(Number(adjB[0].qty), -2);
  assert.equal(await saldo(a.id), 25); assert.equal(await saldo(b.id), 15, "ledger = fisik");
});

test("sesi hitung: tanda BELUM masuk → selisih terhadap snapshot (pergerakan tetap utuh); tanda bisa diganti sebelum Complete", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const b = await createTestMaterial(); await seedBalance(b.id, 20);
  const { id, lines } = await sesi([b.id], { gudang, owner });
  const mb = await testPrisma.stockMovement.create({ data: { materialId: b.id, type: "ISSUE", qty: -3, note: "pemakaian selama sesi" } });
  await isi(gudang, id, lines[0], 15, "fisik 15 saat dihitung");
  assert.equal((await gudang.c.post(`/api/inventory/stock-counts/${id}/submit`, {})).status, 200);
  await gudang.c.post(`/api/inventory/stock-counts/${id}/pergerakan/${mb.id}/tanda`, { tercermin: true });
  await gudang.c.post(`/api/inventory/stock-counts/${id}/pergerakan/${mb.id}/tanda`, { tercermin: false }); // koreksi tanda: yang terakhir berlaku
  const detail = (await gudang.c.get(`/api/inventory/stock-counts/${id}`)).body;
  assert.equal(detail.pergerakanSesi[0].tanda, "BELUM_TERHITUNG");
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 200);
  const adj = await testPrisma.stockMovement.findMany({ where: { materialId: b.id, type: "ADJUSTMENT", stockCountId: id } });
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -5, "15 − snapshot 20");
  assert.equal(await saldo(b.id), 12, "20 − 3 (issue) − 5 (selisih)");
  // complete kedua tidak menggandakan
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 400);
  assert.equal(await testPrisma.stockMovement.count({ where: { materialId: b.id, type: "ADJUSTMENT" } }), 1);
});

test("sesi hitung tanpa pergerakan selama sesi: perilaku lama tidak berubah (selisih = fisik − snapshot); pergerakan ADJUSTMENT milik count sendiri tidak dihitung sebagai pergerakan sesi", async () => {
  const gudang = await akun(["WAREHOUSE"]); const owner = await akun(["OWNER"]);
  const m = await createTestMaterial(); await seedBalance(m.id, 9);
  const { id, lines } = await sesi([m.id], { gudang, owner });
  await isi(gudang, id, lines[0], 7, "susut");
  await gudang.c.post(`/api/inventory/stock-counts/${id}/submit`, {});
  assert.equal((await owner.c.post(`/api/inventory/stock-counts/${id}/complete`, {})).status, 200);
  assert.equal(await saldo(m.id), 7);
  const detail = (await owner.c.get(`/api/inventory/stock-counts/${id}`)).body;
  assert.deepEqual(detail.pergerakanSesi, [], "ADJUSTMENT hasil count ini tidak muncul sebagai pergerakan sesi");
});
