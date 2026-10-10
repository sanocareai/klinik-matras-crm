// Batas maksimal diskon promo/voucher (8 Oktober 2026): validasi API Pengaturan Promo, batas ikut di daftar promo,
// peringatan (tidak memblokir) di daftar order & respons item, dan harga-sebelum-diskon yang dipotong batas.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { hitungDiskonPromo, periksaBatasDiskon, normalisasiBatasDiskon } from "../../src/services/diskonPromo.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  return r.body.token;
}

test("hitungDiskonPromo: batas Rupiah memotong diskon hasil hitung mundur persen; tanpa batas perilaku lama", () => {
  const tanpa = hitungDiskonPromo({ totalFinal: 830000, promo: { discountPercent: 17 } });
  assert.equal(tanpa.nilaiDiskon, 170000);
  assert.equal(tanpa.hargaSebelumDiskon, 1000000);
  assert.equal(tanpa.terpotongBatas, false);

  const dibatasi = hitungDiskonPromo({ totalFinal: 830000, promo: { discountPercent: 17, maxDiscountAmount: 100000 } });
  assert.equal(dibatasi.nilaiDiskon, 100000);
  assert.equal(dibatasi.hargaSebelumDiskon, 930000);
  assert.equal(dibatasi.terpotongBatas, true);

  const longgar = hitungDiskonPromo({ totalFinal: 830000, promo: { discountPercent: 17, maxDiscountAmount: 900000 } });
  assert.equal(longgar.nilaiDiskon, 170000); // batas lebih besar dari diskon: tidak berpengaruh

  assert.equal(hitungDiskonPromo({ totalFinal: 500000, promo: null }).hargaSebelumDiskon, 500000);
  assert.equal(hitungDiskonPromo({ totalFinal: 500000, promo: { maxDiscountAmount: 1000 } }).nilaiDiskon, 0); // tanpa persen tidak ada yang dihitung mundur
});

test("periksaBatasDiskon & normalisasiBatasDiskon", () => {
  assert.equal(periksaBatasDiskon({ items: [{ harga: 1, standardPrice: 100 }], promo: { code: "X" } }), null); // promo tanpa batas
  const p = { code: "MERDEKA17", maxDiscountAmount: 500000 };
  const dalam = periksaBatasDiskon({ items: [{ harga: 700000, standardPrice: 1000000 }], promo: p });
  assert.equal(dalam.diskon, 300000);
  assert.equal(dalam.melebihi, false);
  const lebih = periksaBatasDiskon({ items: [{ harga: 400000, standardPrice: 1000000 }, { harga: 1200000, standardPrice: 1000000 }, { harga: 50000, standardPrice: null }], promo: p });
  assert.equal(lebih.diskon, 600000); // item di atas standard & item bebas tidak ikut menutupi
  assert.equal(lebih.melebihi, true);
  assert.equal(lebih.lebih, 100000);
  assert.equal(normalisasiBatasDiskon(""), null);
  assert.equal(normalisasiBatasDiskon(null), null);
  assert.equal(normalisasiBatasDiskon("500000"), 500000);
  assert.ok(Number.isNaN(normalisasiBatasDiskon(-5)));
  assert.ok(Number.isNaN(normalisasiBatasDiskon(0)));
  assert.ok(Number.isNaN(normalisasiBatasDiskon("abc")));
  assert.ok(Number.isNaN(normalisasiBatasDiskon(1.5)));
});

test("API Promo: buat/ubah dengan batas, validasi persen & batas, hanya admin, daftar membawa batas", async () => {
  const admin = await masuk(["ADMIN"]);
  const sales = await masuk(["SALES"]);

  const buruk1 = await raw("POST", "/api/promos", { token: admin, body: { code: "BAD1", name: "x", discountPercent: 250 } });
  assert.equal(buruk1.status, 400);
  const buruk2 = await raw("POST", "/api/promos", { token: admin, body: { code: "BAD2", name: "x", discountPercent: 10, maxDiscountAmount: -5 } });
  assert.equal(buruk2.status, 400);
  const buruk3 = await raw("POST", "/api/promos", { token: admin, body: { code: "BAD3", name: "x", maxDiscountAmount: "abc" } });
  assert.equal(buruk3.status, 400);

  const ok = await raw("POST", "/api/promos", { token: admin, body: { code: "merdeka17", name: "Merdeka", discountPercent: 17, maxDiscountAmount: "500000" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.maxDiscountAmount, 500000);
  assert.equal(ok.body.code, "MERDEKA17");

  const tanpaBatas = await raw("POST", "/api/promos", { token: admin, body: { code: "LONGGAR", name: "Tanpa batas", discountPercent: 5 } });
  assert.equal(tanpaBatas.status, 201);
  assert.equal(tanpaBatas.body.maxDiscountAmount, null);

  // Hanya mengubah `active` tidak boleh menghapus batas.
  const nonaktif = await raw("PATCH", `/api/promos/${ok.body.id}`, { token: admin, body: { active: false } });
  assert.equal(nonaktif.status, 200);
  assert.equal(nonaktif.body.maxDiscountAmount, 500000);
  await raw("PATCH", `/api/promos/${ok.body.id}`, { token: admin, body: { active: true } });

  const ubah = await raw("PATCH", `/api/promos/${ok.body.id}`, { token: admin, body: { maxDiscountAmount: 750000 } });
  assert.equal(ubah.body.maxDiscountAmount, 750000);
  const hapus = await raw("PATCH", `/api/promos/${ok.body.id}`, { token: admin, body: { maxDiscountAmount: null } });
  assert.equal(hapus.body.maxDiscountAmount, null);
  await raw("PATCH", `/api/promos/${ok.body.id}`, { token: admin, body: { maxDiscountAmount: 500000 } });

  const patchSales = await raw("PATCH", `/api/promos/${ok.body.id}`, { token: sales, body: { maxDiscountAmount: 1 } });
  assert.equal(patchSales.status, 403);

  // Sales (dropdown form order & app) membaca daftar promo aktif: batas ikut.
  const daftar = await raw("GET", "/api/promos?active=true", { token: sales });
  assert.equal(daftar.status, 200);
  assert.equal(daftar.body.find((p) => p.code === "MERDEKA17").maxDiscountAmount, 500000);
});

test("Peringatan batas: respons tambah/ubah item & daftar order menandai MELEBIHI tanpa memblokir; promo tanpa batas = null", async () => {
  const admin = await masuk(["ADMIN"]);
  const promo = await testPrisma.promo.create({ data: { code: "VCH500", name: "Voucher 500rb", discountPercent: 20, maxDiscountAmount: 500000 } });
  const bebas = await testPrisma.promo.create({ data: { code: "VCHBEBAS", name: "Tanpa batas", discountPercent: 20 } });
  const cust = await testPrisma.customer.create({ data: { phone: "6281200004001", name: "Voucher" } });
  const order = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: `VCH-${Date.now()}`, category: "LAYANAN", status: "PENDING", value: 0, promoId: promo.id } });
  const orderBebas = await testPrisma.order.create({ data: { customerId: cust.id, orderNumber: `VCH-${Date.now()}-b`, category: "LAYANAN", status: "PENDING", value: 0, promoId: bebas.id } });

  const a = await raw("POST", `/api/orders/${order.id}/items`, { token: admin, body: { layananName: "Full Service", harga: 700000, standardPrice: 1000000, normalPrice: 1200000 } });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.body.promoCheck.melebihi, false);
  assert.equal(a.body.promoCheck.diskon, 300000);

  const b = await raw("POST", `/api/orders/${order.id}/items`, { token: admin, body: { layananName: "Upgrade", harga: 400000, standardPrice: 800000 } });
  assert.equal(b.status, 201); // TIDAK diblokir
  assert.equal(b.body.promoCheck.melebihi, true);
  assert.equal(b.body.promoCheck.diskon, 700000);
  assert.equal(b.body.promoCheck.lebih, 200000);
  assert.equal(b.body.promoCheck.batas, 500000);

  // Memperbaiki harga item: kembali dalam batas.
  const perbaiki = await raw("PATCH", `/api/orders/items/${b.body.item.id}`, { token: admin, body: { harga: 650000 } });
  assert.equal(perbaiki.status, 200);
  assert.equal(perbaiki.body.promoCheck.melebihi, false);
  assert.equal(perbaiki.body.promoCheck.diskon, 450000);
  await raw("PATCH", `/api/orders/items/${b.body.item.id}`, { token: admin, body: { harga: 300000 } });

  const tb = await raw("POST", `/api/orders/${orderBebas.id}/items`, { token: admin, body: { layananName: "Upgrade", harga: 100000, standardPrice: 900000 } });
  assert.equal(tb.status, 201);
  assert.equal(tb.body.promoCheck, null); // promo tanpa batas: tidak ada pemeriksaan

  // Server memfilter per hari WIB (UTC+7); tanggal UTC salah antara 00.00-07.00 WIB.
  const hari = new Date(Date.now() + 7 * 3_600_000).toISOString().slice(0, 10);
  const list = await raw("GET", `/api/orders?from=${hari}&to=${hari}&limit=50`, { token: admin });
  assert.equal(list.status, 200, JSON.stringify(list.body));
  const di = list.body.items.find((o) => o.id === order.id);
  assert.equal(di.promoCheck.melebihi, true);
  assert.equal(di.promo.maxDiscountAmount, 500000);
  assert.equal(list.body.items.find((o) => o.id === orderBebas.id).promoCheck, null);
});
