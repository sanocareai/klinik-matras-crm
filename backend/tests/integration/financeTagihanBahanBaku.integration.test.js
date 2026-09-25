// B3.3 — Tagihan Supplier: jenis tagihan menentukan akun, dan persediaan tidak boleh terjurnal dua kali.
// B3.5 — Metode persediaan: PERIODIK sebelum cutover (default 1 Okt 2026), PERPETUAL mulai cutover. Tanggal yang dinilai = TANGGAL TAGIHAN,
// jadi tes tidak bergantung pada tanggal hari ini.
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

test("PERIODIK sebelum cutover: bahan baku TANPA penerimaan → Dr 5-1100 / Cr Utang Usaha (bukan Persediaan, bukan Overhead 5-1300)", async () => {
  const ctx = await siapkan();
  const b = await buat(ctx, { amount: 5_000_000, billType: "BAHAN_BAKU", description: "Busa rebonded", billDate: "2026-09-09" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal(b.body.jenisTagihan.kode, "BAHAN_BAKU");
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  assert.deepEqual(await barisJurnalTagihan(b.body.id), [{ akun: "5-1100", d: 5_000_000, k: 0 }, { akun: "2-1100", d: 0, k: 5_000_000 }]);
  assert.equal(await saldo("5-1300"), 0);
  assert.equal(await saldo("1-1400"), 0, "periodik: persediaan akhir lewat stok opname, tidak dijurnal per tagihan");
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
  assert.equal((await barisJurnalTagihan(lama.body.id))[0].akun, "5-1100");
});

test("Pembayaran tidak mengubah klasifikasi bahan; pembatalan membalik jurnal 5-1100 dengan benar (diblokir bila ada pembayaran)", async () => {
  const ctx = await siapkan();
  const b = await buat(ctx, { amount: 1_000_000, billType: "BAHAN_BAKU" });
  await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {});
  assert.equal(await saldo("5-1100"), 1_000_000);
  const bayar = await ctx.a.post("/api/finance/supplier-payments", { supplierId: ctx.sup.id, date: "2026-09-21", cashAccountId: ctx.bank.id, allocations: [{ billId: b.body.id, amount: 1_000_000 }] });
  assert.equal(bayar.status, 201, JSON.stringify(bayar.body));
  assert.equal(await saldo("2-1100"), 0);
  assert.equal(await saldo("5-1100"), 1_000_000, "pembayaran hanya melunasi utang; beban bahan tidak berubah");
  assert.equal(await saldo("1-1400"), 0);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: b.body.id } })).status, "LUNAS");
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/cancel`, { reason: "salah" })).status, 409);
  assert.equal((await ctx.a.post(`/api/finance/supplier-payments/${bayar.body.id}/cancel`, { reason: "salah" })).status, 200);
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/cancel`, { reason: "salah supplier" })).status, 200);
  assert.equal(await saldo("5-1100"), 0, "beban bahan dibalik lewat reversal");
  assert.equal(await saldo("2-1100"), 0);
  const asli = await testPrisma.finJournalEntry.findFirst({ where: { source: "TAGIHAN_SUPPLIER", sourceId: b.body.id }, include: { lines: { include: { account: true } } } });
  assert.equal(asli.status, "REVERSED");
  const pembalik = await testPrisma.finJournalEntry.findFirst({ where: { reversalOfId: asli.id }, include: { lines: { include: { account: true } } } });
  assert.equal(pembalik.status, "POSTED", "satu jurnal pembalik yang POSTED");
  const ringkas = (e) => e.lines.map((l) => `${l.account.code}:${toMoney(l.debit).toNumber()}/${toMoney(l.credit).toNumber()}`).sort();
  assert.deepEqual(ringkas(pembalik), ["2-1100:1000000/0", "5-1100:0/1000000"], "pembalik = kebalikan persis jurnal asli (debit↔kredit)");
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

// ── B3.5 — metode persediaan periodik → perpetual ───────────────────────────────────────────────────────────────────────

const setCutover = (ctx, v) => ctx.a.patch("/api/finance/settings", { settings: { inventory_perpetual_cutover_date: v } });

test("B3.5 kebijakan bawaan: periodik sebelum 1 Okt 2026, perpetual mulai 1 Okt; endpoint menjelaskan metodenya", async () => {
  const ctx = await siapkan();
  const k = await ctx.a.get("/api/finance/inventory-method?tanggal=2026-09-30");
  assert.equal(k.status, 200, JSON.stringify(k.body));
  assert.equal(k.body.cutover, "2026-10-01"); assert.equal(k.body.sebelumCutover, "PERIODIK"); assert.equal(k.body.metode, "PERIODIK");
  assert.equal(k.body.catatanPeriodik, "Metode periodik — nilai persediaan akhir ditentukan melalui stok opname.");
  assert.equal((await ctx.a.get("/api/finance/inventory-method?tanggal=2026-10-01")).body.metode, "PERPETUAL");
});

test("B3.5 PERIODIK: tagihan 30 Sep 2026 (hari terakhir sebelum cutover) tanpa penerimaan diterima dan dijurnal ke 5-1100", async () => {
  const ctx = await siapkan();
  const b = await buat(ctx, { amount: 18_672_864, billType: "BAHAN_BAKU", billDate: "2026-09-30", description: "SJ Rebonded SKY D70 + Soft foam SKY" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  assert.deepEqual(await barisJurnalTagihan(b.body.id), [{ akun: "5-1100", d: 18_672_864, k: 0 }, { akun: "2-1100", d: 0, k: 18_672_864 }]);
});

test("B3.5 PERPETUAL: bahan baku TANPA penerimaan bertanggal ≥ cutover ditolak (buat, ubah tanggal, dan setuju); dengan penerimaan tetap sah lewat GRNI", async () => {
  const ctx = await siapkan();
  const ditolak = await buat(ctx, { amount: 1_000_000, billType: "BAHAN_BAKU", billDate: "2026-10-01" });
  assert.equal(ditolak.status, 422, JSON.stringify(ditolak.body));
  assert.equal(ditolak.body.code, "BAHAN_BAKU_TANPA_PENERIMAAN_PERPETUAL");
  assert.match(ditolak.body.error, /perpetual/); assert.match(ditolak.body.error, /Penerimaan Barang/);
  assert.equal(await testPrisma.finSupplierBill.count(), 0, "tidak ada tagihan yang tersimpan");

  // mengubah TANGGAL tagihan periodik ke ≥ cutover juga ditolak
  const ok = await buat(ctx, { amount: 1_000_000, billType: "BAHAN_BAKU", billDate: "2026-09-30" });
  assert.equal(ok.status, 201);
  const geser = await ctx.a.patch(`/api/finance/bills/${ok.body.id}`, { reason: "salah tanggal", billDate: "2026-10-02" });
  assert.equal(geser.status, 422); assert.equal(geser.body.code, "BAHAN_BAKU_TANPA_PENERIMAAN_PERPETUAL");

  // cutover dimajukan sebelum tagihan disetujui → persetujuan pun ditolak, tanpa jurnal
  assert.equal((await setCutover(ctx, "2026-09-01")).status, 200);
  const r = await ctx.a.post(`/api/finance/bills/${ok.body.id}/approve`, {});
  assert.equal(r.status, 422); assert.equal(r.body.code, "BAHAN_BAKU_TANPA_PENERIMAAN_PERPETUAL");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER" } }), 0);
  assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: ok.body.id } })).status, "MENUNGGU_APPROVAL");
});

test("B3.5 PERPETUAL + penerimaan Gudang: GRNI menutup persediaan (tidak digandakan) dan 5-1100 tidak tersentuh", async () => {
  const ctx = await siapkan();
  const gr = await penerimaan(ctx, { harga: 50_000, qty: 10 }); // Dr 1-1400 500.000 / Cr 2-1150 500.000
  assert.equal((await setCutover(ctx, "2026-09-01")).status, 200);
  const b = await buat(ctx, { amount: 500_000, billType: "BAHAN_BAKU", goodsReceiptId: gr.id, billDate: "2026-10-02" });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  assert.equal((await ctx.a.post(`/api/finance/bills/${b.body.id}/approve`, {})).status, 200);
  assert.deepEqual(await barisJurnalTagihan(b.body.id), [{ akun: "2-1150", d: 500_000, k: 0 }, { akun: "2-1100", d: 0, k: 500_000 }]);
  assert.equal(await saldo("1-1400"), 500_000, "persediaan hanya dari penerimaan Gudang");
  assert.equal(await saldo("2-1150"), 0);
  assert.equal(await saldo("5-1100"), 0, "tagihan tidak membebankan bahan; itu tugas pengeluaran bahan Gudang");
  // penerimaan yang sama tidak bisa ditagih lagi
  const dobel = await buat(ctx, { amount: 500_000, billType: "BAHAN_BAKU", goodsReceiptId: gr.id, billDate: "2026-10-02" });
  const r = await ctx.a.post(`/api/finance/bills/${dobel.body.id}/approve`, {});
  assert.equal(r.status, 409); assert.equal(r.body.code, "PENERIMAAN_SUDAH_DITAGIH");
});

test("B3.5 periodik + penerimaan Gudang yang belum ditagih: bahan baku tanpa tautan tetap ditolak (tidak menggandakan persediaan)", async () => {
  const ctx = await siapkan();
  await penerimaan(ctx); // GRNI terbuka untuk supplier yang sama
  const tanpa = await buat(ctx, { amount: 500_000, billType: "BAHAN_BAKU", billDate: "2026-09-20" });
  const r = await ctx.a.post(`/api/finance/bills/${tanpa.body.id}/approve`, {});
  assert.equal(r.status, 409); assert.equal(r.body.code, "ADA_PENERIMAAN_BELUM_DITAGIH");
  assert.equal(await saldo("5-1100"), 0);
});

test("B3.5 setting: metode & tanggal cutover divalidasi; cutover kosong = periodik terus", async () => {
  const ctx = await siapkan();
  assert.equal((await ctx.a.patch("/api/finance/settings", { settings: { inventory_method_before_cutover: "FIFO" } })).status, 400);
  assert.equal((await setCutover(ctx, "1 Oktober")).status, 400);
  assert.equal((await setCutover(ctx, "")).status, 200);
  const k = await ctx.a.get("/api/finance/inventory-method?tanggal=2027-01-01");
  assert.equal(k.body.cutover, null); assert.equal(k.body.metode, "PERIODIK");
  assert.equal((await buat(ctx, { amount: 1_000, billType: "BAHAN_BAKU", billDate: "2027-01-01" })).status, 201);
});

test("B3.5 tagihan yang tampak mengulang tagihan yang sudah masuk buku tidak disetujui; faktur berbeda = pengiriman terpisah", async () => {
  const ctx = await siapkan();
  const asli = await buat(ctx, { amount: 35_505_600, billType: "BAHAN_BAKU", billDate: "2026-07-20", description: "PE-019 : PE ENCASEMENT datang tgl 20 Juli" });
  assert.equal((await ctx.a.post(`/api/finance/bills/${asli.body.id}/approve`, {})).status, 200);
  const jurnalAwal = await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER" } });
  const tiga = [];
  for (const nominal of [6_970_340, 9_840_480, 18_694_920]) {
    tiga.push(await buat(ctx, { amount: nominal, billType: "BAHAN_BAKU", billDate: "2026-07-20", description: "PE-019 : PE ENCASEMENT" }));
  }
  for (const t of tiga) {
    const r = await ctx.a.post(`/api/finance/bills/${t.body.id}/approve`, {});
    assert.equal(r.status, 409, JSON.stringify(r.body)); assert.equal(r.body.code, "TAGIHAN_DIDUGA_DUPLIKAT");
    assert.equal((await testPrisma.finSupplierBill.findUnique({ where: { id: t.body.id } })).status, "MENUNGGU_APPROVAL");
  }
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "TAGIHAN_SUPPLIER" } }), jurnalAwal, "tidak ada jurnal baru");
  assert.equal(await saldo("2-1100"), -35_505_600, "utang tidak berlipat");

  // tagihan dari supplier & tanggal sama tetapi uraian berbeda / faktur berbeda tetap sah
  const lain = await buat(ctx, { amount: 100_000, billType: "BAHAN_BAKU", billDate: "2026-07-20", description: "Lem kontak 5 kg" });
  assert.equal((await ctx.a.post(`/api/finance/bills/${lain.body.id}/approve`, {})).status, 200);
  const a1 = await buat(ctx, { amount: 200_000, billType: "BAHAN_BAKU", billDate: "2026-07-21", description: "Plastik PE roll", supplierRef: "SCP-1" });
  assert.equal((await ctx.a.post(`/api/finance/bills/${a1.body.id}/approve`, {})).status, 200);
  const a2 = await buat(ctx, { amount: 200_000, billType: "BAHAN_BAKU", billDate: "2026-07-21", description: "Plastik PE roll", supplierRef: "SCP-2" });
  assert.equal((await ctx.a.post(`/api/finance/bills/${a2.body.id}/approve`, {})).status, 200);
});
