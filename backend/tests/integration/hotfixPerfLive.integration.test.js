// HOTFIX PERF (live sejak 27–28 Okt 2026; dijadikan baseline resmi): query "pesan terakhir per percakapan" memakai JOIN LATERAL
// (menggantikan DISTINCT ON atas seluruh tabel Message) + cacheSingkat pada GET /analytics/sales-report.
// Yang dijaga: (1) hasil query SAMA dengan definisi lama (DISTINCT ON) pada data yang sama, termasuk percakapan tanpa pesan;
// (2) batas akses tidak berubah (401/403); (3) cache laporan tidak membocorkan hasil antar pengguna atau antar filter.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";

let server, raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const mnt = 60_000;
async function login(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.token };
}
let nomor = 0;
async function percakapan({ owner = null, status = "OPEN", pesan = [], tipe = "INDIVIDUAL" }) {
  nomor += 1;
  const customer = tipe === "INDIVIDUAL" ? await testPrisma.customer.create({ data: { phone: `62899${String(100000 + nomor)}`, name: `C${nomor}` } }) : null;
  const conv = await testPrisma.conversation.create({ data: { type: tipe, customerId: customer?.id ?? null, groupJid: tipe === "GROUP" ? `g${nomor}@g.us` : null, channel: "WHATSAPP", status, assignedToId: owner, createdAt: new Date(Date.now() - 3 * 86400_000) } });
  // pesan: [[arah, menitLalu], ...] — dibuat unik & berurutan oleh pemanggil
  if (pesan.length) await testPrisma.message.createMany({ data: pesan.map(([direction, menit], i) => ({ conversationId: conv.id, direction, content: `m${nomor}-${i}`, createdAt: new Date(Date.now() - menit * mnt) })) });
  return conv;
}

// Definisi LAMA (baseline 8527e9b8) — DISTINCT ON atas seluruh Message — sebagai pembanding independen.
const legacy = {
  belumDibalas: async () => (await testPrisma.$queryRaw`SELECT COUNT(*)::int AS count FROM (SELECT DISTINCT ON (m."conversationId") m.direction FROM "Message" m ORDER BY m."conversationId", m."createdAt" DESC) sub WHERE sub.direction = 'INBOUND'`)[0].count,
  menggantung: async () => (await testPrisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "Conversation" c JOIN (SELECT DISTINCT ON ("conversationId") "conversationId", direction, "createdAt" FROM "Message" ORDER BY "conversationId", "createdAt" DESC) m ON m."conversationId" = c.id WHERE c."assignedToId" IS NOT NULL AND c.status != 'RESOLVED' AND m.direction = 'INBOUND' AND m."createdAt" < NOW() - INTERVAL '60 minutes'`)[0].n,
  idUnanswered: async () => (await testPrisma.$queryRaw`SELECT sub."conversationId" AS id FROM (SELECT DISTINCT ON (m."conversationId") m."conversationId", m.direction FROM "Message" m ORDER BY m."conversationId", m."createdAt" DESC) sub WHERE sub.direction = 'INBOUND'`).map((r) => r.id).sort(),
  idStalled: async () => (await testPrisma.$queryRaw`SELECT sub."conversationId" AS id FROM (SELECT DISTINCT ON (m."conversationId") m."conversationId", m.direction, m."createdAt" FROM "Message" m ORDER BY m."conversationId", m."createdAt" DESC) sub WHERE sub.direction = 'INBOUND' AND sub."createdAt" < NOW() - INTERVAL '60 minutes'`).map((r) => r.id).sort(),
  stalledNow: async () => (await testPrisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "Conversation" c JOIN (SELECT DISTINCT ON ("conversationId") "conversationId", direction, "createdAt" FROM "Message" ORDER BY "conversationId", "createdAt" DESC) m ON m."conversationId" = c.id WHERE c."type" = 'INDIVIDUAL' AND c."assignedToId" IS NOT NULL AND c.status != 'RESOLVED' AND m.direction = 'INBOUND' AND m."createdAt" < NOW() - INTERVAL '60 minutes'`)[0].n,
};

async function seedCampuran() {
  const a = await login(["SALES"]); const b = await login(["SALES"]);
  // pesan terakhir INBOUND baru (belum menggantung), INBOUND lama (menggantung), OUTBOUND terakhir (sudah dibalas), tanpa pesan sama sekali,
  // INBOUND lama tapi RESOLVED, INBOUND lama tanpa pemilik, grup, dan percakapan dengan pesan lama INBOUND yang sudah dibalas kemudian.
  await percakapan({ owner: a.user.id, pesan: [["OUTBOUND", 300], ["INBOUND", 10]] });                       // baru, belum dibalas
  await percakapan({ owner: a.user.id, pesan: [["OUTBOUND", 500], ["INBOUND", 200]] });                      // menggantung (a)
  await percakapan({ owner: b.user.id, pesan: [["INBOUND", 400], ["OUTBOUND", 100]] });                      // sudah dibalas
  await percakapan({ owner: b.user.id, pesan: [] });                                                          // tanpa pesan
  await percakapan({ owner: b.user.id, status: "RESOLVED", pesan: [["INBOUND", 900]] });                     // lama tapi RESOLVED
  await percakapan({ owner: null, pesan: [["INBOUND", 700]] });                                               // lama, tanpa pemilik
  await percakapan({ owner: b.user.id, pesan: [["INBOUND", 1000], ["OUTBOUND", 800], ["INBOUND", 90]] });   // menggantung (b), ada riwayat campur
  await percakapan({ owner: a.user.id, tipe: "GROUP", pesan: [["INBOUND", 600]] });                          // grup: menggantung di /counts, TIDAK di stalledNow (type INDIVIDUAL)
  return { a, b };
}

test("counts: belumDibalas & menggantung SAMA dengan definisi lama (DISTINCT ON) pada data yang sama", async () => {
  const { a } = await seedCampuran();
  const r = await raw("GET", "/api/conversations/counts", { token: a.token });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.equal(r.body.belumDibalas, await legacy.belumDibalas());
  assert.equal(r.body.menggantung, await legacy.menggantung());
  assert.ok(r.body.belumDibalas >= 5 && r.body.menggantung >= 3, `data uji harus bermakna: ${JSON.stringify(r.body)}`);
});

test("daftar ?unanswered=true dan ?stalled=true: himpunan id SAMA dengan definisi lama; percakapan tanpa pesan tidak ikut", async () => {
  const { a } = await seedCampuran();
  const un = await raw("GET", "/api/conversations?unanswered=true", { token: a.token });
  assert.equal(un.status, 200, JSON.stringify(un.body));
  assert.deepEqual(un.body.data.map((c) => c.id).sort(), await legacy.idUnanswered());
  const st = await raw("GET", "/api/conversations?stalled=true", { token: a.token });
  assert.equal(st.status, 200);
  const idsLama = (await legacy.idStalled());
  const dimilikiAda = await testPrisma.conversation.findMany({ where: { id: { in: idsLama }, assignedToId: { not: null }, status: { not: "RESOLVED" } }, select: { id: true } });
  assert.deepEqual(st.body.data.map((c) => c.id).sort(), dimilikiAda.map((c) => c.id).sort());
  const tanpaPesan = await testPrisma.conversation.findMany({ where: { messages: { none: {} } }, select: { id: true } });
  for (const c of tanpaPesan) assert.ok(!un.body.data.some((x) => x.id === c.id), "percakapan tanpa pesan tidak boleh muncul di Belum Dibalas");
});

test("kombinasi filter (status, pemilik, tanpa pemilik) tetap sama dengan definisi lama", async () => {
  const { a, b } = await seedCampuran();
  const idsLama = new Set(await legacy.idUnanswered());
  for (const q of ["status=OPEN", "status=RESOLVED", `assignedToId=${a.user.id}`, `assignedToId=${b.user.id}`, "unassigned=true", "type=GROUP", "type=INDIVIDUAL"]) {
    const r = await raw("GET", `/api/conversations?unanswered=true&${q}`, { token: a.token });
    assert.equal(r.status, 200, q);
    const semua = await raw("GET", `/api/conversations?${q}`, { token: a.token });
    const harap = semua.body.data.map((c) => c.id).filter((id) => idsLama.has(id)).sort();
    assert.deepEqual(r.body.data.map((c) => c.id).sort(), harap, `filter ${q}`);
  }
});

test("batas akses TIDAK berubah: tanpa token 401; HELPER (kurir) 403 di Inbox", async () => {
  await seedCampuran();
  const helper = await login(["HELPER"]);
  for (const p of ["/api/conversations", "/api/conversations?unanswered=true", "/api/conversations?stalled=true"]) {
    assert.equal((await raw("GET", p, { token: helper.token })).status, 403, p);
    assert.equal((await raw("GET", p)).status, 401, p);
  }
  assert.equal((await raw("GET", "/api/conversations/counts")).status, 401);
  assert.equal((await raw("GET", "/api/analytics/sales-report")).status, 401);
});

test("sales-report: stalledNow & stalled per periode SAMA dengan definisi lama; cakupan data tidak berubah", async () => {
  const { a } = await seedCampuran();
  const admin = await login(["ADMIN"]);
  const r = await raw("GET", "/api/analytics/sales-report", { token: admin.token });
  assert.equal(r.status, 200, JSON.stringify(r.body).slice(0, 200));
  assert.equal(r.body.stalledNow, await legacy.stalledNow());
  assert.ok(r.body.stalledNow >= 2, "data uji bermakna");
  // per-sales dalam periode: bandingkan dengan definisi lama per pemilik
  const baris = r.body.rows.find((x) => x.userId === a.user.id || x.id === a.user.id);
  const lamaA = (await testPrisma.$queryRaw`SELECT COUNT(*)::int AS n FROM "Conversation" c JOIN (SELECT DISTINCT ON ("conversationId") "conversationId", direction, "createdAt" FROM "Message" ORDER BY "conversationId", "createdAt" DESC) m ON m."conversationId" = c.id WHERE c."assignedToId" = ${a.user.id} AND c."type" = 'INDIVIDUAL' AND c.status != 'RESOLVED' AND m.direction = 'INBOUND' AND m."createdAt" < NOW() - INTERVAL '60 minutes'`)[0].n;
  if (baris) assert.equal(baris.stalled, lamaA);
});

test("cache laporan: hasil tidak bocor antar FILTER (periode berbeda → hasil sendiri) dan tidak antar PENGGUNA", async () => {
  const admin = await login(["ADMIN"]); const sales = await login(["SALES"]);
  const o = await percakapan({ owner: sales.user.id, pesan: [["INBOUND", 300]] });
  const urlA = "/api/analytics/sales-report";
  const urlB = `/api/analytics/sales-report?from=2020-01-01&to=2020-01-31`; // periode lain: percakapan baru tidak termasuk

  const a1 = await raw("GET", urlA, { token: admin.token });
  assert.equal(a1.status, 200);
  const stalled1 = a1.body.stalledNow;
  // data berubah SETELAH admin mengisi cache
  await percakapan({ owner: sales.user.id, pesan: [["INBOUND", 400]] });

  // (1) pengguna SAMA, URL sama: dilayani dari cache (basi ≤ 30 dtk) — perilaku yang disengaja
  const a2 = await raw("GET", urlA, { token: admin.token });
  assert.equal(a2.body.stalledNow, stalled1, "admin mendapat cache miliknya sendiri");
  // (2) pengguna LAIN, URL sama: TIDAK memakai cache admin → melihat data terbaru
  const s1 = await raw("GET", urlA, { token: sales.token });
  assert.equal(s1.status, 200);
  assert.equal(s1.body.stalledNow, stalled1 + 1, "pengguna lain tidak boleh menerima cache pengguna lain");
  // (3) FILTER berbeda untuk pengguna yang sama: tidak memakai cache URL lain
  const b1 = await raw("GET", urlB, { token: admin.token });
  assert.equal(b1.status, 200);
  assert.notDeepEqual(JSON.stringify(b1.body.total), JSON.stringify(a2.body.total), "periode berbeda = hasil berbeda");
  assert.equal(b1.body.stalledNow, stalled1 + 1, "URL berbeda dihitung segar (stalledNow lintas periode)");
  // (4) tanpa token tetap ditolak walau URL yang sama sudah pernah di-cache oleh pengguna lain
  assert.equal((await raw("GET", urlA)).status, 401);
  void o;
});
