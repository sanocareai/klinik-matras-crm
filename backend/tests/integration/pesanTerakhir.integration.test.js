// lampirkanPesanTerakhir (utils/pesanTerakhir.js) harus menghasilkan data IDENTIK
// dengan `include: { messages: { orderBy: { createdAt: "desc" }, take: N } }` lama —
// bentuk objek, urutan, `select` — hanya tanpa memuat seluruh riwayat pesan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { lampirkanPesanTerakhir } from "../../src/utils/pesanTerakhir.js";

const T = (menit) => new Date(Date.UTC(2026, 10, 13, 2, 0, 0) + menit * 60_000);

test.before(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

let ids;
test.before(async () => {
  const cust = await testPrisma.customer.create({ data: { name: "Ibu Uji Pesan" } });
  const a = await testPrisma.conversation.create({ data: { customerId: cust.id, channel: "WHATSAPP", lastMessageAt: T(10) } });
  const b = await testPrisma.conversation.create({ data: { channel: "WHATSAPP", lastMessageAt: T(5) } }); // tanpa pesan
  const c = await testPrisma.conversation.create({ data: { channel: "WHATSAPP", lastMessageAt: T(3) } });
  const m = (conv, id, menit, direction, content) =>
    testPrisma.message.create({ data: { id, conversationId: conv.id, direction, content, createdAt: T(menit) } });
  await m(a, "a1", 1, "INBOUND", "halo");
  await m(a, "a2", 2, "OUTBOUND", "siap kak");
  await m(a, "a3", 9, "INBOUND", "jam sama 1"); // dua pesan createdAt sama
  await m(a, "a4", 9, "OUTBOUND", "jam sama 2");
  await m(a, "a5", 4, "INBOUND", "lama");
  await m(c, "c1", 3, "INBOUND", "satu-satunya");
  ids = [a.id, b.id, c.id];
});

async function lama(take, select) {
  return testPrisma.conversation.findMany({
    where: { id: { in: ids } }, orderBy: { lastMessageAt: "desc" },
    include: { messages: { orderBy: [{ createdAt: "desc" }, { id: "desc" }], take, ...(select ? { select } : {}) } },
  });
}
async function baru(take, select) {
  const convs = await testPrisma.conversation.findMany({ where: { id: { in: ids } }, orderBy: { lastMessageAt: "desc" } });
  return lampirkanPesanTerakhir(testPrisma, convs, { jumlah: take, select });
}

test("take 1 tanpa select: objek pesan lengkap identik, percakapan kosong → []", async () => {
  const [l, b] = [await lama(1), await baru(1)];
  assert.deepEqual(b, l);
  assert.equal(b[0].messages[0].id, "a4"); // jam sama → id terbesar menang, sama dengan urutan lama yang deterministik
  assert.deepEqual(b[1].messages, []);
});

test("take 1 dengan select: hanya field yang diminta (conversationId/createdAt/id tidak bocor)", async () => {
  const [l, b] = [await lama(1, { direction: true }), await baru(1, { direction: true })];
  assert.deepEqual(b, l);
  assert.deepEqual(Object.keys(b[0].messages[0]), ["direction"]);
});

test("take 20 (intelligence): urutan terbaru dulu, batas per percakapan", async () => {
  const sel = { direction: true, content: true, createdAt: true };
  assert.deepEqual(await baru(20, sel), await lama(20, sel));
  const b3 = await baru(3, sel);
  assert.deepEqual(b3[0].messages.map((m) => m.content), ["jam sama 2", "jam sama 1", "lama"]);
});

test("daftar kosong & id duplikat aman", async () => {
  assert.deepEqual(await lampirkanPesanTerakhir(testPrisma, []), []);
  const convs = await testPrisma.conversation.findMany({ where: { id: ids[0] } });
  const dobel = [convs[0], { ...convs[0] }];
  await lampirkanPesanTerakhir(testPrisma, dobel);
  assert.equal(dobel[0].messages[0].id, "a4");
  assert.equal(dobel[1].messages[0].id, "a4");
});
