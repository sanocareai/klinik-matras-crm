// Test integrasi — SSO Task & Meeting (D-200). Router ASLI lewat HTTP sungguhan
// terhadap PostgreSQL sungguhan (database sekali-pakai dari
// `npm run test:integration:clean`, yang menjalankan `prisma migrate deploy`
// dari NOL — jadi migrasi hub_handoff_sso ikut terbukti bisa diterapkan).
//
// Yang dibuktikan: kontrak auth (Bearer vs token layanan), flag mati = 404,
// replay, kedaluwarsa, pencabutan, peran & status aktif SELALU dibaca ulang
// dari DB (bukan dari klaim JWT), allow-list tujuan, HUB_BASE_URL hanya dari
// env, audit untuk sukses & penolakan tanpa membocorkan rahasia, klaim atomik
// di bawah balapan, alur login tidak berubah, dan bentuk migrasi.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import jwt from "jsonwebtoken";
import express from "express";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { startTestServer } from "./setup/testApp.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";

const { hubSsoRouter } = await import("../../src/routes/hubSso.js");
const { authRouter } = await import("../../src/routes/auth.js");
const { userRouter } = await import("../../src/routes/users.js");
const { resetRateLimits } = await import("../../src/lib/rateLimit.js");
const { resetIntrospectAuditThrottle } = await import("../../src/services/hubSso.js");
const { hashHandoffCode } = await import("../../src/lib/domain/hubSso.js");

const SERVICE_TOKEN = "s".repeat(48);
const HUB_BASE = "https://hub.sanomatrassehat.com";
/** SHA-256 hex sah (64 karakter [a-f0-9]) dipakai sebagai `stateHash` bawaan di
 *  helper `handoff()` di bawah — tahap 4 mewajibkan field ini di setiap
 *  permintaan. Nilai aslinya tidak penting untuk tes yang tidak secara khusus
 *  menguji alur state/nonce (SANSS hanya menyimpan & mengembalikannya apa
 *  adanya; perbandingan sungguhan terjadi di sisi HUB). */
const DEFAULT_STATE_HASH = "a".repeat(64);

// ── HUB palsu (D-200 tahap 4) — server HTTP SUNGGUHAN di localhost yang
// berperan sebagai POST {HUB_INTERNAL_URL}/api/sso/revoke, supaya
// notifyHubRevoke() (dipanggil dari logout, PATCH /users/:id, dan
// DELETE /users/:id/roles/:role) teruji lewat panggilan jaringan NYATA —
// bukan fetch yang di-mock — persis prinsip yang sama dengan `raw`/`svc` di
// bawah yang memukul router ASLI lewat HTTP sungguhan.
function createFakeHub() {
  const calls = [];
  let mode = "ok"; // "ok" | "fail"
  const app = express();
  app.use(express.json());
  app.post("/api/sso/revoke", (req, res) => {
    calls.push({ token: req.get("x-hub-service-token"), body: req.body });
    if (mode === "fail") return res.status(500).json({ error: "boom" });
    res.status(200).json({ ok: true });
  });
  return { app, calls, setMode: (m) => { mode = m; } };
}
const fakeHub = createFakeHub();
const fakeHubServer = await startTestServer(fakeHub.app);

const SSO_ENV = {
  HUB_SSO_ENABLED: "true",
  HUB_BASE_URL: HUB_BASE,
  HUB_INTERNAL_URL: fakeHubServer.baseUrl,
  HUB_SERVICE_TOKEN: SERVICE_TOKEN,
};
const SAVED = Object.fromEntries(Object.keys(SSO_ENV).map((k) => [k, process.env[k]]));

/** Tunggu sampai `fn()` mengembalikan nilai truthy — dipakai untuk efek async
 *  fire-and-forget (`.catch()`, bukan `await`, di routes/auth.js & users.js)
 *  yang tuntas SETELAH respons HTTP-nya sudah kembali ke pemanggil. */
async function waitFor(fn, { timeoutMs = 2000, intervalMs = 20 } = {}) {
  const start = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - start > timeoutMs) throw new Error("waitFor: batas waktu habis");
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

function enableSso(over = {}) {
  for (const [k, v] of Object.entries({ ...SSO_ENV, ...over })) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}
function restoreEnv() {
  for (const [k, v] of Object.entries(SAVED)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
}

let server;
let raw;
test.before(async () => {
  await truncateAll();
  const app = express();
  app.use(express.json({ limit: "1mb" }));
  app.use("/api/hub", hubSsoRouter);
  app.use("/api/auth", authRouter);
  app.use("/api/users", userRouter);
  server = await startTestServer(app);
  raw = makeRaw(server.baseUrl);
});
test.after(async () => {
  restoreEnv();
  await server.close();
  await fakeHubServer.close();
  await truncateAll();
  await testPrisma.$disconnect();
});
test.beforeEach(() => {
  enableSso();
  resetRateLimits();
  resetIntrospectAuditThrottle();
  fakeHub.calls.length = 0;
  fakeHub.setMode("ok");
});
test.afterEach(async () => {
  restoreEnv();
  await truncateAll();
});

let n = 0;
/** Pengguna + token. `claimRoles` = isi klaim JWT; `dbRoles` = peran SEBENARNYA di DB (default: sama). */
async function mkUser({ dbRoles = ["ADMIN"], claimRoles, active = true, name } = {}) {
  n += 1;
  const user = await testPrisma.user.create({
    data: { name: name ?? `Hub Test ${n}`, email: `hub-${Date.now()}-${n}@example.test`, passwordHash: "x", role: dbRoles[0], active },
  });
  await testPrisma.userRole.createMany({ data: dbRoles.map((role) => ({ userId: user.id, role })), skipDuplicates: true });
  const claims = claimRoles ?? dbRoles;
  const token = jwt.sign({ id: user.id, name: user.name, role: claims[0], roles: claims }, process.env.JWT_SECRET, { expiresIn: "1h" });
  return { user, token };
}

const svc = (path, body, headers = {}) =>
  raw("POST", `/api/hub/internal${path}`, { body, headers: { "x-hub-service-token": SERVICE_TOKEN, ...headers } });
// `stateHash` bawaan disisipkan supaya SELURUH tes lama (ditulis sebelum
// tahap 4 mewajibkan field ini) tetap mengirim nilai yang sah tanpa perlu
// diubah satu-satu — pemanggil yang secara khusus menguji alur state/nonce
// cukup mengoper `{ stateHash: ... }` di `body` untuk menimpanya.
const handoff = (token, body = {}) =>
  raw("POST", "/api/hub/handoff", { token, body: { stateHash: DEFAULT_STATE_HASH, ...body } });
const auditRows = (eventType) =>
  testPrisma.activityEvent.findMany({ where: { entityType: "hub_sso", ...(eventType ? { eventType } : {}) }, orderBy: { createdAt: "asc" } });
/** Terbitkan kode untuk pengguna dan kembalikan kode mentah. */
async function issue(token, next) {
  const r = await handoff(token, next === undefined ? {} : { next });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.fields.code;
}

// ═══ Flag & konfigurasi ═════════════════════════════════════════════════════

test("HUB_SSO_ENABLED tidak 'true' → SEMUA endpoint 404, tidak ada baris tertulis, tidak ada audit", async () => {
  const { user, token } = await mkUser();
  for (const v of [undefined, "false", "", "TRUE", "1"]) {
    enableSso({ HUB_SSO_ENABLED: v });
    for (const [method, p, opt] of [
      ["POST", "/api/hub/handoff", { token, body: {} }],
      ["POST", "/api/hub/internal/exchange", { headers: { "x-hub-service-token": SERVICE_TOKEN }, body: { code: "a".repeat(43) } }],
      ["POST", "/api/hub/internal/introspect", { headers: { "x-hub-service-token": SERVICE_TOKEN }, body: { sub: user.id } }],
      ["POST", "/api/hub/internal/revoke", { headers: { "x-hub-service-token": SERVICE_TOKEN }, body: { userId: user.id } }],
      ["POST", "/api/hub/handoff", { body: {} }], // tanpa token pun tetap 404, bukan 401
    ]) {
      const r = await raw(method, p, opt);
      assert.equal(r.status, 404, `${v} ${p}`);
    }
  }
  assert.equal(await testPrisma.hubHandoff.count(), 0);
  assert.equal((await auditRows()).length, 0);
});

test("enabled tapi konfigurasi cacat → 503 HUB_SSO_MISCONFIGURED (tidak jalan setengah benar)", async () => {
  const { token } = await mkUser();
  for (const over of [{ HUB_BASE_URL: undefined }, { HUB_BASE_URL: "http://hub.example.com" }, { HUB_BASE_URL: "https://hub.example.com/x" },
    { HUB_SERVICE_TOKEN: "pendek" }, { HUB_SERVICE_TOKEN: process.env.JWT_SECRET },
    // HUB_INTERNAL_URL (tahap 4) — alamat PRIVAT untuk SANSS→HUB revoke; publik/path/tak ada = cacat.
    { HUB_INTERNAL_URL: undefined }, { HUB_INTERNAL_URL: "https://public.example.com" }, { HUB_INTERNAL_URL: `${fakeHubServer.baseUrl}/x` }]) {
    enableSso(over);
    const r = await handoff(token);
    assert.equal(r.status, 503, JSON.stringify(over));
    assert.equal(r.body.code, "HUB_SSO_MISCONFIGURED");
    assert.ok(!JSON.stringify(r.body).includes(SERVICE_TOKEN));
  }
  assert.equal(await testPrisma.hubHandoff.count(), 0);
});

// ═══ POST /api/hub/handoff ══════════════════════════════════════════════════

test("handoff: tanpa token → 401; token rusak → 401", async () => {
  assert.equal((await raw("POST", "/api/hub/handoff", { body: {} })).status, 401);
  assert.equal((await raw("POST", "/api/hub/handoff", { token: "bukan.jwt.valid", body: {} })).status, 401);
  assert.equal(await testPrisma.hubHandoff.count(), 0);
});

test("handoff: token mobile (typ:mobile) ditolak oleh pagar jalur mobile", async () => {
  const { user } = await mkUser();
  const mobile = jwt.sign({ id: user.id, name: "m", role: "ADMIN", roles: ["ADMIN"], typ: "mobile", sid: "00000000-0000-0000-0000-000000000000" }, process.env.JWT_SECRET, { expiresIn: 300 });
  const r = await handoff(mobile);
  assert.ok([401, 403].includes(r.status), `status ${r.status}`);
  assert.equal(await testPrisma.hubHandoff.count(), 0);
});

test("handoff ADMIN: 200, bentuk respons, alamat dari env, kode 256-bit, hanya HASH di DB, umur 60 detik", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN"] });
  const r = await handoff(token);
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["expiresInSec", "fields", "method", "postUrl"]);
  assert.equal(r.body.method, "POST");
  assert.equal(r.body.postUrl, `${HUB_BASE}/sso/callback`);
  assert.equal(r.body.expiresInSec, 60);
  assert.deepEqual(Object.keys(r.body.fields), ["code"]);
  const code = r.body.fields.code;
  assert.match(code, /^[A-Za-z0-9_-]{43}$/);
  assert.equal(r.headers.get("cache-control"), "no-store");

  const rows = await testPrisma.hubHandoff.findMany();
  assert.equal(rows.length, 1);
  const row = rows[0];
  assert.equal(row.userId, user.id);
  assert.equal(row.codeHash, hashHandoffCode(code));
  assert.equal(row.destination, "/");
  assert.equal(row.usedAt, null);
  assert.equal(row.revokedAt, null);
  const ttl = (row.expiresAt.getTime() - row.createdAt.getTime()) / 1000;
  assert.ok(ttl >= 59 && ttl <= 61, `TTL ${ttl}s`);
  // kode mentah tidak ada di baris mana pun
  assert.ok(!JSON.stringify(row).includes(code));
  const dump = await testPrisma.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM hub_handoffs t`);
  assert.ok(!dump.some((d) => d.j.includes(code)));
});

test("handoff OWNER juga diizinkan", async () => {
  const { token } = await mkUser({ dbRoles: ["OWNER"] });
  assert.equal((await handoff(token)).status, 200);
});

test("handoff: SEMUA role non-admin ditolak 403 (default deny) dan tercatat di audit", async () => {
  const roles = ["SALES", "PRODUCTION_LEAD", "PRODUCTION_WORKER", "QC_LEAD", "WAREHOUSE", "DISPATCHER", "DRIVER", "FINANCE", "HELPER", "LEADER_DRIVER", "ACCOUNTANT", "APPROVER"];
  for (const role of roles) {
    const { token } = await mkUser({ dbRoles: [role] });
    const r = await handoff(token);
    assert.equal(r.status, 403, role);
    assert.equal(r.body.code, "HUB_ACCESS_DENIED");
  }
  assert.equal(await testPrisma.hubHandoff.count(), 0);
  const denied = await auditRows("HUB_HANDOFF_DENIED");
  assert.equal(denied.length, roles.length);
  assert.ok(denied.every((d) => d.metadata.reason === "no_permission" && d.actorId));
});

test("peran dibaca ulang dari DB: klaim JWT ADMIN tapi DB SALES → 403", async () => {
  const { token } = await mkUser({ dbRoles: ["SALES"], claimRoles: ["ADMIN"] });
  const r = await handoff(token);
  assert.equal(r.status, 403);
  assert.equal(await testPrisma.hubHandoff.count(), 0);
});

test("peran dibaca ulang dari DB: klaim JWT SALES tapi DB ADMIN → 200", async () => {
  const { token } = await mkUser({ dbRoles: ["ADMIN"], claimRoles: ["SALES"] });
  assert.equal((await handoff(token)).status, 200);
});

test("peran dicabut SETELAH token dibuat (JWT 1 jam masih sah) → langsung 403", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN"] });
  assert.equal((await handoff(token)).status, 200);
  await testPrisma.userRole.deleteMany({ where: { userId: user.id } });
  await testPrisma.user.update({ where: { id: user.id }, data: { role: "SALES" } });
  resetRateLimits();
  assert.equal((await handoff(token)).status, 403);
});

test("pengguna NONAKTIF dengan JWT masih sah → 403 dan tercatat user_inactive", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN"], active: false });
  const r = await handoff(token);
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "HUB_ACCESS_DENIED");
  assert.equal(await testPrisma.hubHandoff.count(), 0);
  const [d] = await auditRows("HUB_HANDOFF_DENIED");
  assert.equal(d.metadata.reason, "user_inactive");
  assert.equal(d.actorId, user.id);
});

test("pengguna dinonaktifkan SETELAH sukses sekali → permintaan berikutnya 403", async () => {
  const { user, token } = await mkUser();
  assert.equal((await handoff(token)).status, 200);
  await testPrisma.user.update({ where: { id: user.id }, data: { active: false } });
  resetRateLimits();
  assert.equal((await handoff(token)).status, 403);
});

test("pengguna sudah tidak ada di DB tapi JWT sah → 403, bukan 500", async () => {
  const { user, token } = await mkUser();
  await testPrisma.user.delete({ where: { id: user.id } });
  const r = await handoff(token);
  assert.equal(r.status, 403);
  const [d] = await auditRows("HUB_HANDOFF_DENIED");
  assert.equal(d.metadata.reason, "user_not_found");
  assert.equal(d.actorId, null);
});

test("tujuan: yang di allow-list diterima dan tersimpan; SEMUA bentuk open-redirect → 400 DESTINATION_NOT_ALLOWED", async () => {
  const { token } = await mkUser();
  for (const ok of ["/", "/meetings", "/meetings/action-item-saya", "/my-tasks", "/meetings/cmui7f3rd00075wpzv6906lit", "/projects/cmrocu6kq000kf4wdbrrupgqt/board"]) {
    resetRateLimits();
    await issue(token, ok);
    const last = (await testPrisma.hubHandoff.findMany({ orderBy: { createdAt: "desc" }, take: 1 }))[0];
    assert.equal(last.destination, ok);
  }
  const before = await testPrisma.hubHandoff.count();
  const evil = ["//evil.com", "/\\evil.com", "https://evil.com/x", "http://evil.com", "javascript:alert(1)", "/%2F%2Fevil.com", "/meetings/..", "/meetings?next=https://evil.com",
    "/login", "/api/auth/signout", "evil.com", "/meetings#x", "/" + "a".repeat(300)];
  for (const e of evil) {
    resetRateLimits();
    const r = await handoff(token, { next: e });
    assert.equal(r.status, 400, e);
    assert.equal(r.body.code, "DESTINATION_NOT_ALLOWED");
  }
  for (const t of [123, {}, ["/meetings"], true]) {
    resetRateLimits();
    assert.equal((await handoff(token, { next: t })).status, 400, JSON.stringify(t));
  }
  assert.equal(await testPrisma.hubHandoff.count(), before, "penolakan tidak menulis handoff");
  const denied = await auditRows("HUB_HANDOFF_DENIED");
  assert.ok(denied.length >= evil.length);
  assert.ok(denied.every((d) => d.metadata.reason === "destination_not_allowed"));
  assert.ok(denied.every((d) => (d.metadata.attempted ?? "").length <= 80), "isi yang dicoba dipotong");
});

test("HUB_BASE_URL hanya dari env: Host/Origin/X-Forwarded-Host palsu dan url di body tidak berpengaruh", async () => {
  const { token } = await mkUser();
  const r = await raw("POST", "/api/hub/handoff", {
    token,
    headers: { Host: "evil.example.com", Origin: "https://evil.example.com", "X-Forwarded-Host": "evil.example.com", Referer: "https://evil.example.com/x" },
    body: { url: "https://evil.example.com", postUrl: "https://evil.example.com/sso/callback", baseUrl: "https://evil.example.com", next: "/meetings", stateHash: DEFAULT_STATE_HASH },
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.postUrl, `${HUB_BASE}/sso/callback`);
  assert.ok(!JSON.stringify(r.body).includes("evil"));
});

test("handoff: kode baru mencabut kode lama yang belum terpakai (satu kode hidup per pengguna)", async () => {
  const { token } = await mkUser();
  const first = await issue(token);
  resetRateLimits();
  const second = await issue(token);
  assert.notEqual(first, second);
  const rows = await testPrisma.hubHandoff.findMany();
  assert.equal(rows.filter((r) => r.revokedAt).length, 1);
  assert.equal((await svc("/exchange", { code: first })).status, 401);
  assert.equal((await svc("/exchange", { code: second })).status, 200);
});

test("handoff: rate limit 10/menit per pengguna → 429 pada yang ke-11", async () => {
  const { token } = await mkUser();
  for (let i = 0; i < 10; i++) assert.equal((await handoff(token)).status, 200, `ke-${i + 1}`);
  assert.equal((await handoff(token)).status, 429);
  const { token: other } = await mkUser();
  assert.equal((await handoff(other)).status, 200, "pengguna lain tidak ikut terkunci");
});

// ═══ State / nonce (D-200 tahap 4) ═══════════════════════════════════════════
// HUB membuat `state` acak ≥256-bit di GET /sso/start, simpan HttpOnly di
// cookie-nya sendiri, dan kirim HANYA SHA-256(state) ke halaman peluncuran
// SANSS lewat query string. SANSS TIDAK PERNAH melihat `state` asli — cuma
// menyimpan hash itu apa adanya di `hub_handoffs.state_hash` dan
// mengembalikannya lagi saat /internal/exchange, supaya HUB bisa
// membandingkannya (waktu-konstan) dengan hash cookie-nya sendiri SEBELUM
// membuat sesi. Karena itu di sisi SANSS `stateHash` HANYA perlu punya
// BENTUK yang sah (regex) — SANSS tidak bisa dan tidak perlu memverifikasi
// bahwa itu benar-benar hash dari `state` HUB yang asli.

test("handoff: stateHash wajib berbentuk SHA-256 hex (64 [a-f0-9]) → selain itu 400 INVALID_STATE, TIDAK ada baris tertulis, TIDAK ada audit HUB_HANDOFF_ISSUED", async () => {
  const { token } = await mkUser();
  for (const bad of [undefined, null, "", "pendek", "A".repeat(64), "g".repeat(64), "a".repeat(63), "a".repeat(65), 123, {}, ["a".repeat(64)]]) {
    resetRateLimits();
    const r = await handoff(token, { stateHash: bad });
    assert.equal(r.status, 400, JSON.stringify(bad));
    assert.equal(r.body.code, "INVALID_STATE");
  }
  assert.equal(await testPrisma.hubHandoff.count(), 0);
  assert.equal((await auditRows("HUB_HANDOFF_ISSUED")).length, 0);
  // Dicek TERAKHIR (setelah pengguna/tujuan) — pemanggil tanpa izin SAMA
  // SEKALI tidak melihat detail soal state (satu-satunya sinyal yang bocor
  // ke penyerang tanpa akses tetaplah HUB_ACCESS_DENIED, bukan INVALID_STATE).
  const { token: denied } = await mkUser({ dbRoles: ["SALES"] });
  resetRateLimits();
  const r2 = await handoff(denied, { stateHash: "bukan-hash-sah" });
  assert.equal(r2.status, 403);
  assert.equal(r2.body.code, "HUB_ACCESS_DENIED");
});

test("handoff: stateHash sah tersimpan APA ADANYA di baris hub_handoffs (mentah, bukan di-hash ulang)", async () => {
  const { token } = await mkUser();
  const hash = "b".repeat(64);
  const r = await handoff(token, { stateHash: hash });
  assert.equal(r.status, 200);
  const row = await testPrisma.hubHandoff.findFirst({ orderBy: { createdAt: "desc" } });
  assert.equal(row.stateHash, hash);
});

test("REPLAY state: stateHash yang sama dipakai lagi untuk permintaan handoff BERBEDA tetap diterima (state adalah properti HUB, bukan SANSS) — SANSS tidak menolak berdasarkan kecocokan lintas baris", async () => {
  const a = await mkUser();
  const b = await mkUser();
  const hash = "c".repeat(64);
  const ra = await handoff(a.token, { stateHash: hash });
  resetRateLimits();
  const rb = await handoff(b.token, { stateHash: hash });
  assert.equal(ra.status, 200);
  assert.equal(rb.status, 200, "SANSS hanya menyimpan/meneruskan hash — perbandingan dgn cookie HUB terjadi di sisi HUB");
  const codeA = ra.body.fields.code;
  const codeB = rb.body.fields.code;
  assert.equal((await svc("/exchange", { code: codeA })).body.stateHash, hash);
  assert.equal((await svc("/exchange", { code: codeB })).body.stateHash, hash);
});

// ═══ Autentikasi layanan (exchange / introspect / revoke) ═══════════════════

test("layanan: tanpa token → 401 SERVICE_TOKEN_REQUIRED; token salah → 401 SERVICE_TOKEN_INVALID; keduanya diaudit", async () => {
  const { user } = await mkUser();
  for (const p of ["/exchange", "/introspect", "/revoke"]) {
    const none = await raw("POST", `/api/hub/internal${p}`, { body: { code: "a".repeat(43), sub: user.id, userId: user.id } });
    assert.equal(none.status, 401, p);
    assert.equal(none.body.code, "SERVICE_TOKEN_REQUIRED");
    // (header yang cuma spasi dipangkas HTTP jadi kosong = "tidak ada token": kasus 'none' di atas)
    for (const bad of ["salah", SERVICE_TOKEN.slice(0, -1), SERVICE_TOKEN + "x", "  x  ", process.env.JWT_SECRET]) {
      const r = await raw("POST", `/api/hub/internal${p}`, { headers: { "x-hub-service-token": bad }, body: { code: "a".repeat(43), sub: user.id, userId: user.id } });
      assert.equal(r.status, 401, `${p} ${JSON.stringify(bad)}`);
      assert.equal(r.body.code, "SERVICE_TOKEN_INVALID");
    }
  }
  const denied = await auditRows("HUB_SERVICE_DENIED");
  assert.equal(denied.length, 3 * 6);
  assert.ok(denied.every((d) => ["token_missing", "token_invalid"].includes(d.metadata.reason) && d.actorType === "SERVICE"));
});

test("layanan: JWT pengguna (Bearer) TIDAK bisa dipakai sebagai token layanan", async () => {
  const { token, user } = await mkUser();
  const r = await raw("POST", "/api/hub/internal/introspect", { token, body: { sub: user.id } });
  assert.equal(r.status, 401);
  const r2 = await raw("POST", "/api/hub/internal/introspect", { headers: { "x-hub-service-token": token }, body: { sub: user.id } });
  assert.equal(r2.status, 401);
});

test("layanan: permintaan yang lewat proxy (X-Forwarded-For / X-Real-IP / Forwarded / Via) → 404 walau token benar", async () => {
  const { user } = await mkUser();
  for (const h of [{ "x-forwarded-for": "1.2.3.4" }, { "x-real-ip": "1.2.3.4" }, { forwarded: "for=1.2.3.4" }, { via: "1.1 nginx" }, { "x-forwarded-proto": "https" }]) {
    const r = await svc("/introspect", { sub: user.id }, h);
    assert.equal(r.status, 404, JSON.stringify(h));
  }
  const denied = await auditRows("HUB_SERVICE_DENIED");
  assert.equal(denied.length, 5);
  assert.ok(denied.every((d) => d.metadata.reason === "not_internal"));
});

test("audit penolakan layanan dibatasi laju (tidak bisa dipakai membanjiri activity_events)", async () => {
  for (let i = 0; i < 125; i++) await raw("POST", "/api/hub/internal/introspect", { headers: { "x-hub-service-token": "salah" }, body: { sub: "x" } });
  const denied = await auditRows("HUB_SERVICE_DENIED");
  assert.ok(denied.length <= 120, `${denied.length} baris audit`);
  const r = await raw("POST", "/api/hub/internal/introspect", { headers: { "x-hub-service-token": "salah" }, body: { sub: "x" } });
  assert.equal(r.status, 429);
});

// ═══ POST /internal/exchange ════════════════════════════════════════════════

test("exchange: kode sah → identitas dari DB (sub, nama, email, roles, hubRole, tujuan); baris ditandai terpakai; diaudit", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN", "FINANCE"], name: "Novi Uji" });
  const code = await issue(token, "/meetings");
  const r = await svc("/exchange", { code });
  assert.equal(r.status, 200);
  assert.deepEqual(Object.keys(r.body).sort(), ["active", "destination", "email", "hubRole", "name", "roles", "stateHash", "sub"]);
  assert.equal(r.body.sub, user.id);
  assert.equal(r.body.name, "Novi Uji");
  assert.equal(r.body.email, user.email);
  assert.deepEqual([...r.body.roles].sort(), ["ADMIN", "FINANCE"]);
  assert.equal(r.body.hubRole, "ADMIN");
  assert.equal(r.body.active, true);
  assert.equal(r.body.destination, "/meetings");
  // tahap 4 — stateHash dikembalikan APA ADANYA (SHA-256 dari `state` HUB, HUB yang membandingkannya).
  assert.equal(r.body.stateHash, DEFAULT_STATE_HASH);
  assert.equal(r.headers.get("cache-control"), "no-store");
  const row = await testPrisma.hubHandoff.findFirst();
  assert.ok(row.usedAt, "used_at terisi");
  const [ex] = await auditRows("HUB_HANDOFF_EXCHANGED");
  assert.equal(ex.entityId, row.id);
  assert.equal(ex.actorId, user.id);
  assert.equal(ex.metadata.hubRole, "ADMIN");
});

test("exchange: OWNER → hubRole OWNER", async () => {
  const { token } = await mkUser({ dbRoles: ["OWNER"] });
  const r = await svc("/exchange", { code: await issue(token) });
  assert.equal(r.body.hubRole, "OWNER");
});

test("REPLAY: kode yang sama dipakai kedua kali → 401 INVALID_CODE, diaudit sebagai replay", async () => {
  const { token } = await mkUser();
  const code = await issue(token);
  assert.equal((await svc("/exchange", { code })).status, 200);
  for (let i = 0; i < 3; i++) {
    const again = await svc("/exchange", { code });
    assert.equal(again.status, 401);
    assert.equal(again.body.code, "INVALID_CODE");
    assert.equal(again.body.sub, undefined, "tidak ada identitas bocor pada kegagalan");
  }
  const rejected = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(rejected.length, 3);
  assert.ok(rejected.every((d) => d.metadata.reason === "replay"));
});

test("KEDALUWARSA: lewat expires_at → 401, diaudit expired (dan tidak terpakai)", async () => {
  const { token } = await mkUser();
  const code = await issue(token);
  await testPrisma.hubHandoff.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
  const r = await svc("/exchange", { code });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "INVALID_CODE");
  const [d] = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(d.metadata.reason, "expired");
  assert.equal((await testPrisma.hubHandoff.findFirst()).usedAt, null, "kode kedaluwarsa tidak ditandai terpakai");
});

test("batas umur: tepat di dalam 60 detik masih sah, satu detik setelahnya tidak", async () => {
  const { token } = await mkUser();
  const code = await issue(token);
  await testPrisma.hubHandoff.updateMany({ data: { expiresAt: new Date(Date.now() + 5_000) } });
  assert.equal((await svc("/exchange", { code })).status, 200);
  const code2 = await issue(token);
  await testPrisma.hubHandoff.updateMany({ where: { usedAt: null }, data: { expiresAt: new Date(Date.now() - 1) } });
  assert.equal((await svc("/exchange", { code: code2 })).status, 401);
});

test("kode tak dikenal / cacat → 401, diaudit (unknown_code / malformed) tanpa memuat kodenya", async () => {
  const guess = "A".repeat(43);
  assert.equal((await svc("/exchange", { code: guess })).status, 401);
  for (const bad of [undefined, null, "", "pendek", 123, {}, [], "a".repeat(44), "a".repeat(42) + "!", "'; DROP TABLE hub_handoffs;--"]) {
    const r = await svc("/exchange", { code: bad });
    assert.equal(r.status, 401, JSON.stringify(bad));
    assert.equal(r.body.code, "INVALID_CODE");
  }
  const rej = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(rej.length, 11);
  assert.equal(rej[0].metadata.reason, "unknown_code");
  assert.ok(rej.slice(1).every((d) => d.metadata.reason === "malformed"));
  assert.ok(!JSON.stringify(rej).includes(guess), "kode tebakan tidak tercatat");
  assert.equal(await testPrisma.hubHandoff.count(), 0, "tabel masih ada dan kosong");
});

test("exchange: pengguna dinonaktifkan ANTARA terbit dan tukar → 403 ACCESS_DENIED, kode tetap hangus", async () => {
  const { user, token } = await mkUser();
  const code = await issue(token);
  await testPrisma.user.update({ where: { id: user.id }, data: { active: false } });
  const r = await svc("/exchange", { code });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "ACCESS_DENIED");
  assert.equal(r.body.sub, undefined);
  assert.ok((await testPrisma.hubHandoff.findFirst()).usedAt, "kode dikonsumsi walau ditolak");
  const [d] = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(d.metadata.reason, "user_inactive");
  assert.equal(d.actorId, user.id);
  // pemulihan akun tidak menghidupkan kode lama
  await testPrisma.user.update({ where: { id: user.id }, data: { active: true } });
  assert.equal((await svc("/exchange", { code })).status, 401);
});

test("exchange: role dicabut ANTARA terbit dan tukar → 403 no_permission", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN"] });
  const code = await issue(token);
  await testPrisma.userRole.deleteMany({ where: { userId: user.id } });
  await testPrisma.user.update({ where: { id: user.id }, data: { role: "DRIVER" } });
  const r = await svc("/exchange", { code });
  assert.equal(r.status, 403);
  const [d] = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(d.metadata.reason, "no_permission");
});

test("exchange: role BERTAMBAH antara terbit dan tukar tercermin (dibaca ulang, bukan snapshot)", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN"] });
  const code = await issue(token);
  await testPrisma.userRole.create({ data: { userId: user.id, role: "OWNER" } });
  const r = await svc("/exchange", { code });
  assert.equal(r.body.hubRole, "OWNER");
});

test("exchange: tujuan divalidasi ULANG — baris dengan tujuan tidak sah (dirusak di DB) ditolak", async () => {
  const { token } = await mkUser();
  const code = await issue(token);
  await testPrisma.hubHandoff.updateMany({ data: { destination: "https://evil.com" } });
  const r = await svc("/exchange", { code });
  assert.equal(r.status, 403);
  const [d] = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(d.metadata.reason, "destination_not_allowed");
});

test("BALAPAN: 12 penukar serentak untuk satu kode → tepat SATU 200, sisanya 401", async () => {
  const { token } = await mkUser();
  const code = await issue(token);
  const results = await Promise.all(Array.from({ length: 12 }, () => svc("/exchange", { code })));
  const ok = results.filter((r) => r.status === 200);
  const bad = results.filter((r) => r.status === 401);
  assert.equal(ok.length, 1, `statuses: ${results.map((r) => r.status).join(",")}`);
  assert.equal(bad.length, 11);
  assert.equal((await auditRows("HUB_HANDOFF_EXCHANGED")).length, 1);
  assert.equal((await auditRows("HUB_HANDOFF_REJECTED")).length, 11);
});

test("exchange: kode milik pengguna A tidak pernah menghasilkan identitas pengguna B", async () => {
  const a = await mkUser({ dbRoles: ["ADMIN"], name: "Pengguna A" });
  const b = await mkUser({ dbRoles: ["OWNER"], name: "Pengguna B" });
  const codeA = await issue(a.token);
  resetRateLimits();
  const codeB = await issue(b.token);
  const rA = await svc("/exchange", { code: codeA });
  const rB = await svc("/exchange", { code: codeB });
  assert.equal(rA.body.sub, a.user.id);
  assert.equal(rB.body.sub, b.user.id);
  assert.equal(rA.body.hubRole, "ADMIN");
  assert.equal(rB.body.hubRole, "OWNER");
});

// ═══ POST /internal/introspect ══════════════════════════════════════════════

test("introspect: pengguna aktif berizin → identitas & hubRole terkini; perubahan role langsung terlihat", async () => {
  const { user } = await mkUser({ dbRoles: ["ADMIN"] });
  const r1 = await svc("/introspect", { sub: user.id });
  assert.equal(r1.status, 200);
  assert.deepEqual([r1.body.sub, r1.body.active, r1.body.hubRole], [user.id, true, "ADMIN"]);
  await testPrisma.userRole.create({ data: { userId: user.id, role: "OWNER" } });
  assert.equal((await svc("/introspect", { sub: user.id })).body.hubRole, "OWNER");
});

test("introspect: nonaktif → active:false, hubRole null, TANPA roles/nama/email; diaudit sebagai penolakan", async () => {
  const { user } = await mkUser({ active: false });
  const r = await svc("/introspect", { sub: user.id });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { sub: user.id, active: false, hubRole: null, roles: [] });
  const [d] = await auditRows("HUB_INTROSPECT_DENIED");
  assert.equal(d.metadata.reason, "user_inactive");
});

test("introspect: role dicabut → active:true tapi hubRole null (HUB harus menutup sesi)", async () => {
  const { user } = await mkUser({ dbRoles: ["SALES"] });
  const r = await svc("/introspect", { sub: user.id });
  assert.equal(r.body.hubRole, null);
  assert.equal(r.body.active, false, "tanpa hubRole diperlakukan sebagai tidak aktif untuk HUB");
  assert.equal((await auditRows("HUB_INTROSPECT_DENIED"))[0].metadata.reason, "no_permission");
});

test("introspect: id tak dikenal → 200 {active:false} (bukan 404, tidak membocorkan keberadaan); sub cacat → 400", async () => {
  const r = await svc("/introspect", { sub: "id-yang-tidak-ada" });
  assert.equal(r.status, 200);
  assert.equal(r.body.active, false);
  assert.equal(r.body.hubRole, null);
  assert.equal((await auditRows("HUB_INTROSPECT_DENIED"))[0].metadata.reason, "unknown_user");
  for (const bad of [undefined, null, "", 5, {}, "x".repeat(65)]) {
    assert.equal((await svc("/introspect", { sub: bad })).status, 400, JSON.stringify(bad));
  }
});

test("introspect sukses diaudit tersampling (paling banyak sekali per pengguna per jendela); penolakan SELALU diaudit", async () => {
  const { user } = await mkUser();
  for (let i = 0; i < 5; i++) await svc("/introspect", { sub: user.id });
  assert.equal((await auditRows("HUB_INTROSPECTED")).length, 1);
  await testPrisma.user.update({ where: { id: user.id }, data: { active: false } });
  for (let i = 0; i < 3; i++) await svc("/introspect", { sub: user.id });
  assert.equal((await auditRows("HUB_INTROSPECT_DENIED")).length, 3);
});

// ═══ POST /internal/revoke ══════════════════════════════════════════════════

test("revoke: mencabut kode belum-terpakai milik pengguna → exchange berikutnya 401 (revoked); yang sudah terpakai tidak terhitung", async () => {
  const { user, token } = await mkUser();
  const used = await issue(token);
  assert.equal((await svc("/exchange", { code: used })).status, 200);
  resetRateLimits();
  const pending = await issue(token);
  const r = await svc("/revoke", { userId: user.id, reason: "logout" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { revoked: 1 });
  const x = await svc("/exchange", { code: pending });
  assert.equal(x.status, 401);
  const rej = await auditRows("HUB_HANDOFF_REJECTED");
  assert.equal(rej[rej.length - 1].metadata.reason, "revoked");
  const [rv] = await auditRows("HUB_HANDOFF_REVOKED");
  assert.equal(rv.metadata.reason, "logout");
  assert.equal(rv.metadata.revoked, 1);
  assert.equal((await svc("/revoke", { userId: user.id })).body.revoked, 0, "idempoten");
});

test("revoke: hanya mengenai pengguna yang disebut; alasan liar dinormalkan; userId cacat → 400", async () => {
  const a = await mkUser();
  const b = await mkUser();
  const codeA = await issue(a.token);
  resetRateLimits();
  const codeB = await issue(b.token);
  await svc("/revoke", { userId: a.user.id, reason: "<script>alert(1)</script>" });
  assert.equal((await svc("/exchange", { code: codeA })).status, 401);
  assert.equal((await svc("/exchange", { code: codeB })).status, 200, "kode pengguna lain tidak tersentuh");
  assert.equal((await auditRows("HUB_HANDOFF_REVOKED"))[0].metadata.reason, "other");
  for (const bad of [undefined, null, "", 5, {}, "x".repeat(65)]) {
    assert.equal((await svc("/revoke", { userId: bad })).status, 400, JSON.stringify(bad));
  }
  assert.equal((await svc("/revoke", { userId: "tidak-ada" })).body.revoked, 0);
});

// ═══ Audit & kerahasiaan ════════════════════════════════════════════════════

test("audit: sukses DAN penolakan tercatat; tidak ada kode mentah maupun token layanan di audit atau tabel handoff", async () => {
  const good = await mkUser({ dbRoles: ["ADMIN"] });
  const bad = await mkUser({ dbRoles: ["SALES"] });
  const code = await issue(good.token);
  await svc("/exchange", { code });
  await svc("/exchange", { code }); // replay
  await handoff(bad.token); // ditolak
  await svc("/introspect", { sub: good.user.id });
  await svc("/revoke", { userId: good.user.id, reason: "admin" });
  await raw("POST", "/api/hub/internal/exchange", { headers: { "x-hub-service-token": "salah-token-rahasia-uji" }, body: { code } });

  const types = new Set((await auditRows()).map((r) => r.eventType));
  for (const t of ["HUB_HANDOFF_ISSUED", "HUB_HANDOFF_DENIED", "HUB_HANDOFF_EXCHANGED", "HUB_HANDOFF_REJECTED", "HUB_INTROSPECTED", "HUB_HANDOFF_REVOKED", "HUB_SERVICE_DENIED"]) {
    assert.ok(types.has(t), `tipe audit ${t} hilang`);
  }
  const everything = JSON.stringify(await auditRows()) + JSON.stringify(await testPrisma.hubHandoff.findMany());
  const dumpTable = (await testPrisma.$queryRawUnsafe(`SELECT row_to_json(t)::text AS j FROM hub_handoffs t`)).map((r) => r.j).join("");
  for (const secret of [code, SERVICE_TOKEN, "salah-token-rahasia-uji", good.token, process.env.JWT_SECRET]) {
    assert.ok(!everything.includes(secret), "rahasia bocor ke audit/tabel");
    assert.ok(!dumpTable.includes(secret), "rahasia bocor ke tabel");
  }
  assert.ok((await auditRows()).every((r) => r.entityId && r.entityId.length > 0));
});

// ═══ Alur login TIDAK berubah ═══════════════════════════════════════════════

test("alur login tidak berubah: bentuk respons /auth/login sama persis, dan SALES TIDAK PERNAH melihat apa pun tentang HUB walau flag menyala", async () => {
  for (const flag of ["false", "true"]) {
    enableSso({ HUB_SSO_ENABLED: flag });
    for (const roles of [["SALES"], ["ADMIN"]]) {
      const { email, password } = await createLoginUser({ roles });
      const r = await raw("POST", "/api/auth/login", { body: { email, password } });
      assert.equal(r.status, 200, `${roles} flag=${flag}`);
      // Bentuk respons ADITIF sejak awal (Stage 2/3) — kartu HUB (kalau ada)
      // masuk KE DALAM array `portals` yang sudah ada, bukan field baru di
      // level `user`. Daftar key ini harus tetap PERSIS sama baik flag
      // mati/hidup maupun perannya SALES/ADMIN. "divisions" (C2.1, akses
      // divisi — tidak terkait SSO sama sekali) sudah ada di main SEBELUM
      // forward-port ini; disertakan di sini supaya tes ini menguji "tidak
      // ada field BARU ikut bocor", bukan membeku pada bentuk pra-C2.1.
      assert.deepEqual(Object.keys(r.body.user).sort(), ["avatarUrl", "capabilities", "divisions", "id", "isOnline", "name", "onlineSince", "portals", "role", "roles"]);
      const portalKeys = r.body.user.portals.map((p) => p.key);
      if (roles[0] === "SALES") {
        assert.deepEqual(portalKeys, ["growth"], "sales tetap satu portal, tidak pernah dapat kartu hub");
        assert.ok(!/hub/i.test(JSON.stringify(r.body)), "SALES tidak boleh melihat apa pun tentang HUB di respons login");
      }
    }
  }
});

// ═══ Kartu portal "Task & Meeting" (D-200 tahap 4) ═══════════════════════════
// hubPortalEntry(user)/portalsWithHub(user) — HANYA tampil di /auth/login DAN
// /auth/me kalau (a) HUB_SSO_ENABLED=true DAN konfigurasi lengkap (ready),
// DAN (b) pengguna itu punya HUB_ACCESS (ADMIN/OWNER). Aditif murni: daftar
// portalsFor(user) yang sudah ada TIDAK disentuh — kartu hub cuma ditambahkan
// di akhir array kalau berlaku.

test("portal: kartu 'Task & Meeting' HANYA muncul untuk ADMIN/OWNER ketika SSO menyala & terkonfigurasi; SALES tidak pernah dapat", async () => {
  for (const flag of ["true", "false"]) {
    enableSso({ HUB_SSO_ENABLED: flag });
    for (const dbRoles of [["ADMIN"], ["OWNER"], ["SALES"]]) {
      const { email, password } = await createLoginUser({ roles: dbRoles });
      const login = await raw("POST", "/api/auth/login", { body: { email, password } });
      assert.equal(login.status, 200, `${dbRoles} flag=${flag}`);
      const expectHub = flag === "true" && dbRoles[0] !== "SALES";
      const hubCardLogin = login.body.user.portals.find((p) => p.key === "hub");
      assert.equal(!!hubCardLogin, expectHub, `login ${dbRoles} flag=${flag}`);
      if (expectHub) {
        assert.equal(hubCardLogin.label, "Task & Meeting");
        assert.equal(hubCardLogin.path, `${HUB_BASE}/sso/start`);
        // URL LENGKAP ke origin HUB (bukan rute SPA relatif) — masuk WAJIB
        // dimulai dari GET /sso/start (HUB membuat state di sana), tidak
        // bisa berupa navigasi klien biasa/iframe.
        assert.ok(/^https?:\/\//.test(hubCardLogin.path));
      }
      const me = await raw("GET", "/api/auth/me", { token: login.body.token });
      assert.equal(me.status, 200);
      const hubCardMe = me.body.portals.find((p) => p.key === "hub");
      assert.equal(!!hubCardMe, expectHub, `me ${dbRoles} flag=${flag}`);
      if (expectHub) assert.deepEqual(hubCardMe, hubCardLogin);
      // Portal lain yang sudah ada tidak berkurang — hub murni ditambahkan.
      const others = login.body.user.portals.filter((p) => p.key !== "hub").map((p) => p.key);
      assert.ok(others.length > 0, "portal non-hub tetap ada");
    }
  }
});

test("portal: enabled tapi konfigurasi cacat (mis. HUB_INTERNAL_URL publik) → kartu TIDAK tampil walau ADMIN (fail-closed, sama seperti /handoff → 503)", async () => {
  enableSso({ HUB_INTERNAL_URL: "https://public.example.com" });
  const { email, password } = await createLoginUser({ roles: ["ADMIN"] });
  const login = await raw("POST", "/api/auth/login", { body: { email, password } });
  assert.equal(login.status, 200);
  assert.ok(!login.body.user.portals.some((p) => p.key === "hub"));
});

// ═══ POST /api/auth/logout (D-200 tahap 4) ═══════════════════════════════════
// SATU-SATUNYA pekerjaan tambahan: cabut kode handoff SANSS yang belum
// terpakai + beri tahu HUB (POST {HUB_INTERNAL_URL}/api/sso/revoke) untuk
// menutup sesi HUB milik user ini. SELALU 200 — logout TIDAK PERNAH boleh
// gagal karena HUB sedang mati/tidak terjangkau (HUB tetap punya jaring
// pengaman introspeksi berkala ≤60 detik untuk kasus itu).

test("logout: 200 {ok:true}; mencabut kode handoff yang belum terpakai; memberi tahu HUB (server sungguhan) dengan reason=logout", async () => {
  const { user, token } = await mkUser({ dbRoles: ["ADMIN"] });
  const code = await issue(token);
  const r = await raw("POST", "/api/auth/logout", { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  assert.equal((await svc("/exchange", { code })).status, 401, "kode handoff tercabut oleh logout");
  const call = await waitFor(() => fakeHub.calls.find((c) => c.body?.sub === user.id));
  assert.equal(call.token, SERVICE_TOKEN);
  assert.equal(call.body.reason, "logout");
  const [notified] = await auditRows("HUB_REVOKE_NOTIFIED");
  assert.equal(notified.entityId, user.id);
});

test("logout: SSO mati → tetap 200, dan TIDAK memanggil HUB sama sekali (tidak ada HUB nyata untuk diberi tahu)", async () => {
  const { token } = await mkUser({ dbRoles: ["ADMIN"] });
  enableSso({ HUB_SSO_ENABLED: "false" });
  const r = await raw("POST", "/api/auth/logout", { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  await new Promise((res) => setTimeout(res, 150));
  assert.equal(fakeHub.calls.length, 0);
});

test("logout: panggilan revoke ke HUB gagal (HUB balas 500) → logout TETAP 200 dan {ok:true}; kegagalan diaudit HUB_REVOKE_NOTIFY_FAILED", async () => {
  const { token } = await mkUser({ dbRoles: ["ADMIN"] });
  fakeHub.setMode("fail");
  const r = await raw("POST", "/api/auth/logout", { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
  await waitFor(async () => (await auditRows("HUB_REVOKE_NOTIFY_FAILED")).length > 0);
});

test("logout: pengguna tanpa HUB_ACCESS (SALES) tetap 200 dan aman dipanggil (tidak pernah 500 walau tidak punya apa-apa untuk dicabut)", async () => {
  const { token } = await mkUser({ dbRoles: ["SALES"] });
  const r = await raw("POST", "/api/auth/logout", { token });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { ok: true });
});

// ═══ Sinkronisasi akses saat pengguna berubah (D-200 tahap 4) ════════════════
// routes/users.js memicu syncHubAccessOnUserChange() setelah PATCH /:id
// (active:false ATAU role berubah) dan DELETE /:id/roles/:role — yang di
// baliknya mencabut kode handoff SANSS yang belum terpakai + memberi tahu
// HUB, TAPI HANYA kalau perubahan itu SUNGGUH menghilangkan HUB_ACCESS
// (dicek ULANG dari DB, bukan ditebak dari nama field/role yang disentuh) —
// supaya perubahan yang tidak relevan (mis. mencabut SALES dari seseorang
// yang juga ADMIN) tidak memaksa logout paksa yang tidak perlu.

test("PATCH /users/:id {active:false} → cabut kode handoff SANSS + beri tahu HUB (reason=deactivated)", async () => {
  const admin = await mkUser({ dbRoles: ["ADMIN"], name: "Admin Uji" });
  const target = await mkUser({ dbRoles: ["ADMIN"], name: "Novi" });
  const code = await issue(target.token);
  const r = await raw("PATCH", `/api/users/${target.user.id}`, { token: admin.token, body: { active: false } });
  assert.equal(r.status, 200);
  // routes/users.js memanggil syncHubAccessOnUserChange() TANPA await (fire-
  // and-forget, `.catch()` saja) SEBELUM mengirim respons ini — jadi
  // revokeHandoffs() di dalamnya belum tentu tuntas persis saat respons PATCH
  // ini kembali. Tunggu bukti KONKRET (panggilan ke HUB palsu, yang terjadi
  // SETELAH revokeHandoffs ter-await di dalam syncHubAccessOnUserChange)
  // dulu, baru periksa /exchange — supaya tes ini deterministik, bukan balapan.
  const call = await waitFor(() => fakeHub.calls.find((c) => c.body?.sub === target.user.id));
  assert.equal(call.body.reason, "deactivated");
  assert.equal((await svc("/exchange", { code })).status, 401, "kode handoff tercabut");
});

test("PATCH /users/:id ganti kolom role TAPI HUB_ACCESS efektif tidak berubah (masih ADMIN di user_roles) → TIDAK memicu cabut (skip, dicek ulang dari DB)", async () => {
  const admin = await mkUser({ dbRoles: ["ADMIN"] });
  const target = await mkUser({ dbRoles: ["ADMIN"] });
  const code = await issue(target.token);
  const r = await raw("PATCH", `/api/users/${target.user.id}`, { token: admin.token, body: { role: "ADMIN" } });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal((await svc("/exchange", { code })).status, 200, "akses tidak hilang → kode tetap hidup");
  assert.equal(fakeHub.calls.length, 0, "HUB tidak diganggu kalau akses tidak berubah");
});

test("DELETE /users/:id/roles/:role mencabut role TERAKHIR pemberi HUB_ACCESS → cabut kode handoff + beri tahu HUB (reason=role_changed)", async () => {
  const admin = await mkUser({ dbRoles: ["ADMIN"] });
  const target = await mkUser({ dbRoles: ["ADMIN", "SALES"] });
  const code = await issue(target.token);
  const r = await raw("DELETE", `/api/users/${target.user.id}/roles/ADMIN`, { token: admin.token });
  assert.equal(r.status, 200);
  // Sama seperti PATCH di atas — syncHubAccessOnUserChange() dipanggil TANPA
  // await. Tunggu panggilan ke HUB palsu (bukti revokeHandoffs sudah tuntas)
  // dulu, baru periksa /exchange.
  const call = await waitFor(() => fakeHub.calls.find((c) => c.body?.sub === target.user.id));
  assert.equal(call.body.reason, "role_changed");
  assert.equal((await svc("/exchange", { code })).status, 401, "kode handoff tercabut");
});

test("DELETE /users/:id/roles/:role mencabut role yang TIDAK memengaruhi HUB_ACCESS (ADMIN masih ada) → TIDAK memicu cabut", async () => {
  const admin = await mkUser({ dbRoles: ["ADMIN"] });
  const target = await mkUser({ dbRoles: ["ADMIN", "SALES"] });
  const code = await issue(target.token);
  const r = await raw("DELETE", `/api/users/${target.user.id}/roles/SALES`, { token: admin.token });
  assert.equal(r.status, 200);
  await new Promise((res) => setTimeout(res, 150));
  assert.equal((await svc("/exchange", { code })).status, 200, "ADMIN masih ada → akses HUB tidak hilang, kode tetap hidup");
  assert.equal(fakeHub.calls.length, 0);
});

test("PATCH /users/:id {active:false} untuk pengguna TANPA HUB_ACCESS (SALES) → tetap 200, tidak error walau tidak ada apa-apa untuk dicabut", async () => {
  const admin = await mkUser({ dbRoles: ["ADMIN"] });
  const target = await mkUser({ dbRoles: ["SALES"] });
  const r = await raw("PATCH", `/api/users/${target.user.id}`, { token: admin.token, body: { active: false } });
  assert.equal(r.status, 200);
});

// ═══ Migrasi ════════════════════════════════════════════════════════════════

test("migrasi: tabel hub_handoffs ada dengan kolom, tipe, indeks unik, dan FK yang benar", async () => {
  const cols = await testPrisma.$queryRawUnsafe(
    `SELECT column_name, data_type, is_nullable, column_default FROM information_schema.columns WHERE table_name = 'hub_handoffs' ORDER BY column_name`);
  const by = Object.fromEntries(cols.map((c) => [c.column_name, c]));
  assert.deepEqual(Object.keys(by).sort(), ["code_hash", "created_at", "destination", "expires_at", "id", "revoked_at", "state_hash", "used_at", "user_id"]);
  assert.equal(by.id.data_type, "uuid");
  for (const c of ["user_id", "code_hash", "destination", "expires_at", "created_at"]) assert.equal(by[c].is_nullable, "NO", c);
  for (const c of ["used_at", "revoked_at", "state_hash"]) assert.equal(by[c].is_nullable, "YES", c);
  assert.equal(by.state_hash.data_type, "text");
  assert.match(by.created_at.column_default, /CURRENT_TIMESTAMP|now\(\)/i);

  const idx = await testPrisma.$queryRawUnsafe(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'hub_handoffs'`);
  const defs = idx.map((i) => i.indexdef).join("\n");
  assert.match(defs, /UNIQUE INDEX hub_handoffs_code_hash_key .*\(code_hash\)/);
  assert.match(defs, /\(user_id, used_at, revoked_at\)/);
  assert.match(defs, /\(expires_at\)/);

  const fk = await testPrisma.$queryRawUnsafe(
    `SELECT confdeltype FROM pg_constraint WHERE conname = 'hub_handoffs_user_id_fkey'`);
  assert.equal(fk.length, 1);
  assert.equal(fk[0].confdeltype, "c", "ON DELETE CASCADE");
});

test("migrasi: kode hash unik di level database (dua baris dengan hash sama ditolak)", async () => {
  const { user } = await mkUser();
  const data = { userId: user.id, codeHash: "h".repeat(64), destination: "/", expiresAt: new Date(Date.now() + 60_000) };
  await testPrisma.hubHandoff.create({ data });
  await assert.rejects(() => testPrisma.hubHandoff.create({ data }), /Unique constraint/);
});

test("migrasi: FK ON DELETE CASCADE — menghapus pengguna membersihkan handoff-nya", async () => {
  const { user, token } = await mkUser();
  await issue(token);
  assert.equal(await testPrisma.hubHandoff.count(), 1);
  await testPrisma.user.delete({ where: { id: user.id } });
  assert.equal(await testPrisma.hubHandoff.count(), 0);
});

// Forward-port ke main (lihat km-sanss-task-meeting-sso-forward-port): migrasi
// asli tahap 3 (20260926090000_hub_handoff_sso) + tahap 4
// (20260927060000_hub_handoff_state) DIGABUNG jadi SATU migrasi baru
// (20261231170000_hub_handoff_sso, timestamp baru supaya tetap terurut
// setelah migrasi terbaru main saat forward-port ini dibuat) — bukan reuse
// timestamp lama yang sudah tidak terurut benar lagi. state_hash karena itu
// bagian dari CREATE TABLE awal, bukan ALTER TABLE ADD COLUMN terpisah;
// nullable & tipe TEXT-nya sudah diverifikasi lewat introspeksi skema di tes
// "migrasi: bentuk tabel hub_handoffs" di atas.
test("migrasi: additive murni — file SQL hanya CREATE TABLE/INDEX dan ALTER TABLE atas hub_handoffs (tanpa DROP/UPDATE/DELETE)", () => {
  const dir = path.resolve("prisma/migrations/20261231170000_hub_handoff_sso");
  const sql = fs.readFileSync(path.join(dir, "migration.sql"), "utf8").replace(/--.*$/gm, "");
  // Klausa FK "ON DELETE/ON UPDATE CASCADE" bukan perintah data — dibuang dulu sebelum mencari kata destruktif.
  // "NOT NULL" SENGAJA tidak dilarang di sini — CREATE TABLE baru wajar punya kolom wajib
  // (id/user_id/code_hash/destination/expires_at/created_at); yang dijaga justru state_hash
  // TIDAK boleh NOT NULL, dan itu sudah diverifikasi lewat introspeksi skema di atas.
  const tanpaKlausaFk = sql.replace(/\bON (DELETE|UPDATE) (CASCADE|RESTRICT|SET NULL|NO ACTION)\b/gi, "");
  assert.ok(!/\b(DROP|TRUNCATE|DELETE|UPDATE|INSERT|RENAME)\b/i.test(tanpaKlausaFk), "ada perintah destruktif");
  assert.doesNotMatch(sql, /"state_hash"[^,\n]*NOT NULL/i, "state_hash harus tetap nullable");
  const stmts = sql.split(";").map((s) => s.trim()).filter(Boolean);
  assert.ok(stmts.length >= 5);
  for (const s of stmts) {
    assert.match(s, /^(CREATE TABLE "hub_handoffs"|CREATE (UNIQUE )?INDEX "hub_handoffs_[a-z_]+" ON "hub_handoffs"|ALTER TABLE "hub_handoffs")/, s.slice(0, 80));
  }
});

test("migrasi: tercatat selesai di _prisma_migrations", async () => {
  const name = "20261231170000_hub_handoff_sso";
  const rows = await testPrisma.$queryRawUnsafe(
    `SELECT migration_name, finished_at, rolled_back_at FROM _prisma_migrations WHERE migration_name = '${name}'`);
  assert.equal(rows.length, 1, name);
  assert.ok(rows[0].finished_at, name);
  assert.equal(rows[0].rolled_back_at, null, name);
});
