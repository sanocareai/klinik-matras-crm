// conversation:update membawa status "belum dibalas" (bug 5 Okt 2026: chat yang sudah dibalas — terutama dari WhatsApp di HP — tetap tampil
// di tab "Belum Dibalas" karena payload ringkas ini tidak membawa status itu). Database nyata; io Socket.IO sungguhan di atas http.Server,
// emit-nya disadap.
import "./setup/env.js";
import http from "node:http";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { initSocket, getIO, emitConversationUpdate } from "../../src/socket.js";

let server;
const diterima = [];
test.before(async () => {
  await truncateAll();
  server = http.createServer();
  initSocket(server);
  const io = getIO();
  io.emit = (event, payload) => { diterima.push({ event, payload }); return true; }; // sadap — tanpa klien sungguhan
});
test.afterEach(async () => { diterima.length = 0; await truncateAll(); });
test.after(async () => { await truncateAll(); getIO()?.close(); await testPrisma.$disconnect(); });

async function chat(arahBerurutan) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Uji", phone: `62812${Math.floor(Math.random() * 1e8)}` } });
  const conv = await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", sessionId: "CS-1" } });
  let t = Date.now() - arahBerurutan.length * 60_000;
  for (const direction of arahBerurutan) {
    await testPrisma.message.create({ data: { conversationId: conv.id, direction, content: "x", createdAt: new Date(t) } });
    t += 60_000;
  }
  return conv;
}
const payloadTerakhir = () => diterima.filter((d) => d.event === "conversation:update").at(-1)?.payload;

test("pesan terakhir dari pelanggan → isUnanswered true + menit menunggu", async () => {
  const conv = await chat(["OUTBOUND", "INBOUND"]);
  await emitConversationUpdate(conv);
  const p = payloadTerakhir();
  assert.equal(p.id, conv.id);
  assert.equal(p.isUnanswered, true);
  assert.ok(Number.isInteger(p.unansweredMinutes) && p.unansweredMinutes >= 0);
});

test("sudah dibalas (pesan terakhir OUTBOUND, mis. diketik dari HP) → isUnanswered false", async () => {
  const conv = await chat(["INBOUND", "INBOUND", "OUTBOUND"]);
  await emitConversationUpdate(conv);
  const p = payloadTerakhir();
  assert.equal(p.isUnanswered, false);
  assert.equal(p.unansweredMinutes, null);
});

test("dibalas lalu pelanggan membalas lagi → kembali belum dibalas (dihitung dari pesan TERAKHIR, bukan ada-tidaknya balasan)", async () => {
  const conv = await chat(["INBOUND", "OUTBOUND", "INBOUND"]);
  await emitConversationUpdate(conv);
  assert.equal(payloadTerakhir().isUnanswered, true);
});

test("field lama payload tetap ada (kompatibel dengan klien lama)", async () => {
  const conv = await chat(["INBOUND"]);
  await emitConversationUpdate({ ...conv, lastMessagePreview: "halo", unreadCount: 3, pinned: false });
  const p = payloadTerakhir();
  assert.equal(p.lastMessagePreview, "halo");
  assert.equal(p.unreadCount, 3);
  assert.equal(p.sessionId, "CS-1");
});

test("emit tanpa io / tanpa conv tidak melempar", async () => {
  await emitConversationUpdate(null);
  await emitConversationUpdate(undefined);
});
