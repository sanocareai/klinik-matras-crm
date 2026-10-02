// GUARD "Payment menunggu verifikasi" pada verifikasi penerimaan (services/finance/penerimaanOrder.js).
// Kasus nyata (30 Sep 2026, order RES-21092026-130): Payment Sales belum diverifikasi (sudah berjurnal, tidak terhitung pada status bayar karena gerbang
// verifikasi menyala) → order tampak "LUNAS belum dicatat" → Finance membuat penerimaan BARU → uang yang sama terbukukan dua kali (Bank Rp7,45 jt untuk order Rp3,73 jt).

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  // Gerbang verifikasi MENYALA sejak kemarin (sama seperti produksi sejak 30 Sep 2026).
  await testPrisma.finSetting.upsert({ where: { key: "payment_verification_gate" }, create: { key: "payment_verification_gate", value: "true" }, update: { value: "true" } });
  await testPrisma.finSetting.upsert({ where: { key: "payment_verification_gate_since" }, create: { key: "payment_verification_gate_since", value: new Date(Date.now() - 86_400_000).toISOString() }, update: { value: new Date(Date.now() - 86_400_000).toISOString() } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Uji", assignedSalesId: sales.id } });
  const order = await testPrisma.order.create({
    data: { customerId: customer.id, value: 3_726_000, category: "LAYANAN", orderNumber: "RES-UJI-001", status: "DELIVERED", paymentStatus: "BELUM_BAYAR" },
  });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: admin.user.id }));
  return { bank, order, cAdmin: makeClient(server.baseUrl, admin.token), cFin: makeClient(server.baseUrl, fin.token) };
}

async function saldoBank() {
  const akun = await testPrisma.finAccount.findFirst({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } }, select: { debit: true, credit: true } });
  return baris.reduce((a, b) => a.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

/** Skenario produksi: Payment langsung dicatat (belum diverifikasi, berjurnal) lalu order ditandai LUNAS lewat dropdown Sales. */
async function paymentMenunggu(w) {
  const r = await w.cAdmin.post(`/api/orders/${w.order.id}/payments`, { amount: 3_726_000, method: "TRANSFER", cashAccountId: w.bank.id, proofPhotoUrl: "/media/payment-proofs/uji.jpg" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  await testPrisma.order.update({ where: { id: w.order.id }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  return r.body.payment.id;
}

test("Payment BELUM diverifikasi tetap berjurnal (aturan historis: kas diakui saat dicatat; guard tidak mengubahnya)", async () => {
  const w = await dunia();
  const id = await paymentMenunggu(w);
  const j = await testPrisma.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", sourceId: id } });
  assert.equal(j.length, 1, "jurnal ada walau belum diverifikasi — aturan eksplisit paymentLedger.js/jembatanKas.js");
  assert.equal(await saldoBank(), "3726000.00");
});

test("GUARD: verifikasi penerimaan ditolak 409 PAYMENT_MENUNGGU_VERIFIKASI bila order punya Payment aktif belum-verifikasi — tidak ada Payment/jurnal baru", async () => {
  const w = await dunia();
  await paymentMenunggu(w);

  const antre = (await w.cFin.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.equal(antre.items.length, 1, "order tampak 'belum dicatat' karena Payment menunggu tidak terhitung (gerbang) — inilah jebakannya");
  assert.deepEqual(antre.items[0].pembayaranMenunggu, { jumlah: 1, total: 3_726_000 }, "antrean menandai Payment menunggu");

  const r = await w.cFin.post("/api/finance/penerimaan/verifikasi", { orderId: w.order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: w.bank.id, proofPhotoUrl: "/media/finance-receipts/b.jpg" });
  assert.equal(r.status, 409, JSON.stringify(r.body));
  assert.equal(r.body.code, "PAYMENT_MENUNGGU_VERIFIKASI");
  assert.match(r.body.error, /BELUM diverifikasi/);
  assert.equal(await testPrisma.payment.count({ where: { orderId: w.order.id } }), 1, "tidak ada Payment kedua");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PEMBAYARAN_ORDER" } }), 1, "tidak ada jurnal kedua");
  assert.equal(await saldoBank(), "3726000.00", "saldo bank tidak berlipat");
});

test("GUARD berlaku juga di verifikasi massal: baris itu gagal dengan pesan jelas, tidak membatalkan yang lain", async () => {
  const w = await dunia();
  await paymentMenunggu(w);
  const lain = await testPrisma.order.create({ data: { customerId: w.order.customerId, value: 500_000, category: "LAYANAN", orderNumber: "RES-UJI-002", status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date() } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: lain.id, userId: null }));
  const r = await w.cFin.post("/api/finance/penerimaan/verifikasi-massal", { orderIds: [w.order.id, lain.id], mode: "REKENING", method: "TRANSFER", cashAccountId: w.bank.id });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.berhasil, 1);
  assert.equal(r.body.gagal, 1);
  const gagal = r.body.hasil.find((h) => !h.ok);
  assert.equal(gagal.orderId, w.order.id);
  assert.match(gagal.error, /BELUM diverifikasi/);
});

test("Jalur resmi: verifikasi Payment yang menunggu → status bayar benar, antrean kosong, satu Payment, satu jurnal", async () => {
  const w = await dunia();
  const id = await paymentMenunggu(w);
  const v = await w.cFin.post(`/api/finance/pembayaran/${id}/verifikasi`, {});
  assert.equal(v.status, 201, JSON.stringify(v.body));
  assert.equal((await w.cFin.get("/api/finance/penerimaan/lunas-belum-dicatat")).body.semua.jumlah, 0);
  assert.equal(await testPrisma.payment.count({ where: { orderId: w.order.id } }), 1);
  assert.equal(await saldoBank(), "3726000.00");
});

test("Payment menunggu yang SALAH INPUT dibatalkan (jurnal dibalik) → penerimaan boleh dibuat; saldo = satu kali", async () => {
  const w = await dunia();
  const id = await paymentMenunggu(w);
  const b = await w.cAdmin.post(`/api/orders/${w.order.id}/payments/${id}/cancel`, { reason: "salah input" });
  assert.equal(b.status, 200, JSON.stringify(b.body));
  assert.equal(await saldoBank(), "0.00", "jurnal dibalik");
  await testPrisma.order.update({ where: { id: w.order.id }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  const r = await w.cFin.post("/api/finance/penerimaan/verifikasi", { orderId: w.order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: w.bank.id, proofPhotoUrl: "/media/finance-receipts/b.jpg" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldoBank(), "3726000.00");
});

test("Tanpa Payment menunggu, verifikasi penerimaan berjalan seperti biasa (jalur normal tidak berubah)", async () => {
  const w = await dunia();
  await testPrisma.order.update({ where: { id: w.order.id }, data: { paymentStatus: "LUNAS", paidAt: new Date() } });
  const antre = (await w.cFin.get("/api/finance/penerimaan/lunas-belum-dicatat")).body;
  assert.deepEqual(antre.items[0].pembayaranMenunggu, { jumlah: 0, total: 0 });
  const r = await w.cFin.post("/api/finance/penerimaan/verifikasi", { orderId: w.order.id, mode: "REKENING", method: "TRANSFER", cashAccountId: w.bank.id, proofPhotoUrl: "/media/finance-receipts/b.jpg" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(await saldoBank(), "3726000.00");
});
