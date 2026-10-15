// Uji terarah metode penyesuaian stok hasil rekonsiliasi (Okt 2026) — Postgres SUNGGUHAN terisolasi, kode route ASLI.
// Tidak menyentuh production. Yang dibuktikan: idempotensi, jejak actor, larangan saldo negatif, tidak ada double posting,
// dan jebakan "QTY SEP bukan saldo hari ini" (Stock Count dengan countedQty = fisik Sep menghapus penerimaan Oktober).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestMaterial, createTestUser, seedBalance } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { jalankanRekon } from "./setup/rekonStokRunner.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await server.close(); await truncateAll(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

const saldo = async (materialId) => {
  const [{ s }] = await testPrisma.$queryRaw`SELECT COALESCE(SUM(qty),0)::float AS s FROM stock_movements WHERE material_id = ${materialId}::uuid`;
  return s;
};
const movs = (materialId, where = {}) => testPrisma.stockMovement.findMany({ where: { materialId, ...where }, orderBy: { createdAt: "asc" } });
async function aktor() {
  const gudang = await createTestUser({ roles: ["WAREHOUSE"] });
  const admin = await createTestUser({ roles: ["OWNER"] }); // penyetuju (INVENTORY_ADJUSTMENT_APPROVE); nama variabel dipertahankan
  return { gudang, admin, cGudang: makeClient(server.baseUrl, gudang.token), cAdmin: makeClient(server.baseUrl, admin.token) };
}
async function ajukanSetujuPost(c1, c2, materialId, delta, reason = "REKON uji") {
  const a = await c1.post("/api/inventory/adjustments", { materialId, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: delta, reason });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const id = a.body.id;
  assert.equal((await c2.patch(`/api/inventory/adjustments/${id}`, { status: "WAITING_APPROVAL" })).status, 200);
  assert.equal((await c2.patch(`/api/inventory/adjustments/${id}`, { status: "APPROVED" })).status, 200);
  return id;
}

test("1. Jalur Adjustment resmi: satu baris ADJUSTMENT, actor tercatat di request, movement, dan activity log; tidak ada jurnal", async () => {
  const { gudang, admin, cGudang, cAdmin } = await aktor();
  const m = await createTestMaterial({ unit: "KG" });
  await seedBalance(m.id, 27);
  const jurnalSebelum = await testPrisma.finJournalEntry.count(); const gapSebelum = await testPrisma.finPostingGap.count();

  const id = await ajukanSetujuPost(cGudang, cAdmin, m.id, -7, "fisik 20 vs ledger 27");
  const post = await cAdmin.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(post.status, 200, JSON.stringify(post.body));

  const rows = await movs(m.id, { type: "ADJUSTMENT" });
  assert.equal(rows.length, 1, "tepat satu ADJUSTMENT");
  assert.equal(Number(rows[0].qty), -7);
  assert.equal(rows[0].stockAdjustmentRequestId, id, "movement bertaut ke dokumen");
  assert.equal(rows[0].createdById, admin.user.id, "createdBy = pemosting");
  assert.equal(await saldo(m.id), 20);

  const req = await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } });
  assert.equal(req.requestedById, gudang.user.id); assert.equal(req.approvedById, admin.user.id); assert.equal(req.postedById, admin.user.id);
  assert.equal(req.status, "POSTED"); assert.equal(req.beforeQty, 27);

  const ev = await testPrisma.activityEvent.findMany({ where: { entityId: id } });
  const tipe = ev.map((e) => e.eventType).sort();
  assert.ok(tipe.includes("DOCUMENT_APPROVED") && tipe.includes("DOCUMENT_POSTED"), "approve & post tercatat: " + tipe);
  assert.ok(ev.every((e) => e.actorId === admin.user.id), "actor activity log = penyetuju/pemosting");

  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "tidak ada jurnal baru");
  assert.equal(await testPrisma.finPostingGap.count(), gapSebelum, "tidak ada posting gap baru");
});

test("2. Idempotensi server: post kedua (berurutan DAN serentak) ditolak — satu movement saja", async () => {
  const { cGudang, cAdmin } = await aktor();
  const m = await createTestMaterial();
  await seedBalance(m.id, 10);
  const id = await ajukanSetujuPost(cGudang, cAdmin, m.id, 5);

  const [r1, r2] = await Promise.all([cAdmin.post(`/api/inventory/adjustments/${id}/post`, {}), cAdmin.post(`/api/inventory/adjustments/${id}/post`, {})]);
  const kode = [r1.status, r2.status].sort();
  assert.deepEqual(kode, [200, 400], "satu sukses, satu ditolak: " + JSON.stringify([r1.body, r2.body]));
  const r3 = await cAdmin.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(r3.status, 400);
  assert.equal((await movs(m.id, { type: "ADJUSTMENT" })).length, 1);
  assert.equal(await saldo(m.id), 15);
});

test("3. Saldo negatif ditolak: request disetujui tetapi post gagal, tidak ada jejak ledger, status tetap APPROVED", async () => {
  const { cGudang, cAdmin } = await aktor();
  const m = await createTestMaterial();
  await seedBalance(m.id, 10);
  const id = await ajukanSetujuPost(cGudang, cAdmin, m.id, -15);
  const p = await cAdmin.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(p.status, 400); assert.match(p.body.error, /tidak cukup/);
  assert.equal((await movs(m.id, { type: "ADJUSTMENT" })).length, 0);
  assert.equal(await saldo(m.id), 10);
  assert.equal((await testPrisma.stockAdjustmentRequest.findUnique({ where: { id } })).status, "APPROVED");
});

test("4. beforeQty basi tidak lolos: saldo berubah antara request dan post → dicek ulang terhadap saldo BERJALAN", async () => {
  const { cGudang, cAdmin } = await aktor();
  const m = await createTestMaterial();
  await seedBalance(m.id, 10);
  const id = await ajukanSetujuPost(cGudang, cAdmin, m.id, -8); // beforeQty 10
  await seedBalance(m.id, -5); // pemakaian lain masuk ledger → saldo 5
  const p = await cAdmin.post(`/api/inventory/adjustments/${id}/post`, {});
  assert.equal(p.status, 400);
  assert.equal(await saldo(m.id), 5, "saldo tidak berubah");
});

test("5. Stock Count resmi: satu ADJUSTMENT per selisih, complete kedua ditolak, countedQty negatif ditolak dan seluruh transaksi rollback", async () => {
  const { admin, cGudang, cAdmin } = await aktor();
  const a = await createTestMaterial(); const b = await createTestMaterial();
  await seedBalance(a.id, 27); await seedBalance(b.id, 5);
  const c = await cGudang.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", blindCount: false, lines: [{ materialId: a.id }, { materialId: b.id }] });
  assert.equal(c.status, 201, JSON.stringify(c.body)); const cid = c.body.id;
  assert.equal((await cGudang.post(`/api/inventory/stock-counts/${cid}/start`, {})).status, 200);
  const lines = (await cGudang.get(`/api/inventory/stock-counts/${cid}`)).body.lines;
  const la = lines.find((l) => l.materialId === a.id), lb = lines.find((l) => l.materialId === b.id);
  assert.equal(la.systemQty, 27);
  await cGudang.patch(`/api/inventory/stock-counts/${cid}/lines/${la.id}`, { countedQty: 20, reason: "fisik Sep" });
  await cGudang.patch(`/api/inventory/stock-counts/${cid}/lines/${lb.id}`, { countedQty: -1, reason: "salah ketik" });
  assert.equal((await cGudang.post(`/api/inventory/stock-counts/${cid}/submit`, {})).status, 200);
  const gagal = await cAdmin.post(`/api/inventory/stock-counts/${cid}/complete`, {});
  assert.equal(gagal.status, 400, "countedQty negatif → saldo negatif → tolak");
  assert.equal((await movs(a.id, { type: "ADJUSTMENT" })).length, 0, "rollback penuh: baris A yang valid pun tidak tertulis");
  assert.equal((await testPrisma.stockCount.findUnique({ where: { id: cid } })).status, "WAITING_REVIEW");

  await cGudang.patch(`/api/inventory/stock-counts/${cid}/lines/${lb.id}`, { countedQty: 5 });
  const ok = await cAdmin.post(`/api/inventory/stock-counts/${cid}/complete`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const kedua = await cAdmin.post(`/api/inventory/stock-counts/${cid}/complete`, {});
  assert.equal(kedua.status, 400);
  const adj = await movs(a.id, { type: "ADJUSTMENT" });
  assert.equal(adj.length, 1); assert.equal(Number(adj[0].qty), -7); assert.equal(adj[0].stockCountId, cid); assert.equal(adj[0].createdById, admin.user.id, "actor = penyetuju yang menyelesaikan, bukan pembuat hitungan");
  assert.equal((await movs(b.id, { type: "ADJUSTMENT" })).length, 0, "tanpa selisih → tanpa movement");
  assert.equal(await saldo(a.id), 20);
});

test("6. JEBAKAN: Stock Count dengan fisik Sep sebagai countedQty MENGHAPUS penerimaan Okt; delta terhadap ledger pada tgl hitung tidak", async () => {
  const { cGudang, cAdmin } = await aktor();
  const salah = await createTestMaterial(); const benar = await createTestMaterial();
  for (const m of [salah, benar]) { await seedBalance(m.id, 5); await seedBalance(m.id, 100); } // 5 sebelum tgl hitung + RECEIPT 100 pasca tgl hitung
  const FISIK_SEP = 5;

  // cara salah: fisik Sep dibandingkan dengan saldo HARI INI (105) → ADJUSTMENT −100
  const c = await cGudang.post("/api/inventory/stock-counts", { countType: "CYCLE_COUNT", countMethod: "BY_ITEM", lines: [{ materialId: salah.id }] });
  const cid = c.body.id;
  await cGudang.post(`/api/inventory/stock-counts/${cid}/start`, {});
  const ln = (await cGudang.get(`/api/inventory/stock-counts/${cid}`)).body.lines[0];
  await cGudang.patch(`/api/inventory/stock-counts/${cid}/lines/${ln.id}`, { countedQty: FISIK_SEP, reason: "fisik Sep" });
  await cGudang.post(`/api/inventory/stock-counts/${cid}/submit`, {});
  await cAdmin.post(`/api/inventory/stock-counts/${cid}/complete`, {});
  assert.equal(await saldo(salah.id), 5, "penerimaan 100 hilang dari ledger — INILAH yang tidak boleh terjadi");

  // cara benar: delta = fisik − ledger pada tgl hitung (5) = 0 → tidak ada request sama sekali
  const ledgerT = 105 - 100; const delta = FISIK_SEP - ledgerT;
  assert.equal(delta, 0);
  const hasil = await jalankanRekon({ plan: [{ key: `REKON-STOK-2026-10:${benar.code}`, materialId: benar.id, delta, reason: "tidak ada selisih" }], pemohon: cGudang, penyetuju: cAdmin, apply: true });
  assert.equal(hasil.dibuat.length, 0); assert.equal(hasil.dilewati.length, 1);
  assert.equal(await saldo(benar.id), 105, "penerimaan Okt tetap utuh");
});

test("7. Runner: dry-run tidak menulis; apply sekali; ulang → semua dilewati (tidak ada request/movement ganda)", async () => {
  const { cGudang, cAdmin } = await aktor();
  const a = await createTestMaterial(); const b = await createTestMaterial(); const neg = await createTestMaterial();
  await seedBalance(a.id, 27); await seedBalance(b.id, -3); await seedBalance(neg.id, 4);
  const plan = [
    { key: `REKON-STOK-2026-10:${a.code}`, materialId: a.id, delta: -7, reason: "fisik 20" },
    { key: `REKON-STOK-2026-10:${b.code}`, materialId: b.id, delta: 43, reason: "ledger negatif → fisik 40" },
    { key: `REKON-STOK-2026-10:${neg.code}`, materialId: neg.id, delta: -9, reason: "akan menolak" },
  ];
  const kering = await jalankanRekon({ plan, pemohon: cGudang, penyetuju: cAdmin, apply: false });
  assert.equal(kering.dryRun, true); assert.equal(kering.dibuat.length, 3);
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 0, "dry-run tidak membuat apa pun");
  assert.equal(await testPrisma.stockMovement.count({ where: { type: "ADJUSTMENT" } }), 0 + 1 /* seed b bertipe ADJUSTMENT (qty negatif) */);

  const satu = await jalankanRekon({ plan, pemohon: cGudang, penyetuju: cAdmin, apply: true });
  assert.equal(satu.diposting.length, 2); assert.equal(satu.ditolak.length, 1); assert.match(satu.ditolak[0].alasan, /tidak cukup/);
  assert.equal(await saldo(a.id), 20); assert.equal(await saldo(b.id), 40); assert.equal(await saldo(neg.id), 4);
  const movSetelahSatu = await testPrisma.stockMovement.count();

  const dua = await jalankanRekon({ plan, pemohon: cGudang, penyetuju: cAdmin, apply: true });
  assert.equal(dua.diposting.length, 0, "run kedua tidak memposting apa pun");
  assert.equal(dua.dilewati.length, 3, "dua sudah POSTED, satu masih APPROVED (tersangkut) → tetap dilewati, bukan dibuat ganda");
  assert.equal(await testPrisma.stockMovement.count(), movSetelahSatu, "jumlah movement tidak berubah");
  assert.equal(await testPrisma.stockAdjustmentRequest.count(), 3, "tidak ada request ganda");
});

test("8. Rencana dihitung ulang setelah apply menghasilkan nol selisih (tidak ada double posting pada run berikutnya)", async () => {
  const { cGudang, cAdmin } = await aktor();
  const m = await createTestMaterial();
  await seedBalance(m.id, 27);
  const FISIK = 20;
  const rencana = async () => { const led = await saldo(m.id); return FISIK - led; };
  const d1 = await rencana(); assert.equal(d1, -7);
  await jalankanRekon({ plan: [{ key: `REKON-STOK-2026-10:${m.code}`, materialId: m.id, delta: d1 }], pemohon: cGudang, penyetuju: cAdmin, apply: true });
  assert.equal(await rencana(), 0);
  assert.equal((await movs(m.id, { type: "ADJUSTMENT" })).length, 1);
});

test("9. Kontrol akses: SALES tidak boleh membuat adjustment; pemohon TIDAK boleh menyetujui sendiri (setelah pemisahan tugas)", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  const cSales = makeClient(server.baseUrl, sales.token);
  const m = await createTestMaterial();
  await seedBalance(m.id, 10);
  const tolak = await cSales.post("/api/inventory/adjustments", { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -1, reason: "x" });
  assert.equal(tolak.status, 403);

  const { cGudang } = await aktor();
  const a = await cGudang.post("/api/inventory/adjustments", { materialId: m.id, adjustmentType: "COUNT_DIFFERENCE", adjustmentQty: -2, reason: "pemohon = penyetuju" });
  assert.equal(a.status, 201);
  await cGudang.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "WAITING_APPROVAL" });
  const self = await cGudang.patch(`/api/inventory/adjustments/${a.body.id}`, { status: "APPROVED" });
  assert.equal(self.status, 403, "pemohon tanpa peran penyetuju ditolak");
});
