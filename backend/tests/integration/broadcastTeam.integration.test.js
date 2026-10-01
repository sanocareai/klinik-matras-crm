// Broadcast Team (1 Oktober 2026): kontak tim per divisi (orang → WA pribadi, grup → WA grup) + sales.
// WAHA DITIRU lewat globalThis.fetch (tidak ada WAHA di lingkungan tes) — yang dibuktikan di sini: siapa dikirimi
// ke chatId apa, dan bahwa orang dikirimi satu per satu secara pribadi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { runStaffBroadcastCycle } from "../../src/services/staffBroadcastWorker.js";

let server;
let raw;
const fetchAsli = globalThis.fetch;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { globalThis.fetch = fetchAsli; await truncateAll(); await testPrisma.staffBroadcast.deleteMany(); });
test.after(async () => { globalThis.fetch = fetchAsli; await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function masuk() {
  const u = await createLoginUser({ roles: ["ADMIN"] });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  return r.body.token;
}

function tiruWaha() {
  const terkirim = [];
  globalThis.fetch = async (url, opts) => {
    if (String(url).includes("/api/sendText")) {
      const b = JSON.parse(opts.body);
      terkirim.push({ chatId: b.chatId, text: b.text, session: b.session });
      return new Response(JSON.stringify({ ok: true }), { status: 201, headers: { "content-type": "application/json" } });
    }
    return fetchAsli(url, opts);
  };
  return terkirim;
}

test("Kontak tim: seed divisi Delivery (6 orang + grup) dan grup SANO SALES; grup belum ada di Inbox ditandai belum siap", async () => {
  const token = await masuk();
  const r = await raw("GET", "/api/staff-broadcast/contacts", { token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const delivery = r.body.filter((c) => c.division === "DELIVERY");
  assert.deepEqual(delivery.map((c) => c.name), ["SANO DRIVETHRU", "Agung", "Apriansyah", "Difa", "Alwan", "Natasha", "Kemal"]);
  assert.equal(delivery.find((c) => c.name === "Kemal").roleLabel, "Leader");
  assert.equal(delivery.find((c) => c.name === "Difa").phone, "6287759327793");
  const grupSales = r.body.find((c) => c.division === "SALES" && c.kind === "GROUP");
  assert.equal(grupSales.name, "SANO SALES");
  assert.equal(grupSales.ready, false); // belum ada percakapan grup di Inbox (DB tes kosong)
  assert.equal(delivery.find((c) => c.name === "Agung").ready, true);
});

test("Broadcast ke orang (pribadi satu per satu) + grup (lewat JID Inbox) + hasil per penerima", async () => {
  const token = await masuk();
  const cust = await testPrisma.customer.create({ data: { phone: "6281200009001", name: "Dummy" } });
  void cust;
  await testPrisma.conversation.create({ data: { channel: "WHATSAPP", type: "GROUP", groupJid: "120363000000000001@g.us", groupName: "Sano Drivethru", sessionId: "CS-2" } });

  const kontak = await raw("GET", "/api/staff-broadcast/contacts", { token });
  const id = (nama) => kontak.body.find((c) => c.name === nama).id;
  assert.equal(kontak.body.find((c) => c.name === "SANO DRIVETHRU").ready, true);

  const jadwal = await raw("POST", "/api/staff-broadcast", {
    token,
    body: { message: "Briefing pagi jam 7", contactIds: [id("SANO DRIVETHRU"), id("Difa"), id("Kemal"), id("SANO SALES")], scheduledAt: new Date(Date.now() - 1000).toISOString() },
  });
  assert.equal(jadwal.status, 201, JSON.stringify(jadwal.body));
  assert.equal(jadwal.body.contactIds.length, 4);

  const terkirim = tiruWaha();
  await runStaffBroadcastCycle();

  const ke = Object.fromEntries(terkirim.map((t) => [t.chatId, t]));
  assert.ok(ke["120363000000000001@g.us"], "grup SANO DRIVETHRU dikirimi lewat JID dari Inbox");
  assert.equal(ke["120363000000000001@g.us"].session, "CS-2");
  assert.ok(ke["6287759327793@c.us"], "Difa dikirimi PRIBADI");
  assert.ok(ke["6287759378375@c.us"], "Kemal dikirimi PRIBADI");
  assert.equal(terkirim.length, 3); // SANO SALES tidak ada di Inbox → tidak dikirim

  const b = await testPrisma.staffBroadcast.findUnique({ where: { id: jadwal.body.id } });
  assert.equal(b.status, "SENT");
  const hasil = Object.values(b.results);
  assert.equal(hasil.filter((h) => h.status === "TERKIRIM").length, 3);
  const gagal = hasil.find((h) => h.status === "GAGAL");
  assert.match(gagal.nama, /SANO SALES/);
  assert.match(gagal.error, /belum terdeteksi di Inbox/);
});

test("Validasi: minimal 1 penerima; kontak nonaktif/tidak dikenal ditolak; broadcast sales lama (tanpa contactIds) tetap jalan", async () => {
  const token = await masuk();
  const kosong = await raw("POST", "/api/staff-broadcast", { token, body: { message: "x", scheduledAt: new Date().toISOString() } });
  assert.equal(kosong.status, 400);
  const palsu = await raw("POST", "/api/staff-broadcast", { token, body: { message: "x", contactIds: ["tidak-ada"], scheduledAt: new Date().toISOString() } });
  assert.equal(palsu.status, 400);

  const sales = await createLoginUser({ roles: ["SALES"] });
  await testPrisma.user.update({ where: { id: sales.user.id }, data: { role: "SALES" } });
  const lama = await raw("POST", "/api/staff-broadcast", { token, body: { message: "sales only", recipientIds: [sales.user.id], scheduledAt: new Date().toISOString() } });
  assert.equal(lama.status, 201, JSON.stringify(lama.body));
  assert.deepEqual(lama.body.contactIds, []);
});
