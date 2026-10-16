// STATUS CUSTOMER pada touch (NEW / EXISTING / UNKNOWN) — router webhook ASLI + PostgreSQL sekali-pakai.
// Bukti kausal, bukan heuristik waktu: customer yang dibuat MANUAL sebelum pesan pertama tidak boleh menjadi "lead iklan baru".
import path from "node:path";
import os from "node:os";

process.env.WAHA_BASE_URL = "http://127.0.0.1:9";
process.env.CTWA_CAPTURE_HASH_SALT = "salt-integrasi-status-0123456789abcdef";
process.env.CTWA_CAPTURE_DIR = path.join(os.tmpdir(), "atribusi-status-cap");
delete process.env.CTWA_ATTRIBUTION_CAPTURE_ENABLED;
process.env.ATRIBUSI_TOUCH_CAPTURE_ENABLED = "true";
process.env.JWT_SECRET ||= "rahasia-uji-status-customer";

await import("./setup/env.js");
const { default: test } = await import("node:test");
const { default: assert } = await import("node:assert/strict");
const { default: express } = await import("express");
const { default: jwt } = await import("jsonwebtoken");
const { testPrisma, truncateAll } = await import("./setup/testDb.js");
const { startTestServer } = await import("./setup/testApp.js");
const { webhookRouter } = await import("../../src/routes/webhooks.js");
const { attributionAdsRouter } = await import("../../src/routes/attributionAds.js");
const { gowsPayload, bungkusWebhook, CLID_UJI } = await import("./helpers/ctwaPayload.js");

const AD = "52694481763484";
let server, token;
test.before(async () => {
  await truncateAll();
  const admin = await testPrisma.user.create({ data: { name: "Admin Status", email: `st-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  token = jwt.sign({ id: admin.id, name: admin.name, role: "ADMIN", roles: ["ADMIN"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const app = express();
  app.use(express.json({ limit: "10mb" }));
  app.use("/api/webhooks", webhookRouter);
  app.use("/api/atribusi/iklan", attributionAdsRouter);
  server = await startTestServer(app);
});
test.after(async () => { await server?.close?.(); await testPrisma.$disconnect(); });

const post = async (event, payload) => {
  const r = await fetch(`${server.baseUrl}/api/webhooks/waha`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(bungkusWebhook(event, payload)) });
  assert.equal(r.status, 200);
};
const tunggu = async (cond, ms = 12_000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await cond()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };
const tenang = async (jendela = 500) => {
  let akhir = await testPrisma.attributionTouch.count(); let sejak = Date.now();
  while (Date.now() - sejak < jendela) { await new Promise((r) => setTimeout(r, 50)); const n = await testPrisma.attributionTouch.count(); if (n !== akhir) { akhir = n; sejak = Date.now(); } }
};
const touchDari = (phone) => testPrisma.attributionTouch.findMany({ where: { customer: { phone } }, orderBy: [{ touchAt: "asc" }, { id: "asc" }] });
const ringkas = (t) => `${t.customerStatusAtTouch}/${t.customerBasisAtTouch}`;
let n = 0;
const phoneBaru = () => `62858${String(Date.now() % 1e6).padStart(6, "0")}${String(++n).padStart(2, "0")}`;
const msgId = (k) => `3EB0STAT${k}${Date.now() % 1e6}${n}`;

test("customer yang benar-benar dibuat oleh webhook → NEW/WEBHOOK_MEMBUAT; retry message.any + message bersamaan tidak menggandakan", async () => {
  const phone = phoneBaru();
  const p = gowsPayload({ phone, msgId: msgId("A"), ad: AD });
  await Promise.all([post("message", p), post("message.any", p), post("message.any", p)]);
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 1));
  await tenang();
  await post("message", p);                                   // retry sesudah tersimpan
  await tenang();
  const ts = await touchDari(phone);
  assert.equal(ts.length, 1);
  assert.equal(ringkas(ts[0]), "NEW/WEBHOOK_MEMBUAT");
  assert.equal(await testPrisma.message.count({ where: { externalId: p.id } }), 1);
});

test("customer dibuat MANUAL sebelum pesan pertama (tanpa pesan, tanpa clid) → UNKNOWN/TANPA_BUKTI; leadSource customer TIDAK diubah; touch tetap tercatat", async () => {
  const phone = phoneBaru();
  const c = await testPrisma.customer.create({ data: { name: "Dibuat Sales", phone, leadSource: "OTHER", leadSourceDetail: "input manual", createdAt: new Date(Date.now() - 30_000) } });
  const p = gowsPayload({ phone, msgId: msgId("B"), ad: AD });
  await post("message", p);
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 1));
  const [t] = await touchDari(phone);
  assert.equal(ringkas(t), "UNKNOWN/TANPA_BUKTI");
  assert.equal(t.adId, AD, "Ad ID tetap tercatat (fakta payload); yang tidak terbukti hanyalah status akuisisi");
  const sesudah = await testPrisma.customer.findUnique({ where: { id: c.id }, select: { leadSource: true, leadSourceDetail: true, ctwaClid: true } });
  assert.deepEqual([sesudah.leadSource, sesudah.leadSourceDetail, sesudah.ctwaClid], ["OTHER", "input manual", null], "jalur atribusi tidak menimpa data asal customer");
});

test("customer dibuat sales dari CRM (mulai-chat) dan pesan outbound sudah ada → customer membalas lewat iklan = EXISTING/RIWAYAT_PESAN", async () => {
  const phone = phoneBaru();
  const c = await testPrisma.customer.create({ data: { phone, leadSource: "OTHER", leadSourceDetail: "Dimulai manual oleh sales dari CRM" } });
  const conv = await testPrisma.conversation.create({ data: { customerId: c.id, channel: "WHATSAPP" } });
  await testPrisma.message.create({ data: { conversationId: conv.id, direction: "OUTBOUND", content: "halo dari sales", externalId: `true_${phone}@c.us_3EB0OUT${n}` } });
  const p = gowsPayload({ phone, msgId: msgId("C"), ad: AD });
  await post("message", p);
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 1));
  assert.equal(ringkas((await touchDari(phone))[0]), "EXISTING/RIWAYAT_PESAN");
});

test("customer lama dengan riwayat inbound → EXISTING; customer tidak berubah (leadSource/createdAt) dan jumlah Customer tetap", async () => {
  const phone = phoneBaru();
  await post("message", gowsPayload({ phone, msgId: msgId("D1"), ad: null, ctwa: false }));             // pesan biasa membuat customer
  assert.ok(await tunggu(async () => (await testPrisma.customer.count({ where: { phone } })) === 1));
  assert.ok(await tunggu(async () => (await testPrisma.message.count({ where: { conversation: { customer: { phone } } } })) === 1));
  const sebelum = await testPrisma.customer.findUnique({ where: { phone }, select: { id: true, createdAt: true, leadSource: true } });
  const total = await testPrisma.customer.count();
  await post("message", gowsPayload({ phone, msgId: msgId("D2"), ad: AD }));
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 1));
  assert.equal(ringkas((await touchDari(phone))[0]), "EXISTING/RIWAYAT_PESAN");
  assert.deepEqual(await testPrisma.customer.findUnique({ where: { phone }, select: { id: true, createdAt: true, leadSource: true } }), sebelum);
  assert.equal(await testPrisma.customer.count(), total);
});

test("sisa customer dari webhook yang mati (ada, tanpa pesan, clid tersimpan = clid payload) → NEW/CLID_COCOK", async () => {
  const phone = phoneBaru();
  await testPrisma.customer.create({ data: { phone, leadSource: "META_ADS", ctwaClid: CLID_UJI, leadSourceDetail: "sisa upsert webhook sebelum pesan tersimpan" } });
  await post("message", gowsPayload({ phone, msgId: msgId("E"), ad: AD }));
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 1));
  assert.equal(ringkas((await touchDari(phone))[0]), "NEW/CLID_COCOK");
});

test("customer ada tanpa pesan dengan clid BERBEDA dari payload → UNKNOWN (clid lain bukan bukti untuk klik ini)", async () => {
  const phone = phoneBaru();
  await testPrisma.customer.create({ data: { phone, leadSource: "META_ADS", ctwaClid: "ClidKlikLainYangBerbeda123456789" } });
  await post("message", gowsPayload({ phone, msgId: msgId("F"), ad: AD }));
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 1));
  assert.equal(ringkas((await touchDari(phone))[0]), "UNKNOWN/TANPA_BUKTI");
});

test("dua pesan CTWA BERSAMAAN dari nomor yang belum ada: tepat SATU NEW (kunci customer menserialkan); yang lain EXISTING", async () => {
  const phone = phoneBaru();
  await Promise.all([
    post("message", gowsPayload({ phone, msgId: msgId("G1"), ad: AD })),
    post("message", gowsPayload({ phone, msgId: msgId("G2"), ad: "52689767293284" })),
  ]);
  assert.ok(await tunggu(async () => (await touchDari(phone)).length === 2));
  const st = (await touchDari(phone)).map(ringkas).sort();
  assert.deepEqual(st, ["EXISTING/RIWAYAT_PESAN", "NEW/WEBHOOK_MEMBUAT"]);
  assert.equal(await testPrisma.customer.count({ where: { phone } }), 1);
});

test("laporan: hanya NEW menjadi lead iklan; UNKNOWN dan EXISTING dipisah; jumlah touch di /kesehatan = jumlah baris", async () => {
  const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10);
  const q = `dari=${hari}&sampai=${hari}&level=ad`;
  const r = await fetch(`${server.baseUrl}/api/atribusi/iklan?${q}`, { headers: { Authorization: `Bearer ${token}` } });
  assert.equal(r.status, 200);
  const j = await r.json();
  const total = await testPrisma.attributionTouch.count();
  const baru = await testPrisma.attributionTouch.count({ where: { customerStatusAtTouch: "NEW" } });
  const unknown = await testPrisma.attributionTouch.count({ where: { customerStatusAtTouch: "UNKNOWN" } });
  assert.equal(baru, 3, "A (webhook), E (clid cocok), G (balapan: satu pemenang)"); assert.equal(unknown, 2, "B (manual), F (clid berbeda)");
  assert.equal(j.jumlahTeratribusi.leadUnik, new Set((await testPrisma.attributionTouch.findMany({ where: { customerStatusAtTouch: "NEW" }, select: { customerId: true } })).map((x) => x.customerId)).size,
    "lead iklan = customer unik dengan touch NEW");
  assert.ok(j.cakupan.leadBaruTouchTanpaBukti >= 2, "customer manual/tidak terbukti terlihat terpisah");
  assert.ok(j.peringatan.some((w) => w.kode === "TOUCH_TANPA_BUKTI_AKUISISI"));
  const sent = j.grup.reduce((s, g) => s + g.sentuhanBerikutnya.touch + g.lead.unik, 0);
  assert.ok(sent <= total, "tidak ada touch yang dihitung ganda");
  assert.equal(j.rekonsiliasi.ok, true, JSON.stringify(j.rekonsiliasi.cek.filter((c) => !c.ok)));
  const k = await (await fetch(`${server.baseUrl}/api/atribusi/iklan/kesehatan`, { headers: { Authorization: `Bearer ${token}` } })).json();
  assert.equal(k.db.touchTotal, total);
  assert.deepEqual(k.db.statusCustomer, { new: baru, existing: await testPrisma.attributionTouch.count({ where: { customerStatusAtTouch: "EXISTING" } }), unknown });
});
