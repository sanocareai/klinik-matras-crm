import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { initSocket, getIO } from "../src/socket.js";
import { broadcast } from "../src/routes/sse.js";

// Realtime web = satu koneksi Socket.IO: event global SSE (new_message) juga
// harus diteruskan ke socket dengan nama event yang sama.
test("broadcast() meneruskan event ke Socket.IO (tanpa client SSE pun tidak error)", () => {
  assert.doesNotThrow(() => broadcast("new_message", { conversationId: "x" })); // io belum init
  const server = http.createServer();
  initSocket(server);
  const io = getIO();
  const emitted = [];
  const orig = io.emit.bind(io);
  io.emit = (ev, data) => { emitted.push([ev, data]); return orig(ev, data); };
  broadcast("new_message", { conversationId: "c1", customerId: "u1" });
  assert.deepEqual(emitted, [["new_message", { conversationId: "c1", customerId: "u1" }]]);
  io.close();
});
