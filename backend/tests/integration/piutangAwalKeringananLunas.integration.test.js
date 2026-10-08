// Uji skrip piutang awal keringanan lunas (scripts/piutangAwalKeringananLunas.js): 10 order Hotel Discovery diserahkan sebelum pembukuan, tanpa jurnal sama sekali, belum dibayar.
// Yang dikunci: pratinjau tidak menulis; apply wajib KOREKSI_BACKUP_OK; hasil = jurnal NON-KAS Dr Piutang / Cr Laba Ditahan bertanggal saldo awal; kas/bank, status, tanggal lunas tidak berubah;
// idempoten; pengakuan pendapatan otomatis TIDAK membuat piutang kedua; dan pembayaran Hotel sesudahnya MENUTUP piutang (bukan menjadi Uang Muka palsu).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition, postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const NOMOR = [["083", 1_500_000], ["084", 1_500_000], ["085", 1_500_000], ["086", 1_500_000], ["087", 1_000_000], ["088", 1_000_000], ["089", 1_000_000], ["090", 1_000_000], ["091", 1_000_000], ["092", 1_100_000]];
async function dunia({ pelanggan = "HOTEL DISCOVERY ANCOL" } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const owner = await testPrisma.user.create({ data: { name: "OWNER (Admin)", email: `owner-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const customer = await testPrisma.customer.create({ data: { name: pelanggan } });
  const orders = [];
  for (const [no, nilai] of NOMOR) {
    const o = await testPrisma.order.create({ data: { customerId: customer.id, value: nilai, category: "LAYANAN", orderNumber: `RES-19082026-${no}`, status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date("2026-09-30T05:00:00Z") } });
    await testPrisma.orderPaidAtPengecualian.create({ data: { orderId: o.id, paidAtDikunci: new Date("2026-09-30T05:00:00Z"), alasan: "Keringanan target September (uji)", createdById: owner.id } });
    orders.push(o);
  }
  return { bank, owner, orders };
}
const jalankan = (args, env = {}) => {
  try { return { kode: 0, out: execFileSync(process.execPath, ["scripts/piutangAwalKeringananLunas.js", ...args], { cwd: akar, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { kode: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
async function foto() {
  const per = async (where) => { const a = await testPrisma.finJournalLine.aggregate({ where: { ...where, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0); };
  const akun = async (key) => testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS[key] } });
  const orders = await testPrisma.order.findMany({ select: { orderNumber: true, paymentStatus: true, paidAt: true, status: true } });
  return { kas: await per({ cashAccountId: { not: null } }), piutang: await per({ accountId: (await akun("PIUTANG_USAHA")).id }), uangMuka: await per({ accountId: (await akun("UANG_MUKA_PELANGGAN")).id }), jurnal: await testPrisma.finJournalEntry.count(), orders: orders.sort((a, b) => a.orderNumber.localeCompare(b.orderNumber)) };
}

test("pratinjau tidak menulis; apply tanpa KOREKSI_BACKUP_OK ditolak", async () => {
  await dunia();
  const sebelum = await foto();
  const p = jalankan([]);
  assert.equal(p.kode, 0, p.out);
  assert.match(p.out, /PRATINJAU/);
  assert.match(p.out, /Rp12\.100\.000,00/);
  assert.deepEqual(await foto(), sebelum);
  const tolak = jalankan(["--apply"]);
  assert.notEqual(tolak.kode, 0);
  assert.match(tolak.out, /KOREKSI_BACKUP_OK/);
  assert.deepEqual(await foto(), sebelum);
});

test("apply: 10 jurnal non-kas Dr Piutang / Cr Laba Ditahan bertanggal saldo awal; kas, status, tanggal lunas tak berubah; idempoten", async () => {
  const { orders } = await dunia();
  const sebelum = await foto();
  const a = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(a.kode, 0, a.out);
  assert.match(a.out, /DIBUAT 10 jurnal/);
  const sesudah = await foto();
  assert.equal(sesudah.piutang, 12_100_000);
  assert.equal(sesudah.kas, sebelum.kas);
  assert.equal(sesudah.uangMuka, 0);
  assert.equal(sesudah.jurnal, sebelum.jurnal + 10);
  assert.deepEqual(sesudah.orders, sebelum.orders);
  const e = await testPrisma.finJournalEntry.findFirst({ where: { idempotencyKey: `PENGAKUAN_PENDAPATAN:${orders[0].id}` }, include: { lines: { include: { account: { select: { systemKey: true } } } } } });
  assert.equal(e.source, "SALDO_AWAL");
  assert.equal(e.date.toISOString().slice(0, 10), "2026-09-18");
  assert.ok(e.lines.every((l) => !l.cashAccountId && l.orderId === orders[0].id));
  assert.deepEqual(e.lines.map((l) => [l.account.systemKey, Number(l.debit), Number(l.credit)]).sort(), [[SYSTEM_KEYS.LABA_DITAHAN, 0, 1_500_000], [SYSTEM_KEYS.PIUTANG_USAHA, 1_500_000, 0]].sort());
  const ulang = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(ulang.kode, 0, ulang.out);
  assert.match(ulang.out, /SUDAH DIKOREKSI/);
  assert.deepEqual(await foto(), sesudah);
});

test("sesudah piutang awal: pengakuan otomatis tidak menggandakan piutang, dan pembayaran Hotel MENUTUP piutang (bukan Uang Muka palsu)", async () => {
  const { orders, bank, owner } = await dunia();
  assert.equal(jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" }).kode, 0);
  const r = await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: orders[0].id, userId: owner.id }));
  assert.equal(r.created, false, "pendapatan dianggap sudah diakui — tidak ada piutang kedua");
  const p = await testPrisma.payment.create({ data: { orderId: orders[0].id, amount: 1_500_000, method: "TRANSFER", cashAccountId: bank.id, recordedById: owner.id, createdAt: new Date("2026-10-07T05:00:00Z") } });
  await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: owner.id }));
  const f = await foto();
  assert.equal(f.piutang, 12_100_000 - 1_500_000, "piutang order itu ditutup");
  assert.equal(f.uangMuka, 0, "tidak boleh ada Uang Muka palsu");
  assert.equal(f.kas, 1_500_000, "uang baru masuk bank pada saat dibayar");
});

test("data tidak sesuai dugaan → berhenti tanpa menulis (sudah ada Payment / bukan Hotel Discovery)", async () => {
  const { orders, owner } = await dunia();
  await testPrisma.payment.create({ data: { orderId: orders[3].id, amount: 100_000, method: "TRANSFER", recordedById: owner.id } });
  const sebelum = await foto();
  const r = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(r.kode, 2, r.out);
  assert.match(r.out, /Payment aktif/);
  assert.deepEqual(await foto(), sebelum);
  await truncateAll();
  await dunia({ pelanggan: "Pelanggan Lain" });
  const x = jalankan([]);
  assert.equal(x.kode, 2);
  assert.match(x.out, /bukan Hotel Discovery/);
});
