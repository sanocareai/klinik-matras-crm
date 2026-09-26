// RESI GABUNGAN Fase 1: banyak order dalam satu transaksi, invoice bundle otomatis, Ongkir Tambahan, DP 30%, feature flag server-side,
// rollback penuh, dan TIDAK menyentuh Payment/jurnal/order lama.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { buildInvoiceView } from "../../src/services/invoice.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const nyalakan = (v = "true") => setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, v);
async function siapkan() {
  const sales = await createTestUser({ roles: ["SALES"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const lain = await testPrisma.customer.create({ data: { name: "Bapak Andi" } });
  return { sales, driver, customer, lain, c: makeClient(server.baseUrl, sales.token), d: makeClient(server.baseUrl, driver.token) };
}
const item = (extra = {}) => ({ merk: "Sano", ukuran: "84x195x12", keluhan: "Pegal pinggang", nominal: 1_200_000, unitCount: 1, catatan: "", ...extra });
const badan = (customerId, items, extra = {}) => ({ customerId, alamat: "Jl. Kemang 1/11", kota: "Jakarta Selatan", tautanLokasi: "https://maps.example/x", ongkirTambahan: 0, items, ...extra });
async function hitung() {
  const [order, unit, job, invoice, payment, jurnal, alokasi, item_] = await Promise.all([
    testPrisma.order.count(), testPrisma.unit.count(), testPrisma.job.count(), testPrisma.invoice.count(),
    testPrisma.payment.count(), testPrisma.finJournalEntry.count(), testPrisma.finPaymentAllocation.count(), testPrisma.orderItem.count(),
  ]);
  return { order, unit, job, invoice, payment, jurnal, alokasi, item: item_ };
}
const POST = "/api/resi";

// ── feature flag ────────────────────────────────────────────────────────────────────────────────────────────────

test("Flag RESI_INPUT_AKTIF default MATI: status aktif=false dan POST ditolak 403 tanpa membuat data apa pun", async () => {
  const { c, customer } = await siapkan();
  const st = await c.get("/api/resi/status");
  assert.equal(st.status, 200);
  assert.equal(st.body.aktif, false);
  const sebelum = await hitung();
  const r = await c.post(POST, badan(customer.id, [item(), item()]));
  assert.equal(r.status, 403);
  assert.match(r.body.error, /belum diaktifkan/);
  assert.deepEqual(await hitung(), sebelum);
  await nyalakan("false");
  assert.equal((await c.post(POST, badan(customer.id, [item()]))).status, 403);
  await nyalakan("true");
  assert.equal((await c.get("/api/resi/status")).body.aktif, true);
});

// ── pembuatan ───────────────────────────────────────────────────────────────────────────────────────────────────

test("Buat resi 3 item: 3 order + unit + invoice, satu transaksi; invoice tergabung ke satu anchor; Ongkir Tambahan sekali; DP 30% dari total resi", async () => {
  const { c, customer } = await siapkan();
  await nyalakan();
  const r = await c.post(POST, badan(customer.id, [item({ nominal: 1_000_000 }), item({ nominal: 500_000, unitCount: 2 }), item({ nominal: 250_001, ukuran: "90x200x20" })], { ongkirTambahan: 50_000 }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.orders.length, 3);
  assert.deepEqual(r.body.ringkasan, { subtotal: 1_750_001, ongkirTambahan: 50_000, totalResi: 1_800_001, dpPersen: 30, dp: 540_000, sisaSetelahDp: 1_260_001 });

  const orders = await testPrisma.order.findMany({ orderBy: { createdAt: "asc" }, include: { items: true, units: true, invoice: true } });
  assert.equal(orders.length, 3);
  assert.deepEqual(orders.map((o) => o.value), [1_000_000, 500_000, 250_001]);
  assert.deepEqual(orders.map((o) => o.units.length), [1, 2, 1], "unit dibuat seperti alur lama (unitCount)");
  assert.ok(orders.every((o) => o.customerId === customer.id && o.items.length === 1 && o.invoice));
  assert.deepEqual(orders.map((o) => o.ongkir), [50_000, null, null], "Ongkir Tambahan hanya di anchor");
  assert.equal(orders.reduce((s, o) => s + (o.dpTarget ?? 0), 0), 540_000, "Σ dpTarget = DP 30% total resi");
  assert.ok(orders.every((o) => o.deliveryAddress === "Jl. Kemang 1/11" && o.deliveryCity === "Jakarta Selatan"));
  const notes = JSON.parse(orders[0].notes);
  assert.equal(notes.merkKasur, "Sano"); assert.equal(notes.ukuranKasur, "84x195x12"); assert.equal(notes.keluhanCustomer, "Pegal pinggang");

  // bundle otomatis: invoice item ke-2..N menunjuk ke invoice anchor (item pertama)
  const anchor = orders[0].invoice;
  assert.equal(anchor.combinedIntoId, null);
  assert.equal(r.body.anchorInvoiceNumber, anchor.invoiceNumber);
  assert.deepEqual(orders.slice(1).map((o) => o.invoice.combinedIntoId), [anchor.id, anchor.id]);

  // tampilan gabungan: total = Σ item + ongkir tambahan; DP target = 30%
  const view = await buildInvoiceView(orders[2].id); // dari anggota mana pun → dokumen gabungan yang sama
  assert.equal(view.invoice.invoiceNumber, anchor.invoiceNumber);
  assert.equal(view.orders.length, 3);
  assert.equal(view.nominal.totalTagihan, 1_800_001);
  assert.equal(view.nominal.dpTarget, 540_000);
  assert.equal(view.nominal.sisa, 1_800_001);
});

test("Ongkir Tambahan default Rp0; Total Resi = Σ item; DP 30% dari subtotal", async () => {
  const { c, customer } = await siapkan();
  await nyalakan();
  const r = await c.post(POST, badan(customer.id, [item(), item(), item()], { ongkirTambahan: undefined }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.ringkasan.totalResi, 3_600_000);
  assert.equal(r.body.ringkasan.dp, 1_080_000);
  const orders = await testPrisma.order.findMany({ orderBy: { createdAt: "asc" } });
  assert.deepEqual(orders.map((o) => o.ongkir), [0, null, null]);
  const view = await buildInvoiceView(orders[0].id);
  assert.equal(view.nominal.totalTagihan, 3_600_000);
  assert.equal(view.nominal.dpTarget, 1_080_000);
});

// ── atomik ──────────────────────────────────────────────────────────────────────────────────────────────────────

test("Gagal di item terakhir → SEMUA rollback (order, unit, job, item, invoice); nomor order boleh terpakai tetapi tidak ada baris tersisa", async () => {
  const { c, customer } = await siapkan();
  await nyalakan();
  const sebelum = await hitung();
  // nominal 3 miliar lolos validasi (bilangan bulat > 0) tetapi meluap kolom Int di database → gagal SAAT item ke-3 dibuat, setelah 2 order lahir
  const r = await c.post(POST, badan(customer.id, [item(), item(), item({ nominal: 3_000_000_000 })]));
  assert.equal(r.status, 500, JSON.stringify(r.body));
  assert.match(r.body.error, /tidak ada order yang tersimpan/);
  assert.deepEqual(await hitung(), sebelum);
});

// ── validasi ────────────────────────────────────────────────────────────────────────────────────────────────────

test("Customer campur ditolak; validasi item/ongkir/customer; tidak ada data tersisa", async () => {
  const { c, customer, lain } = await siapkan();
  await nyalakan();
  const sebelum = await hitung();
  assert.equal((await c.post(POST, badan(customer.id, [item(), item({ customerId: lain.id })]))).status, 400);
  assert.equal((await c.post(POST, badan(customer.id, []))).status, 400);
  assert.equal((await c.post(POST, badan(customer.id, Array.from({ length: 21 }, () => item())))).status, 400);
  assert.equal((await c.post(POST, badan(customer.id, [item({ nominal: 0 })]))).status, 400);
  assert.equal((await c.post(POST, badan(customer.id, [item({ nominal: 1000.5 })]))).status, 400);
  assert.equal((await c.post(POST, badan(customer.id, [item({ unitCount: 0 })]))).status, 400);
  assert.equal((await c.post(POST, badan(customer.id, [item()], { ongkirTambahan: -1 }))).status, 400);
  assert.equal((await c.post(POST, badan("tidak-ada", [item()]))).status, 404);
  assert.equal((await c.post(POST, { items: [item()] })).status, 400);
  const salah = await c.post(POST, badan(customer.id, [item(), item({ customerId: lain.id })]));
  assert.match(salah.body.error, /customer yang sama/);
  assert.deepEqual(await hitung(), sebelum);
});

test("Izin: tanpa sesi 401; peran tanpa order:write (Driver) 403", async () => {
  const { d, customer } = await siapkan();
  await nyalakan();
  assert.equal((await makeClient(server.baseUrl, null).post(POST, badan(customer.id, [item()]))).status, 401);
  assert.equal((await d.post(POST, badan(customer.id, [item()]))).status, 403);
  assert.equal(await testPrisma.order.count(), 0);
});

// ── tidak menyentuh finance / order lama ────────────────────────────────────────────────────────────────────────

test("Buat resi TIDAK membuat Payment, alokasi, atau jurnal, dan tidak mengubah order lama (tanpa resi) maupun invoice lamanya", async () => {
  const { c, customer, sales } = await siapkan();
  await nyalakan();
  // alur lama (fungsi yang sama dipakai POST /api/customers/:id/orders): tanpa opts.tx → transaksi sendiri, perilaku tidak berubah
  const lamaOrder = await createOrderForCustomer(customer.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  const lama = { body: { id: lamaOrder.id } };
  await testPrisma.order.update({ where: { id: lama.body.id }, data: { value: 750_000 } });
  const snapLama = async () => {
    const o = await testPrisma.order.findUnique({ where: { id: lama.body.id }, include: { invoice: true, units: true } });
    return JSON.stringify({ o: { ...o, updatedAt: null, invoice: { ...o.invoice, updatedAt: null }, units: o.units.map((u) => ({ ...u, updatedAt: null })) } });
  };
  const fpLama = await snapLama();
  const sebelum = await hitung();

  const r = await c.post(POST, badan(customer.id, [item(), item()]));
  assert.equal(r.status, 201, JSON.stringify(r.body));

  const sesudah = await hitung();
  assert.equal(sesudah.payment, sebelum.payment);
  assert.equal(sesudah.alokasi, 0);
  assert.equal(sesudah.jurnal, sebelum.jurnal, "tidak ada jurnal baru");
  assert.equal(sesudah.order, sebelum.order + 2);
  assert.equal(await snapLama(), fpLama, "order & invoice lama tidak berubah");
  const inv = await testPrisma.invoice.findUnique({ where: { orderId: lama.body.id } });
  assert.equal(inv.combinedIntoId, null, "order lama tidak ikut bundle");
  // alur lama tetap berjalan persis (dengan flag ON maupun OFF)
  await nyalakan("false");
  const lagi = await createOrderForCustomer(customer.id, { notes: "{}", unitCount: 1 }, sales.user.id);
  assert.ok(lagi.id && lagi.orderNumber);
  assert.equal((await testPrisma.invoice.findUnique({ where: { orderId: lagi.id } })).combinedIntoId, null);
});
