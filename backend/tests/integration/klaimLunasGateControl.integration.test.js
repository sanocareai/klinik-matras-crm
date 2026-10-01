// KONTROL SAKELAR "Gerbang Klaim Lunas" (Finance > Pengaturan) — izin, audit aktor/waktu/sebelum-sesudah, validasi nilai, dan jaminan bahwa
// menyalakan/mematikan TIDAK mengubah data transaksi apa pun. Plus kompatibilitas klien lama (pesan 409 Bahasa Indonesia).
import "./setup/env.js";
import "./setup/klaimTmpEnv.js";
import "./setup/paymentProofsTmpEnv.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return {
    admin, sales,
    cAdmin: makeClient(server.baseUrl, admin.token), cFin: makeClient(server.baseUrl, finance.token), cSales: makeClient(server.baseUrl, sales.token),
  };
}
const KEY = "klaim_lunas_gate_aktif";
const foto = async () => ({
  order: await testPrisma.order.count(), pay: await testPrisma.payment.count(), alok: await testPrisma.finPaymentAllocation.count(),
  jurnal: await testPrisma.finJournalEntry.count(), klaim: await testPrisma.orderPaymentClaim.count(),
  status: JSON.stringify(await testPrisma.order.findMany({ select: { id: true, paymentStatus: true, paidAt: true }, orderBy: { id: "asc" } })),
});

test("Default MATI; kartu membaca status + riwayat kosong; endpoint status klien = {aktif:false}", async () => {
  const w = await dunia();
  const s = await w.cAdmin.get("/api/finance/settings");
  assert.equal(s.status, 200);
  assert.deepEqual(s.body.klaimLunasGate, { aktif: false, riwayat: [] });
  assert.equal(s.body.keys.KLAIM_LUNAS_GATE_AKTIF, KEY);
  assert.deepEqual((await w.cSales.get("/api/klaim-lunas/status")).body, { aktif: false });
});

test("Hanya Admin (FINANCE_ADMIN) yang dapat mengubah; Finance biasa & Sales ditolak 403; nilai selain true/false ditolak 400 (tetap MATI)", async () => {
  const w = await dunia();
  assert.equal((await w.cFin.patch("/api/finance/settings", { settings: { [KEY]: "true" } })).status, 403);
  assert.equal((await w.cSales.patch("/api/finance/settings", { settings: { [KEY]: "true" } })).status, 403);
  for (const salah of ["ya", "TRUE", "1", "", "aktif"]) {
    const r = await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: salah } });
    assert.equal(r.status, 400, `nilai ${JSON.stringify(salah)}`);
  }
  assert.equal((await w.cAdmin.get("/api/finance/settings")).body.klaimLunasGate.aktif, false);
});

test("Aktifkan lalu matikan: audit memuat aktor, waktu, dan nilai sebelum/sesudah; data transaksi TIDAK berubah; kirim nilai sama tidak menambah audit", async () => {
  const w = await dunia();
  const cust = await testPrisma.customer.create({ data: { name: "Bu Uji", assignedSalesId: w.sales.user.id } });
  await testPrisma.order.create({ data: { customerId: cust.id, value: 1_000_000, category: "LAYANAN", orderNumber: "RES-UJI-1", status: "PENDING", paymentStatus: "LUNAS", paidAt: new Date("2026-09-25T03:00:00Z") } });
  const sebelum = await foto();

  const on = await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: "true" } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  assert.deepEqual((await w.cSales.get("/api/klaim-lunas/status")).body, { aktif: true });
  assert.deepEqual(await foto(), sebelum, "aktivasi tidak mengubah order/payment/alokasi/jurnal/status/paidAt");

  await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: "true" } }); // nilai sama
  const off = await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: "false" } });
  assert.equal(off.status, 200);
  assert.deepEqual((await w.cSales.get("/api/klaim-lunas/status")).body, { aktif: false });
  assert.deepEqual(await foto(), sebelum, "mematikan kembali juga tidak mengubah data");

  const g = (await w.cAdmin.get("/api/finance/settings")).body.klaimLunasGate;
  assert.equal(g.aktif, false);
  assert.equal(g.riwayat.length, 2, "dua perubahan nyata; kirim nilai sama tidak tercatat");
  assert.deepEqual([g.riwayat[0].dari, g.riwayat[0].ke], ["true", "false"]);
  assert.deepEqual([g.riwayat[1].dari, g.riwayat[1].ke], ["false", "true"]);
  assert.equal(g.riwayat[0].oleh, w.admin.user.name);
  assert.ok(Date.now() - new Date(g.riwayat[0].pada).getTime() < 60_000);
  const audit = await testPrisma.activityEvent.findMany({ where: { entityType: "fin_setting", entityId: KEY } });
  assert.ok(audit.every((e) => e.actorId === w.admin.user.id));
});

test("KLIEN LAMA saat gerbang AKTIF: PATCH Lunas (409 LUNAS_HANYA_DARI_LEDGER) dan POST pembayaran Sales (409 PEMBAYARAN_SALES_LEWAT_KLAIM) dijawab Bahasa Indonesia yang jelas; saat MATI bekerja seperti dulu", async () => {
  const w = await dunia();
  const cust = await testPrisma.customer.create({ data: { name: "Bu Lama", assignedSalesId: w.sales.user.id } });
  const o = await testPrisma.order.create({ data: { customerId: cust.id, value: 500_000, category: "LAYANAN", orderNumber: "RES-UJI-2", status: "PENDING" } });
  // MATI: perilaku lama (klien lama masih berjalan normal)
  assert.equal((await w.cSales.post(`/api/orders/${o.id}/payments`, { amount: 100_000, method: "CASH" })).status, 201);
  await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: "true" } });
  const bayar = await w.cSales.post(`/api/orders/${o.id}/payments`, { amount: 100_000, method: "CASH" });
  assert.equal(bayar.status, 409);
  assert.match(bayar.body.error, /Ajukan Klaim Lunas/);
  assert.match(bayar.body.error, /Perbarui aplikasi/);
  const lunas = await w.cSales.patch(`/api/orders/${o.id}`, { paymentStatus: "LUNAS" });
  assert.equal(lunas.status, 409);
  assert.match(lunas.body.error, /Klaim Lunas/);
  assert.equal(await testPrisma.payment.count(), 1, "hanya pembayaran sebelum gerbang aktif");
});

test("Klaim Resi/order & akses bukti tetap berlaku setelah sakelar dinyalakan lewat endpoint Pengaturan (bukan hanya lewat DB)", async () => {
  const w = await dunia();
  await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: "true" } });
  const cust = await testPrisma.customer.create({ data: { name: "Bu Baru", assignedSalesId: w.sales.user.id } });
  const o = await testPrisma.order.create({ data: { customerId: cust.id, value: 500_000, category: "LAYANAN", orderNumber: "RES-UJI-3", status: "PENDING" } });
  const d = await w.cSales.post(`/api/klaim-lunas/order/${o.id}`, {});
  assert.equal(d.status, 201, JSON.stringify(d.body));
  await w.cAdmin.patch("/api/finance/settings", { settings: { [KEY]: "false" } });
  assert.equal((await w.cSales.post(`/api/klaim-lunas/order/${o.id}`, {})).status, 403, "dimatikan → klaim baru tidak bisa dibuat");
  assert.equal(await testPrisma.orderPaymentClaim.count(), 1, "klaim yang sudah ada tidak dihapus saat gerbang dimatikan");
});
