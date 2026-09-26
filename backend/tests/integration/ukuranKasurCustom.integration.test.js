// Ukuran Kasur Custom end-to-end di backend: simpan terstruktur di Order.notes, salin ke Unit.ukuran, edit ulang + sinkron unit,
// pembersihan saat kembali ke standar, validasi 400 Indonesia, invoice, dan item Buat Resi. Data legacy tidak diubah/ditebak.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { buildInvoiceView } from "../../src/services/invoice.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const notes = (o) => JSON.stringify({ merkKasur: "Sano", keluhanCustomer: "Pegal", ...o });
const CUSTOM = "Ukuran Custom";
const QUEEN = "160x200 cm (Queen)";
async function siapkan() {
  const sales = await createTestUser({ roles: ["SALES"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  return { sales, customer, c: makeClient(server.baseUrl, sales.token) };
}
const unitUkuran = async (orderId) => (await testPrisma.unit.findMany({ where: { orderId }, orderBy: { seq: "asc" } })).map((u) => u.ukuran);
const notesOf = async (orderId) => JSON.parse((await testPrisma.order.findUnique({ where: { id: orderId } })).notes);

// ── Buat Order ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Buat Order custom: Lebar/Panjang tersimpan terstruktur di notes dan unit baru memuat ukuran aktual", async () => {
  const { sales, customer } = await siapkan();
  const o = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: "145", ukuranPanjangCm: "205,5" }), unitCount: 2 }, sales.user.id);
  const n = await notesOf(o.id);
  assert.equal(n.ukuranKasur, CUSTOM, "label dropdown tetap (kunci katalog harga tidak berubah)");
  assert.equal(n.ukuranLebarCm, 145);
  assert.equal(n.ukuranPanjangCm, 205.5);
  assert.deepEqual(await unitUkuran(o.id), ["145 × 205,5 cm (Custom)", "145 × 205,5 cm (Custom)"]);
});

test("Buat Order custom tidak valid → 400 Bahasa Indonesia dan TIDAK ada order/unit/invoice tersimpan", async () => {
  const { sales, customer } = await siapkan();
  const coba = (lebar, panjang) => createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: lebar, ukuranPanjangCm: panjang }), unitCount: 1 }, sales.user.id);
  await assert.rejects(coba("", ""), (e) => e.statusCode === 400 && /Lebar \(cm\) wajib diisi/.test(e.message) && /Panjang \(cm\) wajib diisi/.test(e.message));
  await assert.rejects(coba("abc", 200), (e) => e.statusCode === 400 && /Lebar harus berupa angka positif/.test(e.message));
  await assert.rejects(coba(145, 5000), (e) => e.statusCode === 400 && /Panjang harus antara 30 dan 400 cm/.test(e.message));
  await assert.rejects(coba(-145, 200), (e) => e.statusCode === 400);
  assert.equal(await testPrisma.order.count(), 0);
  assert.equal(await testPrisma.unit.count(), 0);
  assert.equal(await testPrisma.invoice.count(), 0);
});

test("Ukuran standar: angka custom yang ikut terkirim dibuang (tidak tersimpan)", async () => {
  const { sales, customer } = await siapkan();
  const o = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: QUEEN, ukuranLebarCm: 145, ukuranPanjangCm: 205 }), unitCount: 1 }, sales.user.id);
  const n = await notesOf(o.id);
  assert.equal("ukuranLebarCm" in n, false);
  assert.equal("ukuranPanjangCm" in n, false);
  assert.deepEqual(await unitUkuran(o.id), [QUEEN]);
});

test("Klien lama (tanpa kunci angka): 'Ukuran Custom' tetap diterima dan TIDAK ditebak; tampil penanda belum diisi", async () => {
  const { sales, customer } = await siapkan();
  const o = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM }), unitCount: 1 }, sales.user.id);
  const n = await notesOf(o.id);
  assert.equal("ukuranLebarCm" in n, false);
  assert.deepEqual(await unitUkuran(o.id), [CUSTOM]);
  const view = await buildInvoiceView(o.id);
  assert.equal(view.order.ukuranKasur, "Ukuran Custom (ukuran belum diisi)");
});

// ── Edit Order ──────────────────────────────────────────────────────────────────────────────────────────────────

test("Edit Order: standar → custom → ubah angka → kembali ke standar; notes & Unit.ukuran selalu selaras, nilai custom dibersihkan", async () => {
  const { sales, customer, c } = await siapkan();
  const o = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: QUEEN }), unitCount: 2 }, sales.user.id);
  const patch = (nilai) => c.patch(`/api/orders/${o.id}`, { notes: notes(nilai) });

  let r = await patch({ ukuranKasur: CUSTOM, ukuranLebarCm: "145", ukuranPanjangCm: "205" });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal((await notesOf(o.id)).ukuranLebarCm, 145);
  assert.deepEqual(await unitUkuran(o.id), ["145 × 205 cm (Custom)", "145 × 205 cm (Custom)"]);
  assert.equal((await buildInvoiceView(o.id)).order.ukuranKasur, "145 × 205 cm (Custom)");
  assert.match((await buildInvoiceView(o.id)).order.produk, /145 × 205 cm \(Custom\)/);

  r = await patch({ ukuranKasur: CUSTOM, ukuranLebarCm: "150", ukuranPanjangCm: "210" });
  assert.equal(r.status, 200);
  assert.deepEqual(await unitUkuran(o.id), ["150 × 210 cm (Custom)", "150 × 210 cm (Custom)"]);

  r = await patch({ ukuranKasur: "180x200 cm (King)", ukuranLebarCm: 150, ukuranPanjangCm: 210 });
  assert.equal(r.status, 200);
  const n = await notesOf(o.id);
  assert.equal("ukuranLebarCm" in n, false, "nilai custom tidak ikut tersimpan setelah kembali ke standar");
  assert.equal("ukuranPanjangCm" in n, false);
  assert.deepEqual(await unitUkuran(o.id), ["180x200 cm (King)", "180x200 cm (King)"]);
});

test("Edit Order tidak valid → 400 Indonesia, notes & unit TIDAK berubah; unit yang ukurannya diubah manual tidak ditimpa", async () => {
  const { sales, customer, c } = await siapkan();
  const o = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: 145, ukuranPanjangCm: 205 }), unitCount: 2 }, sales.user.id);
  const sebelum = (await testPrisma.order.findUnique({ where: { id: o.id } })).notes;
  const bad = await c.patch(`/api/orders/${o.id}`, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: "", ukuranPanjangCm: "abc" }) });
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Lebar \(cm\) wajib diisi/);
  assert.match(bad.body.error, /Panjang harus berupa angka positif/);
  assert.equal((await testPrisma.order.findUnique({ where: { id: o.id } })).notes, sebelum);

  const [u1] = await testPrisma.unit.findMany({ where: { orderId: o.id }, orderBy: { seq: "asc" } });
  await testPrisma.unit.update({ where: { id: u1.id }, data: { ukuran: "Diukur ulang di workshop" } });
  const ok = await c.patch(`/api/orders/${o.id}`, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: 160, ukuranPanjangCm: 200 }) });
  assert.equal(ok.status, 200);
  assert.deepEqual(await unitUkuran(o.id), ["Diukur ulang di workshop", "160 × 200 cm (Custom)"]);
});

test("Data legacy tidak diubah: edit keluhan pada order custom lama (tanpa angka) tetap boleh dan tidak menebak ukuran; unit lama utuh", async () => {
  const { sales, customer, c } = await siapkan();
  const lama = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM }), unitCount: 1 }, sales.user.id);
  const r = await c.patch(`/api/orders/${lama.id}`, { notes: notes({ ukuranKasur: CUSTOM, keluhanCustomer: "Pinggang" }) });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const n = await notesOf(lama.id);
  assert.equal(n.keluhanCustomer, "Pinggang");
  assert.equal("ukuranLebarCm" in n, false);
  assert.deepEqual(await unitUkuran(lama.id), [CUSTOM], "unit lama tidak diubah");
  // order lain (bukan yang diedit) tidak tersentuh
  const lain = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: 145, ukuranPanjangCm: 205 }), unitCount: 1 }, sales.user.id);
  const fp = async () => JSON.stringify(await testPrisma.unit.findMany({ where: { orderId: lain.id } }));
  const sebelum = await fp();
  await c.patch(`/api/orders/${lama.id}`, { notes: notes({ ukuranKasur: QUEEN }) });
  assert.equal(await fp(), sebelum);
});

// ── Buat Resi (setiap item) ─────────────────────────────────────────────────────────────────────────────────────

const item = (extra = {}) => ({ merk: "Sano", ukuran: QUEEN, keluhan: "Pegal", nominal: 1_000_000, unitCount: 1, catatan: "", ...extra });
const badan = (customerId, items) => ({ customerId, alamat: "Jl. Kemang 1", kota: "Jakarta Selatan", ongkirTambahan: 0, items });

test("Buat Resi: item custom menyimpan Lebar/Panjang + unit aktual + nama layanan; item standar membuang angka; tidak valid → 400 dan tidak ada data", async () => {
  const { customer, c } = await siapkan();
  await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");

  const r = await c.post("/api/resi", badan(customer.id, [
    item({ ukuran: CUSTOM, ukuranLebar: "145", ukuranPanjang: "205" }),
    item({ ukuran: QUEEN, ukuranLebar: "999", ukuranPanjang: "999" }),
  ]));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const [o1, o2] = r.body.orders;
  const n1 = await notesOf(o1.id); const n2 = await notesOf(o2.id);
  assert.equal(n1.ukuranKasur, CUSTOM); assert.equal(n1.ukuranLebarCm, 145); assert.equal(n1.ukuranPanjangCm, 205);
  assert.equal("ukuranLebarCm" in n2, false, "ukuran standar: angka tidak ikut");
  assert.deepEqual(await unitUkuran(o1.id), ["145 × 205 cm (Custom)"]);
  assert.deepEqual(await unitUkuran(o2.id), [QUEEN]);
  assert.match(o1.nama, /145 × 205 cm \(Custom\)/);

  const sebelum = { o: await testPrisma.order.count(), g: await testPrisma.orderGroup.count() };
  const bad = await c.post("/api/resi", badan(customer.id, [item(), item({ ukuran: CUSTOM, ukuranLebar: "", ukuranPanjang: "205" })]));
  assert.equal(bad.status, 400);
  assert.match(bad.body.error, /Item 2: Lebar \(cm\) wajib diisi/);
  const asing = await c.post("/api/resi", badan(customer.id, [item({ ukuran: "84x195x12" })]));
  assert.equal(asing.status, 400);
  assert.match(asing.body.error, /Item 1: ukuran tidak dikenal/);
  assert.equal(await testPrisma.order.count(), sebelum.o);
  assert.equal(await testPrisma.orderGroup.count(), sebelum.g);
});
