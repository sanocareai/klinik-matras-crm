// GET /api/orders membawa `salesKredit` = pihak yang dikreditkan laporan Sales (aturan sama dengan atribusiOrderWhere), terpisah dari label lead.
// Kasus nyata 11 Okt 2026: order tampak "atas nama Fadlan" (label lead) tetapi laporan mengkreditkan Ervina (pemilik order eksplisit).
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

const orang = async (nama, roles = ["SALES"]) => { const x = await createTestUser({ roles }); await testPrisma.user.update({ where: { id: x.user.id }, data: { name: nama } }); return x.user; };
async function buatOrder({ nomor, labelId = null, pemegangId = null, pemilikId = null, extra = {} }) {
  const customer = await testPrisma.customer.create({ data: { name: `Cust ${nomor}`, phone: `62811${Math.floor(Math.random() * 1e8)}`, assignedSalesId: labelId } });
  await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", type: "INDIVIDUAL", assignedToId: pemegangId } });
  return testPrisma.order.create({ data: { customerId: customer.id, value: 1000000, category: "LAYANAN", orderNumber: nomor, salesOwnerId: pemilikId, ...extra } });
}
async function daftar(klien) {
  const r = await klien.get("/api/orders?limit=100");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return Object.fromEntries(r.body.items.map((o) => [o.orderNumber, o]));
}

test("pemilik eksplisit MENANG atas label lead & pemegang percakapan (kasus Fadlan/Ervina)", async () => {
  const fadlan = await orang("Fadlan"); const ervina = await orang("Ervina");
  await buatOrder({ nomor: "RES-A", labelId: fadlan.id, pemegangId: fadlan.id, pemilikId: ervina.id });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const o = (await daftar(makeClient(server.baseUrl, token)))["RES-A"];
  assert.deepEqual(o.salesKredit, { id: ervina.id, name: "Ervina", sumber: "PEMILIK_ORDER" });
  assert.equal(o.assignedSales.name, "Fadlan", "label lead tetap dikirim apa adanya");
});

test("tanpa pemilik eksplisit: kredit = pemegang percakapan SEKARANG (bukan label lead)", async () => {
  const risel = await orang("Risel"); const alya = await orang("Alya");
  await buatOrder({ nomor: "RES-B", labelId: risel.id, pemegangId: alya.id });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const o = (await daftar(makeClient(server.baseUrl, token)))["RES-B"];
  assert.deepEqual(o.salesKredit, { id: alya.id, name: "Alya", sumber: "PEMEGANG_PERCAKAPAN" });
});

test("tanpa pemilik & tanpa pemegang → salesKredit null (Tanpa Sales)", async () => {
  await buatOrder({ nomor: "RES-C" });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  assert.equal((await daftar(makeClient(server.baseUrl, token)))["RES-C"].salesKredit, null);
});

test("Penjualan Karyawan (staffSeller) tidak punya kredit Sales walau percakapannya dipegang sales", async () => {
  const sales = await orang("Kiki"); const karyawan = await orang("Imam", ["PRODUCTION_LEAD"]);
  await buatOrder({ nomor: "RES-D", pemegangId: sales.id, extra: { staffSellerId: karyawan.id } });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  assert.equal((await daftar(makeClient(server.baseUrl, token)))["RES-D"].salesKredit, null);
});

test("kolom sementara tidak bocor ke respons", async () => {
  const s = await orang("Mila");
  await buatOrder({ nomor: "RES-E", pemegangId: s.id });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const o = (await daftar(makeClient(server.baseUrl, token)))["RES-E"];
  assert.equal("_pemegangPercakapan" in o, false);
});

test("FILTER ?salesId = yang dikreditkan (bukan label lead): cocok dengan kolom salesKredit; gabungan dengan filter lain tidak saling menimpa", async () => {
  const fadlan = await orang("Fadlan"); const ervina = await orang("Ervina");
  // F1: label lead Fadlan, tapi pemilik order Ervina (kasus nyata) → harus muncul di filter Ervina, BUKAN Fadlan
  await buatOrder({ nomor: "F1", labelId: fadlan.id, pemegangId: fadlan.id, pemilikId: ervina.id });
  // F2: tanpa pemilik, pemegang chat Fadlan → kredit Fadlan
  await buatOrder({ nomor: "F2", labelId: ervina.id, pemegangId: fadlan.id });
  // F3: Penjualan Karyawan di chat yang dipegang Fadlan → tidak ikut filter siapa pun
  const imam = await orang("Imam", ["PRODUCTION_LEAD"]);
  await buatOrder({ nomor: "F3", pemegangId: fadlan.id, extra: { staffSellerId: imam.id } });
  // F4: kredit Fadlan, kategori BARU → dipakai menguji gabungan filter
  const o4 = await buatOrder({ nomor: "F4", pemilikId: fadlan.id });
  await testPrisma.order.update({ where: { id: o4.id }, data: { category: "BARU" } });
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const api = makeClient(server.baseUrl, token);
  const nomor = async (q) => { const r = await api.get(`/api/orders?limit=100&${q}`); assert.equal(r.status, 200, JSON.stringify(r.body)); return r.body.items.map((o) => o.orderNumber).sort(); };
  assert.deepEqual(await nomor(`salesId=${ervina.id}`), ["F1"]);
  assert.deepEqual(await nomor(`salesId=${fadlan.id}`), ["F2", "F4"]);
  assert.deepEqual(await nomor(`salesId=${fadlan.id}&category=BARU`), ["F4"]);
  assert.deepEqual(await nomor(`salesId=${fadlan.id}&hasConfirmedDate=true`), []);
  // konsistensi: tiap order di hasil filter memang salesKredit-nya orang itu
  const r = await api.get(`/api/orders?limit=100&salesId=${fadlan.id}`);
  assert.ok(r.body.items.every((o) => o.salesKredit?.id === fadlan.id));
});
