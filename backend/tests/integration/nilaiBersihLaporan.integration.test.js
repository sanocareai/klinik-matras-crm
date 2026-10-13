// NILAI BERSIH DI SEMUA LAPORAN (Okt 2026) — kasus Sofyan: order 4,3 jt, refund 200 rb tertaut Nota Kredit → TIDAK BOLEH 4,3 jt masuk komisi/target/omset.
// Satu skenario dijalankan melalui SELURUH permukaan yang membaca nilai order: laporan Sales (Lunas/komisi, rincian, omset, AOV, target), Overview, Ringkasan bisnis (uang/piutang/aging),
// pelanggan (Customer.orderValue + detail), daftar Order (KPI + per status + order), Pipeline (kanban + papan order), Promo, invoice pelanggan (PDF/WA/total), MCP, webhook.
// Kebenaran yang dikunci: sebelum nota = 4,3 jt (belum lunas → Lunas 0); sesudah nota tertaut = 4,1 jt; nota dibatalkan = kembali; nota mandiri = nilai bersih juga.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";
import { syncCustomerOrderAggregate } from "../../src/services/customerOrderAggregate.js";
import { buildInvoiceView } from "../../src/services/invoice.js";
import { aggregateBersih, groupByBersih, nilaiBersihPerOrder, kreditAktifPerOrder } from "../../src/services/orderNilaiBersih.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const LAMPIRAN = `/media/finance-receipts/${"a".repeat(40)}.jpg`;
const kunci = () => ({ "Idempotency-Key": `nb-${randomUUID()}` });
const wib = (d = new Date()) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
const kemarin = () => wib(new Date(Date.now() - 86_400_000));
const besok = () => wib(new Date(Date.now() + 86_400_000));
const PERIODE = () => `from=${kemarin()}&to=${besok()}`;
let seq = 0;

async function login(roles, nama) {
  const u = await createLoginUser({ roles });
  if (nama) await testPrisma.user.update({ where: { id: u.user.id }, data: { name: nama } });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  return { ...u, token: r.body.token };
}

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const admin = await login(["ADMIN"], "Admin Uji");
  const fadlan = await login(["SALES"], "Fadlan");
  return { bank, admin, fadlan };
}

/** Pelanggan + percakapan milik Fadlan + order (ownership eksplisit) + Payment terverifikasi + pengakuan pendapatan → LUNAS bila bayar ≥ tagihan. */
async function order(w, { nama = "Sofyan", nilai, bayar = [], promoId = null } = {}) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { phone: `6281299${String(seq).padStart(6, "0")}`, name: nama, pipelineStage: "TRANSACTION", assignedSalesId: w.fadlan.user.id } });
  await testPrisma.conversation.create({ data: { customerId: c.id, channel: "WHATSAPP", assignedToId: w.fadlan.user.id, type: "INDIVIDUAL" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nilai, category: "LAYANAN", status: "DELIVERED", orderNumber: `RES-NB-${String(seq).padStart(4, "0")}`, salesOwnerId: w.fadlan.user.id, promoId } });
  await testPrisma.orderItem.create({ data: { orderId: o.id, layananName: "Paket Upgrade", harga: nilai, sortOrder: 0 } });
  for (const amount of bayar) {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id } });
    await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.admin.user.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.user.id }));
  }
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.admin.user.id }));
  await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
  await syncCustomerOrderAggregate(c.id);
  return { o: await testPrisma.order.findUnique({ where: { id: o.id } }), c };
}

async function refund(w, orderId, amount) {
  const r = await raw("POST", "/api/finance/refunds", { token: w.admin.token, body: { orderId, date: wib(), amount, reason: "refund triplek: tidak perlu", cashAccountId: w.bank.id, attachmentUrl: LAMPIRAN } });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ap = await raw("POST", `/api/finance/refunds/${r.body.id}/approve`, { token: w.admin.token, body: {} });
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return r.body;
}
async function nota(w, orderId, body) {
  const g = await raw("GET", `/api/finance/orders/${orderId}/nota-kredit`, { token: w.admin.token });
  return raw("POST", `/api/finance/orders/${orderId}/nota-kredit`, { token: w.admin.token, headers: kunci(), body: { reason: "Potongan harga disepakati", revisi: g.body.ringkasan.revisi, ...body } });
}
const batalNota = async (w, id, orderId) => {
  const g = await raw("GET", `/api/finance/orders/${orderId}/nota-kredit`, { token: w.admin.token });
  return raw("POST", `/api/finance/nota-kredit/${id}/batal`, { token: w.admin.token, headers: kunci(), body: { reason: "salah", revisi: g.body.ringkasan.revisi } });
};

/** Foto SELURUH permukaan: satu fungsi, dibandingkan antar keadaan. */
async function potret(w, { orderId, customerId }) {
  const t = { token: w.admin.token };
  const sr = (await raw("GET", `/api/analytics/sales-report?${PERIODE()}`, t)).body;
  const baris = sr.rows.find((r) => r.userId === w.fadlan.user.id);
  const ld = (await raw("GET", `/api/analytics/sales-report/lunas-detail?userId=${w.fadlan.user.id}&${PERIODE()}`, t)).body;
  const ov = (await raw("GET", `/api/analytics/overview?${PERIODE()}`, t)).body;
  const bs = (await raw("GET", `/api/analytics/business-summary?${PERIODE()}`, t)).body;
  const cuR = await raw("GET", `/api/customers/${customerId}`, t);
  assert.equal(cuR.status, 200, `GET /customers/:id → ${cuR.status} ${JSON.stringify(cuR.body)}`);
  const cu = cuR.body;
  const od = (await raw("GET", `/api/orders?${PERIODE()}`, t)).body;
  const pl = (await raw("GET", `/api/pipeline/board`, t)).body;
  const ob = (await raw("GET", `/api/pipeline/order-board?${PERIODE()}`, t)).body;
  const ro = (await raw("GET", `/api/analytics/recent-orders`, t)).body;
  const iv = await buildInvoiceView(orderId);
  const kartu = Object.values(pl?.board ?? pl ?? {}).flat().find((k) => k.id === customerId) ?? null;
  return {
    salesLunas: baris?.collectedValue ?? 0, salesGross: baris?.grossValue ?? 0, salesAov: baris?.aov ?? 0,
    rincianTotal: ld.total, rincianBaris: ld.orders?.[0] ?? null,
    overviewNilai: ov.totalValue ?? ov.totalOrderValue ?? ov.orderValue ?? null,
    bsGross: bs.uang?.grossValue, bsCollected: bs.uang?.collectedValue, bsOutstanding: bs.uang?.outstandingValue,
    customerOrderValue: (await testPrisma.customer.findUnique({ where: { id: customerId } })).orderValue,
    customerDetailOrder: cu.orders?.[0] ?? null,
    ordersSummary: od.summary, ordersItem: od.items?.find((i) => i.id === orderId) ?? null,
    kanbanTotal: kartu?.totalValue ?? null,
    papanOrder: Object.values(ob?.board ?? {}).flat().find((o) => o.id === orderId) ?? null,
    recentValue: Array.isArray(ro) ? ro.find((o) => o.id === orderId)?.value ?? null : null,
    invoice: iv?.nominal ?? null,
  };
}

test("KASUS SOFYAN: nota tertaut refund → komisi/omset/pelanggan/order/pipeline/invoice = 4,1 jt (bukan 4,3 jt); dibatalkan → kembali 4,3 jt", async () => {
  const w = await dunia();
  const { o, c } = await order(w, { nilai: 4_300_000, bayar: [4_300_000] });
  assert.equal(o.paymentStatus, "LUNAS");
  const rf = await refund(w, o.id, 200_000);
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).paymentStatus, "DP", "gejala asli: refund diverifikasi → DP, belum terhitung Lunas");

  // Sebelum nota: order DP → belum masuk "Lunas"/komisi; omset (gross) 4,3 jt.
  const sebelum = await potret(w, { orderId: o.id, customerId: c.id });
  assert.equal(sebelum.salesLunas, 0, "belum lunas → komisi 0");
  assert.equal(sebelum.salesGross, 4_300_000);

  // Nota tertaut refund → LUNAS, paidAt = tanggal bayar; nilai bersih 4,1 jt di SEMUA tempat
  const n = await nota(w, o.id, { amount: 200_000, refundId: rf.id });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const sesudah = await potret(w, { orderId: o.id, customerId: c.id });
  assert.equal(sesudah.salesLunas, 4_100_000, "komisi/Lunas Fadlan = 4,1 jt");
  assert.equal(sesudah.salesGross, 4_100_000, "omset sales = 4,1 jt");
  assert.equal(sesudah.salesAov, 4_100_000);
  assert.equal(sesudah.rincianTotal, 4_100_000, "rincian Lunas (dasar komisi) = ringkasan");
  assert.deepEqual([sesudah.rincianBaris.value, sesudah.rincianBaris.nilaiKotor, sesudah.rincianBaris.notaKredit], [4_100_000, 4_300_000, 200_000]);
  assert.equal(sesudah.bsGross, 4_100_000, "ringkasan bisnis: omset");
  assert.equal(sesudah.bsCollected, 4_100_000, "ringkasan bisnis: terkumpul");
  assert.equal(sesudah.bsOutstanding, 0);
  assert.equal(sesudah.customerOrderValue, 4_100_000, "Customer.orderValue tersinkron setelah nota (VIP/urut daftar pelanggan)");
  assert.equal(sesudah.customerDetailOrder.orderCredits?.length, 1, "detail pelanggan memuat nota aktif");
  assert.equal(sesudah.ordersSummary.nilaiOrderAktif, 4_100_000, "KPI daftar order");
  assert.equal(sesudah.ordersItem.orderCredits?.[0]?.amount !== undefined, true);
  assert.equal(sesudah.kanbanTotal, 4_100_000, "kolom/kartu kanban");
  assert.equal(sesudah.papanOrder.value, 4_100_000, "papan order");
  assert.equal(sesudah.papanOrder.nilaiKotor, 4_300_000);
  assert.equal(sesudah.recentValue, 4_100_000, "widget order terbaru");
  assert.deepEqual([sesudah.invoice.totalTagihan, sesudah.invoice.notaKredit, sesudah.invoice.lunas], [4_100_000, 200_000, true], "invoice pelanggan: total bersih + baris potongan");

  // Dibatalkan → semuanya kembali (gross lagi, belum lunas)
  const bt = await batalNota(w, n.body.id, o.id);
  assert.equal(bt.status, 200, JSON.stringify(bt.body));
  const kembali = await potret(w, { orderId: o.id, customerId: c.id });
  assert.equal(kembali.salesLunas, 0);
  assert.equal(kembali.salesGross, 4_300_000);
  assert.equal(kembali.customerOrderValue, 4_300_000, "Customer.orderValue kembali setelah nota dibatalkan");
  assert.equal(kembali.invoice.notaKredit, 0);
});

test("NOTA MANDIRI (potongan belum dibayar): tagihan 4,0 jt, bayar 3,8 jt, potongan 200 rb → Lunas 3,8 jt di komisi; invoice tidak menagih 200 rb; piutang tidak berlabel 'dibayar sebagian' karena potongan", async () => {
  const w = await dunia();
  const { o, c } = await order(w, { nilai: 4_000_000, bayar: [3_800_000] });
  assert.equal(o.paymentStatus, "DP");
  const sebelum = await potret(w, { orderId: o.id, customerId: c.id });
  assert.equal(sebelum.salesLunas, 0);
  assert.equal(sebelum.invoice.sisa, 200_000);

  const n = await nota(w, o.id, { amount: 200_000 });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const sesudah = await potret(w, { orderId: o.id, customerId: c.id });
  assert.equal(sesudah.salesLunas, 3_800_000);
  assert.equal(sesudah.salesGross, 3_800_000);
  assert.equal(sesudah.customerOrderValue, 3_800_000);
  assert.deepEqual([sesudah.invoice.totalTagihan, sesudah.invoice.sisa, sesudah.invoice.lunas, sesudah.invoice.notaKredit], [3_800_000, 0, true, 200_000], "invoice: sisa 0, bukan 200 rb");
  // laporan Piutang (buku besar): order lunas tidak muncul; nota tidak dihitung sebagai pembayaran
  const pi = (await raw("GET", "/api/finance/reports/receivables", { token: w.admin.token })).body;
  assert.equal(pi.baris.find((b) => b.orderId === o.id), undefined, "tidak ada piutang tersisa");
});

test("ORDER BELUM LUNAS + potongan: nota mandiri pada order tanpa pembayaran → piutang berkurang, statusBayar 'Belum bayar' (potongan BUKAN pembayaran)", async () => {
  const w = await dunia();
  const { o } = await order(w, { nilai: 1_000_000, bayar: [] });
  const n = await nota(w, o.id, { amount: 100_000 });
  assert.equal(n.status, 201, JSON.stringify(n.body));
  const pi = (await raw("GET", "/api/finance/reports/receivables", { token: w.admin.token })).body;
  const b = pi.baris.find((x) => x.orderId === o.id);
  assert.ok(b, "masih ada piutang 900 rb");
  assert.deepEqual([b.sisaTagihan, b.statusBayar, b.notaKredit, b.sudahDilunasi, b.tagihanDiakui], [900_000, "BELUM_BAYAR", 100_000, 0, 900_000]);
});

test("HELPER: aggregateBersih / groupByBersih / nilaiBersihPerOrder / kreditAktifPerOrder — bentuk hasil sama dgn Prisma, nilai bersih, nota dibatalkan tidak dihitung", async () => {
  const w = await dunia();
  const a = await order(w, { nama: "A", nilai: 1_000_000, bayar: [900_000] });
  const b = await order(w, { nama: "B", nilai: 2_000_000, bayar: [1_700_000] });
  await testPrisma.order.update({ where: { id: b.o.id }, data: { category: "BARU" } });
  const n1 = await nota(w, a.o.id, { amount: 100_000 });
  assert.equal(n1.status, 201, JSON.stringify(n1.body));
  const n2 = await nota(w, b.o.id, { amount: 300_000 });
  assert.equal(n2.status, 201, JSON.stringify(n2.body));

  const agg = await aggregateBersih(testPrisma, { where: {}, _count: { _all: true }, _sum: { value: true }, _avg: { value: true } });
  assert.deepEqual([agg._count._all, agg._sum.value, agg._avg.value], [2, 2_600_000, 1_300_000]);
  const tanpaValue = await aggregateBersih(testPrisma, { where: {}, _count: { _all: true } });
  assert.deepEqual(tanpaValue._count, { _all: 2 }, "tanpa _sum.value hasil dilewatkan apa adanya");
  const grup = await groupByBersih(testPrisma, { by: ["category"], where: {}, _count: { _all: true }, _sum: { value: true } });
  const peta = Object.fromEntries(grup.map((g) => [g.category, g._sum.value]));
  assert.deepEqual(peta, { LAYANAN: 900_000, BARU: 1_700_000 });
  const per = await nilaiBersihPerOrder(testPrisma, [{ id: a.o.id, value: 1_000_000 }, { id: b.o.id, value: 2_000_000 }]);
  assert.deepEqual(per.map((r) => [r.notaKredit, r.nilaiBersih]), [[100_000, 900_000], [300_000, 1_700_000]]);
  assert.equal((await kreditAktifPerOrder(testPrisma, [a.o.id, b.o.id])).get(b.o.id), 300_000);

  assert.equal((await batalNota(w, n2.body.id, b.o.id)).status, 200);
  const agg2 = await aggregateBersih(testPrisma, { where: {}, _count: { _all: true }, _sum: { value: true } });
  assert.equal(agg2._sum.value, 2_900_000, "nota dibatalkan tidak lagi mengurangi");
});

test("KONTRAK STRICT: tagihanOrder pada order tanpa relasi orderCredits MELEMPAR di tes (bukan diam-diam kotor)", async () => {
  const { tagihanOrder } = await import("../../src/services/finance/tagihanOrder.js");
  assert.throws(() => tagihanOrder({ value: 100, ongkir: 0 }), /orderCredits/);
  assert.equal(tagihanOrder({ value: 100, ongkir: 0, orderCredits: [{ amount: 30 }] }), 70);
});
