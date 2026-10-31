// DRAWER = DAFTAR untuk "Data order" (Okt 2026): GET /api/production/units/:id/adopsi harus menilai kelengkapan order Penjualan Karyawan (PKR)
// dengan aturan & data yang SAMA dengan daftar Order Produksi. Dulu query drawer tidak memuat kolom PKR → order PKR kurang tampil
// "Tidak ada kekurangan terdeteksi · Data order belum dinilai" padahal daftar/filter/hitungan menandainya "Data order kurang".
// Tiga kasus: PKR kurang, PKR lengkap, non-PKR (tetap "Belum dinilai" — ketiadaan aturan BUKAN lengkap). BACA-SAJA.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser, createTestUnit } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  const admin = await createTestUser({ roles: ["ADMIN"] }); const sales = await createTestUser({ roles: ["SALES"] });
  return { admin, sales, a: makeClient(server.baseUrl, admin.token) };
}
async function unit(nomor, { pkrId = null, notes = null, status = "RECEIVED" } = {}) {
  const { order, unit: u } = await createTestUnit({ status });
  await testPrisma.order.update({ where: { id: order.id }, data: { orderNumber: nomor, status: "PROCESSING", ...(pkrId ? { penjualanKaryawanId: pkrId } : {}), ...(notes ? { notes: JSON.stringify(notes), pkrPerluDikirim: false } : {}) } });
  return u;
}
const buatPkr = (w, nomor) => testPrisma.finPenjualanKaryawan.create({ data: { nomor, date: new Date(), sellerId: w.sales.user.id, buyerName: "Kerabat", total: 1_000_000, status: "AKTIF", items: { create: [{ name: "Kasur", quantity: 1, unitPrice: 1_000_000, sortOrder: 0 }] } } });
const dariDaftar = async (w, u) => (await w.a.get("/api/production/work-orders?pageSize=200")).body.units.find((x) => x.unitCode === u.unitCode).adopsi.kelengkapan;
const dariDrawer = async (w, u) => { const r = await w.a.get(`/api/production/units/${u.id}/adopsi`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.adopsi.kelengkapan; };
const ringkasan = (k) => ({ keys: k.keys, ringkas: k.ringkas, dataOrder: k.dataOrder, alasan: k.items.DATA_ORDER_KURANG?.alasan ?? null });

test("D1. PKR kurang: drawer menampilkan 'Data order kurang' dengan alasan yang SAMA dengan daftar (bukan 'belum dinilai')", async () => {
  const w = await dunia(); const pkr = await buatPkr(w, "PKR-DR-001"); const u = await unit("RES-DR-01", { pkrId: pkr.id });
  const kd = await dariDrawer(w, u); const kl = await dariDaftar(w, u);
  assert.deepEqual(kd.keys, ["DATA_ORDER_KURANG"]);
  assert.equal(kd.dataOrder.status, "KURANG");
  assert.match(kd.items.DATA_ORDER_KURANG.alasan[0].teks, /PKR-DR-001 belum lengkap: .*Merk kasur/);
  assert.ok(!/belum dinilai/i.test(kd.ringkas), "tidak boleh tampil 'Data order belum dinilai' untuk order PKR");
  assert.deepEqual(ringkasan(kd), ringkasan(kl), "drawer = daftar");
});

test("D2. PKR lengkap: drawer 'Lengkap' (bukan 'belum dinilai') dan sama dengan daftar; setelah data dikurangi → kembali kurang di KEDUANYA", async () => {
  const w = await dunia(); const pkr = await buatPkr(w, "PKR-DR-002"); const u = await unit("RES-DR-02", { pkrId: pkr.id, notes: { merkKasur: "Sano", ukuranKasur: "160x200" } });
  const kd = await dariDrawer(w, u);
  assert.equal(kd.dataOrder.status, "LENGKAP"); assert.deepEqual(kd.keys, []);
  assert.deepEqual(ringkasan(kd), ringkasan(await dariDaftar(w, u)), "drawer = daftar");
  const order = await testPrisma.order.findFirst({ where: { orderNumber: "RES-DR-02" } });
  await testPrisma.order.update({ where: { id: order.id }, data: { notes: JSON.stringify({ merkKasur: "Sano" }) } });
  const k2 = await dariDrawer(w, u);
  assert.equal(k2.dataOrder.status, "KURANG"); assert.deepEqual(ringkasan(k2), ringkasan(await dariDaftar(w, u)), "drawer = daftar setelah data berubah");
});

test("D3. order biasa (non-PKR): 'Belum dinilai' di drawer dan daftar — bukan lengkap, bukan kurang (perilaku tidak berubah)", async () => {
  const w = await dunia(); const u = await unit("RES-DR-03");
  const kd = await dariDrawer(w, u);
  assert.equal(kd.dataOrder.status, "BELUM_DINILAI"); assert.deepEqual(kd.keys, []);
  assert.equal(kd.ringkas, "Tidak ada kekurangan terdeteksi · Data order belum dinilai");
  assert.deepEqual(ringkasan(kd), ringkasan(await dariDaftar(w, u)), "drawer = daftar");
});

test("D4. BACA-SAJA dan tanpa kebocoran: membuka drawer PKR tidak mengubah data, dan respons tidak membawa catatan/alamat/nominal PKR", async () => {
  const w = await dunia(); const pkr = await buatPkr(w, "PKR-DR-004"); const u = await unit("RES-DR-04", { pkrId: pkr.id, notes: { merkKasur: "Sano", ukuranKasur: "160x200", rahasiaCatatan: "CATATAN-INTERNAL-XYZ" } });
  const o4 = await testPrisma.order.findFirst({ where: { orderNumber: "RES-DR-04" } });
  await testPrisma.order.update({ where: { id: o4.id }, data: { deliveryAddress: "Jl. Rahasia 99 ALAMAT-XYZ" } });
  const hitung = async () => ({ o: await testPrisma.order.count(), u: await testPrisma.unit.count(), l: await testPrisma.stockMovement.count() });
  const sebelum = await hitung();
  const r = await w.a.get(`/api/production/units/${u.id}/adopsi`); assert.equal(r.status, 200);
  const teks = JSON.stringify(r.body);
  assert.ok(!teks.includes("CATATAN-INTERNAL-XYZ") && !teks.includes("ALAMAT-XYZ"), "catatan internal & alamat order tidak ikut respons drawer");
  assert.ok(!teks.includes("1000000"), "nominal PKR tidak ikut respons drawer");
  assert.deepEqual(await hitung(), sebelum, "membuka drawer tidak menulis apa pun");
});
