import test from "node:test";
import assert from "node:assert/strict";
import { createRealtime } from "../src/lib/realtime.js";

function fakeSocket(connected = true) {
  const h = new Map();
  return {
    connected,
    on(e, f) { if (!h.has(e)) h.set(e, new Set()); h.get(e).add(f); },
    off(e, f) { h.get(e)?.delete(f); },
    emit(e, d) { h.get(e)?.forEach((f) => f(d)); },
    count() { let n = 0; for (const s of h.values()) n += s.size; return n; },
  };
}
function fakeTimers() {
  let id = 0; const q = new Map();
  return {
    setTimeoutFn: (fn, ms) => { q.set(++id, { fn, ms }); return id; },
    clearTimeoutFn: (i) => q.delete(i),
    pending: () => q.size,
    fire() { const first = [...q][0]; if (!first) return null; q.delete(first[0]); first[1].fn(); return first[1].ms; },
  };
}
function fakeEs() {
  const handlers = new Map();
  return { closed: false, close() { this.closed = true; }, addEventListener(t, f) { handlers.set(t, f); }, removeEventListener(t) { handlers.delete(t); }, handlers };
}

test("socket tersambung: SSE TIDAK pernah dibuka (satu koneksi realtime)", () => {
  const sock = fakeSocket(true); const t = fakeTimers(); let opened = 0;
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => { opened++; return fakeEs(); }, ...t });
  const got = [];
  rt.subscribe("new_message", (d) => got.push(d));
  sock.emit("new_message", { conversationId: "c1" });
  assert.deepEqual(got, [{ conversationId: "c1" }]);
  assert.equal(opened, 0);
  assert.equal(t.pending(), 0);
});

test("banyak subscriber event sama memakai satu handler socket", () => {
  const sock = fakeSocket(true); const t = fakeTimers();
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => null, ...t });
  rt.subscribe("new_message", () => {}); rt.subscribe("new_message", () => {}); rt.subscribe("new_message", () => {});
  // 1 handler event + connect + disconnect
  assert.equal(sock.count(), 3);
});

test("socket putus > grace: SSE fallback dibuka; socket pulih: SSE ditutup", () => {
  const sock = fakeSocket(true); const t = fakeTimers(); const opened = [];
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => { const e = fakeEs(); opened.push(e); return e; }, ...t });
  const got = [];
  rt.subscribe("new_message", (d) => got.push(d));
  sock.connected = false; sock.emit("disconnect");
  assert.equal(opened.length, 0, "belum dibuka sebelum grace habis");
  t.fire();
  assert.equal(opened.length, 1);
  opened[0].handlers.get("new_message")({ data: JSON.stringify({ conversationId: "c9" }) });
  assert.deepEqual(got, [{ conversationId: "c9" }]);
  sock.connected = true; sock.emit("connect");
  assert.equal(opened[0].closed, true);
  assert.equal(rt.stats().sseOpen, false);
});

test("reconnect blip cepat (<grace) tidak membuka SSE", () => {
  const sock = fakeSocket(true); const t = fakeTimers(); let opened = 0;
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => { opened++; return fakeEs(); }, ...t });
  rt.subscribe("new_message", () => {});
  sock.connected = false; sock.emit("disconnect");
  sock.connected = true; sock.emit("connect");
  assert.equal(t.pending(), 0);
  assert.equal(opened, 0);
});

test("SSE error → reconnect dengan exponential backoff (maks 30 dtk)", () => {
  const sock = fakeSocket(false); const t = fakeTimers(); const opened = [];
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => { const e = fakeEs(); opened.push(e); return e; }, ...t });
  rt.subscribe("new_message", () => {});
  t.fire(); // grace → buka SSE #1
  const delays = [];
  for (let i = 0; i < 6; i++) {
    opened[opened.length - 1].onerror();
    delays.push(t.fire()); // retry timer
  }
  assert.deepEqual(delays, [3000, 6000, 12000, 24000, 30000, 30000]);
  assert.equal(opened.length, 7);
});

test("unsubscribe terakhir membersihkan semua listener, timer & SSE", () => {
  const sock = fakeSocket(false); const t = fakeTimers(); const opened = [];
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => { const e = fakeEs(); opened.push(e); return e; }, ...t });
  const off1 = rt.subscribe("new_message", () => {});
  const off2 = rt.subscribe("other", () => {});
  t.fire();
  off1();
  assert.equal(rt.stats().types, 1);
  off2();
  assert.equal(sock.count(), 0, "tidak ada listener socket tersisa");
  assert.equal(t.pending(), 0, "tidak ada timer tersisa");
  assert.equal(opened[0].closed, true);
  assert.equal(rt.stats().sseOpen, false);
});

test("error di satu listener tidak mematikan listener lain", () => {
  const sock = fakeSocket(true); const t = fakeTimers();
  const rt = createRealtime({ getSocket: () => sock, openEventSource: () => null, ...t });
  const got = [];
  rt.subscribe("e", () => { throw new Error("boom"); });
  rt.subscribe("e", (d) => got.push(d));
  sock.emit("e", 1);
  assert.deepEqual(got, [1]);
});
