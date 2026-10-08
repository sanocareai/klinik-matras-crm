// ORDER DIBATALKAN TIDAK BOLEH MENYISAKAN PIUTANG (laporan Owner 6 Okt 2026: 7 order CANCELLED masih muncul di Piutang, Rp4,65 juta). Dikunci:
//   - POST /orders/:id/cancel membalik jurnal pengakuan pendapatan → piutang order nol, pendapatan ikut turun, kas tidak berubah;
//   - order lama yang sudah CANCELLED tetapi pengakuannya belum dibalik TIDAK tampil di daftar piutang (dilaporkan di `dibatalkan`) dan muncul di Diagnosis sebagai ORDER_DIBATALKAN;
//   - order dibuka lagi (DELIVERED) sesudah dibatalkan → diakui ULANG dengan kunci ber-sufiks, dan pembayaran sesudahnya menutup piutang (bukan Uang Muka);
//   - order tanpa pengakuan (belum diserahkan) dibatalkan → tidak ada jurnal apa pun.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition, postPaymentReceived, pendapatanSudahDiakui } from "../../src/services/finance/posting/orderRevenue.js";
import { umurPiutang } from "../../src/services/finance/reports.js";
import { diagnosisPiutang } from "../../src/services/finance/piutangDiagnosis.js";

let server; let n = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Batal" } });
  const buat = async ({ status = "DELIVERED", value = 1_000_000, diakui = true } = {}) => {
    const o = await testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `BTL-${String(++n).padStart(3, "0")}`, status, paymentStatus: "BELUM_BAYAR" } });
    if (diakui) await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id }));
    return o;
  };
  return { bank, admin, buat, api: makeClient(server.baseUrl, admin.token) };
}
async function saldo(kode, orderId = null) {
  const akun = await testPrisma.finAccount.findFirst({ where: { code: kode } });
  const a = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, ...(orderId && { orderId }), entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0);
}

test("Batalkan Order: jurnal pengakuan dibalik → piutang order nol, pendapatan turun, kas tidak berubah, tak tampil di piutang", async () => {
  const { buat, api } = await dunia();
  const o = await buat({ value: 1_600_000 });
  assert.equal(await saldo("1-1300", o.id), 1_600_000);
  const pendapatanSebelum = await saldo("4-1100");
  const r = await api.post(`/api/orders/${o.id}/cancel`, { reason: "salah input" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.status, "CANCELLED");

  assert.equal(await saldo("1-1300", o.id), 0, "piutang order batal harus nol");
  assert.equal(await saldo("4-1100"), pendapatanSebelum + 1_600_000, "pendapatan (kredit negatif) turun sebesar yang diakui");
  const pembalik = await testPrisma.finJournalEntry.findFirst({ where: { source: "REVERSAL" }, include: { lines: true } });
  assert.match(pembalik.description, /Order dibatalkan — salah input/);
  assert.equal(await pendapatanSudahDiakui(testPrisma, o.id), false);

  const ar = await umurPiutang(testPrisma, {});
  assert.ok(!ar.baris.some((b) => b.orderId === o.id));
  assert.equal(ar.total, 0);
  assert.equal(ar.dibatalkan.jumlah, 0);
  const ulang = await api.post(`/api/orders/${o.id}/cancel`, { reason: "dobel klik" }); // idempoten
  assert.equal(ulang.status, 200);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1, "tidak boleh ada pembalik kedua");
});

test("order belum diserahkan (tanpa pengakuan) dibatalkan → tidak ada jurnal apa pun", async () => {
  const { buat, api } = await dunia();
  const o = await buat({ status: "PROCESSING", diakui: false });
  const sebelum = await testPrisma.finJournalEntry.count();
  assert.equal((await api.post(`/api/orders/${o.id}/cancel`, { reason: "batal" })).status, 200);
  assert.equal(await testPrisma.finJournalEntry.count(), sebelum);
});

test("order batal LAMA yang pengakuannya belum dibalik: tidak tampil di daftar piutang, dilaporkan di `dibatalkan`, dan jadi ORDER_DIBATALKAN di Diagnosis", async () => {
  const { buat } = await dunia();
  const sehat = await buat({ value: 500_000 });
  const lama = await buat({ value: 1_350_000 });
  await testPrisma.order.update({ where: { id: lama.id }, data: { status: "CANCELLED" } }); // pembatalan zaman dulu: status berubah, jurnal tidak

  const ar = await umurPiutang(testPrisma, {});
  assert.deepEqual(ar.baris.map((b) => b.orderId), [sehat.id]);
  assert.equal(ar.total, 500_000);
  assert.deepEqual(ar.dibatalkan, { jumlah: 1, total: 1_350_000 });
  assert.equal(ar.total + ar.dibatalkan.total + ar.menungguVerifikasi.total, await saldo("1-1300"), "neraca = daftar + menungguVerifikasi + dibatalkan");

  const d = await diagnosisPiutang(testPrisma, {});
  const baris = d.baris.find((b) => b.orderId === lama.id);
  assert.equal(baris.kategori, "ORDER_DIBATALKAN");
  assert.match(baris.penjelasan, /DIBATALKAN/);
  assert.equal(d.rekonsiliasi.selisih, 0);
  assert.equal(d.rekonsiliasi.perKategori.ORDER_DIBATALKAN.total, 1_350_000);
});

test("order dibatalkan lalu dibuka lagi: diakui ULANG (kunci ber-sufiks) dan pembayaran sesudahnya menutup piutang, bukan Uang Muka", async () => {
  const { buat, api, bank, admin } = await dunia();
  const o = await buat({ value: 900_000 });
  await api.post(`/api/orders/${o.id}/cancel`, { reason: "salah input" });
  assert.equal(await saldo("1-1300", o.id), 0);

  await testPrisma.order.update({ where: { id: o.id }, data: { status: "DELIVERED" } });
  const r = await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id }));
  assert.equal(r.created, true, "pengakuan ulang harus benar-benar dibuat");
  assert.match(r.entry.idempotencyKey, /:ULANG:1$/);
  assert.equal(await saldo("1-1300", o.id), 900_000);
  assert.equal(await pendapatanSudahDiakui(testPrisma, o.id), true);
  const lagi = await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id }));
  assert.equal(lagi.created, false, "pengakuan aktif → idempoten");

  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: 900_000, method: "TRANSFER", cashAccountId: bank.id, recordedById: admin.user.id } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: admin.user.id }));
  assert.equal(await saldo("1-1300", o.id), 0, "pembayaran menutup piutang");
  assert.equal(await saldo("2-1200", o.id), 0, "tidak ada Uang Muka palsu");
});

test("jalur kedua: ubah status order ke CANCELLED lewat PATCH (dropdown) juga membalik pengakuan", async () => {
  const { buat, api } = await dunia();
  const o = await buat({ value: 750_000 });
  const r = await api.patch(`/api/orders/${o.id}`, { status: "CANCELLED", statusOverrideNote: "dibatalkan customer" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).status, "CANCELLED");
  assert.equal(await saldo("1-1300", o.id), 0);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
  assert.equal((await umurPiutang(testPrisma, {})).total, 0);
});
