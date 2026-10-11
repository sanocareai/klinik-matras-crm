// Kredit closing saat percakapan berpindah (keputusan Owner 11 Okt 2026, opsi B): tiap order atas nama pemegang lama WAJIB punya keputusan eksplisit;
// tanpa keputusan = tetap. Diuji lewat HTTP + kueri atribusi laporan yang SAMA dengan analytics (atribusiOrderWhere).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { atribusiOrderWhere } from "../../src/services/salesOwner.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const orang = async (nama, roles = ["SALES"], aktif = true) => {
  const x = await createTestUser({ roles });
  await testPrisma.user.update({ where: { id: x.user.id }, data: { name: nama, active: aktif } });
  return { ...x, user: { ...x.user, name: nama }, api: makeClient(server.baseUrl, x.token) };
};

async function skenario() {
  const admin = await orang("Novi", ["ADMIN"]);
  const suci = await orang("Suci");
  const fadlan = await orang("Fadlan");
  const ervina = await orang("Ervina");
  const karyawan = await orang("Imam", ["PRODUCTION_LEAD"]);
  const customer = await testPrisma.customer.create({ data: { name: "Rr. Devy", phone: `62812${Math.floor(Math.random() * 1e8)}`, assignedSalesId: suci.user.id } });
  const conv = await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", type: "INDIVIDUAL", assignedToId: suci.user.id } });
  await testPrisma.message.create({ data: { conversationId: conv.id, direction: "OUTBOUND", content: "halo" } });
  const mk = (nomor, data = {}) => testPrisma.order.create({ data: { customerId: customer.id, value: 1_000_000, category: "LAYANAN", orderNumber: nomor, ...data } });
  const o = {
    A: await mk("A-null-belumlunas", { paymentStatus: "BELUM_BAYAR" }),
    B: await mk("B-null-lunas", { paymentStatus: "LUNAS", paidAt: new Date() }),
    C: await mk("C-pemilik-suci", { salesOwnerId: suci.user.id }),
    D: await mk("D-pemilik-ervina", { salesOwnerId: ervina.user.id }),
    E: await mk("E-batal", { status: "CANCELLED" }),
    F: await mk("F-karyawan", { staffSellerId: karyawan.user.id }),
  };
  return { admin, suci, fadlan, ervina, customer, conv, o };
}
const pemilik = async (id) => (await testPrisma.order.findUnique({ where: { id } })).salesOwnerId;
const kreditKe = async (userId, orderId) => !!(await testPrisma.order.findFirst({
  where: { id: orderId, ...atribusiOrderWhere(userId, { type: "INDIVIDUAL", assignedToId: userId }) },
}));

test("pratinjau: hanya order yang kreditnya ada pada pemegang lama (null/pemilik=dia), non-batal, non-karyawan; lunas tidak disarankan ikut", async () => {
  const s = await skenario();
  const r = await s.admin.api.get(`/api/conversations/${s.conv.id}/order-terdampak?ke=${s.fadlan.user.id}`);
  assert.equal(r.status, 200);
  assert.equal(r.body.dari.name, "Suci");
  assert.equal(r.body.penerimaSales, true);
  const map = Object.fromEntries(r.body.orders.map((x) => [x.orderNumber, x]));
  assert.deepEqual(Object.keys(map).sort(), ["A-null-belumlunas", "B-null-lunas", "C-pemilik-suci"]);
  assert.equal(map["A-null-belumlunas"].sumber, "PEMEGANG_PERCAKAPAN");
  assert.equal(map["C-pemilik-suci"].sumber, "PEMILIK_ORDER");
  assert.equal(map["A-null-belumlunas"].sarankanIkut, true);
  assert.equal(map["B-null-lunas"].sarankanIkut, false);
});

test("pratinjau: bukan admin → 403; penerima Admin → penerimaSales=false", async () => {
  const s = await skenario();
  assert.equal((await s.suci.api.get(`/api/conversations/${s.conv.id}/order-terdampak`)).status, 403);
  const r = await s.admin.api.get(`/api/conversations/${s.conv.id}/order-terdampak?ke=${s.admin.user.id}`);
  assert.equal(r.body.penerimaSales, false);
});

test("transfer dengan keputusan: yang ikut pindah ke penerima (diaudit), yang tetap dikunci ke pemegang lama; order orang lain tidak tersentuh", async () => {
  const s = await skenario();
  const r = await s.admin.api.patch(`/api/conversations/${s.conv.id}`, {
    assignedToId: s.fadlan.user.id,
    keputusanOrder: [{ orderId: s.o.A.id, ikut: true }, { orderId: s.o.B.id, ikut: false }, { orderId: s.o.C.id, ikut: true }],
    alasanOrder: "Fadlan yang mengerjakan closing",
  });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.kreditOrder, { ikut: 2, tetap: 1 });
  assert.equal(await pemilik(s.o.A.id), s.fadlan.user.id);
  assert.equal(await pemilik(s.o.B.id), s.suci.user.id, "lunas tetap & dikunci ke Suci (dulu: ikut pemegang chat)");
  assert.equal(await pemilik(s.o.C.id), s.fadlan.user.id);
  assert.equal(await pemilik(s.o.D.id), s.ervina.user.id);
  assert.equal(await pemilik(s.o.E.id), null);
  assert.equal(await pemilik(s.o.F.id), null);
  // laporan: B tetap kredit Suci walau chat sekarang Fadlan; A kredit Fadlan
  assert.equal(await kreditKe(s.suci.user.id, s.o.B.id), true);
  assert.equal(await kreditKe(s.fadlan.user.id, s.o.B.id), false);
  assert.equal(await kreditKe(s.fadlan.user.id, s.o.A.id), true);
  const audit = await testPrisma.$queryRawUnsafe(`SELECT metadata->>'aksi' aksi, metadata->>'orderNumber' no FROM activity_events WHERE metadata->>'aksi' IN ('ganti_sales_owner','kunci_sales_owner') ORDER BY no`);
  assert.deepEqual(audit.map((a) => [a.no, a.aksi]), [["A-null-belumlunas", "ganti_sales_owner"], ["B-null-lunas", "kunci_sales_owner"], ["C-pemilik-suci", "ganti_sales_owner"]]);
});

test("TANPA keputusan (klien lama): kredit semua order TETAP di pemegang lama — angka laporan tidak bergeser", async () => {
  const s = await skenario();
  const r = await s.admin.api.patch(`/api/conversations/${s.conv.id}`, { assignedToId: s.fadlan.user.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.kreditOrder, { ikut: 0, tetap: 3 });
  for (const id of [s.o.A.id, s.o.B.id, s.o.C.id]) {
    assert.equal(await kreditKe(s.suci.user.id, id), true);
    assert.equal(await kreditKe(s.fadlan.user.id, id), false);
  }
  assert.equal(r.body.assignedTo.name, "Fadlan");
});

test("ikut tanpa alasan → 400 dan TIDAK ada yang berubah (percakapan, order)", async () => {
  const s = await skenario();
  const r = await s.admin.api.patch(`/api/conversations/${s.conv.id}`, { assignedToId: s.fadlan.user.id, keputusanOrder: [{ orderId: s.o.A.id, ikut: true }] });
  assert.equal(r.status, 400);
  assert.match(r.body.error, /alasan/i);
  assert.equal((await testPrisma.conversation.findUnique({ where: { id: s.conv.id } })).assignedToId, s.suci.user.id);
  assert.equal(await pemilik(s.o.A.id), null);
});

test("keputusan memuat order yang bukan atas nama pemegang lama → 400, tidak ada perubahan", async () => {
  const s = await skenario();
  const r = await s.admin.api.patch(`/api/conversations/${s.conv.id}`, { assignedToId: s.fadlan.user.id, keputusanOrder: [{ orderId: s.o.D.id, ikut: true }], alasanOrder: "x" });
  assert.equal(r.status, 400);
  assert.equal(await pemilik(s.o.D.id), s.ervina.user.id);
  assert.equal((await testPrisma.conversation.findUnique({ where: { id: s.conv.id } })).assignedToId, s.suci.user.id);
});

test("penerima Admin: 'ikut' tidak mungkin (pemilik harus Sales) → otomatis tetap, tanpa alasan, tidak error", async () => {
  const s = await skenario();
  const r = await s.admin.api.patch(`/api/conversations/${s.conv.id}`, { assignedToId: s.admin.user.id, keputusanOrder: [{ orderId: s.o.A.id, ikut: true }] });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.kreditOrder, { ikut: 0, tetap: 3 });
  assert.equal(await pemilik(s.o.A.id), s.suci.user.id);
});

test("pemegang lama sudah nonaktif: tidak ada kredit Sales aktif yang bisa tertukar → tidak ada order dikunci", async () => {
  const s = await skenario();
  const mila = await orang("Mila", ["SALES"], false);
  await testPrisma.conversation.update({ where: { id: s.conv.id }, data: { assignedToId: mila.user.id } });
  const r = await s.admin.api.patch(`/api/conversations/${s.conv.id}`, { assignedToId: s.fadlan.user.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.kreditOrder, { ikut: 0, tetap: 0 });
  assert.equal(await pemilik(s.o.A.id), null);
});

test("AMBIL ALIH oleh sales: order pemegang lama dikunci ke dia (tidak ikut pindah); order milik orang lain tidak tersentuh", async () => {
  const s = await skenario();
  await testPrisma.message.create({ data: { conversationId: s.conv.id, direction: "INBOUND", content: "kak?", createdAt: new Date(Date.now() - 120 * 60_000) } });
  await testPrisma.message.deleteMany({ where: { conversationId: s.conv.id, direction: "OUTBOUND" } });
  const r = await s.fadlan.api.post(`/api/conversations/${s.conv.id}/takeover`);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(await pemilik(s.o.A.id), s.suci.user.id);
  assert.equal(await pemilik(s.o.B.id), s.suci.user.id);
  assert.equal(await pemilik(s.o.C.id), s.suci.user.id);
  assert.equal(await pemilik(s.o.D.id), s.ervina.user.id);
  assert.equal(await kreditKe(s.fadlan.user.id, s.o.A.id), false);
  assert.equal(await kreditKe(s.suci.user.id, s.o.A.id), true);
});

test("order BARU yang dibuat penerima sesudah transfer dikreditkan ke pembuatnya (tidak dipengaruhi kunci)", async () => {
  const s = await skenario();
  await s.admin.api.patch(`/api/conversations/${s.conv.id}`, { assignedToId: s.fadlan.user.id });
  const baru = await testPrisma.order.create({ data: { customerId: s.customer.id, value: 500000, category: "LAYANAN", orderNumber: "G-baru", salesOwnerId: s.fadlan.user.id } });
  assert.equal(await kreditKe(s.fadlan.user.id, baru.id), true);
  assert.equal(await kreditKe(s.suci.user.id, baru.id), false);
});
