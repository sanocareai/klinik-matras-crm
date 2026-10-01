// PENJUALAN KARYAWAN (1 Okt 2026) — penanda penjual karyawan non-Sales pada order: hanya Admin, harus non-Sales, diaudit; filter daftar order; ringkasan per karyawan
// (tagihan/terbayar/sisa dari ledger); tidak menulis Payment/jurnal; order tetap di luar angka Tim Sales (tanpa pemilik Sales).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const emon = await createTestUser({ roles: ["PRODUCTION_WORKER"] });
  const cust = await testPrisma.customer.create({ data: { name: "Kerabat Emon" } });
  const bank = await testPrisma.finCashAccount.findFirst();
  const order = (nomor, value, extra = {}) => testPrisma.order.create({ data: { customerId: cust.id, orderNumber: nomor, value, status: "DELIVERED", ...extra } });
  const bayar = (o, amount) => testPrisma.payment.create({ data: { orderId: o.id, amount, method: "CASH", recordedById: admin.user.id } });
  return { admin, finance, sales, emon, cust, order, bayar, cA: makeClient(server.baseUrl, admin.token), cF: makeClient(server.baseUrl, finance.token), cS: makeClient(server.baseUrl, sales.token), bank };
}
const tandai = (w, o, id = w.emon.user.id) => w.cA.put(`/api/orders/${o.id}/penjual-karyawan`, { staffSellerId: id });

test("tandai: hanya Admin; karyawan harus non-Sales & aktif; diaudit; bisa dihapus; sama = 409", async () => {
  const w = await dunia();
  const o = await w.order("NEW-1", 1_300_000);
  assert.equal((await w.cS.put(`/api/orders/${o.id}/penjual-karyawan`, { staffSellerId: w.emon.user.id })).status, 403, "Sales tidak boleh");
  assert.equal((await w.cF.put(`/api/orders/${o.id}/penjual-karyawan`, { staffSellerId: w.emon.user.id })).status, 403, "Finance tidak boleh menandai");
  const sls = await tandai(w, o, w.sales.user.id);
  assert.equal(sls.status, 422); assert.equal(sls.body.code, "KARYAWAN_ADALAH_SALES");
  assert.equal((await tandai(w, o, "tidak-ada")).status, 422);
  await testPrisma.user.update({ where: { id: w.emon.user.id }, data: { active: false } });
  assert.equal((await tandai(w, o)).status, 422, "karyawan nonaktif ditolak");
  await testPrisma.user.update({ where: { id: w.emon.user.id }, data: { active: true } });
  const ok = await tandai(w, o);
  assert.equal(ok.status, 200, JSON.stringify(ok.body)); assert.equal(ok.body.nama, w.emon.user.name);
  assert.equal((await tandai(w, o)).status, 409);
  const log = await testPrisma.activityEvent.findMany({ where: { entityId: o.id, eventType: "PENJUALAN_KARYAWAN_DIUBAH" } });
  assert.equal(log.length, 1, "diaudit tepat sekali");
  assert.equal((await w.cA.put(`/api/orders/${o.id}/penjual-karyawan`, { staffSellerId: null })).status, 200);
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).staffSellerId, null);
});

test("tidak menulis uang: Payment, jurnal, status bayar, nilai order tidak berubah; order tetap tanpa pemilik Sales", async () => {
  const w = await dunia();
  const o = await w.order("NEW-2", 1_200_000, { paymentStatus: "DP" }); await w.bayar(o, 500_000);
  const hitung = async () => JSON.stringify([await testPrisma.payment.count(), await testPrisma.finJournalEntry.count(), (await testPrisma.order.findUnique({ where: { id: o.id } })).paymentStatus, (await testPrisma.order.findUnique({ where: { id: o.id } })).value, (await testPrisma.order.findUnique({ where: { id: o.id } })).salesOwnerId]);
  const sebelum = await hitung();
  assert.equal((await tandai(w, o)).status, 200);
  assert.equal(await hitung(), sebelum);
});

test("filter daftar order: ?penjualan=KARYAWAN | TIM_SALES | ?staffSellerId=; baris membawa nama penjual", async () => {
  const w = await dunia();
  const a = await w.order("NEW-A", 1_000_000), b = await w.order("NEW-B", 2_000_000), c = await w.order("NEW-C", 3_000_000);
  await tandai(w, a); await tandai(w, b);
  const emon2 = await createTestUser({ roles: ["DRIVER"] });
  await tandai(w, c, emon2.user.id);
  const nomor = (r) => r.body.items.map((x) => x.orderNumber).sort();
  const semua = await w.cA.get("/api/orders?limit=50");
  assert.equal(semua.body.items.length, 3);
  assert.deepEqual(nomor(await w.cA.get("/api/orders?penjualan=KARYAWAN")), ["NEW-A", "NEW-B", "NEW-C"]);
  assert.deepEqual(nomor(await w.cA.get("/api/orders?penjualan=TIM_SALES")), []);
  assert.deepEqual(nomor(await w.cA.get(`/api/orders?staffSellerId=${w.emon.user.id}`)), ["NEW-A", "NEW-B"]);
  const baris = semua.body.items.find((x) => x.orderNumber === "NEW-A");
  assert.equal(baris.staffSeller.name, w.emon.user.name);
});

test("ringkasan per karyawan: nilai, terbayar (ledger), sisa; order batal tidak dihitung; periode WIB; izin Admin/Finance saja", async () => {
  const w = await dunia();
  // skenario Emon: 3 order belum bayar 3,8jt (1,3 + 1,2 + 1,3), cicilan 500rb ke yang pertama; 3 order lunas (1,2 + 1,4 + 1,7)
  const o1 = await w.order("NEW-01102026-001", 1_300_000, { paymentStatus: "DP" }), o2 = await w.order("NEW-01102026-002", 1_200_000), o3 = await w.order("NEW-01102026-003", 1_300_000);
  const l1 = await w.order("NEW-27092026-047", 1_200_000, { paymentStatus: "LUNAS" }), l2 = await w.order("NEW-27092026-048", 1_400_000, { paymentStatus: "LUNAS" }), l3 = await w.order("RES-30092026-197", 1_700_000, { paymentStatus: "LUNAS", category: "LAYANAN" });
  await w.bayar(o1, 500_000); await w.bayar(l1, 1_200_000); await w.bayar(l2, 1_400_000); await w.bayar(l3, 1_700_000);
  const batal = await w.order("NEW-BATAL", 9_000_000, { status: "CANCELLED" });
  const bukan = await w.order("NEW-BIASA", 5_000_000);
  for (const o of [o1, o2, o3, l1, l2, l3, batal]) await tandai(w, o);
  const r = await w.cA.get("/api/orders/penjualan-karyawan/ringkasan");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.karyawan.length, 1);
  const e = r.body.karyawan[0];
  assert.equal(e.nama, w.emon.user.name);
  assert.equal(e.jumlahOrder, 6, "order batal & order biasa tidak ikut");
  assert.equal(e.nilai, 8_100_000);
  assert.equal(e.terbayar, 4_800_000);
  assert.equal(e.sisa, 3_300_000, "piutang karyawan = 3,8jt − cicilan 0,5jt");
  assert.deepEqual(r.body.total, { jumlahOrder: 6, nilai: 8_100_000, terbayar: 4_800_000, sisa: 3_300_000 });
  assert.equal(e.orders.find((x) => x.orderNumber === "NEW-01102026-001").sisa, 800_000);
  assert.ok(!e.orders.some((x) => x.orderNumber === "NEW-BIASA" || x.orderNumber === "NEW-BATAL"));
  // Finance boleh baca; Sales tidak
  assert.equal((await w.cF.get("/api/orders/penjualan-karyawan/ringkasan")).status, 200);
  assert.equal((await w.cS.get("/api/orders/penjualan-karyawan/ringkasan")).status, 403);
  // periode: bulan tanpa order → kosong
  const kosong = await w.cA.get("/api/orders/penjualan-karyawan/ringkasan?from=2020-01-01&to=2020-01-31");
  assert.equal(kosong.body.karyawan.length, 0); assert.equal(kosong.body.total.sisa, 0);
  void bukan;
});
