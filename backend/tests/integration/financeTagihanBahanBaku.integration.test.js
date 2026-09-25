// B3.3 — Tagihan Supplier: jenis tagihan menentukan akun, dan persediaan tidak boleh terjurnal dua kali.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postGoodsReceiptValue } from "../../src/services/finance/posting/supplier.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const a = makeClient(server.baseUrl, admin.token);
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-SKY", name: "PT Sky Foam", aliases: ["Skyfoam"] } });
  const kat = async (code) => testPrisma.finExpenseCategory.findUnique({ where: { code } });
  const katBeli = async (code) => testPrisma.finPurchaseCategory.findUnique({ where: { code } });
  return { bank, admin, a, sup, kat, katBeli };
}

async function barisJurnalTagihan(billId) {
  const e = await testPrisma.finJournalEntry.findFirst({ where: { source: "TAGIHAN_SUPPLIER", sourceId: billId, status: "POSTED" }, include: { lines: { include: { account: true } } } });
  return e?.lines.map((l) => ({ akun: l.account.code, d: toMoney(l.debit).toNumber(), k: toMoney(l.credit).toNumber() })) || [];
}
async function saldo(code) {
  const a = await testPrisma.finAccount.findUnique({ where: { code } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0)).toNumber();
}
async function penerimaan(ctx, { harga = 50_000, qty = 10, supplier = "Skyfoam" } = {}) {
  const material = await createTestMaterial({ unit: "PCS" });
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: `GR-250926-${String(Math.floor(Math.random() * 90) + 10)}`, sourceType: "MANUAL", supplier, status: "COMPLETED" } });
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty, unitCost: harga, goodsReceiptId: gr.id } });
  await testPrisma.$transaction((tx) => postGoodsReceiptValue(tx, { goodsReceiptId: gr.id, userId: ctx.admin.user.id }));
  return gr;
}
const buat = (ctx, body) => ctx.a.post("/api/finance/bills", { supplierId: ctx.sup.id, billDate: "2026-09-20", description: "Uji", ...body });

test("Bahan baku TANPA penerimaan: Dr Persediaan 1-1400 / Cr Utang Usaha (bukan Overhead Produksi)", async () => {
  const ctx = await siapkan();
  const b = await buat(ctx, { amount: 5_000_000, billType: "BAHAN_BAKU", description: "Busa rebonded" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.jenisTagihan.kode, "BAHAN_BAKU");
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  assert.deepEqual(await barisJurnalTagihan(b.body.id), [{ akun: "1-1400", d: 5_000_000, k: 0 }, { akun: "2-1100", d: 0, k: 5_000_000 }]);
  assert.equal(await saldo("5-1300"), 0);
});

test("Bahan baku DENGAN penerimaan gudang: persediaan hanya sekali (GRNI dipakai), selisih harga ke 5-1950", async () => {
  const ctx = await siapkan();
  const gr = await penerimaan(ctx, { harga: 50_000, qty: 10 }); // Dr 1-1400 500.000 / Cr 2-1150 500.000
  const b = await buat(ctx, { amount: 520_000, billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  const baris = await barisJurnalTagihan(b.body.id);
  assert.ok(!baris.some((x) => x.akun === "1-1400"), "tagihan TIDAK mendebet Persediaan lagi");
  assert.deepEqual(baris.find((x) => x.akun === "2-1150"), { akun: "2-1150", d: 500_000, k: 0 });
  assert.deepEqual(baris.find((x) => x.akun === "5-1950"), { akun: "5-1950", d: 20_000, k: 0 });
  assert.equal(await saldo("1-1400"), 500_000, "persediaan tercatat sekali");
  assert.equal(await saldo("2-1150"), 0, "GRNI tertutup");
});

test("Anti double-counting: satu penerimaan tidak bisa ditagih dua kali; bahan baku tanpa penerimaan ditolak bila supplier punya penerimaan belum ditagih", async () => {
  const ctx = await siapkan();
  const gr = await penerimaan(ctx);
  // tagihan bahan baku tanpa tautan padahal ada penerimaan Skyfoam yang belum ditagih → ditolak saat approve
  const tanpa = await buat(ctx, { amount: 500_000, billType: "BAHAN_BAKU" });
  const r1 = await ctx.a.post(`/api/finance/bills/${tanpa.body.id}/approve`, {});
  assert.equal(r1.status, 409); assert.match(r1.body.error, /belum ditagih/); assert.equal(r1.body.code, "ADA_PENERIMAAN_BELUM_DITAGIH");
  const b1 = await buat(ctx, { amount: 500_000, billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  assert.equal((await ctx.a.post(`/api/finance/bills/${b1.body.id}/approve`, {})).status, 200);
  const b2 = await buat(ctx, { amount: 500_000, billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  const r2 = await ctx.a.post(`/api/finance/bills/${b2.body.id}/approve`, {});
  assert.equal(r2.status, 409); assert.equal(r2.body.code, "PENERIMAAN_SUDAH_DITAGIH");
  assert.equal(await saldo("1-1400"), 500_000);
  // setelah penerimaan itu ditagih, tagihan bahan baku tanpa tautan tidak lagi terblokir
  assert.equal((await ctx.a.post(`/api/finance/bills/${tanpa.body.id}/approve`, {})).status, 200);
});

test("Penerimaan yang belum dibukukan ke Persediaan tidak bisa ditagih (GRNI tidak boleh terbalik)", async () => {
  const ctx = await siapkan();
  const material = await createTestMaterial({ unit: "PCS" });
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-250926-77", sourceType: "MANUAL", supplier: "Lain", status: "COMPLETED" } });
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 2, unitCost: 1000, goodsReceiptId: gr.id } });
  const b = await buat(ctx, { amount: 2000, billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  const r = await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {});
  assert.equal(r.status, 409); assert.equal(r.body.code, "PENERIMAAN_BELUM_DIBUKUKAN");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER" } }), 0);
});

test("Jasa/Operasional → akun beban; Biaya Produksi Non-Stok → beban pokok; kategori bahan baku manual ditolak", async () => {
  const ctx = await siapkan();
  const jasa = await buat(ctx, { amount: 300_000, billType: "JASA_OPERASIONAL", expenseCategoryId: (await ctx.kat("PERLENGKAPAN")).id });
  assert.equal((await ctx.a.post(`/api/finance/bills/${jasa.body.id}/approve`, {})).status, 200);
  assert.equal((await barisJurnalTagihan(jasa.body.id))[0].akun, "6-1600");
  const prod = await buat(ctx, { amount: 400_000, billType: "BIAYA_PRODUKSI_NON_STOK", expenseCategoryId: (await ctx.kat("OVERHEAD_PRODUKSI")).id });
  assert.equal((await ctx.a.post(`/api/finance/bills/${prod.body.id}/approve`, {})).status, 200);
  assert.equal((await barisJurnalTagihan(prod.body.id))[0].akun, "5-1300");
  // salah pasangan jenis/kategori
  assert.equal((await buat(ctx, { amount: 1, billType: "JASA_OPERASIONAL", expenseCategoryId: (await ctx.kat("OVERHEAD_PRODUKSI")).id })).status, 422);
  assert.equal((await buat(ctx, { amount: 1, billType: "BIAYA_PRODUKSI_NON_STOK", expenseCategoryId: (await ctx.kat("PERLENGKAPAN")).id })).status, 422);
  const bb = await ctx.kat("BAHAN_BAKU_MANUAL");
  if (bb) {
    const r = await buat(ctx, { amount: 1, billType: "BIAYA_PRODUKSI_NON_STOK", expenseCategoryId: bb.id });
    assert.equal(r.status, bb.active ? 422 : 404);
  }
});

test("Mesin/Peralatan → aset 1-2200; Uang Muka Pembelian → 1-1500; kategori yang tidak cocok ditolak", async () => {
  const ctx = await siapkan();
  const mesin = await buat(ctx, { amount: 12_000_000, billType: "MESIN_PERALATAN", purchaseCategoryId: (await ctx.katBeli("ASET_PERALATAN")).id });
  assert.equal(mesin.status, 201, JSON.stringify(mesin.body));
  assert.equal((await ctx.a.post(`/api/finance/bills/${mesin.body.id}/approve`, {})).status, 200);
  assert.equal((await barisJurnalTagihan(mesin.body.id))[0].akun, "1-2200");
  const dp = await buat(ctx, { amount: 2_000_000, billType: "UANG_MUKA_PEMBELIAN", purchaseCategoryId: (await ctx.katBeli("UANG_MUKA_PEMBELIAN")).id });
  assert.equal((await ctx.a.post(`/api/finance/bills/${dp.body.id}/approve`, {})).status, 200);
  assert.equal((await barisJurnalTagihan(dp.body.id))[0].akun, "1-1500");
  assert.equal((await buat(ctx, { amount: 1, billType: "MESIN_PERALATAN", purchaseCategoryId: (await ctx.katBeli("UANG_MUKA_PEMBELIAN")).id })).status, 422);
});

test("Tagihan lama tanpa jenis: dibuat tetap boleh (klien lama), tetapi TIDAK bisa disetujui sebelum jenis dipilih; memilih jenis lewat Edit", async () => {
  const ctx = await siapkan();
  const lama = await buat(ctx, { amount: 700_000, expenseCategoryId: (await ctx.kat("OVERHEAD_PRODUKSI")).id });
  assert.equal(lama.status, 201);
  assert.equal(lama.body.jenisTagihan.lama, true);
  const r = await ctx.a.post(`/api/finance/bills/${lama.body.id}/approve`, {});
  assert.equal(r.status, 422); assert.equal(r.body.code, "JENIS_TAGIHAN_WAJIB");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER" } }), 0);
  const e = await ctx.a.patch(`/api/finance/bills/${lama.body.id}`, { reason: "busa = bahan baku", billType: "BAHAN_BAKU", expenseCategoryId: null });
  assert.equal(e.status, 200, JSON.stringify(e.body));
  assert.equal((await ctx.a.post(`/api/finance/bills/${lama.body.id}/approve`, {})).status, 200);
  assert.equal((await barisJurnalTagihan(lama.body.id))[0].akun, "1-1400");
});

test("Pembayaran & pembatalan tagihan bahan baku: utang lunas lewat kas; batal membalik jurnal persediaan (diblokir bila ada pembayaran)", async () => {
  const ctx = await siapkan();
  const b = await buat(ctx, { amount: 1_000_000, billType: "BAHAN_BAKU" });
  await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {});
  const bayar = await ctx.a.post("/api/finance/supplier-payments", { supplierId: ctx.sup.id, date: "2026-09-21", cashAccountId: ctx.bank.id, allocations: [{ billId: b.body.id, amount: 1_000_000 }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  assert.equal(await saldo("2-1100"), 0);
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/cancel`, { reason: "salah" })).status, 409);
  assert.equal((await ctx.a.post(`/api/finance/supplier-payments/${bayar.body.id}/cancel`, { reason: "salah" })).status, 200);
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/cancel`, { reason: "salah supplier" })).status, 200);
  assert.equal(await saldo("1-1400"), 0, "persediaan dibalik lewat reversal");
});

test("Faktur supplier yang sama tidak bisa ditagih dua kali", async () => {
  const ctx = await siapkan();
  const k = (await ctx.kat("PERLENGKAPAN")).id;
  const b1 = await buat(ctx, { amount: 100_000, billType: "JASA_OPERASIONAL", expenseCategoryId: k, supplierRef: "INV-77" });
  assert.equal((await ctx.a.post(`/api/finance/bills/${b1.body.id}/approve`, {})).status, 200);
  const b2 = await buat(ctx, { amount: 100_000, billType: "JASA_OPERASIONAL", expenseCategoryId: k, supplierRef: "inv-77" });
  const r = await ctx.a.post(`/api/finance/bills/${b2.body.id}/approve`, {});
  assert.equal(r.status, 409); assert.equal(r.body.code, "FAKTUR_GANDA");
});
