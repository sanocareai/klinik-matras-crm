// Skrip koreksi order batal lama (scripts/balikPengakuanOrderBatal.js): 7 order CANCELLED yang pengakuannya tertinggal (kasus produksi 6 Okt 2026, Rp4.650.000).
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

const KASUS = [["NEW-01102026-004", 1_600_000, "BARU"], ["NEW-30092026-052", 1_350_000, "BARU"], ["NEW-30092026-053", 900_000, "BARU"], ["SWS-28092026-015", 200_000, "SEWA"], ["NEW-30092026-054", 200_000, "BARU"], ["NEW-30092026-050", 200_000, "BARU"], ["NEW-30092026-051", 200_000, "BARU"]];
async function dunia({ denganPayment = false } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const owner = await testPrisma.user.create({ data: { name: "OWNER (Admin)", email: `owner-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan" } });
  const orders = [];
  for (const [no, nilai, kategori] of KASUS) {
    const o = await testPrisma.order.create({ data: { customerId: customer.id, value: nilai, category: kategori, orderNumber: no, status: "DELIVERED", paymentStatus: "BELUM_BAYAR" } });
    await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: owner.id }));
    await testPrisma.order.update({ where: { id: o.id }, data: { status: "CANCELLED" } });
    orders.push(o);
  }
  if (denganPayment) await testPrisma.payment.create({ data: { orderId: orders[0].id, amount: 1000, method: "CASH", recordedById: owner.id } });
  return { owner, orders };
}
const jalankan = (args, env = {}) => {
  try { return { kode: 0, out: execFileSync(process.execPath, ["scripts/balikPengakuanOrderBatal.js", ...args], { cwd: akar, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { kode: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
async function foto() {
  const akun = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.PIUTANG_USAHA } });
  const a = await testPrisma.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  const kas = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: { not: null }, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  return { piutang: Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0), kas: Number(kas._sum.debit ?? 0) - Number(kas._sum.credit ?? 0), jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count() };
}

test("pratinjau tidak menulis; apply tanpa KOREKSI_BACKUP_OK ditolak", async () => {
  await dunia();
  const sebelum = await foto();
  assert.equal(sebelum.piutang, 4_850_000 - 200_000, "1,6+1,35+0,9+0,2×4 = 4,65 jt");
  const p = jalankan([]);
  assert.equal(p.kode, 0, p.out);
  assert.match(p.out, /PRATINJAU/);
  assert.match(p.out, /Rp4\.650\.000,00 → Rp0,00/);
  assert.deepEqual(await foto(), sebelum);
  const tolak = jalankan(["--apply"]);
  assert.notEqual(tolak.kode, 0);
  assert.match(tolak.out, /KOREKSI_BACKUP_OK/);
  assert.deepEqual(await foto(), sebelum);
});

test("apply: 7 pembalik; piutang Rp4,65 jt → 0; kas & Payment tak berubah; idempoten", async () => {
  const { orders } = await dunia();
  const sebelum = await foto();
  const a = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(a.kode, 0, a.out);
  assert.match(a.out, /DIBUAT 7 jurnal pembalik/);
  const sesudah = await foto();
  assert.equal(sesudah.piutang, 0);
  assert.equal(sesudah.kas, sebelum.kas);
  assert.equal(sesudah.payment, sebelum.payment);
  assert.equal(sesudah.jurnal, sebelum.jurnal + 7);
  for (const o of orders) assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).status, "CANCELLED");
  const ulang = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(ulang.kode, 0, ulang.out);
  assert.match(ulang.out, /SUDAH DIKOREKSI/);
  assert.deepEqual(await foto(), sesudah);
});

test("order batal yang ternyata punya Payment aktif → berhenti tanpa menulis (ditangani lewat refund)", async () => {
  await dunia({ denganPayment: true });
  const sebelum = await foto();
  const r = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(r.kode, 2, r.out);
  assert.match(r.out, /Payment aktif/);
  assert.deepEqual(await foto(), sebelum);
});
