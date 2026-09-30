// paidAt KANONIK (30 Sep 2026): Sales hanya membuat KLAIM Lunas; status LUNAS final dan tanggal lunas (paidAt) berasal dari Payment TERVERIFIKASI —
// paidAt = tanggal Payment yang membuat akumulasi mencapai tagihan (bukan waktu klik Sales / waktu verifikasi). Beda jam pada tanggal WIB yang sama
// dibiarkan; pindah tanggal/bulan dicatat di audit (paid_at_disinkron, pindahBulan).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { verifikasiPembayaran } from "../../src/services/finance/pembayaran.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";

test.before(async () => { await truncateAll(); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

let n = 0;
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: akunBank.id } });
  const finance = (await createTestUser({ roles: ["FINANCE"] })).user;
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  return { bank, finance, sales };
}
async function skenario(w, { nilai = 1_000_000, ongkir = null, paidAt, tglBayar, amount = nilai }) {
  const c = await testPrisma.customer.create({ data: { name: "Uji paidAt" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nilai, ...(ongkir && { ongkir }), category: "LAYANAN", orderNumber: `PK-${String(++n).padStart(3, "0")}`, status: "DELIVERED", paymentStatus: "LUNAS", paidAt } });
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount, method: "TRANSFER", cashAccountId: w.bank.id, recordedById: w.sales.id, createdAt: new Date(tglBayar) } });
  await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: w.sales.id }));
  return { o, p };
}
const verif = (w, id) => testPrisma.$transaction((tx) => verifikasiPembayaran(tx, { paymentId: id, userId: w.finance.id }));
const wib = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const audit = (id) => testPrisma.activityEvent.findMany({ where: { entityType: "order", entityId: id } }).then((r) => r.filter((e) => e.metadata.aksi === "paid_at_disinkron"));

test("Klaim Lunas Sales dengan tanggal klik lebih lambat: verifikasi Payment menggeser paidAt ke tanggal Payment (bulan sama), diaudit", async () => {
  const w = await dunia();
  const { o, p } = await skenario(w, { paidAt: new Date("2026-09-25T10:00:00Z"), tglBayar: "2026-09-20T05:00:00Z" });
  await verif(w, p.id);
  const sesudah = await testPrisma.order.findUnique({ where: { id: o.id } });
  assert.equal(sesudah.paymentStatus, "LUNAS");
  assert.equal(wib(sesudah.paidAt), "2026-09-20", "tanggal lunas = tanggal Payment yang melunasi");
  const a = await audit(o.id);
  assert.equal(a.length, 1);
  assert.equal(a[0].metadata.pindahBulan, false);
  assert.equal(wib(a[0].metadata.dari), "2026-09-25");
});

test("Beda jam pada tanggal WIB yang SAMA tidak dikoreksi", async () => {
  const w = await dunia();
  const paidAt = new Date("2026-09-20T13:00:00Z"); // 20:00 WIB
  const { o, p } = await skenario(w, { paidAt, tglBayar: "2026-09-20T05:00:00Z" }); // 12:00 WIB, tanggal sama
  await verif(w, p.id);
  const sesudah = await testPrisma.order.findUnique({ where: { id: o.id } });
  assert.equal(sesudah.paidAt.toISOString(), paidAt.toISOString(), "paidAt tidak berubah");
  assert.equal((await audit(o.id)).length, 0);
});

test("Pindah bulan tetap mengikuti tanggal Payment tetapi ditandai pindahBulan di audit", async () => {
  const w = await dunia();
  const { o, p } = await skenario(w, { paidAt: new Date("2026-10-02T05:00:00Z"), tglBayar: "2026-09-30T05:00:00Z" });
  await verif(w, p.id);
  const sesudah = await testPrisma.order.findUnique({ where: { id: o.id } });
  assert.equal(wib(sesudah.paidAt), "2026-09-30");
  const a = await audit(o.id);
  assert.equal(a[0].metadata.pindahBulan, true, "pindah bulan dilaporkan di audit");
});

test("Klaim Lunas dengan Payment yang BELUM menutup tagihan: status final DP dan paidAt kosong (LUNAS final berasal dari Payment)", async () => {
  const w = await dunia();
  const { o, p } = await skenario(w, { nilai: 1_000_000, paidAt: new Date("2026-09-25T10:00:00Z"), tglBayar: "2026-09-20T05:00:00Z", amount: 400_000 });
  await verif(w, p.id);
  const sesudah = await testPrisma.order.findUnique({ where: { id: o.id } });
  assert.equal(sesudah.paymentStatus, "DP");
  assert.equal(sesudah.paidAt, null);
});

test("Ongkir ikut tagihan kanonis: Payment sebesar nilai jasa saja = DP; nilai jasa + ongkir = LUNAS dengan paidAt tanggal Payment yang melunasi", async () => {
  const w = await dunia();
  const a = await skenario(w, { nilai: 500_000, ongkir: 200_000, paidAt: new Date("2026-09-25T10:00:00Z"), tglBayar: "2026-09-20T05:00:00Z", amount: 500_000 });
  await verif(w, a.p.id);
  assert.equal((await testPrisma.order.findUnique({ where: { id: a.o.id } })).paymentStatus, "DP", "ongkir belum terbayar");
  // pelunasan ongkir 22 Sep, diverifikasi → LUNAS, paidAt = 22 Sep (payment yang membuat akumulasi mencapai Rp700.000)
  const p2 = await testPrisma.payment.create({ data: { orderId: a.o.id, amount: 200_000, method: "TRANSFER", cashAccountId: w.bank.id, recordedById: w.sales.id, createdAt: new Date("2026-09-22T05:00:00Z") } });
  await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p2.id, userId: w.sales.id }));
  await verif(w, p2.id);
  const akhir = await testPrisma.order.findUnique({ where: { id: a.o.id } });
  assert.equal(akhir.paymentStatus, "LUNAS");
  assert.equal(wib(akhir.paidAt), "2026-09-22");
});
