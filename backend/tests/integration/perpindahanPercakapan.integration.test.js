// Audit perpindahan percakapan (11 Okt 2026): ambil alih, transfer admin, klaim otomatis — diuji lewat HTTP & helper terhadap Postgres uji.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import jwt from "jsonwebtoken";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { klaimJikaBelumDimiliki } from "../../src/utils/perpindahanPercakapan.js";
import { initSocket, getIO, emitConversationUpdate } from "../../src/socket.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const sales = async (nama) => { const x = await createTestUser({ roles: ["SALES"] }); await testPrisma.user.update({ where: { id: x.user.id }, data: { name: nama } }); return { ...x, user: { ...x.user, name: nama }, api: makeClient(server.baseUrl, x.token) }; };
const admin = async (nama = "Admin Uji") => { const x = await createTestUser({ roles: ["ADMIN"] }); await testPrisma.user.update({ where: { id: x.user.id }, data: { name: nama } }); return { ...x, user: { ...x.user, name: nama }, api: makeClient(server.baseUrl, x.token) }; };

async function percakapan({ pemegang = null, labelId = null, arahTerakhir = "OUTBOUND", menitLalu = 5, tipe = "INDIVIDUAL" } = {}) {
  const customer = tipe === "GROUP" ? null : await testPrisma.customer.create({ data: { name: "Ibu Uji", phone: `62812${Math.floor(Math.random() * 1e8)}`, assignedSalesId: labelId } });
  const conv = await testPrisma.conversation.create({
    data: { type: tipe, channel: "WHATSAPP", customerId: customer?.id ?? null, assignedToId: pemegang, ...(tipe === "GROUP" ? { groupJid: `120363${Math.floor(Math.random() * 1e8)}@g.us`, groupName: "Grup Uji" } : {}) },
  });
  await testPrisma.message.create({ data: { conversationId: conv.id, direction: arahTerakhir, content: "halo", createdAt: new Date(Date.now() - menitLalu * 60_000) } });
  return { customer, conv };
}
const events = (convId) => testPrisma.handoverEvent.findMany({ where: { conversationId: convId }, orderBy: { createdAt: "asc" } });

test("takeover percakapan belum bertuan: 200, event + catatan + label customer, respons membawa assignedTo & canTakeOver", async () => {
  const a = await sales("Fadlan");
  const { conv, customer } = await percakapan();
  const r = await a.api.post(`/api/conversations/${conv.id}/takeover`);
  assert.equal(r.status, 200);
  assert.equal(r.body.assignedToId, a.user.id);
  assert.equal(r.body.assignedTo.name, "Fadlan");
  assert.equal(typeof r.body.canTakeOver, "boolean");
  assert.deepEqual((await events(conv.id)).map((e) => e.reason), ["takeover"]);
  assert.equal((await testPrisma.customer.findUnique({ where: { id: customer.id } })).assignedSalesId, a.user.id);
  assert.equal(await testPrisma.note.count({ where: { customerId: customer.id } }), 1);
});

test("BALAPAN: dua sales menekan Ambil bersamaan → tepat satu berhasil, satu event, pemegang = pemenang", async () => {
  const a = await sales("Ervina");
  const b = await sales("Risel");
  const { conv } = await percakapan();
  const [ra, rb] = await Promise.all([
    a.api.post(`/api/conversations/${conv.id}/takeover`),
    b.api.post(`/api/conversations/${conv.id}/takeover`),
  ]);
  const sukses = [ra, rb].filter((x) => x.status === 200);
  assert.equal(sukses.length, 1, `status: ${ra.status}, ${rb.status}`);
  assert.ok([ra, rb].find((x) => x.status !== 200).status === 409 || [ra, rb].find((x) => x.status !== 200).status === 403);
  const ev = await events(conv.id);
  assert.equal(ev.length, 1);
  const c = await testPrisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(c.assignedToId, sukses[0].body.assignedToId);
  assert.equal(c.assignedToId, ev[0].toUserId);
});

test("takeover percakapan GRUP ditolak 400 dan tidak mengubah apa pun", async () => {
  const a = await sales("Kiki");
  const { conv } = await percakapan({ tipe: "GROUP" });
  const r = await a.api.post(`/api/conversations/${conv.id}/takeover`);
  assert.equal(r.status, 400);
  assert.equal((await testPrisma.conversation.findUnique({ where: { id: conv.id } })).assignedToId, null);
  assert.equal((await events(conv.id)).length, 0);
});

test("takeover: sales tidak boleh merebut chat yang sudah dibalas / belum 1 jam; belum dibalas ≥60 mnt boleh; admin selalu boleh", async () => {
  const pemilik = await sales("Pemilik");
  const a = await sales("Penantang");
  const adm = await admin("Novi");
  const dibalas = await percakapan({ pemegang: pemilik.user.id, arahTerakhir: "OUTBOUND" });
  assert.equal((await a.api.post(`/api/conversations/${dibalas.conv.id}/takeover`)).status, 403);
  const baru = await percakapan({ pemegang: pemilik.user.id, arahTerakhir: "INBOUND", menitLalu: 20 });
  assert.equal((await a.api.post(`/api/conversations/${baru.conv.id}/takeover`)).status, 403);
  const lama = await percakapan({ pemegang: pemilik.user.id, arahTerakhir: "INBOUND", menitLalu: 90 });
  assert.equal((await a.api.post(`/api/conversations/${lama.conv.id}/takeover`)).status, 200);
  assert.equal((await adm.api.post(`/api/conversations/${dibalas.conv.id}/takeover`)).status, 200);
});

test("transfer valid: respons membawa assignedTo, catatan serah-terima memuat nama, riwayat & label customer ikut", async () => {
  const adm = await admin("Novi");
  const lama = await sales("Suci");
  const baru = await sales("Fadlan");
  const { conv, customer } = await percakapan({ pemegang: lama.user.id, labelId: lama.user.id });
  const r = await adm.api.patch(`/api/conversations/${conv.id}`, { assignedToId: baru.user.id });
  assert.equal(r.status, 200);
  assert.equal(r.body.assignedTo.name, "Fadlan");
  assert.match(r.body.handoverNote, /Suci/);
  assert.match(r.body.handoverNote, /Fadlan/);
  assert.ok(r.body.handoverNote.includes(`oleh ${jwt.decode(adm.token).name}`), r.body.handoverNote); // pelaku = nama di token login
  const ev = await events(conv.id);
  assert.deepEqual(ev.map((e) => [e.reason, e.fromUserId, e.toUserId]), [["transfer", lama.user.id, baru.user.id]]);
  assert.equal((await testPrisma.customer.findUnique({ where: { id: customer.id } })).assignedSalesId, baru.user.id);
});

test("transfer ditolak 400: akun Driver/Helper, akun nonaktif, id tidak ada — percakapan TIDAK berubah", async () => {
  const adm = await admin();
  const pemilik = await sales("Pemilik");
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const nonaktif = await sales("Mila");
  await testPrisma.user.update({ where: { id: nonaktif.user.id }, data: { active: false } });
  const { conv } = await percakapan({ pemegang: pemilik.user.id });
  for (const id of [driver.user.id, nonaktif.user.id, "tidak-ada"]) {
    const r = await adm.api.patch(`/api/conversations/${conv.id}`, { assignedToId: id });
    assert.equal(r.status, 400, id);
  }
  assert.equal((await testPrisma.conversation.findUnique({ where: { id: conv.id } })).assignedToId, pemilik.user.id);
  assert.equal((await events(conv.id)).length, 0);
});

test("transfer oleh non-admin tetap 403; status/unread ikut tertulis pada transfer yang sama", async () => {
  const biasa = await sales("Biasa");
  const adm = await admin();
  const tujuan = await sales("Tujuan");
  const { conv } = await percakapan();
  assert.equal((await biasa.api.patch(`/api/conversations/${conv.id}`, { assignedToId: tujuan.user.id })).status, 403);
  const r = await adm.api.patch(`/api/conversations/${conv.id}`, { assignedToId: tujuan.user.id, status: "PENDING", unread: true });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "PENDING");
  assert.equal(r.body.unread, true);
});

test("PATCH tanpa assignedToId (pin/status) tidak menyentuh pemegang maupun riwayat", async () => {
  const adm = await admin();
  const pemilik = await sales("Pemilik");
  const { conv } = await percakapan({ pemegang: pemilik.user.id });
  const r = await adm.api.patch(`/api/conversations/${conv.id}`, { pinned: true });
  assert.equal(r.status, 200);
  const c = await testPrisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(c.pinned, true);
  assert.equal(c.assignedToId, pemilik.user.id);
  assert.equal((await events(conv.id)).length, 0);
});

test("KLAIM OTOMATIS bersamaan: tepat satu menang, satu event; yang kalah tidak menimpa", async () => {
  const a = await sales("Ervina");
  const b = await sales("Risel");
  const { conv } = await percakapan();
  const baca = () => testPrisma.conversation.findUnique({ where: { id: conv.id }, include: { customer: true } });
  const [x, y] = await Promise.all([
    klaimJikaBelumDimiliki(testPrisma, { conversation: await baca(), user: { id: a.user.id, roles: ["SALES"] }, messageCreatedAt: new Date() }),
    klaimJikaBelumDimiliki(testPrisma, { conversation: await baca(), user: { id: b.user.id, roles: ["SALES"] }, messageCreatedAt: new Date() }),
  ]);
  assert.equal([x, y].filter(Boolean).length, 1);
  const ev = await events(conv.id);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].reason, "auto-claim");
  assert.equal((await testPrisma.conversation.findUnique({ where: { id: conv.id } })).assignedToId, ev[0].toUserId);
});

test("KLAIM OTOMATIS oleh orang yang sama dua kali bersamaan → hanya SATU event (dulu dobel)", async () => {
  const a = await sales("Rifki");
  const { conv } = await percakapan();
  const baca = () => testPrisma.conversation.findUnique({ where: { id: conv.id }, include: { customer: true } });
  const u = { id: a.user.id, roles: ["SALES"] };
  const hasil = await Promise.all([
    klaimJikaBelumDimiliki(testPrisma, { conversation: await baca(), user: u, messageCreatedAt: new Date() }),
    klaimJikaBelumDimiliki(testPrisma, { conversation: await baca(), user: u, messageCreatedAt: new Date() }),
  ]);
  assert.equal(hasil.filter(Boolean).length, 1);
  assert.equal((await events(conv.id)).length, 1);
});

test("klaim otomatis: label customer yang sudah terisi TIDAK dirampas; non-SALES & grup tidak mengklaim", async () => {
  const pemilikLabel = await sales("Pemilik Label");
  const a = await sales("Penjawab");
  const { conv, customer } = await percakapan({ labelId: pemilikLabel.user.id });
  const baca = () => testPrisma.conversation.findUnique({ where: { id: conv.id }, include: { customer: true } });
  assert.equal(await klaimJikaBelumDimiliki(testPrisma, { conversation: await baca(), user: { id: a.user.id, roles: ["SALES"] }, messageCreatedAt: new Date() }), true);
  assert.equal((await testPrisma.customer.findUnique({ where: { id: customer.id } })).assignedSalesId, pemilikLabel.user.id);
  const g = await percakapan({ tipe: "GROUP" });
  assert.equal(await klaimJikaBelumDimiliki(testPrisma, { conversation: g.conv, user: { id: a.user.id, roles: ["SALES"] }, messageCreatedAt: new Date() }), false);
  const adm = await admin();
  const lain = await percakapan();
  assert.equal(await klaimJikaBelumDimiliki(testPrisma, { conversation: lain.conv, user: { id: adm.user.id, roles: ["ADMIN"] }, messageCreatedAt: new Date() }), false);
});

test("PAYLOAD socket conversation:update membawa assignedToId, assignedTo, handoverNote, canTakeOver; payload parsial tidak menghapusnya", async () => {
  initSocket(http.createServer());
  const io = getIO();
  const tertangkap = [];
  io.emit = (evt, payload) => { if (evt === "conversation:update") tertangkap.push(payload); };
  const pemilik = await sales("Ervina");
  const { conv } = await percakapan({ pemegang: pemilik.user.id, arahTerakhir: "INBOUND", menitLalu: 90 });
  const penuh = await testPrisma.conversation.findUnique({ where: { id: conv.id } });
  await emitConversationUpdate(penuh);
  const p = tertangkap.at(-1);
  assert.equal(p.assignedToId, pemilik.user.id);
  assert.equal(p.assignedTo.name, "Ervina");
  assert.equal(p.canTakeOver, true);
  assert.ok("handoverNote" in p);
  await emitConversationUpdate({ id: conv.id, lastMessagePreview: "x", lastMessageAt: new Date() });
  const parsial = tertangkap.at(-1);
  assert.equal("assignedToId" in parsial, false, "payload parsial tidak boleh menimpa pemegang klien dengan undefined");
  assert.equal("assignedTo" in parsial, false);
});
