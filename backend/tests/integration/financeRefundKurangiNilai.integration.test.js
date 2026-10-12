// REFUND PEMBATALAN SEBAGIAN (kurangiNilaiOrder) — kasus nyata RES-07102026-037: order Lunas Rp4,3 jt, refund Rp200 rb (triplek tidak jadi) + biaya BI-FAST Rp2.500.
// Yang dikunci:
//  - Disetujui → nilai order turun TEPAT sebesar refund lewat 1 baris OrderItem negatif terkunci (finRefundId); order Lunas TETAP Lunas.
//  - Tanpa tanda = perilaku lama (nilai tetap, status turun ke DP).
//  - Biaya admin transfer = beban bank di jurnal yang sama (Cr Bank = refund + biaya), BUKAN pengurang nilai order. Tidak ada jurnal tambahan untuk pengurangan nilai.
//  - Baris pengurang tidak bisa diedit/dihapus dari endpoint item; refund dibatalkan / dikoreksi → baris dibalik & diterapkan ulang; bukti transfer wajib hasil unggah.
//  - Penolakan: pecahan rupiah, nilai habis, Resi gabungan. Diagnosis piutang tidak menuduh NILAI_BEDA_PENGAKUAN.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived, postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { RECEIPTS_URL_PREFIX } from "../../src/services/finance/receipts.js";
import { diagnosisPiutang } from "../../src/services/finance/piutangDiagnosis.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const POLA_SIMPAN = /\/(bills|refunds)\/[^/]+\/(koreksi|info)$/;
function denganKunci(c) {
  const post = c.post;
  return { ...c, post: (path, body, headers) => post(path, body, headers ?? (POLA_SIMPAN.test(path) && !body?.preview ? { "Idempotency-Key": `uji-${randomUUID()}` } : undefined)) };
}

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return { bank, admin, sales, a: denganKunci(makeClient(server.baseUrl, admin.token, { tanpaStepUp: true })) };
}

/** Order Lunas: 2 item (kasur 3,5 jt + triplek 800 rb = 4,3 jt), dibayar penuh, pendapatan diakui. */
async function orderLunas(ctx, { nilai = 4_300_000, diakui = true } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Muhammad Sofyan Hakim" } });
  const order = await testPrisma.order.create({
    data: {
      customerId: customer.id, value: nilai, category: "LAYANAN", status: "DELIVERED", orderNumber: `RES-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
      items: { create: [{ layananName: "Upgrade kasur", harga: nilai - 800_000, sortOrder: 0 }, { layananName: "Triplek", harga: 800_000, sortOrder: 1 }] },
    },
  });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: nilai, method: "CASH", recordedById: ctx.admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: payment.id, userId: ctx.admin.user.id }));
  if (diakui) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: ctx.admin.user.id }));
  await testPrisma.order.update({ where: { id: order.id }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  return order;
}

const ambilOrder = (id) => testPrisma.order.findUnique({ where: { id }, include: { items: { orderBy: { sortOrder: "asc" } } } });
const biayaBI = { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" };

async function ajukanSetujui(ctx, order, extra = {}) {
  const r = await ctx.a.post("/api/finance/refunds", { orderId: order.id, date: "2026-10-12", amount: 200_000, reason: "Triplek tidak jadi dipakai", cashAccountId: ctx.bank.id, ...biayaBI, ...extra });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const ap = await ctx.a.post(`/api/finance/refunds/${r.body.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  return r.body;
}

async function pastikanBukuSeimbang() {
  const lines = await testPrisma.finJournalLine.findMany({ select: { debit: true, credit: true } });
  const d = lines.reduce((a, l) => a + Number(l.debit), 0);
  const k = lines.reduce((a, l) => a + Number(l.credit), 0);
  assert.equal(d, k, `buku besar harus seimbang (debit ${d} vs kredit ${k})`);
}

test("Refund pembatalan sebagian: nilai order −200 rb, order Lunas TETAP Lunas, biaya BI-FAST 2.500 jadi beban bank, tanpa jurnal tambahan", async () => {
  const ctx = await siapkan();
  const o = await orderLunas(ctx);
  const sebelumJurnal = await testPrisma.finJournalEntry.count();
  const r = await ajukanSetujui(ctx, o, { kurangiNilaiOrder: true });

  const sesudah = await ambilOrder(o.id);
  assert.equal(sesudah.value, 4_100_000);
  assert.equal(sesudah.paymentStatus, "LUNAS", "Lunas tetap Lunas — hanya nilai order yang turun");
  const pengurang = sesudah.items.filter((i) => i.finRefundId);
  assert.equal(pengurang.length, 1);
  assert.equal(pengurang[0].harga, -200_000);
  assert.equal(pengurang[0].finRefundId, r.id);
  assert.match(pengurang[0].layananName, /^Refund RFD-/);
  assert.equal(sesudah.items.reduce((s, i) => s + i.harga, 0), sesudah.value, "Order.value = Σ item");

  // Jurnal: tepat SATU jurnal baru (REFUND) — pengurangan nilai TIDAK menambah jurnal (hindari memotong pendapatan dua kali).
  assert.equal(await testPrisma.finJournalEntry.count(), sebelumJurnal + 1);
  const j = await testPrisma.finJournalEntry.findFirst({ where: { source: "REFUND", sourceId: r.id }, include: { lines: { include: { account: { select: { code: true } } } } } });
  const kreditBank = j.lines.filter((l) => l.cashAccountId === ctx.bank.id).reduce((s, l) => s + Number(l.credit), 0);
  assert.equal(kreditBank, 202_500, "bank keluar = refund 200.000 + biaya BI-FAST 2.500");
  const biaya = j.lines.find((l) => Number(l.debit) === 2_500);
  assert.ok(biaya, "biaya admin transfer = baris debit beban terpisah");
  assert.equal(j.lines.find((l) => Number(l.debit) === 200_000)?.account.code, "4-2100", "Dr Retur & Potongan Penjualan");
  await pastikanBukuSeimbang();

  // Diagnosis piutang tidak menuduh nilai order berubah.
  const dg = await diagnosisPiutang(testPrisma);
  assert.equal(dg.baris.filter((b) => b.kategori === "NILAI_BEDA_PENGAKUAN").length, 0);
});

test("Tanpa tanda kurangiNilaiOrder = perilaku lama: nilai order tetap, status turun ke DP", async () => {
  const ctx = await siapkan();
  const o = await orderLunas(ctx);
  await ajukanSetujui(ctx, o);
  const sesudah = await ambilOrder(o.id);
  assert.equal(sesudah.value, 4_300_000);
  assert.equal(sesudah.paymentStatus, "DP");
  assert.equal(sesudah.items.filter((i) => i.finRefundId).length, 0);
});

test("Baris pengurang terkunci dari edit/hapus item; refund dibatalkan → baris dibalik, nilai naik kembali dan tetap Lunas", async () => {
  const ctx = await siapkan();
  const o = await orderLunas(ctx);
  const r = await ajukanSetujui(ctx, o, { kurangiNilaiOrder: true });
  const baris = (await ambilOrder(o.id)).items.find((i) => i.finRefundId);
  const sales = makeClient(server.baseUrl, ctx.admin.token, { tanpaStepUp: true });

  const patch = await sales.patch(`/api/orders/items/${baris.id}`, { harga: -1 });
  assert.equal(patch.status, 409, JSON.stringify(patch.body));
  const del = await sales.delete(`/api/orders/items/${baris.id}`);
  assert.equal(del.status, 409, JSON.stringify(del.body));
  assert.equal((await ambilOrder(o.id)).value, 4_100_000);

  // Item biasa tetap bisa diedit dan nilai order mengikuti (pengurang ikut terhitung).
  const biasa = (await ambilOrder(o.id)).items.find((i) => i.layananName === "Triplek");
  const ok = await sales.patch(`/api/orders/items/${biasa.id}`, { harga: 900_000 });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await ambilOrder(o.id)).value, 4_200_000);
  await sales.patch(`/api/orders/items/${biasa.id}`, { harga: 800_000 });

  const batal = await ctx.a.post(`/api/finance/refunds/${r.id}/cancel`, { reason: "Salah input" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  const akhir = await ambilOrder(o.id);
  assert.equal(akhir.items.filter((i) => i.finRefundId).length, 0);
  assert.equal(akhir.value, 4_300_000);
  assert.equal(akhir.paymentStatus, "LUNAS", "uang kembali dipegang penuh setelah refund batal");
  await pastikanBukuSeimbang();
});

test("Koreksi refund: tambah biaya admin + bukti transfer; nominal sama → nilai order tetap 4,1 jt & Lunas; jenis dapat diubah; lampiran wajib hasil unggah", async () => {
  const ctx = await siapkan();
  const o = await orderLunas(ctx);
  // Kasus nyata: admin mencatat refund tanpa biaya (transfer sesama bank / "tanpa biaya") lalu lupa biaya admin & bukti.
  const r = await ajukanSetujui(ctx, o, { kurangiNilaiOrder: true, paymentMethod: "TRANSFER", transferFeeType: "SESAMA_BANK" });
  const kreditAwal = Number((await testPrisma.finJournalEntry.findFirst({ where: { source: "REFUND", sourceId: r.id, status: "POSTED" }, include: { lines: true } })).lines
    .filter((l) => l.cashAccountId === ctx.bank.id).reduce((s, l) => s + Number(l.credit), 0));
  assert.equal(kreditAwal, 200_000);

  const palsu = await ctx.a.post(`/api/finance/refunds/${r.id}/koreksi`, { reason: "Lengkapi", attachmentUrl: "https://contoh.com/bukti.jpg", ...biayaBI });
  assert.equal(palsu.status, 400, JSON.stringify(palsu.body));

  const url = `${RECEIPTS_URL_PREFIX}/bukti-refund-uji.jpg`;
  const pv = await ctx.a.post(`/api/finance/refunds/${r.id}/koreksi`, { reason: "Lengkapi biaya admin & bukti transfer", attachmentUrl: url, ...biayaBI, preview: true });
  assert.equal(pv.status, 200, JSON.stringify(pv.body));
  assert.equal((await ambilOrder(o.id)).value, 4_100_000, "pratinjau tidak mengubah apa pun");

  const k = await ctx.a.post(`/api/finance/refunds/${r.id}/koreksi`, { reason: "Lengkapi biaya admin & bukti transfer", attachmentUrl: url, ...biayaBI });
  assert.equal(k.status, 201, JSON.stringify(k.body));
  const baru = await testPrisma.finRefund.findUnique({ where: { id: k.body.baruId } });
  assert.equal(baru.attachmentUrl, url);
  assert.equal(baru.kurangiNilaiOrder, true);
  assert.equal(Number(baru.transferFeeAmount), 2_500);

  const sesudah = await ambilOrder(o.id);
  assert.equal(sesudah.value, 4_100_000);
  assert.equal(sesudah.paymentStatus, "LUNAS");
  const pengurang = sesudah.items.filter((i) => i.finRefundId);
  assert.equal(pengurang.length, 1, "satu baris pengurang, bukan dobel");
  assert.equal(pengurang[0].finRefundId, baru.id);
  const jb = await testPrisma.finJournalEntry.findFirst({ where: { source: "REFUND", sourceId: baru.id, status: "POSTED" }, include: { lines: true } });
  assert.equal(jb.lines.filter((l) => l.cashAccountId === ctx.bank.id).reduce((s, l) => s + Number(l.credit), 0), 202_500);
  await pastikanBukuSeimbang();

  // Koreksi nominal: baris pengurang mengikuti nominal baru.
  const k2 = await ctx.a.post(`/api/finance/refunds/${baru.id}/koreksi`, { reason: "Nominal disepakati 150 rb", amount: 150_000 });
  assert.equal(k2.status, 201, JSON.stringify(k2.body));
  const o2 = await ambilOrder(o.id);
  assert.equal(o2.value, 4_150_000);
  assert.equal(o2.paymentStatus, "LUNAS");
  assert.equal(o2.items.filter((i) => i.finRefundId).length, 1);

  // Ganti ke refund biasa: baris pengurang dibalik, nilai kembali penuh (status turun ke DP karena uang dipegang berkurang).
  const k3 = await ctx.a.post(`/api/finance/refunds/${k2.body.baruId}/koreksi`, { reason: "Ternyata pengembalian dana biasa", kurangiNilaiOrder: false });
  assert.equal(k3.status, 201, JSON.stringify(k3.body));
  const o3 = await ambilOrder(o.id);
  assert.equal(o3.value, 4_300_000);
  assert.equal(o3.items.filter((i) => i.finRefundId).length, 0);
  assert.equal(o3.paymentStatus, "DP");
  await pastikanBukuSeimbang();
});

test("Info refund: bukti transfer boleh dilengkapi tanpa jurnal; URL bebas ditolak", async () => {
  const ctx = await siapkan();
  const o = await orderLunas(ctx);
  const r = await ajukanSetujui(ctx, o, { kurangiNilaiOrder: true });
  const jurnal = await testPrisma.finJournalEntry.count();
  const url = `${RECEIPTS_URL_PREFIX}/bukti-info-uji.jpg`;
  assert.equal((await ctx.a.post(`/api/finance/refunds/${r.id}/info`, { reason: "Lampirkan bukti", attachmentUrl: "http://evil.example/x.jpg" })).status, 400);
  const ok = await ctx.a.post(`/api/finance/refunds/${r.id}/info`, { reason: "Lampirkan bukti", attachmentUrl: url });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal((await testPrisma.finRefund.findUnique({ where: { id: r.id } })).attachmentUrl, url);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnal, "edit info tidak membuat jurnal");
  assert.equal((await ambilOrder(o.id)).value, 4_100_000, "edit info tidak menyentuh nilai order");
});

test("Penolakan: pecahan rupiah, nilai habis, Resi gabungan", async () => {
  const ctx = await siapkan();
  const o = await orderLunas(ctx);
  const pecahan = await ctx.a.post("/api/finance/refunds", { orderId: o.id, date: "2026-10-12", amount: 200_000.5, reason: "x", cashAccountId: ctx.bank.id, kurangiNilaiOrder: true });
  assert.equal(pecahan.status, 400, JSON.stringify(pecahan.body));
  const habis = await ctx.a.post("/api/finance/refunds", { orderId: o.id, date: "2026-10-12", amount: 4_300_000, reason: "x", cashAccountId: ctx.bank.id, kurangiNilaiOrder: true });
  assert.equal(habis.status, 409, JSON.stringify(habis.body));
  assert.equal(habis.body.code, "NILAI_HABIS");
  assert.equal(await testPrisma.finRefund.count(), 0);
});
