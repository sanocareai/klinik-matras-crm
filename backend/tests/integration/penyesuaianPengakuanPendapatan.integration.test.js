// Uji skrip penyesuaian pengakuan pendapatan (scripts/penyesuaianPengakuanPendapatan.js) untuk 4 order yang nilainya diedit SESUDAH diakui. Dunia meniru produksi:
// Wisnu diakui 3.790.000 → nilai 2.990.000; Subrata 1.150.000 → 1.050.000; Ocnop 250.000 → 1.250.000; Tina (BARU) 2.800.000 → 4.000.000; uang terverifikasi = nilai sekarang.
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

const KASUS = [
  { nomor: "RES-16092026-090", kategori: "LAYANAN", diakui: 3_790_000, nilai: 2_990_000 },
  { nomor: "RES-19082026-093", kategori: "LAYANAN", diakui: 1_150_000, nilai: 1_050_000 },
  { nomor: "RES-13092026-080", kategori: "LAYANAN", diakui: 250_000, nilai: 1_250_000 },
  { nomor: "NEW-10092026-011", kategori: "BARU", diakui: 2_800_000, nilai: 4_000_000 },
  { nomor: "SWS-30092026-019", kategori: "SEWA", diakui: 200_000, nilai: 0 }, // sewa gratis: tanpa Payment
];
async function dunia({ uangBeda = false } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const owner = await testPrisma.user.create({ data: { name: "OWNER (Admin)", email: `owner-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const out = [];
  for (const k of KASUS) {
    const customer = await testPrisma.customer.create({ data: { name: `C ${k.nomor}` } });
    const o = await testPrisma.order.create({ data: { customerId: customer.id, value: k.diakui, category: k.kategori, orderNumber: k.nomor, status: "DELIVERED", paymentStatus: "LUNAS" } });
    await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: owner.id }));
    await testPrisma.order.update({ where: { id: o.id }, data: { value: k.nilai } });
    if (k.nilai === 0) { out.push(o); continue; }
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: uangBeda && k.nomor === "RES-13092026-080" ? k.nilai - 1 : k.nilai, method: "TRANSFER", cashAccountId: bank.id, recordedById: owner.id } });
    await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: owner.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: owner.id }));
    out.push(o);
  }
  return { bank, owner, orders: out };
}
const jalankan = (args, env = {}, tanggal = "--tanggal=2026-10-06") => {
  try { return { kode: 0, out: execFileSync(process.execPath, ["scripts/penyesuaianPengakuanPendapatan.js", tanggal, ...args], { cwd: akar, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { kode: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
async function foto() {
  const per = async (where) => { const a = await testPrisma.finJournalLine.aggregate({ where: { ...where, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return Number(a._sum.debit ?? 0) - Number(a._sum.credit ?? 0); };
  const akun = async (key) => testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS[key] } });
  const piutang = await akun("PIUTANG_USAHA"); const layanan = await akun("PENDAPATAN_LAYANAN"); const produk = await akun("PENDAPATAN_PRODUK"); const sewa = await akun("PENDAPATAN_SEWA");
  const orders = await testPrisma.order.findMany({ select: { orderNumber: true, paymentStatus: true, value: true } });
  return {
    kas: await per({ cashAccountId: { not: null } }), piutang: await per({ accountId: piutang.id }), layanan: 0 - (await per({ accountId: layanan.id })), produk: 0 - (await per({ accountId: produk.id })), sewa: 0 - (await per({ accountId: sewa.id })),
    jurnal: await testPrisma.finJournalEntry.count(), payment: await testPrisma.payment.count(), orders: orders.sort((x, y) => x.orderNumber.localeCompare(y.orderNumber)),
  };
}

test("pratinjau tidak menulis; apply tanpa KOREKSI_BACKUP_OK ditolak; tanggal di luar Oktober 2026 ditolak", async () => {
  await dunia();
  const sebelum = await foto();
  assert.equal(sebelum.piutang, 800_000 + 100_000 - 1_000_000 - 1_200_000 + 200_000);
  const p = jalankan([]);
  assert.equal(p.kode, 0, p.out);
  assert.match(p.out, /PRATINJAU/);
  assert.deepEqual(await foto(), sebelum);
  const tolak = jalankan(["--apply"]);
  assert.notEqual(tolak.kode, 0);
  assert.match(tolak.out, /KOREKSI_BACKUP_OK/);
  const sept = jalankan([], {}, "--tanggal=2026-09-30");
  assert.equal(sept.kode, 2);
  assert.match(sept.out, /bukan Oktober/);
  assert.deepEqual(await foto(), sebelum);
});

test("apply: piutang 5 order jadi 0; pendapatan neto +1.100.000; kas/Payment/order tidak berubah; 5 jurnal; idempoten", async () => {
  const { orders } = await dunia();
  const sebelum = await foto();
  const a = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(a.kode, 0, a.out);
  assert.match(a.out, /DIBUAT 5 jurnal/);
  const sesudah = await foto();
  assert.equal(sesudah.piutang, 0);
  assert.equal(sesudah.kas, sebelum.kas);
  assert.equal(sesudah.layanan, sebelum.layanan - 800_000 - 100_000 + 1_000_000, "4-1100 Layanan: −800.000 −100.000 +1.000.000");
  assert.equal(sesudah.produk, sebelum.produk + 1_200_000, "4-1200 Produk: +1.200.000");
  assert.equal(sesudah.sewa, sebelum.sewa - 200_000, "Pendapatan Sewa: −200.000 (sewa gratis)");
  assert.equal(sesudah.jurnal, sebelum.jurnal + 5);
  assert.equal(sesudah.payment, sebelum.payment);
  assert.deepEqual(sesudah.orders, sebelum.orders);
  for (const o of orders) {
    const e = await testPrisma.finJournalEntry.findFirst({ where: { idempotencyKey: { startsWith: `PENYESUAIAN_PENGAKUAN:${o.id}:` } }, include: { lines: true } });
    assert.equal(e.status, "POSTED");
    assert.equal(e.date.toISOString().slice(0, 10), "2026-10-06");
    assert.ok(e.lines.every((l) => l.orderId === o.id && !l.cashAccountId));
  }
  const ulang = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(ulang.kode, 0, ulang.out);
  assert.match(ulang.out, /SUDAH DIKOREKSI/);
  assert.deepEqual(await foto(), sesudah);
});

test("bukti nilai akhir tidak terpenuhi (uang terverifikasi ≠ tagihan) → berhenti tanpa menulis", async () => {
  await dunia({ uangBeda: true });
  const sebelum = await foto();
  const r = jalankan(["--apply"], { KOREKSI_BACKUP_OK: "1" });
  assert.equal(r.kode, 2, r.out);
  assert.match(r.out, /bukti nilai akhir/);
  assert.deepEqual(await foto(), sebelum);
});
