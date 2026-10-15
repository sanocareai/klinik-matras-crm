// K5 — PINTU PEMAKAIAN BAHAN LEPAS → HARGA PERSEDIAAN → HPP.
// Yang dikunci: (1) pemakaian/retur/susut BARU lewat POST /units/:id/materials dan /inventory/movements/issue|return|waste dibukukan di transaksi yang sama
// (Dr Beban Pokok Bahan / Cr Persediaan, harga = rata-rata tertimbang penerimaan berharga); (2) tanpa harga → gap TANPA_HARGA_PEROLEHAN, stok tetap berjalan, tidak ada Rp0 palsu;
// (3) harga referensi Excel (Material.referenceUnitCost) TIDAK PERNAH dipakai; (4) pergerakan historis tanpa jurnal TIDAK disentuh (tak ada pemberian harga otomatis,
// sinkronisasi massal tidak menjangkaunya); (5) idempoten; (6) cutover menunggu persediaan awal → gap PERSEDIAAN_AWAL_BELUM_DIPOSTING, bukan jurnal negatif.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { SETTING_KEYS } from "../../src/services/finance/settings.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia({ cutover = "" } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  await testPrisma.finSetting.upsert({ where: { key: SETTING_KEYS.INVENTORY_CUTOVER_DATE }, update: { value: cutover }, create: { key: SETTING_KEYS.INVENTORY_CUTOVER_DATE, value: cutover } });
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const prod = await createTestUser({ roles: ["PRODUCTION_LEAD"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const c = (u) => makeClient(server.baseUrl, u.token);
  const { unit } = await createTestUnit();
  return { g: c(gudang), p: c(prod), f: c(fin), unit };
}
/** Penerimaan berharga langsung di ledger (setara hasil putaway PO): stok + dasar harga rata-rata. */
const terima = (materialId, qty, unitCost) => testPrisma.stockMovement.create({ data: { materialId, type: "RECEIPT", qty, unitCost, note: "seed penerimaan berharga" } });
const jurnalDari = (kunci) => testPrisma.finJournalEntry.findFirst({ where: { idempotencyKey: kunci }, include: { lines: { include: { account: { select: { systemKey: true } } } } } });
const gapTerbuka = (sourceId) => testPrisma.finPostingGap.findMany({ where: { source: "PEMAKAIAN_BAHAN", sourceId, resolvedAt: null } });
const nilai = (e, key, sisi) => e.lines.filter((l) => l.account.systemKey === key).reduce((a, l) => a + Number(l[sisi]), 0);

test("pemakaian lantai produksi (POST /units/:id/materials): jurnal HPP di transaksi yang sama, harga rata-rata tertimbang penerimaan", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BUSA-K5", unit: "KG" });
  await terima(m.id, 10, 40_000); await terima(m.id, 10, 50_000); // rata-rata 45.000
  const r = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const e = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${r.body.id}`);
  assert.ok(e, "jurnal HPP harus lahir bersama pergerakan stok");
  assert.equal(e.status, "POSTED");
  assert.equal(nilai(e, "BEBAN_POKOK_BAHAN", "debit"), 90_000);
  assert.equal(nilai(e, "PERSEDIAAN_BAHAN", "credit"), 90_000);
  assert.equal((await gapTerbuka(r.body.id)).length, 0);
  // nilai beku per unit tercatat dengan harga yang sama
  const v = await testPrisma.finStockMovementValuation.findFirst({ where: { movementId: r.body.id } });
  assert.equal(v.status, "DINILAI");
  assert.equal(Number(v.value), 90_000); // biaya positif = nilai bahan keluar
});

test("koreksi mengurangi (qty negatif) = RETURN: beban pokok berkurang pada jurnal yang sama jalurnya", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BUSA-K5R", unit: "KG" });
  await terima(m.id, 10, 40_000);
  const pakai = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 3 });
  const kembali = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: -1 });
  assert.equal(pakai.status, 201); assert.equal(kembali.status, 201);
  const e = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${kembali.body.id}`);
  assert.ok(e);
  assert.equal(nilai(e, "BEBAN_POKOK_BAHAN", "credit"), 40_000);
  assert.equal(nilai(e, "PERSEDIAAN_BAHAN", "debit"), 40_000);
});

test("tanpa harga perolehan: stok tetap berjalan, TIDAK ada jurnal Rp0, gap TANPA_HARGA_PEROLEHAN terbuka; harga referensi Excel TIDAK dipakai", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-TANPA-HARGA-K5", unit: "KG", referenceUnitCost: 99_000, referenceUnitCostMonth: "2026-08" });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 5, note: "stok awal tanpa harga" } });
  const r = await w.g.post("/api/inventory/movements/issue", { materialId: m.id, unitId: w.unit.id, qty: 2 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${r.body.id}`), null);
  const gaps = await gapTerbuka(r.body.id);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, "TANPA_HARGA_PEROLEHAN");
  const v = await testPrisma.finStockMovementValuation.findFirst({ where: { movementId: r.body.id } });
  assert.equal(v.status, "TANPA_HARGA");
  assert.equal(v.value, null);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("/inventory/movements/issue|return|waste: masing-masing dibukukan (beban pokok / susut), idempoten terhadap posting ulang", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-LEPAS-K5", unit: "PCS" });
  await terima(m.id, 20, 10_000);
  const iss = await w.g.post("/api/inventory/movements/issue", { materialId: m.id, unitId: w.unit.id, qty: 4 });
  const ret = await w.g.post("/api/inventory/movements/return", { materialId: m.id, unitId: w.unit.id, qty: 1 });
  const wst = await w.g.post("/api/inventory/movements/waste", { materialId: m.id, unitId: w.unit.id, qty: 2, reason: "salah potong" });
  for (const r of [iss, ret, wst]) assert.equal(r.status, 201, JSON.stringify(r.body));
  const eI = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${iss.body.id}`);
  const eR = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${ret.body.id}`);
  const eW = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${wst.body.id}`);
  assert.equal(nilai(eI, "BEBAN_POKOK_BAHAN", "debit"), 40_000);
  assert.equal(nilai(eR, "BEBAN_POKOK_BAHAN", "credit"), 10_000);
  assert.equal(nilai(eW, "BEBAN_SUSUT_BAHAN", "debit"), 20_000);
  const sebelum = await testPrisma.finJournalEntry.count();
  // posting ulang via retry gap tidak ada (tak ada gap) — panggil helper langsung untuk bukti idempoten
  const { bukukanNilaiPergerakanBaru } = await import("../../src/services/finance/posting/inventory.js");
  await testPrisma.$transaction((tx) => bukukanNilaiPergerakanBaru(tx, { id: iss.body.id, type: "ISSUE" }));
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum, "posting ulang tidak boleh menggandakan jurnal");
});

test("pergerakan HISTORIS tanpa jurnal TIDAK disentuh: pemakaian baru dan sinkronisasi massal tidak memberi harga/jurnal pada baris lama", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-HISTORIS-K5", unit: "KG", referenceUnitCost: 77_000 });
  await testPrisma.stockMovement.create({ data: { materialId: m.id, type: "RECEIPT", qty: 50, note: "stok awal lama" } });
  const lama = await testPrisma.stockMovement.create({
    data: { materialId: m.id, type: "ISSUE", qty: -3, unitId: w.unit.id, note: "pemakaian historis Agustus", createdAt: new Date("2026-08-31T05:00:00.000Z") },
  });
  await terima(m.id, 10, 60_000); // penerimaan berharga BARU (Okt)
  const baru = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 1 });
  assert.equal(baru.status, 201, JSON.stringify(baru.body));
  assert.ok(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${baru.body.id}`), "pemakaian baru dibukukan");
  const sync = await w.f.post("/api/finance/sync/pemakaian-bahan", {});
  assert.ok([200, 403].includes(sync.status), JSON.stringify(sync.body));
  assert.equal(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${lama.id}`), null, "baris historis tetap tanpa jurnal");
  assert.equal((await gapTerbuka(lama.id)).length, 0, "baris historis tidak diubah jadi gap/harga otomatis");
  assert.equal(await testPrisma.finStockMovementValuation.count({ where: { movementId: lama.id } }), 0);
});

test("cutover perpetual berlaku tetapi persediaan awal belum diposting: gap PERSEDIAAN_AWAL_BELUM_DIPOSTING, tidak ada jurnal (saldo tidak negatif)", async () => {
  const w = await dunia({ cutover: "2026-10-01" });
  const m = await createTestMaterial({ code: "BHN-CUTOVER-K5", unit: "KG" });
  await terima(m.id, 10, 40_000);
  const r = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 1 });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${r.body.id}`), null);
  const gaps = await gapTerbuka(r.body.id);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].reason, "PERSEDIAAN_AWAL_BELUM_DIPOSTING");
});
