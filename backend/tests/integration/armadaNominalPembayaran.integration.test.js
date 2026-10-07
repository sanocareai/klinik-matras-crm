// PENGAMAN NOMINAL pembayaran (POST /api/armada/jobs/:id/payment). Kasus nyata 6 Okt 2026: driver mengetik "1" untuk pembayaran tunai order Rp1.200.000
// dan langsung masuk Uang Kas. Dikunci: nominal sangat kecil wajib konfirmasi eksplisit; nominal > sisa tagihan (termasuk Payment yang BELUM diverifikasi) ditolak; order Rp0 tidak
// dibatasi atasnya; tidak ada Payment yang tercipta saat ditolak.
//
// CALLER DIUBAH ke ADMIN (6 Okt 2026, keputusan owner — lihat catatan panjang
// di routes/armada.js endpoint ini) — JOB_OWN_WRITE dicabut dari endpoint ini,
// driver tidak lagi bisa mencatat pembayaran sendiri. Job TETAP milik driver
// (driverId terisi) — yang berubah cuma SIAPA yang boleh memanggil endpoint
// ini, aturan nominal di bawah ini sendiri tidak berubah sama sekali.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { periksaNominal, NOMINAL_KECIL_BATAS } from "../../src/services/finance/nominalPembayaranLapangan.js";

let server; let seq = 0;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });
test.afterEach(async () => { await truncateAll(); });

async function fixture({ value = 1_200_000, ongkir = 0 } = {}) {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const customer = await testPrisma.customer.create({ data: { name: "Pelanggan Nominal", city: "Jakarta" } });
  const route = await testPrisma.route.create({ data: { code: `NOM-RTE-${++seq}`, date: new Date("2026-10-06T00:00:00.000Z"), status: "PUBLISHED", publishedAt: new Date(), driverId: driver.user.id } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, orderNumber: `NOM-ORD-${++seq}`, value, ongkir, category: "LAYANAN", status: "DELIVERED" } });
  const job = await testPrisma.job.create({ data: { type: "DELIVERY", orderId: order.id, routeId: route.id, driverId: driver.user.id, status: "COMPLETED", sequence: 1 } });
  return { order, job, driver, api: makeClient(server.baseUrl, admin.token), driverApi: makeClient(server.baseUrl, driver.token) };
}
const bayar = (f, body) => f.api.post(`/api/armada/jobs/${f.job.id}/payment`, { method: "CASH", ...body });
const jumlahPayment = (f) => testPrisma.payment.count({ where: { orderId: f.order.id } });

test("nominal sangat kecil (Rp1 untuk tagihan Rp1.200.000) ditolak sampai dikonfirmasi; setelah konfirmasi tercatat", async () => {
  const f = await fixture();
  const r = await bayar(f, { amount: 1 });
  assert.equal(r.status, 422, JSON.stringify(r.body));
  assert.equal(r.body.code, "NOMINAL_KECIL_PERLU_KONFIRMASI");
  assert.match(r.body.error, /Rp1 /);
  assert.equal(await jumlahPayment(f), 0, "tidak boleh ada Payment tercipta saat ditolak");
  const sah = await bayar(f, { amount: 1, konfirmasiNominalKecil: true });
  assert.equal(sah.status, 201, JSON.stringify(sah.body));
  assert.equal(await jumlahPayment(f), 1);
});

test("nominal melebihi sisa tagihan ditolak; Payment yang BELUM diverifikasi ikut mengurangi sisa (input ganda tertahan)", async () => {
  const f = await fixture();
  const lebih = await bayar(f, { amount: 2_000_000 });
  assert.equal(lebih.status, 422);
  assert.equal(lebih.body.code, "NOMINAL_MELEBIHI_SISA");
  assert.equal(await jumlahPayment(f), 0);

  assert.equal((await bayar(f, { amount: 500_000 })).status, 201);
  assert.equal((await bayar(f, { amount: 500_000 })).status, 201); // sisa 200.000
  const ganda = await bayar(f, { amount: 800_000 });
  assert.equal(ganda.status, 422);
  assert.equal(ganda.body.code, "NOMINAL_MELEBIHI_SISA");
  assert.match(ganda.body.error, /Rp200\.000/);
  assert.equal((await bayar(f, { amount: 200_000 })).status, 201); // pelunasan pas
  const penuh = await bayar(f, { amount: 50_000 });
  assert.equal(penuh.status, 422);
  assert.match(penuh.body.error, /sudah tertagih penuh/);
  assert.equal(await jumlahPayment(f), 3);
});

test("ongkir ikut tagihan; order bertagihan Rp0 tidak dibatasi atas tetapi nominal kecil tetap perlu konfirmasi", async () => {
  const f = await fixture({ value: 1_000_000, ongkir: 200_000 });
  assert.equal((await bayar(f, { amount: 1_200_000 })).status, 201, "value + ongkir = tagihan");

  const g = await fixture({ value: 0 });
  assert.equal((await bayar(g, { amount: 5_000_000 })).status, 201, "tanpa tagihan pembanding → tidak ada batas atas");
  const kecil = await bayar(g, { amount: 5_000 });
  assert.equal(kecil.status, 422);
  assert.equal(kecil.body.code, "NOMINAL_KECIL_PERLU_KONFIRMASI");
});

test("REGRESI 6 Okt 2026: driver (JOB_OWN_WRITE) ditolak 403 mencatat pembayaran — hanya pemegang JOB_WRITE (admin/dispatcher) yang boleh", async () => {
  const f = await fixture();
  const r = await f.driverApi.post(`/api/armada/jobs/${f.job.id}/payment`, { amount: 500_000, method: "CASH" });
  assert.equal(r.status, 403, JSON.stringify(r.body));
  assert.equal(await jumlahPayment(f), 0, "tidak ada Payment tercipta dari percobaan driver yang ditolak");

  // Driver TETAP bisa mengerjakan job-nya sendiri lewat endpoint lain (JOB_OWN_WRITE
  // tidak dicabut dari situ) — cuma endpoint pembayaran ini yang berubah.
  const posisi = await f.driverApi.post(`/api/armada/jobs/${f.job.id}/positions`, { lat: -6.2, lng: 106.8, recordedAt: new Date().toISOString() });
  assert.equal(posisi.status, 201, "JOB_OWN_WRITE driver di endpoint LAIN tidak boleh ikut tercabut");
});

test("periksaNominal (murni): sisa kecil yang sah tidak dianggap salah ketik; batas atas memakai sisa", () => {
  assert.equal(NOMINAL_KECIL_BATAS, 10_000);
  // sisa Rp5.000: melunasi pas boleh tanpa konfirmasi; Rp100 (jauh di bawah sisa) perlu konfirmasi
  assert.equal(periksaNominal({ amount: 5_000, tagihan: 100_000, dibayar: 95_000 }), null);
  assert.equal(periksaNominal({ amount: 100, tagihan: 100_000, dibayar: 95_000 })?.code, "NOMINAL_KECIL_PERLU_KONFIRMASI");
  assert.equal(periksaNominal({ amount: 100, tagihan: 100_000, dibayar: 95_000, konfirmasiNominalKecil: true }), null);
  assert.equal(periksaNominal({ amount: 6_000, tagihan: 100_000, dibayar: 95_000 })?.code, "NOMINAL_MELEBIHI_SISA");
  assert.equal(periksaNominal({ amount: 1_000, tagihan: 0, dibayar: 0 })?.code, "NOMINAL_KECIL_PERLU_KONFIRMASI");
  assert.equal(periksaNominal({ amount: 10_000, tagihan: 1_200_000, dibayar: 0 }), null, "tepat di batas = tidak dianggap kecil");
});
