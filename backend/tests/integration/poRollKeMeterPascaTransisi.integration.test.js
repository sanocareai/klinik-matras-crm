// PEMBELIAN ROLL → MASTER BERSATUAN METER sesudah transisi satuan (LIST WIBING). Dibuktikan lewat rute asli sampai penerimaan, stok, nilai jurnal, harga per satuan stok, dan idempotensi:
// faktor 90 EKSPLISIT; tanpa faktor ditolak; stok bertambah qty×90 METER bertanda satuan METER; nilai penerimaan = nilai PO persis; replay tidak menggandakan PO maupun stok.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { denganVerifikasiOtomatis } from "./setup/verifikasiOtomatis.js"; // non-ADMIN: pengajuan → diverifikasi ADMIN uji lain (jalur tulis yang sama)
import { bawaSampaiSiap } from "./setup/kedatangan.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { pratinjauTransisi, terapkanTransisi } from "../../src/services/transisiSatuanBahan.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const HARGA_ROLL = 85_000;
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const HASH_REF = "f5d08fab2c0b38a0b84ebbf712a1655723133af599c69b64b758a626f5033a9d";
const saldo = async (id) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: id }, _sum: { qty: true } }))._sum.qty ?? 0);

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const admin = await createTestUser({ roles: ["ADMIN"] }); const gudang = await createTestUser({ roles: ["WAREHOUSE"] }); const owner = await createTestUser({ roles: ["OWNER"] });
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-WIB", name: "PT WIBING UJI" } });
  const m = await createTestMaterial({ code: `LIST-WIBING-PO-${Date.now() % 100000}`, name: "LIST WIBING PO UJI", unit: "ROLL" });
  await seedBalance(m.id, -78.5, { type: "ADJUSTMENT", createdAt: new Date(Date.now() - 41 * 86400_000) });
  const B = { id: owner.user.id, name: owner.user.name, roles: ["OWNER"] };
  const minta = { materialId: m.id, satuanBaru: "METER", saldoBaru: 180 };
  const p = await pratinjauTransisi(testPrisma, { aktor: B, transisi: [minta] }); assert.equal(p.bolehDiterapkan, true, JSON.stringify(p.transisi[0].penghalang));
  await terapkanTransisi(testPrisma, { aktor: B, transisi: [{ ...minta, hashPratinjau: p.transisi[0].hash }], sumber: "SO uji", alasan: "Satuan operasional mengikuti Excel SO", rujukanHash: HASH_REF, kunci: `tr-po-${randomUUID()}`, tautan: { soTanggal: hariIni(), sumber: "SO uji", alasan: "Tautan SO dalam transisi satuan uji", rujukanHash: HASH_REF } });
  assert.equal((await testPrisma.material.findUnique({ where: { id: m.id } })).unit, "METER"); assert.equal(await saldo(m.id), 180);
  return { a: denganVerifikasiOtomatis(makeClient(server.baseUrl, admin.token), server.baseUrl), g: denganVerifikasiOtomatis(makeClient(server.baseUrl, gudang.token), server.baseUrl), supplier, m };
}
const poBody = (w, line, extra = {}) => ({ supplierId: w.supplier.id, orderDate: hariIni(), lines: [line], ...extra });

test("P1. tanpa faktor ditolak (FAKTOR_WAJIB); faktor tidak valid ditolak; satuan beli = METER (sama dengan master) tanpa konversi", async () => {
  const w = await dunia();
  const a = await w.a.post("/api/finance/purchase-orders", poBody(w, { materialId: w.m.id, satuanBeli: "ROLL", qty: 2, unitPrice: HARGA_ROLL })); assert.equal(a.status, 400, JSON.stringify(a.body)); assert.match(JSON.stringify(a.body), /FAKTOR_WAJIB|Faktor konversi wajib/);
  const b = await w.a.post("/api/finance/purchase-orders", poBody(w, { materialId: w.m.id, satuanBeli: "ROLL", faktorKonversi: 0, qty: 2, unitPrice: HARGA_ROLL })); assert.equal(b.status, 400, JSON.stringify(b.body));
  const c = await w.a.post("/api/finance/purchase-orders", poBody(w, { materialId: w.m.id, qty: 90, unitPrice: 944 })); assert.equal(c.status, 201, JSON.stringify(c.body)); assert.equal(c.body.lines[0].purchaseUnit ?? null, null, "beli dalam METER = tanpa konversi");
  assert.equal(await testPrisma.finPurchaseOrder.count(), 1, "hanya PO yang sah tersimpan");
});

test("P2. PO 2 ROLL @Rp85.000 (faktor 90 eksplisit) → penerimaan: stok +180 METER bertanda METER, harga stok eksak per METER, jurnal = nilai PO persis, saldo 180→360", async () => {
  const w = await dunia(); const h = { "Idempotency-Key": `po-${randomUUID()}` };
  const po = (await w.a.post("/api/finance/purchase-orders", poBody(w, { materialId: w.m.id, satuanBeli: "ROLL", faktorKonversi: 90, qty: 2, unitPrice: HARGA_ROLL }), h));
  assert.equal(po.status, 201, JSON.stringify(po.body)); assert.equal(po.body.lines[0].konversi?.satuanBeli, "ROLL"); assert.equal(Number(po.body.lines[0].konversi?.faktor), 90); assert.equal(po.body.lines[0].konversi?.satuanStok, "METER");
  const ulang = await w.a.post("/api/finance/purchase-orders", poBody(w, { materialId: w.m.id, satuanBeli: "ROLL", faktorKonversi: 90, qty: 2, unitPrice: HARGA_ROLL }), h); assert.equal(ulang.status, 201); assert.equal(ulang.body.id, po.body.id, "replay kunci sama = PO yang sama"); assert.equal(await testPrisma.finPurchaseOrder.count(), 1);
  assert.equal((await w.a.post(`/api/finance/purchase-orders/${po.body.id}/approve`, {})).status, 200);
  const gr = (await w.g.post("/api/inventory/goods-receipts", { purchaseOrderId: po.body.id })).body; assert.equal(gr.lines[0].purchaseOrderLine.purchaseUnit, "ROLL");
  await bawaSampaiSiap(w.g, gr, { datang: 2, baik: 2, tolak: 0 });
  const put = await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, { location: "RAK-B02" }); assert.equal(put.status, 200, JSON.stringify(put.body));
  const mv = await testPrisma.stockMovement.findMany({ where: { goodsReceiptId: gr.id } }); assert.equal(mv.length, 1); assert.equal(Number(mv[0].qty), 180, "2 ROLL × 90 = 180 METER");
  assert.equal(mv[0].unitAtEntry, "METER", "pergerakan baru bertanda satuan METER oleh trigger"); assert.equal(mv[0].unitTransitionId, null);
  assert.ok(Math.abs(Number(mv[0].unitCostExact) - HARGA_ROLL / 90) < 1e-6, `harga stok eksak per METER = 85.000/90: ${mv[0].unitCostExact}`); assert.ok(Math.abs(mv[0].unitCost - Math.round(HARGA_ROLL / 90)) <= 1, `harga bulat per METER: ${mv[0].unitCost}`);
  assert.equal(await saldo(w.m.id), 360, "180 (hasil SO) + 180");
  const jurnal = await testPrisma.finJournalEntry.findFirst({ where: { source: "PENERIMAAN_BAHAN", sourceId: gr.id }, include: { lines: { include: { account: true } } } }); assert.ok(jurnal);
  const dr = jurnal.lines.find((l) => Number(l.debit) > 0); assert.equal(dr.account.code, "1-1400"); assert.equal(Number(dr.debit), 2 * HARGA_ROLL, "nilai persediaan = nilai PO persis (tidak dihitung ulang dari harga bulat per METER)");
  // idempotensi penyimpanan: simpan ulang tidak menggandakan stok maupun jurnal
  const put2 = await w.g.post(`/api/inventory/goods-receipts/${gr.id}/putaway`, { location: "RAK-B02" });
  assert.equal(await testPrisma.stockMovement.count({ where: { goodsReceiptId: gr.id } }), 1, `putaway ulang (${put2.status}) tidak boleh menambah pergerakan`); assert.equal(await saldo(w.m.id), 360);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENERIMAAN_BAHAN", sourceId: gr.id } }), 1);
  // riwayat satuan tetap konsisten: periode ROLL ditutup 0, periode METER 360
  const rs = await w.g.get(`/api/inventory/materials/${w.m.id}/riwayat-satuan`); assert.equal(rs.status, 200); assert.equal(rs.body.konsisten, true); assert.equal(rs.body.saldoSekarang, 360);
});

test("P3. Harga Berlaku sesudah PO ROLL→METER dicatat per satuan stok (METER), bukan per ROLL (tidak ada harga ROLL yang dipakai untuk stok METER)", async () => {
  const w = await dunia();
  const po = (await w.a.post("/api/finance/purchase-orders", poBody(w, { materialId: w.m.id, satuanBeli: "ROLL", faktorKonversi: 90, qty: 2, unitPrice: HARGA_ROLL }))).body;
  const hb = await testPrisma.materialHargaBerlaku.findMany({ where: { materialId: w.m.id }, orderBy: { createdAt: "asc" } });
  for (const x of hb) assert.equal(x.satuan, "METER", `Harga Berlaku harus per METER: ${x.satuan} ${x.unitPrice}`);
  console.log("HARGA_BERLAKU_SESUDAH_PO", JSON.stringify(hb.map((x) => [x.jenis, x.satuan, Number(x.unitPrice)])));
  assert.ok(hb.length === 0 || hb.every((x) => Math.abs(Number(x.unitPrice) - HARGA_ROLL / 90) <= 1), JSON.stringify(hb.map((x) => [x.satuan, Number(x.unitPrice)])));
  assert.ok(po.id);
});
