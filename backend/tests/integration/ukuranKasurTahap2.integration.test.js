// Ukuran Kasur Custom — tahap 2: ukuran di PDF invoice (tanpa merusak layout, termasuk invoice panjang/gabungan) dan penegakan server (default MATI).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { PDFParse } from "pdf-parse";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { setSetting, SETTING_KEYS, getSettingRaw } from "../../src/services/finance/settings.js";
import { createOrderForCustomer } from "../../src/services/orderCreation.js";
import { buildInvoiceView } from "../../src/services/invoice.js";
import { renderInvoicePdf } from "../../src/services/invoicePdf.js";
import { ukuranCustomWajibSejak } from "../../src/services/ukuranWajib.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const CUSTOM = "Ukuran Custom";
const QUEEN = "160x200 cm (Queen)";
const notes = (o) => JSON.stringify({ merkKasur: "Sano", keluhanCustomer: "Pegal", ...o });
async function siapkan() {
  const sales = await createTestUser({ roles: ["SALES"] });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  return { sales, admin, customer, c: makeClient(server.baseUrl, sales.token), a: makeClient(server.baseUrl, admin.token) };
}
async function buatOrder(customerId, userId, notesObj, { items = 1, harga = 500_000 } = {}) {
  const o = await createOrderForCustomer(customerId, { notes: notes(notesObj), unitCount: 1 }, userId);
  for (let i = 0; i < items; i += 1) await testPrisma.orderItem.create({ data: { orderId: o.id, layananName: `Layanan contoh ${i + 1}`, harga, sortOrder: i } });
  await testPrisma.order.update({ where: { id: o.id }, data: { value: harga * items } });
  return o;
}
async function teksPdf(orderId, nama) {
  const buf = await renderInvoicePdf(await buildInvoiceView(orderId));
  if (process.env.UKURAN_PDF_OUT) { fs.mkdirSync(process.env.UKURAN_PDF_OUT, { recursive: true }); fs.writeFileSync(path.join(process.env.UKURAN_PDF_OUT, nama + ".pdf"), buf); }
  const p = new PDFParse({ data: new Uint8Array(buf) });
  const r = await p.getText();
  await p.destroy?.();
  return { teks: r.text.replace(/\s+/g, " "), halaman: r.total ?? r.pages?.length ?? 1, buf };
}
const hitung = (teks, sub) => teks.split(sub).length - 1;

// ── PDF invoice ─────────────────────────────────────────────────────────────────────────────────────────────────

test("PDF invoice: standar '160 × 200 cm', custom '145 × 205 cm (Custom)', legacy 'Ukuran Custom (ukuran belum diisi)'", async () => {
  const { sales, customer } = await siapkan();
  const std = await buatOrder(customer.id, sales.user.id, { ukuranKasur: QUEEN });
  const cus = await buatOrder(customer.id, sales.user.id, { ukuranKasur: CUSTOM, ukuranLebarCm: 145, ukuranPanjangCm: 205 });
  const leg = await buatOrder(customer.id, sales.user.id, { ukuranKasur: CUSTOM });
  const a = await teksPdf(std.id, "standar");
  const b = await teksPdf(cus.id, "custom");
  const c = await teksPdf(leg.id, "legacy");
  assert.match(a.teks, /Ukuran: 160 × 200 cm/);
  assert.doesNotMatch(a.teks, /\(Queen\)/);
  assert.match(b.teks, /Ukuran: 145 × 205 cm \(Custom\)/);
  assert.match(c.teks, /Ukuran: Ukuran Custom \(ukuran belum diisi\)/);
  for (const r of [a, b, c]) { assert.ok(r.buf.subarray(0, 4).toString() === "%PDF"); assert.equal(r.halaman, 1); assert.match(r.teks, /Layanan contoh 1/); }
});

test("PDF invoice: order tanpa ukuran tidak mencetak baris ukuran; layout tetap satu halaman", async () => {
  const { sales, customer } = await siapkan();
  const o = await buatOrder(customer.id, sales.user.id, { ukuranKasur: "" });
  const r = await teksPdf(o.id, "tanpa-ukuran");
  assert.equal(hitung(r.teks, "Ukuran:"), 0);
  assert.equal(r.halaman, 1);
});

test("PDF invoice PANJANG (banyak item, multi-halaman): baris ukuran tercetak SEKALI per order, tidak terpotong, header tabel diulang", async () => {
  const { sales, customer } = await siapkan();
  const o = await buatOrder(customer.id, sales.user.id, { ukuranKasur: CUSTOM, ukuranLebarCm: 145.5, ukuranPanjangCm: 205 }, { items: 45, harga: 100_000 });
  const r = await teksPdf(o.id, "panjang-45-item");
  assert.ok(r.halaman >= 2, `harus multi-halaman (dapat ${r.halaman})`);
  assert.equal(hitung(r.teks, "Ukuran: 145,5 × 205 cm (Custom)"), 1);
  assert.match(r.teks, /Layanan contoh 45/);
  assert.equal(hitung(r.teks, "Layanan contoh 1 "), 1);
});

test("PDF invoice GABUNGAN (Resi): tiap order menampilkan ukurannya sendiri sekali", async () => {
  const { sales, customer, c } = await siapkan();
  await setSetting(testPrisma, SETTING_KEYS.RESI_INPUT_AKTIF, "true");
  const r = await c.post("/api/resi", {
    customerId: customer.id, alamat: "Jl. Kemang 1", kota: "Jakarta Selatan", ongkirTambahan: 0,
    items: [
      { merk: "Sano", ukuran: CUSTOM, ukuranLebar: "145", ukuranPanjang: "205", nominal: 1_000_000, unitCount: 1 },
      { merk: "Sano", ukuran: QUEEN, nominal: 900_000, unitCount: 1 },
      { merk: "Sano", ukuran: CUSTOM, ukuranLebar: "90", ukuranPanjang: "190,5", nominal: 800_000, unitCount: 1 },
    ],
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  const pdf = await teksPdf(r.body.anchorOrderId, "resi-gabungan");
  assert.equal(hitung(pdf.teks, "Ukuran: 145 × 205 cm (Custom)"), 1);
  assert.equal(hitung(pdf.teks, "Ukuran: 160 × 200 cm"), 1);
  assert.equal(hitung(pdf.teks, "Ukuran: 90 × 190,5 cm (Custom)"), 1);
  void sales;
});

// ── Penegakan server ────────────────────────────────────────────────────────────────────────────────────────────

test("Penegakan MATI secara default: custom tanpa angka tetap diterima (kompatibel klien lama); status null", async () => {
  const { sales, customer } = await siapkan();
  assert.equal(await getSettingRaw(testPrisma, SETTING_KEYS.UKURAN_CUSTOM_WAJIB), "false");
  assert.equal(await ukuranCustomWajibSejak(), null);
  const o = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM }), unitCount: 1 }, sales.user.id);
  assert.ok(o.id);
});

test("Menyalakan lewat pengaturan Finance mengunci tanggal mulai; mematikan → status null lagi", async () => {
  const { a } = await siapkan();
  const on = await a.patch("/api/finance/settings", { settings: { [SETTING_KEYS.UKURAN_CUSTOM_WAJIB]: "true" } });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  const sejak = await ukuranCustomWajibSejak();
  assert.ok(sejak && !Number.isNaN(new Date(sejak).getTime()));
  assert.ok(Math.abs(Date.now() - new Date(sejak).getTime()) < 60_000);
  const off = await a.patch("/api/finance/settings", { settings: { [SETTING_KEYS.UKURAN_CUSTOM_WAJIB]: "false" } });
  assert.equal(off.status, 200);
  assert.equal(await ukuranCustomWajibSejak(), null);
  // aktif tetapi tanggal mulai rusak → gagal-aman (tanpa penegakan)
  await setSetting(testPrisma, SETTING_KEYS.UKURAN_CUSTOM_WAJIB, "true");
  await setSetting(testPrisma, SETTING_KEYS.UKURAN_CUSTOM_WAJIB_SEJAK, "bukan-tanggal");
  assert.equal(await ukuranCustomWajibSejak(), null);
});

test("Penegakan AKTIF: create custom wajib angka; edit legacy tanpa mengubah ukuran tetap boleh; memilih/mengubah menjadi custom → angka wajib", async () => {
  const { sales, customer, c } = await siapkan();
  // order legacy dibuat SEBELUM penegakan
  const legacy = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM }), unitCount: 1 }, sales.user.id);
  await setSetting(testPrisma, SETTING_KEYS.UKURAN_CUSTOM_WAJIB, "true");
  await setSetting(testPrisma, SETTING_KEYS.UKURAN_CUSTOM_WAJIB_SEJAK, new Date().toISOString());

  // create
  await assert.rejects(createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM }), unitCount: 1 }, sales.user.id), (e) => e.statusCode === 400 && /Lebar \(cm\) wajib diisi/.test(e.message));
  const before = await testPrisma.order.count();
  const ok = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: 145, ukuranPanjangCm: 205 }), unitCount: 1 }, sales.user.id);
  assert.ok(ok.id);
  await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: QUEEN }), unitCount: 1 }, sales.user.id);
  assert.equal(await testPrisma.order.count(), before + 2, "gagal validasi tidak meninggalkan order");

  // edit legacy TANPA mengubah ukuran → tetap boleh (mis. ubah keluhan)
  const r1 = await c.patch(`/api/orders/${legacy.id}`, { notes: notes({ ukuranKasur: CUSTOM, keluhanCustomer: "Pinggang" }) });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.equal(JSON.parse((await testPrisma.order.findUnique({ where: { id: legacy.id } })).notes).keluhanCustomer, "Pinggang");
  // edit legacy dengan mengisi angka → boleh dan tersimpan
  const r2 = await c.patch(`/api/orders/${legacy.id}`, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: 150, ukuranPanjangCm: 210 }) });
  assert.equal(r2.status, 200);
  assert.equal(JSON.parse((await testPrisma.order.findUnique({ where: { id: legacy.id } })).notes).ukuranLebarCm, 150);
  // sekarang order itu BUKAN legacy lagi: custom tanpa angka ditolak
  const r3 = await c.patch(`/api/orders/${legacy.id}`, { notes: notes({ ukuranKasur: CUSTOM }) });
  assert.equal(r3.status, 400);
  assert.match(r3.body.error, /Lebar \(cm\) wajib diisi/);

  // standar → custom tanpa angka ditolak; custom berangka diterima; standar tetap diterima
  const std = await createOrderForCustomer(customer.id, { notes: notes({ ukuranKasur: QUEEN }), unitCount: 1 }, sales.user.id);
  assert.equal((await c.patch(`/api/orders/${std.id}`, { notes: notes({ ukuranKasur: CUSTOM }) })).status, 400);
  assert.equal((await c.patch(`/api/orders/${std.id}`, { notes: notes({ ukuranKasur: CUSTOM, ukuranLebarCm: 120, ukuranPanjangCm: 200 }) })).status, 200);
  assert.equal((await c.patch(`/api/orders/${std.id}`, { notes: notes({ ukuranKasur: "180x200 cm (King)" }) })).status, 200);
  // PATCH tanpa notes tidak terpengaruh penegakan
  assert.equal((await c.patch(`/api/orders/${legacy.id}`, { deliveryCity: "Jakarta" })).status, 200);
});
