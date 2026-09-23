// Pembayaran Insentif Driver x ledger Finance (24 September 2026) — real
// Postgres. Bukti: satu payout = satu jurnal seimbang (Dr Beban Insentif
// Driver / Cr Kas-Bank) di transaksi yang sama; void = satu jurnal balik.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
let seq = 0;
const K = () => ({ "Idempotency-Key": randomUUID() });
const URL_PAYOUT = "/api/armada/incentive-payouts";

test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function fixture() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const akunBeban = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BEBAN_INSENTIF_DRIVER } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Tes", kind: "KAS", accountId: akunKas.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const approver = await createTestUser({ roles: ["APPROVER"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: driver.user.id }, data: { hasSim: true } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan", city: "Jakarta" } });
  const f = {
    admin: { ...admin, api: makeClient(server.baseUrl, admin.token) },
    finance: { ...finance, api: makeClient(server.baseUrl, finance.token) },
    approver: { ...approver, api: makeClient(server.baseUrl, approver.token) },
    kas, akunKas, akunBeban,
  };
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `FIN-PAY-${++seq}`, value: 1000, category: "LAYANAN" } });
  await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, driverId: driver.user.id, status: "COMPLETED", sequence: 1, completedAt: new Date("2026-09-05T02:00:00.000Z"), addressText: "Alamat tes" } });
  const buat = await f.finance.api.post("/api/armada/incentive-snapshots", { mode: "custom", from: "2026-09-01", to: "2026-09-10" }, K());
  assert.equal(buat.status, 201, JSON.stringify(buat.body));
  await f.finance.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/review`, {}, K());
  const ap = await f.approver.api.post(`/api/armada/incentive-snapshots/${buat.body.id}/approve`, {}, K());
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  f.line = ap.body.lines[0]; // totalRupiah 7000
  return f;
}
const body = (f, amount, extra = {}) => ({ snapshotLineId: f.line.id, amount, method: "TRANSFER", paidAt: "2026-09-20T10:00:00.000Z", cashAccountId: f.kas.id, ...extra });
const jurnalInsentif = () => testPrisma.finJournalEntry.findMany({ where: { source: "INSENTIF_DRIVER" }, include: { lines: true } });
const num = (d) => Number(d.toString());

test("satu payout = satu jurnal seimbang: Dr Beban Insentif Driver, Cr Kas, ter-link FK unik", async () => {
  const f = await fixture();
  const res = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  assert.equal(res.status, 201, JSON.stringify(res.body));
  const payout = await testPrisma.incentivePayout.findUnique({ where: { id: res.body.id } });
  assert.ok(payout.journalEntryId);
  assert.equal(payout.cashAccountId, f.kas.id);
  const js = await jurnalInsentif();
  assert.equal(js.length, 1);
  const j = js[0];
  assert.equal(j.id, payout.journalEntryId);
  assert.equal(j.status, "POSTED");
  assert.equal(j.sourceId, payout.id);
  assert.equal(j.lines.length, 2);
  const debit = j.lines.find((l) => num(l.debit) > 0);
  const kredit = j.lines.find((l) => num(l.credit) > 0);
  assert.equal(debit.accountId, f.akunBeban.id);
  assert.equal(kredit.accountId, f.akunKas.id);
  assert.equal(kredit.cashAccountId, f.kas.id);
  assert.equal(num(debit.debit), 7000);
  assert.equal(num(kredit.credit), 7000);
  assert.equal(await testPrisma.finExpense.count(), 0, "tidak numpang jalur Pengajuan Biaya");
  assert.equal(await testPrisma.expenseSubmission.count(), 0);
});

test("partial payout: jurnal sesuai nominal tiap pembayaran, satu jurnal per payout", async () => {
  const f = await fixture();
  assert.equal((await f.finance.api.post(URL_PAYOUT, body(f, 3000), K())).status, 201);
  assert.equal((await f.finance.api.post(URL_PAYOUT, body(f, 2000), K())).status, 201);
  const js = await jurnalInsentif();
  assert.equal(js.length, 2);
  assert.deepEqual(js.map((j) => num(j.lines.find((l) => num(l.debit) > 0).debit)).sort(), [2000, 3000]);
});

test("retry dengan Idempotency-Key sama: satu payout, satu jurnal", async () => {
  const f = await fixture();
  const hdr = K();
  const a = await f.finance.api.post(URL_PAYOUT, body(f, 7000), hdr);
  const b = await f.finance.api.post(URL_PAYOUT, body(f, 7000), hdr);
  assert.equal(a.status, 201);
  assert.equal(b.body.id, a.body.id);
  assert.equal(await testPrisma.incentivePayout.count(), 1);
  assert.equal((await jurnalInsentif()).length, 1);
});

test("request paralel dengan key sama: tidak double-post", async () => {
  const f = await fixture();
  const hdr = K();
  const hasil = await Promise.all([1, 2, 3].map(() => f.finance.api.post(URL_PAYOUT, body(f, 7000), hdr)));
  assert.ok(hasil.some((r) => r.status === 201), JSON.stringify(hasil.map((r) => r.status)));
  assert.equal(await testPrisma.incentivePayout.count(), 1);
  assert.equal((await jurnalInsentif()).length, 1);
});

test("request paralel key berbeda pada line sama: hanya satu yang muat, jurnal = payout", async () => {
  const f = await fixture();
  const hasil = await Promise.all([1, 2].map(() => f.finance.api.post(URL_PAYOUT, body(f, 7000), K())));
  assert.equal(hasil.filter((r) => r.status === 201).length, 1, JSON.stringify(hasil.map((r) => r.status)));
  assert.equal(await testPrisma.incentivePayout.count(), 1);
  assert.equal((await jurnalInsentif()).length, 1);
});

test("posting gagal (akun beban nonaktif) => seluruh transaksi rollback: tanpa payout, tanpa jurnal", async () => {
  const f = await fixture();
  await testPrisma.finAccount.update({ where: { id: f.akunBeban.id }, data: { active: false } });
  const res = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(await testPrisma.incentivePayout.count(), 0);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "INSENTIF_DRIVER" } }), 0);
});

test("posting gagal (akun beban hilang) => rollback total", async () => {
  const f = await fixture();
  await testPrisma.finAccount.update({ where: { id: f.akunBeban.id }, data: { systemKey: null } });
  const res = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  assert.equal(res.status, 409, JSON.stringify(res.body));
  assert.equal(await testPrisma.incentivePayout.count(), 0);
});

test("akun sumber dana: wajib, tidak ada, nonaktif ditolak; tanpa side-effect", async () => {
  const f = await fixture();
  const tanpa = await f.finance.api.post(URL_PAYOUT, body(f, 1000, { cashAccountId: undefined }), K());
  assert.equal(tanpa.status, 400);
  const fiktif = await f.finance.api.post(URL_PAYOUT, body(f, 1000, { cashAccountId: randomUUID() }), K());
  assert.equal(fiktif.status, 400);
  await testPrisma.finCashAccount.update({ where: { id: f.kas.id }, data: { active: false } });
  const nonaktif = await f.finance.api.post(URL_PAYOUT, body(f, 1000), K());
  assert.equal(nonaktif.status, 409, JSON.stringify(nonaktif.body));
  assert.equal(await testPrisma.incentivePayout.count(), 0);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "INSENTIF_DRIVER" } }), 0);
});

test("daftar sumber dana untuk form hanya berisi rekening aktif", async () => {
  const f = await fixture();
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "Bank Mati", kind: "BANK", accountId: akunBank.id, active: false } });
  const res = await f.finance.api.get(`${URL_PAYOUT}/cash-accounts`);
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.deepEqual(res.body.accounts.map((a) => a.name), ["Kas Tes"]);
});

test("void: tepat satu jurnal balik, jurnal asli REVERSED (tidak diedit/dihapus), payout menyimpan relasi unik", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  const v = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "salah catat" }, K());
  assert.equal(v.status, 200, JSON.stringify(v.body));
  const payout = await testPrisma.incentivePayout.findUnique({ where: { id: bayar.body.id } });
  assert.ok(payout.voidJournalEntryId);
  const asli = await testPrisma.finJournalEntry.findUnique({ where: { id: payout.journalEntryId }, include: { lines: true } });
  assert.equal(asli.status, "REVERSED");
  assert.equal(asli.lines.length, 2, "jurnal asli tidak dihapus");
  const balik = await testPrisma.finJournalEntry.findMany({ where: { reversalOfId: asli.id }, include: { lines: true } });
  assert.equal(balik.length, 1);
  assert.equal(balik[0].id, payout.voidJournalEntryId);
  assert.equal(num(balik[0].lines.find((l) => l.accountId === f.akunBeban.id).credit), 7000, "beban dikredit balik");
  assert.equal(num(balik[0].lines.find((l) => l.accountId === f.akunKas.id).debit), 7000, "kas didebit balik");
});

test("retry void: kunci sama diputar ulang, kunci baru 409, tetap SATU reversal", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  const hdr = K();
  const v1 = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "salah" }, hdr);
  const v2 = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "salah" }, hdr);
  const v3 = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "lagi" }, K());
  assert.equal(v1.status, 200);
  assert.equal(v2.status, 200);
  assert.equal(v3.status, 409);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
});

test("void paralel: hanya satu reversal", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  const hasil = await Promise.all([1, 2, 3].map(() => f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "paralel" }, K())));
  assert.equal(hasil.filter((r) => r.status === 200).length, 1, JSON.stringify(hasil.map((r) => r.status)));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
});

test("rekonsiliasi: total payout valid = total debit jurnal INSENTIF_DRIVER yang belum dibalik = saldo beban", async () => {
  const f = await fixture();
  const a = await f.finance.api.post(URL_PAYOUT, body(f, 3000), K());
  await f.finance.api.post(URL_PAYOUT, body(f, 2500), K());
  await f.finance.api.post(URL_PAYOUT, body(f, 1000), K());
  await f.admin.api.post(`${URL_PAYOUT}/${a.body.id}/void`, { reason: "salah" }, K());
  const valid = await testPrisma.incentivePayout.aggregate({ where: { voidedAt: null }, _sum: { amount: true } });
  const jurnalHidup = await testPrisma.finJournalEntry.findMany({ where: { source: "INSENTIF_DRIVER", status: "POSTED" }, include: { lines: true } });
  const totalJurnal = jurnalHidup.reduce((s, j) => s + num(j.lines.find((l) => l.accountId === f.akunBeban.id).debit), 0);
  assert.equal(valid._sum.amount, 3500);
  assert.equal(totalJurnal, valid._sum.amount);
  const lines = await testPrisma.finJournalLine.findMany({ where: { accountId: f.akunBeban.id } });
  assert.equal(lines.reduce((s, l) => s + num(l.debit) - num(l.credit), 0), 3500);
});

test("constraint DB: satu jurnal tidak bisa dimiliki dua payout", async () => {
  const f = await fixture();
  const p1 = await f.finance.api.post(URL_PAYOUT, body(f, 1000), K());
  const p2 = await f.finance.api.post(URL_PAYOUT, body(f, 1000), K());
  const satu = await testPrisma.incentivePayout.findUnique({ where: { id: p1.body.id } });
  await assert.rejects(testPrisma.incentivePayout.update({ where: { id: p2.body.id }, data: { journalEntryId: satu.journalEntryId } }), (e) => e.code === "P2002");
});

test("kontrak void: retry kunci sama mengembalikan hasil void PERTAMA (byte-sama, header replay), tanpa reversal baru", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  const hdr = K();
  const v1 = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "salah" }, hdr);
  const v2 = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "salah" }, hdr);
  assert.equal(v1.status, 200);
  assert.equal(v2.status, 200);
  assert.deepEqual(v2.body, v1.body, "respons replay identik dengan void pertama");
  assert.equal(v1.body.voidJournalEntryId, v2.body.voidJournalEntryId);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
});

test("kontrak void: paralel dengan kunci SAMA — satu reversal; yang lain replay atau 409 in-progress, tidak pernah reversal kedua", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  const hdr = K();
  const hasil = await Promise.all([1, 2, 3, 4].map(() => f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "paralel" }, hdr)));
  assert.ok(hasil.some((r) => r.status === 200), JSON.stringify(hasil.map((r) => r.status)));
  assert.ok(hasil.every((r) => [200, 409].includes(r.status)), JSON.stringify(hasil.map((r) => r.status)));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
  assert.equal(await testPrisma.incentivePayout.count({ where: { voidedAt: { not: null } } }), 1);
});

test("kontrak void: request BARU (kunci baru) pada payout yang sudah void = 409, tanpa efek samping", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "pertama" }, K());
  const antes = await testPrisma.incentivePayout.findUnique({ where: { id: bayar.body.id } });
  const v = await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "kedua" }, K());
  assert.equal(v.status, 409);
  const sesudah = await testPrisma.incentivePayout.findUnique({ where: { id: bayar.body.id } });
  assert.equal(sesudah.voidReason, "pertama");
  assert.equal(sesudah.voidJournalEntryId, antes.voidJournalEntryId);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }), 1);
});

test("respons riwayat memuat nomor jurnal, jurnal balik, dan rekening sumber dana (siap dirender UI)", async () => {
  const f = await fixture();
  const bayar = await f.finance.api.post(URL_PAYOUT, body(f, 7000), K());
  const a = await f.finance.api.get(`${URL_PAYOUT}?snapshotLineId=${f.line.id}`);
  assert.equal(a.status, 200);
  assert.match(a.body.payouts[0].journalEntry.entryNumber, /^JV-/);
  assert.equal(a.body.payouts[0].cashAccount.name, "Kas Tes");
  assert.equal(a.body.payouts[0].voidJournalEntry, null);
  await f.admin.api.post(`${URL_PAYOUT}/${bayar.body.id}/void`, { reason: "uji" }, K());
  const b = await f.finance.api.get(`${URL_PAYOUT}?snapshotLineId=${f.line.id}`);
  assert.match(b.body.payouts[0].voidJournalEntry.entryNumber, /^JV-/);
  assert.notEqual(b.body.payouts[0].voidJournalEntry.entryNumber, b.body.payouts[0].journalEntry.entryNumber);
});
