// HPP DI PROFIL UNIT (keputusan Owner 14 Nov 2026): HPP operasional bahan (harga berlaku yang dibekukan saat pemakaian) TERBUKA untuk semua peran yang boleh
// membuka unit — dievaluasi bersama tim Produksi di rapat untuk efisiensi bahan baku. Biaya perolehan Finance (PO/supplier, hppBahan) TETAP finance:read.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { denganVerifikasiOtomatis } from "./setup/verifikasiOtomatis.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0; const kunci = (p = "hp") => `${p}-${Date.now()}-${++seq}-uji-kunci`;
const HARI = 86400_000;

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const sales = await createTestUser({ roles: ["SALES"] }); const lead = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const mat = await createTestMaterial({ code: `HPP-${++seq}`, name: "BUSA HPP UJI", unit: "KG" });
  await seedBalance(mat.id, 100, { unitCost: 18000 }); // biaya perolehan (Finance) SENGAJA berbeda dari harga berlaku
  await testPrisma.materialHargaBerlaku.create({ data: { materialId: mat.id, jenis: "HARGA", unitPrice: "20000", satuan: "KG", effectiveFrom: new Date(Date.now() - 5 * HARI), createdAt: new Date(Date.now() - 5 * HARI), reason: "harga uji", idempotencyKey: kunci("hb") } });
  const { unit } = await createTestUnit({ status: "RECEIVED" });
  const c = (u) => denganVerifikasiOtomatis(makeClient(server.baseUrl, u.token), server.baseUrl);
  return { a: c(admin), s: makeClient(server.baseUrl, sales.token), l: makeClient(server.baseUrl, lead.token), mat, unit };
}

test("H1. profil unit (adopsi) membawa HPP operasional untuk SEMUA peran yang boleh membuka unit: total + baris per bahan, harga pemakaian per baris; biaya perolehan Finance tetap tersembunyi", async () => {
  const w = await dunia();
  const pakai = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: w.mat.id, qty: 3 }, { "Idempotency-Key": kunci() });
  assert.equal(pakai.status, 201, JSON.stringify(pakai.body));
  for (const [peran, klien] of [["SALES", w.s], ["PRODUCTION_LEAD", w.l], ["ADMIN", w.a]]) {
    const r = await klien.get(`/api/production/units/${w.unit.id}/adopsi`);
    assert.equal(r.status, 200, peran);
    const h = r.body.hppOperasional;
    assert.ok(h, `${peran}: hppOperasional ada`);
    assert.equal(h.ringkasan.hppOperasionalDibekukan, 60000, `${peran}: 3 KG × harga berlaku 20.000 (bukan biaya perolehan 18.000)`);
    assert.equal(h.status, "LENGKAP_MENURUT_HARGA_BERLAKU");
    assert.equal(h.baris.length, 1); assert.equal(h.baris[0].nama, "BUSA HPP UJI"); assert.equal(h.baris[0].nilai, 60000); assert.equal(h.baris[0].qty, -3);
    assert.equal(r.body.pemakaianAktual.baris[0].hppBeku.harga, 20000, `${peran}: harga per baris di tab Bahan tidak disembunyikan`);
  }
  const sales = (await w.s.get(`/api/production/units/${w.unit.id}/adopsi`)).body;
  assert.equal(sales.hppBahan.lihatNilai, false, "biaya perolehan Finance (PO/supplier) tetap khusus finance:read");
  const jejak = await w.s.get(`/api/units/${w.unit.id}/jejak-bahan`); assert.equal(jejak.status, 403, "jejak PO/supplier tetap tertutup bagi Sales");
});

test("H2. unit tanpa pemakaian: HPP 'belum ada pemakaian' (tidak ada angka Rp0 palsu)", async () => {
  const w = await dunia();
  const h = (await w.l.get(`/api/production/units/${w.unit.id}/adopsi`)).body.hppOperasional;
  assert.equal(h.status, "BELUM_ADA_PEMAKAIAN"); assert.equal(h.baris.length, 0);
});

test("H3. daftar Order Produksi: harga jual (nilai order) + HPP ringkas SAMA dengan profil unit, untuk Sales juga; order 2 unit diberi jumlah unit", async () => {
  const w = await dunia();
  await testPrisma.order.update({ where: { id: w.unit.orderId }, data: { value: 7500000 } });
  await testPrisma.unit.create({ data: { unitCode: `HP2-${Date.now()}-${++seq}`, orderId: w.unit.orderId, seq: 2, status: "RECEIVED" } });
  const pakai = await w.a.post(`/api/units/${w.unit.id}/materials`, { materialId: w.mat.id, qty: 3 }, { "Idempotency-Key": kunci() });
  assert.equal(pakai.status, 201, JSON.stringify(pakai.body));
  for (const [peran, klien] of [["SALES", w.s], ["PRODUCTION_LEAD", w.l]]) {
    const r = await klien.get(`/api/production/work-orders?q=${encodeURIComponent(w.unit.unitCode)}`);
    assert.equal(r.status, 200, peran);
    const b = r.body.units.find((u) => u.id === w.unit.id);
    assert.ok(b, `${peran}: unit ada di daftar`);
    const profil = (await klien.get(`/api/production/units/${w.unit.id}/adopsi`)).body.hppOperasional;
    assert.deepEqual(b.adopsi.nilai, { jual: 7500000, unitDalamOrder: 2, hpp: { total: profil.ringkasan.hppOperasionalDibekukan, status: profil.status, tanpaHarga: 0 } }, peran);
    assert.equal(b.adopsi.nilai.hpp.total, 60000);
  }
  const lain = (await w.l.get(`/api/production/work-orders`)).body.units.find((u) => u.id !== w.unit.id && u.orderId === w.unit.orderId);
  assert.deepEqual(lain.adopsi.nilai.hpp, { total: 0, status: "BELUM_ADA_PEMAKAIAN", tanpaHarga: 0 }, "unit tanpa pemakaian: belum ada (bukan Rp0)");
});
