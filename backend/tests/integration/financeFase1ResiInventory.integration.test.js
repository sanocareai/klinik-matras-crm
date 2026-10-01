// FINANCE FASE 1 — FIXTURE TAMBAHAN: Resi (satu Payment beralokasi ke beberapa child) dan Persediaan (penerimaan → tagihan → pembayaran supplier → pemakaian).
// Yang dikunci: tidak ada hitung ganda di bridge/rekonsiliasi/arus kas/audit; residual Rp0.
import "./setup/env.js";
import "./setup/klaimTmpEnv.js";
import "./setup/paymentProofsTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestMaterial } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { paidForOrder } from "../../src/services/finance/allocation.js";
import { postGoodsReceiptValue } from "../../src/services/finance/posting/supplier.js";
import { postStockMovementCost } from "../../src/services/finance/posting/inventory.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const kunci = () => ({ "Idempotency-Key": `f1-${randomUUID()}` });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const angka = (d) => Number(d);
const garis = (b, k) => b.bridge.find((x) => x.kunci === k);

// ═══ RESI ═══════════════════════════════════════════════════════════════════════════════════════════════════════════
const HARGA = [1_000_000, 500_000, 250_001];
const ONGKIR = 50_000;
const TAGIHAN = [1_050_000, 500_000, 250_001]; // ongkir tambahan menempel di anchor
const TOTAL = 1_800_001;
const NILAI_JASA = 1_750_001;

async function duniaResi() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const bankAkun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Uji", kind: "BANK", accountId: bankAkun.id } });
  const sales = await createTestUser({ roles: ["SALES", "FINANCE"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Resi", phone: "6281300099001", pipelineStage: "TRANSACTION", assignedSalesId: sales.user.id } });
  await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", assignedToId: sales.user.id, type: "INDIVIDUAL" } });
  await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");
  await setSetting(testPrisma, SETTING_KEYS.RESI_PEMBAYARAN_AKTIF, "true");
  const s = makeClient(server.baseUrl, sales.token);
  const f = makeClient(server.baseUrl, finance.token);
  const a = makeClient(server.baseUrl, admin.token);
  const r = await s.post("/api/resi", {
    customerId: customer.id, alamat: "Jl. Kemang 1", kota: "Jakarta Selatan", ongkirTambahan: ONGKIR,
    items: HARGA.map((nominal) => ({ merk: "Sano", ukuran: "160x200 cm (Queen)", keluhan: "Pegal", nominal, unitCount: 1 })),
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  // Order baru berstatus PENDING (tidak dihitung sebagai penjualan); disiapkan ke status berjalan seperti order nyata.
  await testPrisma.order.updateMany({ where: { id: { in: r.body.orders.map((o) => o.id) } }, data: { status: "READY" } });
  return { s, f, a, finance, bank, groupId: r.body.groupId, anak: r.body.orders.map((o) => o.id), anchorId: r.body.anchorOrderId };
}
const bayarResi = (w, body) => w.s.post(`/api/resi/${w.groupId}/pembayaran`, { method: "TRANSFER", cashAccountId: w.bank.id, ...body }, kunci());
const verifikasiSemua = async (w) => {
  for (const p of await testPrisma.payment.findMany({ where: { orderId: { in: w.anak } } })) {
    if (!(await testPrisma.paymentVerification.count({ where: { paymentId: p.id } }))) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.user.id } });
  }
};

test("RESI: satu Payment beralokasi ke 3 child — Σ alokasi = Payment; anchor TIDAK terhitung sebagai Payment penuh; ongkir anchor tepat sekali; DP parsial lalu pelunasan; residual bridge Rp0", async () => {
  const w = await duniaResi();
  const periode = `from=${hariIni()}&to=${hariIni()}`;

  // ── DP parsial: 200.001 ──
  assert.equal((await bayarResi(w, { tipe: "DP", nominal: 200_001 })).status, 201);
  await verifikasiSemua(w);
  let p1 = await testPrisma.payment.findMany({ where: { orderId: { in: w.anak } }, include: { finAllocations: true } });
  assert.equal(p1.length, 1, "SATU Payment untuk seluruh Resi");
  assert.equal(p1[0].orderId, w.anchorId, "Payment menempel di anchor");
  assert.equal(p1[0].finAllocations.reduce((s, x) => s + angka(x.amount), 0), 200_001, "Σ alokasi = nominal Payment");
  assert.ok(p1[0].finAllocations.length >= 2, "dibagi ke beberapa child");
  const rek1 = (await w.a.get(`/api/sales-finance/rekon?${periode}`)).body;
  assert.equal(garis(rek1, "UANG_MASUK").jumlah, 200_001, "uang masuk = nominal Payment SEKALI (bukan ×jumlah child)");
  assert.equal(garis(rek1, "DP_BELUM_LUNAS").jumlah, 200_001, "semua child belum lunas → seluruhnya DP");
  assert.equal(rek1.tahap1.residual, 0); assert.equal(rek1.tahap2.residual, 0);
  const uangMasukPerOrder = rek1.detail.UANG_MASUK;
  assert.equal(uangMasukPerOrder.reduce((s, r) => s + r.jumlah, 0), 200_001, "baris per order menjumlah ke Payment");
  assert.ok(uangMasukPerOrder.every((r) => r.jumlah < 200_001), "anchor hanya menerima ALOKASInya, bukan Payment penuh");

  // ── DP sisa + pelunasan ──
  assert.equal((await bayarResi(w, { tipe: "DP" })).status, 201);
  assert.equal((await bayarResi(w, { tipe: "TAGIHAN" })).status, 201);
  await verifikasiSemua(w);
  const payments = await testPrisma.payment.findMany({ where: { orderId: { in: w.anak } }, include: { finAllocations: true } });
  assert.equal(payments.length, 3, "tiga Payment (DP parsial, sisa DP, pelunasan) — bukan 3 × 3 child");
  for (const p of payments) assert.equal(p.finAllocations.reduce((s, x) => s + angka(x.amount), 0), p.amount, "Σ alokasi = Payment untuk SETIAP Payment");
  assert.equal(payments.reduce((s, p) => s + p.amount, 0), TOTAL);
  const dibayarAnak = [];
  for (const id of w.anak) dibayarAnak.push(angka(await paidForOrder(testPrisma, id, { enabled: false })));
  assert.equal(dibayarAnak.reduce((s, x) => s + x, 0), TOTAL, "Σ dibayar seluruh child = Total Resi");
  assert.deepEqual([...dibayarAnak].sort((x, y) => x - y), [...TAGIHAN].sort((x, y) => x - y), "tiap child dibayar sebesar tagihannya; ongkir hanya di anchor (1.050.000), tidak dua kali");
  const anak = await testPrisma.order.findMany({ where: { id: { in: w.anak } } });
  assert.ok(anak.every((o) => o.paymentStatus === "LUNAS" && o.paidAt), "semua child LUNAS dari ledger");

  const rek = (await w.a.get(`/api/sales-finance/rekon?${periode}`)).body;
  assert.equal(garis(rek, "UANG_MASUK").jumlah, TOTAL);
  assert.equal(garis(rek, "ONGKIR").jumlah, ONGKIR, "ongkir diterima tepat sekali");
  assert.equal(garis(rek, "ONGKIR").nOrder, 1, "hanya anchor yang punya ongkir");
  assert.equal(garis(rek, "DP_BELUM_LUNAS").jumlah, 0);
  assert.equal(garis(rek, "TOTAL_PERUSAHAAN").jumlah, NILAI_JASA, "nilai order lunas = Σ nilai jasa child (tanpa ongkir)");
  assert.equal(rek.tahap1.pembanding.jumlah, NILAI_JASA);
  assert.equal(rek.tahap1.residual, 0); assert.equal(rek.tahap2.residual, 0);
  assert.equal(rek.status.perhitungan, "COCOK");
  assert.equal(garis(rek, "NILAI_LUNAS_SALES").jumlah, NILAI_JASA, "semua child dipegang satu Sales");

  // Jembatan uang masuk → kas: sekali per Payment
  const jb = (await w.f.get(`/api/finance/jembatan/uang-masuk-kas?${periode}`)).body;
  assert.equal(jb.uangMasukTerverifikasi, TOTAL);
  assert.equal(jb.kasMasukBuku, TOTAL, "kas masuk di buku = Σ Payment (satu jurnal per Payment)");
  assert.equal(jb.residual, 0);
  assert.equal(jb.status.perluDitinjau, false);

  // Audit hitung ganda bersih
  const au = (await w.f.get("/api/finance/audit-konsistensi")).body;
  for (const x of au.pemeriksaan) assert.equal(x.status, "OK", `${x.kunci}: ${JSON.stringify(x.contoh)}`);
});

// ═══ PERSEDIAAN ═════════════════════════════════════════════════════════════════════════════════════════════════════
async function saldo(code) {
  const a = await testPrisma.finAccount.findUnique({ where: { code } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return toMoney(agg._sum.debit || 0).minus(toMoney(agg._sum.credit || 0)).toNumber();
}

test("PERSEDIAAN: penerimaan menambah persediaan; tagihan supplier TIDAK menambah persediaan kedua kali; pembayaran supplier BUKAN biaya kedua; pemakaian = satu-satunya beban bahan; residual audit Rp0", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const a = makeClient(server.baseUrl, admin.token);
  const f = makeClient(server.baseUrl, finance.token);
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-SKY", name: "PT Sky Foam", aliases: ["Skyfoam"] } });
  const material = await createTestMaterial({ unit: "PCS" });

  // 1. Penerimaan 10 × 50.000 (10 Sep): Dr Persediaan / Cr Utang Barang Belum Ditagih — belum ada utang usaha, belum ada beban, belum ada kas keluar
  const gr = await testPrisma.goodsReceipt.create({ data: { receiptNumber: "GR-100926-01", sourceType: "MANUAL", supplier: "Skyfoam", status: "COMPLETED" } });
  await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "RECEIPT", qty: 10, unitCost: 50_000, goodsReceiptId: gr.id, createdAt: new Date("2026-09-10T05:00:00Z") } });
  await testPrisma.$transaction((tx) => postGoodsReceiptValue(tx, { goodsReceiptId: gr.id, userId: admin.user.id }));
  assert.equal(await saldo("1-1400"), 500_000, "penerimaan menambah persediaan");
  assert.equal(await saldo("2-1150"), -500_000, "GRNI: barang diterima, tagihan belum datang");
  assert.equal(await saldo("2-1100"), 0, "belum ada utang usaha");

  // 2. Tagihan supplier atas penerimaan itu: GRNI tertutup, persediaan TETAP 500.000 (tidak dobel), utang usaha lahir
  const bill = await a.post("/api/finance/bills", { supplierId: sup.id, billDate: "2026-09-12", amount: 500_000, description: "Busa", billType: "BAHAN_BAKU", goodsReceiptId: gr.id });
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  assert.equal((await a.post(`/api/finance/bills/${bill.body.id}/approve`, {})).status, 200);
  assert.equal(await saldo("1-1400"), 500_000, "tagihan TIDAK menambah persediaan kedua kali");
  assert.equal(await saldo("2-1150"), 0);
  assert.equal(await saldo("2-1100"), -500_000, "utang usaha sekali");
  assert.equal(await saldo("5-1100"), 0, "tagihan bahan baku bukan beban saat ditagih");

  // 3. Pembayaran supplier: mengurangi utang & kas, BUKAN beban baru
  const sp = await a.post("/api/finance/supplier-payments", { supplierId: sup.id, date: "2026-09-14", cashAccountId: bank.id, allocations: [{ billId: bill.body.id, amount: 500_000 }] });
  assert.equal(sp.status, 201, JSON.stringify(sp.body));
  assert.equal(await saldo("2-1100"), 0, "utang lunas");
  assert.equal(await saldo("1-1400"), 500_000, "pembayaran tidak menyentuh persediaan");
  assert.equal(await saldo("5-1100"), 0, "pembayaran supplier BUKAN biaya");

  // 4. Pemakaian 4 pcs (15 Sep): satu-satunya jurnal yang menjadi beban bahan
  const issue = await testPrisma.stockMovement.create({ data: { materialId: material.id, type: "ISSUE", qty: -4, createdAt: new Date("2026-09-15T05:00:00Z") } });
  const pm = await testPrisma.$transaction((tx) => postStockMovementCost(tx, { movementId: issue.id, userId: admin.user.id }));
  assert.equal(pm.posted, true, JSON.stringify(pm));
  assert.equal(await saldo("5-1100"), 200_000, "4 × 50.000 menjadi beban bahan");
  assert.equal(await saldo("1-1400"), 300_000, "persediaan = 6 pcs × 50.000");
  const qtySisa = (await testPrisma.stockMovement.findMany({ where: { materialId: material.id } })).reduce((s, m) => s + angka(m.qty), 0);
  assert.equal(qtySisa * 50_000, await saldo("1-1400"), "nilai persediaan di buku = kuantitas ledger stok × harga");

  // Arus kas September: HANYA pembayaran supplier yang keluar kas; penerimaan/tagihan/pemakaian tidak
  const cf = (await f.get("/api/finance/reports/cash-flow?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(cf.ringkasan.masuk, 0);
  assert.equal(cf.ringkasan.keluar, 500_000, "kas keluar sekali = pembayaran supplier");
  const per = Object.fromEntries(cf.rincianSumber.map((x) => [x.sumber, x]));
  assert.deepEqual(Object.keys(per), ["PEMBAYARAN_SUPPLIER"], "tidak ada sumber kas lain (penerimaan/tagihan/pemakaian tidak menyentuh kas)");
  // Laba rugi: beban bahan 200.000 saja (bukan 500.000 tagihan + 500.000 pembayaran + 200.000 pemakaian)
  const lr = (await f.get("/api/finance/reports/income-statement?from=2026-09-01&to=2026-09-30")).body.ringkasan;
  assert.equal(lr.bebanPokok, 200_000);
  assert.equal(lr.labaBersih, -200_000);

  // Audit hitung ganda & keseimbangan jurnal: residual Rp0
  const au = (await f.get("/api/finance/audit-konsistensi")).body;
  assert.equal(au.ringkasan.perluDitinjau, 0);
  assert.equal(au.pemeriksaan.reduce((s, x) => s + x.nilai, 0), 0, "nilai terdampak seluruh pemeriksaan = Rp0");
  const agg = await testPrisma.finJournalLine.aggregate({ _sum: { debit: true, credit: true } });
  assert.equal(angka(agg._sum.debit), angka(agg._sum.credit), "debit = kredit di seluruh buku");
});
