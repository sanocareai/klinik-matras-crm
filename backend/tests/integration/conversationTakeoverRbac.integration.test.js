// Regresi keamanan (29 September 2026): sebelum ini seluruh router /api/conversations
// (Inbox) cuma dijaga requireAuth — LOGIN APA SAJA, PERAN APA SAJA, bisa membaca dan
// mengubah percakapan customer. Kejadian nyata: Arman (role HELPER, kurir pengiriman,
// tidak pernah pegang Inbox) berhasil POST /:id/takeover dan mengambil alih percakapan
// customer dari sales lain, terlihat di web sebagai "Ditangani oleh Arman".
//
// CLAUDE.md §19: uji dengan akun peran SUNGGUHAN, bukan admin — pola yang sama dipakai
// di sini (HELPER asli, SALES asli, DISPATCHER asli), bukan menyimpulkan dari kode.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";

let server;
let raw;
test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
  raw = makeRaw(server.baseUrl);
});
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function loginWeb(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200, `${roles} login → ${JSON.stringify(r.body)}`);
  return { ...u, token: r.body.token };
}

async function buatPercakapan({ sessionId } = {}) {
  const customer = await testPrisma.customer.create({ data: { phone: `62812${Date.now()}`.slice(0, 15), name: "Customer Uji" } });
  const conv = await testPrisma.conversation.create({ data: { customerId: customer.id, channel: "WHATSAPP", sessionId } });
  return conv;
}

test("HELPER (kurir, D-037) DITOLAK mengambil alih atau membaca percakapan customer", async () => {
  const helper = await loginWeb(["HELPER"]);
  const conv = await buatPercakapan();

  const takeover = await raw("POST", `/api/conversations/${conv.id}/takeover`, { token: helper.token, body: {} });
  assert.equal(takeover.status, 403, JSON.stringify(takeover.body));

  const list = await raw("GET", "/api/conversations", { token: helper.token });
  assert.equal(list.status, 403);

  const detail = await raw("GET", `/api/conversations/${conv.id}`, { token: helper.token });
  assert.equal(detail.status, 403);

  const messages = await raw("GET", `/api/conversations/${conv.id}/messages`, { token: helper.token });
  assert.equal(messages.status, 403);

  const kirim = await raw("POST", `/api/conversations/${conv.id}/messages`, { token: helper.token, body: { content: "halo" } });
  assert.equal(kirim.status, 403);

  // Percakapan TIDAK boleh berubah sama sekali akibat percobaan itu.
  const tetap = await testPrisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(tetap.assignedToId, null);
});

test("DRIVER DITOLAK juga (permission sama dengan HELPER)", async () => {
  const driver = await loginWeb(["DRIVER"]);
  const conv = await buatPercakapan();
  const takeover = await raw("POST", `/api/conversations/${conv.id}/takeover`, { token: driver.token, body: {} });
  assert.equal(takeover.status, 403);
});

test("SALES tetap bisa membaca & mengambil alih percakapan (tidak ada regresi fitur)", async () => {
  const sales = await loginWeb(["SALES"]);
  const conv = await buatPercakapan();

  const list = await raw("GET", "/api/conversations", { token: sales.token });
  assert.equal(list.status, 200, JSON.stringify(list.body));

  const takeover = await raw("POST", `/api/conversations/${conv.id}/takeover`, { token: sales.token, body: {} });
  assert.equal(takeover.status, 200, JSON.stringify(takeover.body));

  const updated = await testPrisma.conversation.findUnique({ where: { id: conv.id } });
  assert.equal(updated.assignedToId, sales.user.id);
});

test("DISPATCHER (Route Planner) tetap LOLOS GERBANG IZIN di /peek & POST /messages (QuickChatModal), TAPI tetap ditolak buka Inbox penuh atau takeover", async () => {
  const dispatcher = await loginWeb(["DISPATCHER"]);
  const conv = await buatPercakapan({ sessionId: "CS-1" });

  const peek = await raw("GET", `/api/conversations/${conv.id}/peek`, { token: dispatcher.token });
  assert.equal(peek.status, 200, JSON.stringify(peek.body));

  // POST /:id/messages sungguhan memanggil WAHA (tidak hidup di lingkungan tes) — yang diuji di
  // sini murni GERBANG IZIN: dispatcher TIDAK BOLEH mentok di 403 (ditolak perannya), respons
  // apa pun setelah itu (200/409/502) murni soal konektivitas WA, bukan RBAC.
  const kirim = await raw("POST", `/api/conversations/${conv.id}/messages`, { token: dispatcher.token, body: { content: "Konfirmasi jadwal pengiriman" } });
  assert.notEqual(kirim.status, 403, JSON.stringify(kirim.body));

  // Fitur QuickChatModal sengaja TIDAK memberi dispatcher akses Inbox penuh maupun takeover.
  const list = await raw("GET", "/api/conversations", { token: dispatcher.token });
  assert.equal(list.status, 403);

  const takeover = await raw("POST", `/api/conversations/${conv.id}/takeover`, { token: dispatcher.token, body: {} });
  assert.equal(takeover.status, 403);
});
