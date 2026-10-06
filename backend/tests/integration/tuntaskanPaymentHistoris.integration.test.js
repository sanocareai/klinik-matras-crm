// Uji skrip penuntasan SATU Payment historis (scripts/tuntaskanPaymentHistoris.js) pada kasus Stanley: Payment terverifikasi bertanggal sebelum saldo awal, tanpa jurnal;
// pendapatan baru diakui sesudahnya → Piutang Usaha menggantung. Yang dikunci: pratinjau tidak menulis; --apply wajib TUNTAS_OK; hasil = jurnal NON-KAS Dr Laba Ditahan / Cr Piutang
// (Kas/Bank tidak berubah, status & tanggal lunas order tidak berubah); idempoten; Payment setelah saldo awal ditolak.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

async function dunia({ tanggalBayar = "2026-09-11T05:00:00Z", paidAt = null } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const owner = await testPrisma.user.create({ data: { name: "OWNER (Admin)", email: `owner-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const customer = await testPrisma.customer.create({ data: { name: "Stanley" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 6_450_000, category: "BARU", orderNumber: "NEW-07092026-008", status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date(paidAt ?? tanggalBayar) } });
  const payment = await testPrisma.payment.create({ data: { orderId: order.id, amount: 6_450_000, method: "TRANSFER", recordedById: owner.id, createdAt: new Date(tanggalBayar) } });
  await testPrisma.paymentVerification.create({ data: { paymentId: payment.id, verifiedById: owner.id } });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: order.id, userId: owner.id }));
  return { pt, owner, order, payment };
}
const hariWIB = (iso) => new Date(new Date(iso).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const jalankan = (args, env = {}) => {
  try { return { kode: 0, out: execFileSync(process.execPath, ["scripts/tuntaskanPaymentHistoris.js", ...args], { cwd: akar, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { kode: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
async function foto(orderId) {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA } });
  const s = async (where) => { const a = await testPrisma.finJournalLine.aggregate({ where: { ...where, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0); };
  const kas = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: { not: null }, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  const o = await testPrisma.order.findUnique({ where: { id: orderId } });
  return { piutangOrder: await s({ accountId: akun.id, orderId }), kas: Number(kas._sum.debit ?? 0) - Number(kas._sum.credit ?? 0), jurnal: await testPrisma.finJournalEntry.count(), status: o.paymentStatus, paidAt: o.paidAt?.toISOString() };
}

test("pratinjau tidak menulis; apply tanpa TUNTAS_OK ditolak", async () => {
  const { order } = await dunia();
  const sebelum = await foto(order.id);
  assert.equal(sebelum.piutangOrder, 6_450_000);
  const p = jalankan(["--order=NEW-07092026-008"]);
  assert.equal(p.kode, 0, p.out);
  assert.match(p.out, /PRATINJAU/);
  assert.match(p.out, /C2/);
  assert.deepEqual(await foto(order.id), sebelum);
  const tolak = jalankan(["--order=NEW-07092026-008", "--apply"]);
  assert.notEqual(tolak.kode, 0);
  assert.match(tolak.out, /TUNTAS_OK/);
  assert.deepEqual(await foto(order.id), sebelum);
});

test("apply: piutang order jadi 0 lewat jurnal non-kas Dr Laba Ditahan / Cr Piutang; kas, status, tanggal lunas tidak berubah; idempoten", async () => {
  const { order, payment } = await dunia();
  const sebelum = await foto(order.id);
  const a = jalankan(["--order=NEW-07092026-008", "--apply"], { TUNTAS_OK: "1" });
  assert.equal(a.kode, 0, a.out);
  assert.match(a.out, /DITUNTASKAN/);
  const sesudah = await foto(order.id);
  assert.equal(sesudah.piutangOrder, 0);
  assert.equal(sesudah.kas, sebelum.kas, "Kas/Bank tidak boleh berubah");
  assert.equal(sesudah.status, sebelum.status);
  assert.equal(sesudah.paidAt, sebelum.paidAt);
  assert.equal(sesudah.jurnal, sebelum.jurnal + 1);
  const e = await testPrisma.finJournalEntry.findFirst({ where: { source: "PEMBAYARAN_ORDER", sourceId: payment.id }, include: { lines: { include: { account: { select: { code: true, systemKey: true } } } } } });
  assert.equal(e.status, "POSTED");
  assert.ok(e.lines.every((l) => !l.cashAccountId), "jurnal non-kas");
  assert.deepEqual(e.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [[SYSTEM_KEYS.LABA_DITAHAN, 6_450_000, 0], [SYSTEM_KEYS.PIUTANG_USAHA, 0, 6_450_000]].sort());
  const ulang = jalankan(["--order=NEW-07092026-008", "--apply"], { TUNTAS_OK: "1" });
  assert.equal(ulang.kode, 0, ulang.out);
  assert.match(ulang.out, /SUDAH TUNTAS/);
  assert.deepEqual(await foto(order.id), sesudah);
});

test("Payment bertanggal SETELAH saldo awal dan order tak dikenal ditolak tanpa menulis", async () => {
  const { order } = await dunia({ tanggalBayar: "2026-09-25T05:00:00Z" });
  const sebelum = await foto(order.id);
  const r = jalankan(["--order=NEW-07092026-008", "--apply"], { TUNTAS_OK: "1" });
  assert.equal(r.kode, 2, r.out);
  assert.match(r.out, /bukan Payment historis/);
  assert.deepEqual(await foto(order.id), sebelum);
  const x = jalankan(["--order=TIDAK-ADA"]);
  assert.equal(x.kode, 2);
  assert.match(x.out, /tidak ditemukan/);
});

test("paidAt order bertanggal sama (WIB) tetapi jam berbeda dari tanggal terima Payment → lolos; tanggal WIB tetap, jam diselaraskan fungsi resmi", async () => {
  const { order } = await dunia({ paidAt: "2026-09-11T02:12:08Z" }); // 09.12 WIB; Payment 12.00 WIB hari yang sama (kasus Stanley produksi)
  const a = jalankan(["--order=NEW-07092026-008", "--apply"], { TUNTAS_OK: "1" });
  assert.equal(a.kode, 0, a.out);
  const o = await testPrisma.order.findUnique({ where: { id: order.id } });
  assert.equal(o.paymentStatus, "LUNAS");
  assert.equal(hariWIB(o.paidAt.toISOString()), "2026-09-11");
  assert.equal((await foto(order.id)).piutangOrder, 0);
});
