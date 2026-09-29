// Area Layanan & milestone lead (7 Okt 2026) — gerbang PATCH /customers/:id
// dan siklus job services/leadMilestones.js terhadap Postgres sungguhan
// (regex harga dijalankan oleh Postgres ~*, bukan JS — itu yang diuji di sini).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { runLeadMilestoneCycle } from "../../src/services/leadMilestones.js";

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

let seq = 0;
async function loginSales() {
  const u = await createLoginUser({ roles: ["SALES"] });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, id: u.user.id, token: r.body.token };
}
async function buatCustomer(data = {}) {
  seq++;
  return testPrisma.customer.create({ data: { phone: `6281200${Date.now() % 1e6}${seq}`.slice(0, 15), name: "Lead Uji", ...data } });
}
async function buatChat(customerId, pesan) {
  const conv = await testPrisma.conversation.create({ data: { customerId, channel: "WHATSAPP", lastMessageAt: new Date() } });
  for (const [direction, content, sentById] of pesan) {
    await testPrisma.message.create({ data: { conversationId: conv.id, direction, content, sentById: sentById || null } });
  }
  return conv;
}

test("stage tidak bisa naik ke PROSPECT sebelum Area Layanan diisi; lolos setelah diisi", async () => {
  const sales = await loginSales();
  const c = await buatCustomer();

  const ditolak = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { pipelineStage: "PROSPECT" } });
  assert.equal(ditolak.status, 422, JSON.stringify(ditolak.body));
  assert.equal(ditolak.body.code, "AREA_WAJIB");
  const masih = await testPrisma.customer.findUnique({ where: { id: c.id } });
  assert.equal(masih.pipelineStage, "NEW");
  assert.equal(await testPrisma.pipelineTransition.count({ where: { customerId: c.id } }), 0);

  // Area + stage dalam SATU request juga sah.
  const ok = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { serviceArea: "BANDUNG", pipelineStage: "PROSPECT" } });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.pipelineStage, "PROSPECT");
  assert.equal(ok.body.serviceArea, "BANDUNG");
  assert.equal(ok.body.serviceAreaSetBy, sales.id);

  // SPAM (bukan naik funnel) tidak butuh area.
  const c2 = await buatCustomer();
  const spam = await raw("PATCH", `/api/customers/${c2.id}`, { token: sales.token, body: { pipelineStage: "SPAM" } });
  assert.equal(spam.status, 200);
});

test("area kosong diisi otomatis dari kota pengiriman order saat stage naik", async () => {
  const sales = await loginSales();
  const c = await buatCustomer();
  await testPrisma.order.create({ data: { customerId: c.id, value: 1_900_000, deliveryCity: "Jakarta Timur" } });

  const r = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { pipelineStage: "TRANSACTION" } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.serviceArea, "JABODETABEK");
  assert.equal(r.body.serviceAreaSetBy, null);
});

test("area tidak dikenal ditolak", async () => {
  const sales = await loginSales();
  const c = await buatCustomer();
  const r = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { serviceArea: "SURABAYA" } });
  assert.equal(r.status, 400);
});

test("tombol Konsultasi/Penawaran: tandai mencatat waktu pertama, tekan ulang tidak menggeser, batal menghapus", async () => {
  const sales = await loginSales();
  const c = await buatCustomer();

  const a = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { consulted: true, quoted: true } });
  assert.equal(a.status, 200);
  assert.ok(a.body.consultedAt);
  assert.equal(a.body.consultedBy, sales.id);
  assert.equal(a.body.quotedSource, "MANUAL");

  await new Promise((r) => setTimeout(r, 20));
  const b = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { consulted: true } });
  assert.equal(b.body.consultedAt, a.body.consultedAt);

  const batal = await raw("PATCH", `/api/customers/${c.id}`, { token: sales.token, body: { consulted: false, quoted: false } });
  assert.equal(batal.body.consultedAt, null);
  assert.equal(batal.body.quotedAt, null);
  assert.equal(batal.body.quotedSource, null);
});

test("job: pesan berharga → quotedAt + NEW naik ke PROSPECT (tercatat); sapaan & inbound tidak; idempoten", async () => {
  const sales = (await createLoginUser({ roles: ["SALES"] })).user;
  const dapatHarga = await buatCustomer();
  await buatChat(dapatHarga.id, [
    ["INBOUND", "Halo sano, saya tertarik konsultasi"],
    ["OUTBOUND", "Halo, selamat datang di Klinik Matras SANO! Ada keluhan apa kasurnya?", sales.id],
    ["INBOUND", "kasurnya amblas, harganya berapa? budget 2jt"], // harga dari CUSTOMER bukan penawaran
    ["OUTBOUND", "Untuk upgrade ukuran 160x200 Rp3.690.000 ya kak", sales.id],
  ]);
  const cumaSapaan = await buatCustomer();
  await buatChat(cumaSapaan.id, [
    ["INBOUND", "halo, budget saya 1.500.000"],
    ["OUTBOUND", "Halo kak, dengan saya Risel. Ada keluhan apa kasurnya?", sales.id],
  ]);
  const sudahProspek = await buatCustomer({ pipelineStage: "TRANSACTION" });
  await buatChat(sudahProspek.id, [["OUTBOUND", "Totalnya 4.190.000 kak"]]); // dikirim dari HP (sentById null)

  const r1 = await runLeadMilestoneCycle(testPrisma, { windowMinutes: 15 });
  assert.equal(r1.ditandai, 2);
  assert.equal(r1.dinaikkan, 1);

  const a = await testPrisma.customer.findUnique({ where: { id: dapatHarga.id } });
  assert.equal(a.pipelineStage, "PROSPECT");
  assert.equal(a.quotedSource, "AUTO_PESAN");
  assert.equal(a.quotedBy, sales.id);
  const tr = await testPrisma.pipelineTransition.findMany({ where: { customerId: dapatHarga.id } });
  assert.equal(tr.length, 1);
  assert.equal(tr[0].toStage, "PROSPECT");
  assert.equal(tr[0].changedById, sales.id);

  const b = await testPrisma.customer.findUnique({ where: { id: cumaSapaan.id } });
  assert.equal(b.quotedAt, null);
  assert.equal(b.pipelineStage, "NEW");

  const c = await testPrisma.customer.findUnique({ where: { id: sudahProspek.id } });
  assert.ok(c.quotedAt);
  assert.equal(c.quotedBy, null);
  assert.equal(c.pipelineStage, "TRANSACTION"); // stage di atas NEW tidak disentuh

  const r2 = await runLeadMilestoneCycle(testPrisma, { windowMinutes: 15 });
  assert.equal(r2.ditandai, 0);
  assert.equal(await testPrisma.pipelineTransition.count({ where: { customerId: dapatHarga.id } }), 1);
});

test("job: area kosong diisi dari order, isian manual tidak ditimpa, kota tak dikenal dibiarkan kosong", async () => {
  const kosong = await buatCustomer();
  await testPrisma.order.create({ data: { customerId: kosong.id, value: 1, deliveryCity: "Bekasi" } });
  const manual = await buatCustomer({ serviceArea: "LUAR_AREA" });
  await testPrisma.order.create({ data: { customerId: manual.id, value: 1, deliveryCity: "Depok" } });
  const takDikenal = await buatCustomer();
  await testPrisma.order.create({ data: { customerId: takDikenal.id, value: 1, deliveryCity: "Surabaya" } });

  const r = await runLeadMilestoneCycle(testPrisma);
  assert.equal(r.diisi, 1);
  assert.equal((await testPrisma.customer.findUnique({ where: { id: kosong.id } })).serviceArea, "JABODETABEK");
  assert.equal((await testPrisma.customer.findUnique({ where: { id: manual.id } })).serviceArea, "LUAR_AREA");
  assert.equal((await testPrisma.customer.findUnique({ where: { id: takDikenal.id } })).serviceArea, null);
});
