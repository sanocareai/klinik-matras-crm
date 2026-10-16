// K5 — PINTU PEMAKAIAN BAHAN → HARGA PERSEDIAAN → HPP.
// Pintu RESMI yang dibukukan: Material Issue formal (per dokumen), POST /units/:id/materials, POST /inventory/movements/issue, penerimaan Retur Produksi. Jalur cepat receipt/return/waste
// DITUTUP PERMANEN (410, rilis Opname) — tidak menulis stok/jurnal. Yang dikunci: (1) satu pergerakan dibukukan TEPAT SEKALI (tanpa jurnal ganda lintas pintu, replay, paralel);
// (2) tanpa harga → gap TANPA_HARGA_PEROLEHAN, bukan Rp0; (3) harga referensi Excel tidak dipakai; (4) pergerakan historis tidak disentuh; (5) cutover tanpa persediaan awal → gap, bukan jurnal negatif;
// (6) retur membalik ke akun benar; waste memakai Beban Susut; (7) stok–jurnal–HPP per unit konsisten.
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

test("/inventory/movements/issue dibukukan; /movements/return, /waste, /receipt DITUTUP 410 tanpa menulis stok/jurnal/gap", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-LEPAS-K5", unit: "PCS" });
  await terima(m.id, 20, 10_000);
  const iss = await w.g.post("/api/inventory/movements/issue", { materialId: m.id, unitId: w.unit.id, qty: 4 });
  assert.equal(iss.status, 201, JSON.stringify(iss.body));
  const eI = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${iss.body.id}`);
  assert.equal(nilai(eI, "BEBAN_POKOK_BAHAN", "debit"), 40_000);
  const sebelum = [await testPrisma.stockMovement.count(), await testPrisma.finJournalEntry.count(), await testPrisma.finPostingGap.count()];
  for (const [jalur, body] of [["return", { materialId: m.id, unitId: w.unit.id, qty: 1 }], ["waste", { materialId: m.id, unitId: w.unit.id, qty: 2, reason: "salah potong" }], ["receipt", { materialId: m.id, qty: 5, unitCost: 1 }]]) {
    const r = await w.g.post(`/api/inventory/movements/${jalur}`, body);
    assert.equal(r.status, 410, `${jalur}: ${JSON.stringify(r.body)}`);
    assert.equal(r.body.code, "JALUR_CEPAT_DITUTUP");
  }
  assert.deepEqual([await testPrisma.stockMovement.count(), await testPrisma.finJournalEntry.count(), await testPrisma.finPostingGap.count()], sebelum, "jalur yang ditutup tidak menulis apa pun");
  const { bukukanNilaiPergerakanBaru } = await import("../../src/services/finance/posting/inventory.js");
  await testPrisma.$transaction((tx) => bukukanNilaiPergerakanBaru(tx, { id: iss.body.id, type: "ISSUE" }));
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum[1], "posting ulang tidak boleh menggandakan jurnal");
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

test("RETUR bertaut unit: akun benar (Cr Beban Pokok / Dr Persediaan), dinilai rata-rata tertimbang SAAT retur dan DIBEKUKAN; biaya unit = Σ jurnal unit = Σ nilai beku", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-RETUR-K5", unit: "KG" });
  await terima(m.id, 10, 40_000);
  const pakai = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 4 }); // 4 × 40.000 = 160.000
  assert.equal(pakai.status, 201, JSON.stringify(pakai.body));
  await terima(m.id, 10, 60_000); // rata-rata tertimbang kini 50.000
  const balik = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: -1 });
  assert.equal(balik.status, 201, JSON.stringify(balik.body));
  const e = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${balik.body.id}`);
  // KEPUTUSAN TERBUKA (dicatat di laporan K5): metode yang berlaku sejak jejak biaya bahan (8 Okt) menilai retur pada rata-rata tertimbang saat retur,
  // bukan pada biaya keluar semula (40.000). Tes ini mengunci perilaku itu + konsistensi, bukan menyatakannya sebagai metode final.
  assert.equal(nilai(e, "BEBAN_POKOK_BAHAN", "credit"), 50_000);
  assert.equal(nilai(e, "PERSEDIAAN_BAHAN", "debit"), 50_000);
  const v = await testPrisma.finStockMovementValuation.findFirst({ where: { movementId: balik.body.id } });
  assert.equal(Number(v.value), -50_000, "nilai beku retur = nilai jurnal");
  const baris = await testPrisma.finJournalLine.findMany({ where: { unitId: w.unit.id, account: { systemKey: "BEBAN_POKOK_BAHAN" } }, select: { debit: true, credit: true } });
  const bebanUnit = baris.reduce((a2, l) => a2 + Number(l.debit) - Number(l.credit), 0);
  assert.equal(bebanUnit, 110_000);
  const jejak = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(jejak.ringkasan.nilaiBersih, bebanUnit, "jejak biaya unit = jurnal HPP unit");
  const beku = await testPrisma.finStockMovementValuation.findMany({ where: { unitId: w.unit.id } });
  assert.equal(beku.reduce((a2, r) => a2 + Number(r.value), 0), bebanUnit);
});

test("PARALEL & REPLAY: enam pemakaian bersamaan = enam jurnal tepat sekali; posting ulang/retry/sinkronisasi tidak menggandakan; saldo stok = Σ ledger; Σ jurnal = Σ nilai beku", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-PARALEL-K5", unit: "KG" });
  await terima(m.id, 100, 12_000);
  const hasil = await Promise.all(Array.from({ length: 6 }, (_, i) => w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: i + 1 })));
  for (const r of hasil) assert.equal(r.status, 201, JSON.stringify(r.body));
  const ids = hasil.map((r) => r.body.id);
  const entri = await testPrisma.finJournalEntry.findMany({ where: { idempotencyKey: { in: ids.map((id) => `PEMAKAIAN_BAHAN_MOVEMENT:${id}`) } }, include: { lines: true } });
  assert.equal(entri.length, 6, "satu jurnal per pergerakan, tidak kurang tidak lebih");
  const total = entri.reduce((a, e) => a + e.lines.filter((l) => Number(l.debit) > 0 && l.unitId === w.unit.id).reduce((x, l) => x + Number(l.debit), 0), 0);
  assert.equal(total, (1 + 2 + 3 + 4 + 5 + 6) * 12_000);
  const beku = await testPrisma.finStockMovementValuation.findMany({ where: { movementId: { in: ids } } });
  assert.equal(beku.length, 6, "satu nilai beku per pergerakan");
  assert.equal(beku.reduce((a, r) => a + Number(r.value), 0), total);
  const saldo = await testPrisma.stockMovement.aggregate({ where: { materialId: m.id }, _sum: { qty: true } });
  assert.equal(Number(saldo._sum.qty), 100 - 21);
  // replay: helper dipanggil ulang + sinkronisasi massal + semua jurnal seimbang
  const { bukukanNilaiPergerakanBaru } = await import("../../src/services/finance/posting/inventory.js");
  for (const id of ids) await testPrisma.$transaction((tx) => bukukanNilaiPergerakanBaru(tx, { id, type: "ISSUE" }));
  await w.f.post("/api/finance/sync/pemakaian-bahan", {});
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMAKAIAN_BAHAN" } }), 6);
  const tak = await testPrisma.$queryRaw`select count(*)::int n from (select entry_id from fin_journal_lines group by entry_id having sum(debit) <> sum(credit)) x`;
  assert.equal(tak[0].n, 0, "semua jurnal seimbang");
});

test("WASTE (jalur dokumen, mis. Barang Rusak): bila dibukukan lewat jalur nilai memakai akun Beban Susut (bukan Beban Pokok) dan tidak masuk biaya persediaan unit; tanpa unit tetap dijurnal", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-WASTE-K5", unit: "KG" });
  await terima(m.id, 10, 20_000);
  const { postStockMovement } = await import("../../src/services/inventoryLedger.js");
  const { bukukanNilaiPergerakanBaru } = await import("../../src/services/finance/posting/inventory.js");
  const tulis = (unitId, qty) => testPrisma.$transaction(async (tx) => {
    const mv = await postStockMovement(tx, { materialId: m.id, type: "WASTE", qty: -qty, unitId, reason: "uji", createdById: null });
    await bukukanNilaiPergerakanBaru(tx, mv, { userId: null });
    return mv;
  });
  const a1 = await tulis(w.unit.id, 1); const b1 = await tulis(null, 2);
  const ea = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${a1.id}`); const eb = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${b1.id}`);
  assert.equal(nilai(ea, "BEBAN_SUSUT_BAHAN", "debit"), 20_000); assert.equal(nilai(ea, "BEBAN_POKOK_BAHAN", "debit"), 0);
  assert.equal(nilai(eb, "BEBAN_SUSUT_BAHAN", "debit"), 40_000);
  const jejak = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(jejak.ringkasan.nilaiBersih ?? 0, 0, "waste tidak masuk biaya persediaan unit");
  assert.equal(jejak.ringkasan.totalWaste, 20_000);
});

// ── Pintu RESMI lain: Material Issue formal dan penerimaan Retur Produksi — satu pergerakan dibukukan TEPAT SEKALI ──
async function issueFormal(w, materialId, qty) {
  const c = await w.g.post("/api/inventory/material-issues", { sourceType: "PRODUCTION_WORK_ORDER", unitId: w.unit.id, lines: [{ materialId, requestedQty: qty }] });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  for (const st of ["WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"]) assert.equal((await w.g.patch(`/api/inventory/material-issues/${c.body.id}`, { status: st })).status, 200);
  const r = await w.g.post(`/api/inventory/material-issues/${c.body.id}/issue`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return c.body;
}

test("MATERIAL ISSUE FORMAL + pintu lepas pada unit yang sama: jurnal per DOKUMEN untuk issue formal, per PERGERAKAN untuk pintu lepas — tidak ada pergerakan terjurnal dua kali; Σ jurnal unit = Σ nilai beku", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-FORMAL-K5", unit: "KG" });
  await terima(m.id, 50, 10_000);
  const doc = await issueFormal(w, m.id, 5); // 50.000 (jurnal per dokumen)
  const lepas = await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 2 }); // 20.000 (jurnal per pergerakan)
  assert.equal(lepas.status, 201, JSON.stringify(lepas.body));
  const mvDoc = await testPrisma.stockMovement.findMany({ where: { materialIssueId: doc.id } });
  assert.equal(mvDoc.length, 1);
  assert.ok(await jurnalDari(`PEMAKAIAN_BAHAN:${doc.id}`), "jurnal dokumen ada");
  assert.equal(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${mvDoc[0].id}`), null, "pergerakan berdokumen TIDAK dijurnal lagi per baris");
  assert.ok(await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${lepas.body.id}`), "pergerakan lepas dijurnal per baris");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMAKAIAN_BAHAN" } }), 2, "tepat dua jurnal untuk dua peristiwa");
  const baris = await testPrisma.finJournalLine.findMany({ where: { unitId: w.unit.id, account: { systemKey: "BEBAN_POKOK_BAHAN" } }, select: { debit: true, credit: true } });
  const beban = baris.reduce((x, l) => x + Number(l.debit) - Number(l.credit), 0);
  assert.equal(beban, 70_000);
  const beku = await testPrisma.finStockMovementValuation.findMany({ where: { unitId: w.unit.id } });
  assert.equal(beku.reduce((x, r) => x + Number(r.value), 0), beban, "Σ nilai beku = Σ jurnal HPP unit");
  const jejak = (await w.f.get(`/api/finance/biaya-bahan/unit/${w.unit.id}`)).body;
  assert.equal(jejak.ringkasan.nilaiBersih, beban, "jejak biaya unit = jurnal HPP unit");
  await w.f.post("/api/finance/sync/pemakaian-bahan", {});
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMAKAIAN_BAHAN" } }), 2, "sinkronisasi massal tidak menggandakan");
});

test("RETUR PRODUKSI (pintu resmi): penerimaan Gudang membukukan Cr Beban Pokok / Dr Persediaan tepat sekali; replay Idempotency-Key = tanpa jurnal kedua; paralel tidak ganda", async () => {
  const w = await dunia();
  const m = await createTestMaterial({ code: "BHN-RETPROD-K5", unit: "KG" });
  await terima(m.id, 10, 40_000);
  assert.equal((await w.p.post(`/api/units/${w.unit.id}/materials`, { materialId: m.id, qty: 3 })).status, 201);
  const { V2_FLAGS } = await import("../../src/services/v2FeatureFlags.js");
  for (const k of [V2_FLAGS.PRODUCTION_WRITER, V2_FLAGS.PRODUCTION_READER]) {
    await testPrisma.v2FeatureFlag.upsert({ where: { key: k }, create: { key: k, enabled: true, scope: "GLOBAL", config: { unitIds: [w.unit.id] }, reason: "k5" }, update: { enabled: true, config: { unitIds: [w.unit.id] } } });
  }
  const run = await testPrisma.productionRun.create({ data: { unitId: w.unit.id, kind: "RESTORATION", origin: "CUSTODY_PICKUP", status: "ACTIVE", currentPhase: "PROCESS", revision: 1 } });
  const ret = await testPrisma.productionMaterialReturn.create({ data: { runId: run.id, unitId: w.unit.id, materialId: m.id, qty: 1, status: "PENDING" } });
  const { receiveMaterialReturn } = await import("../../src/services/productionMaterialReturnService.js");
  const aktor = (await createTestUser({ roles: ["WAREHOUSE"] })).user.id;
  const arg = { returnId: ret.id, actorId: aktor, idempotencyKey: "k5-retur-prod-0001", expectedRevision: 1 };
  const hasil = await Promise.allSettled([receiveMaterialReturn(testPrisma, arg), receiveMaterialReturn(testPrisma, arg)]);
  assert.ok(hasil.some((h) => h.status === "fulfilled"), JSON.stringify(hasil.map((h) => h.reason?.message)));
  const mv = await testPrisma.stockMovement.findMany({ where: { type: "RETURN", unitId: w.unit.id } });
  assert.equal(mv.length, 1, "replay/paralel tidak membuat pergerakan kedua");
  const e = await jurnalDari(`PEMAKAIAN_BAHAN_MOVEMENT:${mv[0].id}`);
  assert.ok(e, "retur produksi dibukukan");
  assert.equal(nilai(e, "BEBAN_POKOK_BAHAN", "credit"), 40_000); assert.equal(nilai(e, "PERSEDIAAN_BAHAN", "debit"), 40_000);
  const ulang = await receiveMaterialReturn(testPrisma, arg);
  assert.equal(ulang.replayed, true);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: `PEMAKAIAN_BAHAN_MOVEMENT:${mv[0].id}` } }), 1, "replay tidak menggandakan jurnal");
});
