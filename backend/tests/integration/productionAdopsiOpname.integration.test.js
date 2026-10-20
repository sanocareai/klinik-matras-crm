// INTERAKSI dua fitur live/kandidat: Stock Opname penuh (sesi model 2, tiga waktu, tanda pergerakan) + Order Produksi adopsi Admin (rencana bahan, pemakaian aktual idempoten, status kerja manual).
// Membuktikan: RENCANA bahan tidak tampil sebagai pergerakan di Opname dan tidak mengubah saldo; PEMAKAIAN AKTUAL (pergerakan stok resmi) yang terjadi sesudah bahan dihitung muncul di tinjauan Opname,
// tepat sekali walau dikirim ulang/serentak; sesi Opname diselesaikan dan saldo akhir = fisik + pemakaian aktual; status kerja manual tidak menyentuh Opname.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const SC = "/api/inventory/stock-counts"; const PR = "/api/production"; let seq = 0;
const iso = (d) => new Date(d).toISOString(); const menitLalu = (n) => new Date(Date.now() - n * 60_000);
const saldo = async (m) => Number((await testPrisma.stockMovement.aggregate({ where: { materialId: m }, _sum: { qty: true } }))._sum.qty ?? 0);
const seedLama = (materialId, qty) => testPrisma.stockMovement.create({ data: { materialId, type: "RECEIPT", qty, note: "saldo awal", createdAt: new Date(Date.now() - 5 * 86_400_000) } }); // sebelum waktu pengamatan
async function dunia() {
  const mk = async (role) => { const u = await createTestUser({ roles: [role] }); return { ...u, api: makeClient(server.baseUrl, u.token) }; };
  const [gudangA, gudangC, owner, admin] = await Promise.all([mk("WAREHOUSE"), mk("WAREHOUSE"), mk("OWNER"), mk("ADMIN")]);
  const m1 = await createTestMaterial({ name: "Busa Opname", unit: "SHEET", itemGroup: "REBONDED" }); await seedLama(m1.id, 100);
  const m2 = await createTestMaterial({ name: "Kain Opname", unit: "METER", itemGroup: "KAIN" }); await seedLama(m2.id, 50);
  const cust = await testPrisma.customer.create({ data: { name: `Pelanggan ${++seq}` } });
  const order = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: `OPO-${++seq}`, value: 100, category: "LAYANAN", status: "PROCESSING", items: { create: [{ layananName: "Service Fondasi", harga: 100, sortOrder: 1 }] } } });
  const unit = await testPrisma.unit.create({ data: { unitCode: `OPO-U-${++seq}`, orderId: order.id, seq: 1, status: "RECEIVED" } });
  return { gudangA, gudangC, owner, admin, m1, m2, order, unit };
}

test("Opname + adopsi Admin: rencana tidak tampil sebagai pergerakan; pemakaian aktual sesudah dihitung tampil SEKALI di tinjauan; sesi selesai dengan saldo = fisik + pemakaian; status kerja manual tidak menyentuh Opname", async () => {
  const w = await dunia();
  // sesi Opname Cycle Count: dihitung 100 (30 menit lalu); sesi dimulai 6 jam lalu supaya waktu pengamatan sah
  const s = (await w.gudangA.api.post(SC, { mode: "ITEMS", materialIds: [w.m1.id, w.m2.id], blindCount: true })).body;
  assert.equal((await w.gudangA.api.post(`${SC}/${s.id}/start`, {})).status, 200);
  await testPrisma.stockCount.update({ where: { id: s.id }, data: { startedAt: new Date(Date.now() - 6 * 3600_000) } });
  const k = (await w.gudangA.api.get(`${SC}/${s.id}/kerja`)).body; const L = Object.fromEntries(k.baris.map((b) => [b.materialId, b]));
  const sim = await w.gudangA.api.put(`${SC}/${s.id}/hasil`, { items: [{ lineId: L[w.m1.id].id, revision: 0, countedQty: 100, observedAt: iso(menitLalu(30)) }, { lineId: L[w.m2.id].id, revision: 0, countedQty: 50, observedAt: iso(menitLalu(30)) }] });
  assert.equal(sim.status, 200, JSON.stringify(sim.body));
  const mov0 = await testPrisma.stockMovement.count();

  // (1) RENCANA bahan + status kerja manual: bukan pergerakan, saldo tidak berubah, Opname tidak melihat apa pun
  const rn = await w.admin.api.put(`${PR}/units/${w.unit.id}/material-plan`, { expectedRevision: 0, lines: [{ materialId: w.m1.id, qty: 5 }, { materialId: w.m2.id, qty: 3 }] });
  assert.equal(rn.status, 200, JSON.stringify(rn.body));
  const kerjaManual = await w.admin.api.post(`${PR}/units/${w.unit.id}/work-progress`, { status: "DIKERJAKAN", expectedLatestId: null }); assert.equal(kerjaManual.status, 201);
  assert.equal(await testPrisma.stockMovement.count(), mov0, "rencana + status kerja tidak membuat pergerakan"); assert.equal(await saldo(w.m1.id), 100); assert.equal(await saldo(w.m2.id), 50);

  // (2) PEMAKAIAN AKTUAL (idempoten): dikirim, diulang, serentak → tepat SATU pergerakan ISSUE per niat
  const K1 = "opo-pakai-0001-aaaaaaaa"; const body = { materialId: w.m1.id, qty: 2, note: "Pemakaian aktual Produksi" };
  const a1 = await w.admin.api.post(`/api/units/${w.unit.id}/materials`, body, { "Idempotency-Key": K1 }); assert.equal(a1.status, 201, JSON.stringify(a1.body));
  const a2 = await w.admin.api.post(`/api/units/${w.unit.id}/materials`, body, { "Idempotency-Key": K1 }); assert.equal(a2.status, 200); assert.equal(a2.body.id, a1.body.id);
  const K2 = "opo-pakai-0002-bbbbbbbb";
  const [b1, b2] = await Promise.all([1, 2].map(() => w.admin.api.post(`/api/units/${w.unit.id}/materials`, { materialId: w.m2.id, qty: 1, note: "Serentak" }, { "Idempotency-Key": K2 })));
  assert.equal([b1.status, b2.status].filter((x) => x === 201).length, 1);
  assert.equal(await testPrisma.stockMovement.count(), mov0 + 2, "dua niat = dua pergerakan (busa 2, kain 1), bukan lebih");
  assert.equal(await saldo(w.m1.id), 98); assert.equal(await saldo(w.m2.id), 49);
  // Opname memakai ledger yang SAMA: pergerakan itu tampil di tinjauan, rencana tidak
  assert.equal((await w.gudangA.api.post(`${SC}/${s.id}/submit`, {})).status, 200);
  const d = (await w.gudangC.api.get(`${SC}/${s.id}`)).body; const t1 = d.lines.find((l) => l.materialId === w.m1.id).tinjau; const t2 = d.lines.find((l) => l.materialId === w.m2.id).tinjau;
  assert.equal(t1.transaksi.jumlah, 1, "pemakaian aktual busa terbaca Opname tepat sekali (rencana 5 tidak ikut)"); assert.equal(t1.transaksi.sejakPengamatan[0].kelas, "SESUDAH_DISIMPAN");
  assert.equal(t2.transaksi.jumlah, 1, "pemakaian aktual kain (serentak) tepat sekali");
  // (3) pemeriksa memutuskan pergerakan belum tercermin → selesai → saldo akhir = fisik + pemakaian aktual
  assert.equal((await w.gudangC.api.post(`${SC}/${s.id}/periksa`, {})).status, 200);
  const tm = await w.gudangC.api.post(`${SC}/${s.id}/pergerakan/tanda-massal`, { tercermin: false }); assert.equal(tm.status, 200, JSON.stringify(tm.body));
  const sel = await w.owner.api.post(`${SC}/${s.id}/complete`, {}); assert.equal(sel.status, 200, JSON.stringify(sel.body));
  assert.equal(await saldo(w.m1.id), 98, "fisik 100 − pemakaian aktual 2; tidak ada penyesuaian ganda"); assert.equal(await saldo(w.m2.id), 49);
  // (4) panel Produksi tetap konsisten sesudah Opname: pemakaian aktual vs rencana dengan dokumen sumber + pelaku
  const p = (await w.admin.api.get(`${PR}/units/${w.unit.id}/adopsi`)).body; const cmp = p.perbandingan.find((x) => x.materialId === w.m1.id);
  assert.equal(cmp.rencana, 5); assert.equal(cmp.aktual, 2); assert.ok(p.pemakaianAktual.baris.every((x) => x.dokumen?.jenis && x.pelaku));
  assert.equal(p.adopsi.kerja.key, "DIKERJAKAN"); assert.equal(p.adopsi.kerja.source, "MANUAL");
});

test("Opname tidak membuat/ mengubah data adopsi: sesi Opname dibuat dan dibatalkan tanpa baris di tabel adopsi; ekspor Excel tetap benar dengan sesi terbuka", async () => {
  const w = await dunia();
  const s = (await w.gudangA.api.post(SC, { mode: "ITEMS", materialIds: [w.m1.id], blindCount: true })).body;
  const [prog, plan, rev] = [await testPrisma.productionUnitWorkProgress.count(), await testPrisma.productionUnitMaterialPlan.count(), await testPrisma.productionUnitMaterialPlanRevision.count()];
  assert.deepEqual([prog, plan, rev], [0, 0, 0]);
  const ex = await fetch(server.baseUrl + `${PR}/work-orders/export.xlsx`, { headers: { Authorization: "Bearer " + w.admin.token } }); assert.equal(ex.status, 200);
  assert.ok((await ex.arrayBuffer()).byteLength > 2000, "berkas xlsx terbentuk");
  assert.equal((await w.gudangA.api.patch(`${SC}/${s.id}/cancel`, { reason: "uji interaksi" })).status, 200);
  assert.equal(await testPrisma.productionUnitWorkProgress.count(), 0);
});
