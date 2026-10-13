// JURNAL REFUND KELEBIHAN BAYAR — terhadap PostgreSQL sungguhan. Aturan (posting/orderRevenue.js#postRefund), untuk order yang pendapatannya SUDAH diakui:
//   debit refund menutup, berurutan: (1) saldo Uang Muka Pelanggan 2-1200, (2) saldo KREDIT Piutang order, (3) sisanya Retur & Potongan 4-2100.
//   Biaya admin transfer = Dr Beban Administrasi Bank terpisah; Cr rekening = nominal + biaya. Refund yang BUKAN kelebihan bayar tidak berubah (seluruhnya Retur).
// Kombinasi yang dikunci: seluruhnya uang muka · sebagian uang muka + retur · seluruhnya retur · lewat kredit piutang · biaya admin · koreksi refund ·
// pembatalan (reversal) · replay & paralel · laporan (Laba Rugi, Arus Kas, Neraca Saldo) konsisten.
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
import { recomputeOrderPaymentStatus } from "../../src/services/paymentLedger.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const LAMPIRAN = `/media/finance-receipts/${"a".repeat(40)}.jpg`;
const kunci = () => ({ "Idempotency-Key": `kb-${randomUUID()}` });
const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
let nomor = 0;

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const fin = await createTestUser({ roles: ["FINANCE"] });
  return { bank, admin, a: makeClient(server.baseUrl, admin.token, { tanpaStepUp: true }), f: makeClient(server.baseUrl, fin.token) };
}

/** `bayarSebelum` = Payment sebelum diserahkan (masuk Uang Muka), `bayarSesudah` = Payment sesudah pengakuan (masuk Piutang). */
async function order(w, { value, bayarSebelum = [], bayarSesudah = [] } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Pak Sofyan" } });
  const o = await testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", status: "PROCESSING", orderNumber: `RES-KB-${String(++nomor).padStart(3, "0")}` } });
  const bayar = async (amount) => {
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", recordedById: w.admin.user.id, cashAccountId: w.bank.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.admin.user.id }));
  };
  for (const n of bayarSebelum) await bayar(n);
  await testPrisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: w.admin.user.id }));
  for (const n of bayarSesudah) await bayar(n);
  await testPrisma.$transaction((tx) => recomputeOrderPaymentStatus(tx, o.id));
  return o;
}
const muat = (id) => testPrisma.order.findUnique({ where: { id } });

async function buatRefund(w, orderId, amount, { fee = false, setuju = true } = {}) {
  const r = await w.a.post("/api/finance/refunds", { orderId, date: hariIni(), amount, reason: "Item tidak jadi dipakai", cashAccountId: w.bank.id, attachmentUrl: LAMPIRAN, ...(fee ? { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" } : {}) });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  if (setuju) { const ap = await w.a.post(`/api/finance/refunds/${r.body.id}/approve`, {}); assert.equal(ap.status, 200, JSON.stringify(ap.body)); }
  return r.body;
}
async function saldo(orderId, systemKey) {
  const a = await testPrisma.finAccount.findUnique({ where: { systemKey } });
  const agg = await testPrisma.finJournalLine.aggregate({ where: { accountId: a.id, orderId, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}
async function saldoBank(w) {
  const agg = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: w.bank.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(agg._sum.debit ?? 0) - Number(agg._sum.credit ?? 0);
}
const barisRefund = async (refundId) => {
  const j = await testPrisma.finJournalEntry.findFirst({ where: { source: "REFUND", sourceId: refundId, status: "POSTED" }, include: { lines: { include: { account: true } } } });
  return j ? j.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort((x, y) => x[0].localeCompare(y[0])) : null;
};
async function bukuSeimbang() {
  for (const e of await testPrisma.finJournalEntry.findMany({ include: { lines: true } })) {
    assert.equal(e.lines.reduce((a, l) => a + Number(l.debit), 0), e.lines.reduce((a, l) => a + Number(l.credit), 0), `jurnal ${e.entryNumber} seimbang`);
  }
}

test("1. seluruhnya dari uang muka: bayar 4,2 jt sebelum diserahkan, tagihan 4,0 jt, refund 200 rb → Dr Uang Muka / Cr Bank; 2-1200 bersih, Retur 0, order tetap LUNAS", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_200_000] });
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), -200_000, "kelebihan bayar menunggu dikembalikan");
  const rf = await buatRefund(w, o.id, 200_000);
  assert.deepEqual(await barisRefund(rf.id), [["BANK", 0, 200_000], ["UANG_MUKA_PELANGGAN", 200_000, 0]]);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.RETUR_PENJUALAN), 0);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.PIUTANG_USAHA), 0);
  assert.equal(await saldoBank(w), 4_000_000);
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");
  // laporan: pendapatan 4,0 jt tidak berkurang; kas keluar 200 rb; audit konsistensi tanpa sisa
  const d = hariIni();
  const lr = (await w.f.get(`/api/finance/reports/income-statement?from=${d}&to=${d}`)).body.ringkasan;
  assert.equal(lr.labaBersih, 4_000_000, "refund kelebihan bayar tidak mengurangi pendapatan/laba");
  const cf = (await w.f.get(`/api/finance/reports/cash-flow?from=${d}&to=${d}`)).body.ringkasan;
  assert.deepEqual([cf.masuk, cf.keluar], [4_200_000, 200_000]);
  await bukuSeimbang();
});

test("2. sebagian uang muka, sebagian retur: kelebihan 200 rb, refund 300 rb → Dr Uang Muka 200 rb + Dr Retur & Potongan 100 rb; order jadi DP (refund melebihi kelebihan bayar)", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_200_000] });
  const rf = await buatRefund(w, o.id, 300_000);
  assert.deepEqual(await barisRefund(rf.id), [["BANK", 0, 300_000], ["RETUR_PENJUALAN", 100_000, 0], ["UANG_MUKA_PELANGGAN", 200_000, 0]]);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.RETUR_PENJUALAN), 100_000);
  assert.equal((await muat(o.id)).paymentStatus, "DP", "pembayaran bersih 3,9 jt < tagihan 4,0 jt");
  const d = hariIni();
  assert.equal((await w.f.get(`/api/finance/reports/income-statement?from=${d}&to=${d}`)).body.ringkasan.labaBersih, 3_900_000, "hanya 100 rb yang mengurangi pendapatan");
  await bukuSeimbang();
});

test("3. seluruhnya retur: bayar pas 4,0 jt, refund 200 rb → Dr Retur & Potongan / Cr Bank (perilaku lama tidak berubah)", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_000_000] });
  const rf = await buatRefund(w, o.id, 200_000);
  assert.deepEqual(await barisRefund(rf.id), [["BANK", 0, 200_000], ["RETUR_PENJUALAN", 200_000, 0]]);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0);
  assert.equal((await muat(o.id)).paymentStatus, "DP");
  await bukuSeimbang();
});

test("4. kelebihan bayar lewat KREDIT PIUTANG: diserahkan lebih dulu, bayar 4,2 jt sesudahnya → refund 200 rb menutup kredit piutang (Dr Piutang), bukan Retur; refund 300 rb → piutang 200 rb + retur 100 rb", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSesudah: [4_200_000] });
  assert.equal(await saldo(o.id, SYSTEM_KEYS.PIUTANG_USAHA), -200_000, "piutang bersaldo kredit = pelanggan kelebihan bayar");
  const rf = await buatRefund(w, o.id, 200_000);
  assert.deepEqual(await barisRefund(rf.id), [["BANK", 0, 200_000], ["PIUTANG_USAHA", 200_000, 0]]);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.PIUTANG_USAHA), 0);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.RETUR_PENJUALAN), 0);
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");

  const o2 = await order(w, { value: 4_000_000, bayarSesudah: [4_200_000] });
  const rf2 = await buatRefund(w, o2.id, 300_000);
  assert.deepEqual(await barisRefund(rf2.id), [["BANK", 0, 300_000], ["PIUTANG_USAHA", 200_000, 0], ["RETUR_PENJUALAN", 100_000, 0]]);
  await bukuSeimbang();
});

test("5. biaya admin: refund kelebihan bayar 200 rb + biaya BI-FAST → Dr Uang Muka 200 rb, Dr Beban Administrasi Bank, Cr Bank = nominal + biaya", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_200_000] });
  const rf = await buatRefund(w, o.id, 200_000, { fee: true });
  const baris = await barisRefund(rf.id);
  const biaya = baris.find((b) => b[0] === "BEBAN_ADMIN_BANK")[1];
  assert.ok(biaya > 0);
  assert.deepEqual(baris, [["BANK", 0, 200_000 + biaya], ["BEBAN_ADMIN_BANK", biaya, 0], ["UANG_MUKA_PELANGGAN", 200_000, 0]].sort((x, y) => x[0].localeCompare(y[0])));
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0);
  assert.equal(await saldoBank(w), 4_200_000 - 200_000 - biaya);
  await bukuSeimbang();
});

test("6. koreksi refund: 300 rb (200 uang muka + 100 retur) → 200 rb: jurnal lama dibalik, pengganti Dr Uang Muka 200 rb saja; tidak ditolak 'pengakuan pendapatan berubah'; order kembali LUNAS", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_200_000] });
  const rf = await buatRefund(w, o.id, 300_000);
  assert.equal((await muat(o.id)).paymentStatus, "DP");
  const rev = (await testPrisma.finRefund.findUnique({ where: { id: rf.id } })).updatedAt.toISOString();
  const k = await w.a.post(`/api/finance/refunds/${rf.id}/koreksi`, { reason: "Nominal disepakati ulang", amount: 200_000, bukti: { mode: "LAMA" }, expectedUpdatedAt: rev }, kunci());
  assert.equal(k.status, 201, JSON.stringify(k.body));
  assert.deepEqual(await barisRefund(k.body.baruId), [["BANK", 0, 200_000], ["UANG_MUKA_PELANGGAN", 200_000, 0]]);
  assert.equal(await barisRefund(rf.id), null, "jurnal refund lama tidak lagi aktif (dibalik, tidak dihapus)");
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.RETUR_PENJUALAN), 0, "retur 100 rb lama sudah dibalik");
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");
  await bukuSeimbang();
});

test("7. pembatalan refund: reversal mengembalikan saldo Uang Muka 200 rb persis seperti sebelum refund; uang kembali ke bank buku", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_200_000] });
  const rf = await buatRefund(w, o.id, 200_000);
  const c = await w.a.post(`/api/finance/refunds/${rf.id}/cancel`, { reason: "Salah input refund" });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), -200_000, "kelebihan bayar kembali menunggu dikembalikan");
  assert.equal(await saldoBank(w), 4_200_000);
  assert.equal((await muat(o.id)).paymentStatus, "LUNAS");
  await bukuSeimbang();
});

test("8. replay & paralel: persetujuan ganda bersamaan → satu jurnal; approve ulang ditolak; buku seimbang", async () => {
  const w = await dunia();
  const o = await order(w, { value: 4_000_000, bayarSebelum: [4_200_000] });
  const r = await buatRefund(w, o.id, 200_000, { setuju: false });
  const [x, y] = await Promise.all([w.a.post(`/api/finance/refunds/${r.id}/approve`, {}), w.a.post(`/api/finance/refunds/${r.id}/approve`, {})]);
  assert.deepEqual([x.status, y.status].sort(), [200, 409], JSON.stringify([x.body, y.body]));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REFUND", sourceId: r.id } }), 1);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0);
  assert.equal((await w.a.post(`/api/finance/refunds/${r.id}/approve`, {})).status, 409);
  assert.equal(await saldo(o.id, SYSTEM_KEYS.UANG_MUKA_PELANGGAN), 0, "tidak didebet dua kali");
  await bukuSeimbang();
});
