// Test integrasi SESI MOBILE Finance Android (S0): login, rotasi refresh,
// pencabutan, tidak ada perpanjangan otomatis, rate limit, capabilities,
// token push perangkat. Memakai router ASLI lewat testApp.js.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import jwt from "jsonwebtoken";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
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

async function loginMobile(u, device = DEVICE()) {
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}

test("Login mobile: access token 15 menit bertanda typ=mobile + sid, refresh token, capabilities", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  assert.equal(b.tokenType, "Bearer");
  assert.equal(b.expiresIn, 900);
  assert.ok(b.refreshToken.startsWith("smr_"));
  const claims = jwt.verify(b.accessToken, process.env.JWT_SECRET);
  assert.equal(claims.typ, "mobile");
  assert.equal(claims.sid, b.session.id);
  assert.equal(claims.exp - claims.iat, 900);
  assert.deepEqual(claims.roles, ["FINANCE"]);
  assert.equal(b.capabilities.paymentWrite, true);
  assert.equal(b.capabilities.financeAdmin, false);
  assert.equal(b.capabilities.preset, "FINANCE");
  // Yang tersimpan di DB hanya HASH refresh token.
  const s = await testPrisma.mobileSession.findUnique({ where: { id: b.session.id } });
  assert.notEqual(s.refreshTokenHash, b.refreshToken);
  assert.equal(s.refreshTokenHash.length, 64);
});

test("Login mobile ditolak: password salah 401, bukan tim finance 403, tanpa deviceId 400, akun nonaktif 403", async () => {
  const fin = await createLoginUser({ roles: ["FINANCE"] });
  const salah = await raw("POST", "/api/mobile/auth/login", { body: { email: fin.email, password: "salah", device: DEVICE() } });
  assert.equal(salah.status, 401);

  const sales = await createLoginUser({ roles: ["SALES"] });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: sales.email, password: sales.password, device: DEVICE() } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "NOT_FINANCE_TEAM");

  const tanpaDevice = await raw("POST", "/api/mobile/auth/login", { body: { email: fin.email, password: fin.password } });
  assert.equal(tanpaDevice.status, 400);

  const off = await createLoginUser({ roles: ["FINANCE"], active: false });
  const nonaktif = await raw("POST", "/api/mobile/auth/login", { body: { email: off.email, password: off.password, device: DEVICE() } });
  assert.equal(nonaktif.status, 403);
});

test("Token mobile TIDAK diperpanjang otomatis (tanpa X-Refreshed-Token); token web tetap diperpanjang seperti dulu", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  const me = await raw("GET", "/api/auth/me", { token: b.accessToken });
  assert.equal(me.status, 200);
  assert.equal(me.headers.get("x-refreshed-token"), null);

  // Token web berumur pendek (sisa < 6 hari) → perilaku lama: dapat token baru.
  const web = jwt.sign({ id: u.user.id, name: u.user.name, role: "FINANCE", roles: ["FINANCE"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
  const meWeb = await raw("GET", "/api/auth/me", { token: web });
  assert.equal(meWeb.status, 200);
  assert.ok(meWeb.headers.get("x-refreshed-token"), "web session harus tetap menerima X-Refreshed-Token");
});

test("Refresh: rotasi menghasilkan token baru; token lama yang dipakai ulang mencabut seluruh sesi", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);

  const r1 = await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: b.refreshToken } });
  assert.equal(r1.status, 200, JSON.stringify(r1.body));
  assert.notEqual(r1.body.refreshToken, b.refreshToken);
  assert.equal(r1.body.session.id, b.session.id);
  assert.equal((await raw("GET", "/api/auth/me", { token: r1.body.accessToken })).status, 200);

  // Token BARU sah dan bisa dirotasi lagi.
  const r2 = await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: r1.body.refreshToken } });
  assert.equal(r2.status, 200);

  // Token lama (b.refreshToken) dipakai lagi = tanda dicuri → sesi dicabut.
  const reuse = await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: r1.body.refreshToken } });
  assert.equal(reuse.status, 401);
  assert.equal(reuse.body.code, "REFRESH_REUSED");

  // Sesi mati total: refresh terbaru dan access token yang masih "hidup" ikut ditolak.
  const akhir = await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: r2.body.refreshToken } });
  assert.equal(akhir.status, 401);
  const me = await raw("GET", "/api/auth/me", { token: r2.body.accessToken });
  assert.equal(me.status, 401);
  assert.equal(me.body.code, "SESSION_REVOKED");
});

test("Refresh paralel dengan token yang sama: hanya satu yang menang", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  const hasil = await Promise.all([1, 2, 3].map(() => raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: b.refreshToken } })));
  assert.equal(hasil.filter((h) => h.status === 200).length, 1, JSON.stringify(hasil.map((h) => h.status)));
});

test("Logout mencabut sesi seketika: access token yang belum kedaluwarsa langsung ditolak; logout dengan refresh token saja juga bisa", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  assert.equal((await raw("GET", "/api/finance/cash-accounts", { token: b.accessToken })).status, 200);

  const out = await raw("POST", "/api/mobile/auth/logout", { token: b.accessToken, body: {} });
  assert.equal(out.status, 200);
  const setelah = await raw("GET", "/api/finance/cash-accounts", { token: b.accessToken });
  assert.equal(setelah.status, 401);
  assert.equal(setelah.body.code, "SESSION_REVOKED");
  assert.equal((await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: b.refreshToken } })).status, 401);

  const b2 = await loginMobile(u, DEVICE("device-b"));
  const out2 = await raw("POST", "/api/mobile/auth/logout", { body: { refreshToken: b2.refreshToken } });
  assert.equal(out2.status, 200);
  assert.equal((await raw("GET", "/api/auth/me", { token: b2.accessToken })).status, 401);
});

test("Akun dinonaktifkan: access token & refresh langsung ditolak", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  await testPrisma.user.update({ where: { id: u.user.id }, data: { active: false } });
  assert.equal((await raw("GET", "/api/auth/me", { token: b.accessToken })).status, 401);
  const r = await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: b.refreshToken } });
  assert.equal(r.status, 401);
  assert.equal(r.body.code, "ACCOUNT_INACTIVE");
});

test("Token mobile hanya berlaku untuk jalur Finance/mobile (hak akses minimum)", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  // /api/units dijaga requireAuth; token web FINANCE tidak dibatasi jalur, token mobile dibatasi.
  const dilarang = await raw("GET", "/api/units/tidak-ada", { token: b.accessToken });
  assert.equal(dilarang.status, 403);
  assert.match(dilarang.body.error, /mobile/i);
});

test("Maksimal 2 sesi aktif per pengguna: perangkat ke-3 mencabut yang paling lama; login ulang di perangkat sama mengganti sesinya", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const a = await loginMobile(u, DEVICE("dev-a"));
  const b = await loginMobile(u, DEVICE("dev-b"));
  const c = await loginMobile(u, DEVICE("dev-c"));
  assert.equal((await raw("GET", "/api/auth/me", { token: a.accessToken })).status, 401, "sesi terlama harus dicabut");
  assert.equal((await raw("GET", "/api/auth/me", { token: b.accessToken })).status, 200);
  assert.equal((await raw("GET", "/api/auth/me", { token: c.accessToken })).status, 200);

  const c2 = await loginMobile(u, DEVICE("dev-c"));
  assert.equal((await raw("GET", "/api/auth/me", { token: c.accessToken })).status, 401, "login ulang di perangkat sama mengganti sesi lama");
  assert.equal((await raw("GET", "/api/auth/me", { token: c2.accessToken })).status, 200);
  assert.equal((await raw("GET", "/api/auth/me", { token: b.accessToken })).status, 200, "perangkat lain tidak terganggu");
});

test("Daftar sesi & keluarkan perangkat lain; admin (USER_MANAGE) bisa mencabut semua sesi seorang pengguna, finance tidak", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const a = await loginMobile(u, DEVICE("dev-a"));
  const b = await loginMobile(u, DEVICE("dev-b"));

  const list = await raw("GET", "/api/mobile/auth/sessions", { token: b.accessToken });
  assert.equal(list.status, 200);
  assert.equal(list.body.sessions.length, 2);
  assert.equal(list.body.sessions.filter((s) => s.current).length, 1);

  const del = await raw("DELETE", `/api/mobile/auth/sessions/${a.session.id}`, { token: b.accessToken });
  assert.equal(del.status, 200);
  assert.equal((await raw("GET", "/api/auth/me", { token: a.accessToken })).status, 401);
  assert.equal((await raw("DELETE", `/api/mobile/auth/sessions/${a.session.id}`, { token: b.accessToken })).status, 404);

  const nonAdmin = await raw("POST", "/api/mobile/auth/sessions/revoke-user", { token: b.accessToken, body: { userId: u.user.id } });
  assert.equal(nonAdmin.status, 403);

  const admin = await createTestUser({ roles: ["ADMIN"] });
  const ok = await raw("POST", "/api/mobile/auth/sessions/revoke-user", { token: admin.token, body: { userId: u.user.id } });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.dicabut, 1);
  assert.equal((await raw("GET", "/api/auth/me", { token: b.accessToken })).status, 401);
});

test("Rate limit login: 5 gagal / 15 mnt per email+IP → 429 + Retry-After; berlaku juga di login web; login yang sah tidak terkunci", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  for (let i = 0; i < 5; i++) {
    const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: "salah", device: DEVICE() } });
    assert.equal(r.status, 401);
  }
  const terkunci = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(terkunci.status, 429);
  assert.equal(terkunci.body.code, "RATE_LIMITED");
  assert.ok(Number(terkunci.headers.get("retry-after")) > 0);

  // Login WEB dengan email yang sama memakai penghitung yang sama.
  const web = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(web.status, 429);

  // Email lain dari IP yang sama tidak ikut terkunci.
  const lain = await createLoginUser({ roles: ["FINANCE"] });
  const ok = await raw("POST", "/api/mobile/auth/login", { body: { email: lain.email, password: lain.password, device: DEVICE("dev-x") } });
  assert.equal(ok.status, 200);
});

test("Rate limit: salah ketik sesekali lalu berhasil mereset hitungan; refresh dibatasi per IP", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  for (let i = 0; i < 4; i++) {
    await raw("POST", "/api/auth/login", { body: { email: u.email, password: "salah" } });
  }
  const sukses = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(sukses.status, 200);
  for (let i = 0; i < 4; i++) {
    const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: "salah" } });
    assert.equal(r.status, 401, "hitungan harus sudah direset oleh login berhasil");
  }

  let terakhir;
  for (let i = 0; i < 61; i++) {
    terakhir = await raw("POST", "/api/mobile/auth/refresh", { body: { refreshToken: "smr_tidak-valid" } });
  }
  assert.equal(terakhir.status, 429);
});

test("Rate limit API mobile: 120 request/menit/pengguna", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u);
  let status = 0;
  for (let i = 0; i < 121; i++) {
    status = (await raw("GET", "/api/mobile/auth/sessions", { token: b.accessToken })).status;
    if (status === 429) break;
  }
  assert.equal(status, 429);
});

test("/auth/me memuat capabilities dari role/permission AKTUAL (login web ikut)", async () => {
  const kasus = [
    [["FINANCE"], { financeRead: true, financePost: true, financeApprove: true, financeAdmin: false, paymentWrite: true, preset: "FINANCE" }],
    [["ADMIN"], { financeRead: true, financePost: true, financeApprove: true, financeAdmin: true, paymentWrite: false, preset: "OWNER" }],
    [["OWNER"], { financeAdmin: true, paymentWrite: false, preset: "OWNER" }],
    [["SALES"], { financeRead: false, financePost: false, financeApprove: false, expenseSubmit: true, financeApp: false, preset: "SUBMITTER" }],
    [["DRIVER"], { financeRead: false, expenseSubmit: false, financeApp: false, preset: "NONE" }],
  ];
  for (const [roles, ekspektasi] of kasus) {
    const u = await createLoginUser({ roles });
    const login = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
    assert.equal(login.status, 200);
    assert.ok(login.body.user.capabilities, "login web juga membawa capabilities (additive)");
    const me = await raw("GET", "/api/auth/me", { token: login.body.token });
    assert.equal(me.status, 200);
    for (const [k, v] of Object.entries(ekspektasi)) {
      assert.equal(me.body.capabilities[k], v, `${roles.join("+")} → ${k}`);
    }
    // Field lama tetap ada (kompatibel web).
    assert.ok(Array.isArray(me.body.roles) && Array.isArray(me.body.portals));
  }
});

test("Token push perangkat: daftar (FCM & Expo), upsert per perangkat, deviceId harus sama dengan sesi, hapus, dan dibersihkan saat logout", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const b = await loginMobile(u, DEVICE("dev-a"));
  const t = b.accessToken;
  const TOKEN_FCM = "f".repeat(60);

  assert.equal((await raw("POST", "/api/mobile/devices", { token: t, body: { deviceId: "dev-a", token: "pendek" } })).status, 400);
  assert.equal((await raw("POST", "/api/mobile/devices", { token: t, body: { deviceId: "dev-LAIN", token: TOKEN_FCM } })).status, 400);
  assert.equal((await raw("POST", "/api/mobile/devices", { token: t, body: { deviceId: "dev-a", token: "bukan-expo", provider: "expo" } })).status, 400);

  const ok = await raw("POST", "/api/mobile/devices", { token: t, body: { deviceId: "dev-a", token: TOKEN_FCM, provider: "fcm", appVersion: "1.0.0" } });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  // Daftar ulang dengan token baru = ganti (bukan menambah baris).
  const ok2 = await raw("POST", "/api/mobile/devices", { token: t, body: { deviceId: "dev-a", token: "ExponentPushToken[abc123]", provider: "expo" } });
  assert.equal(ok2.status, 201);
  let rows = await testPrisma.mobileDeviceToken.findMany({ where: { userId: u.user.id } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].provider, "expo");
  assert.equal(rows[0].fcmToken, "ExponentPushToken[abc123]");

  // Token web (bukan sesi mobile) tidak boleh mendaftarkan perangkat.
  const web = jwt.sign({ id: u.user.id, name: u.user.name, role: "FINANCE", roles: ["FINANCE"] }, process.env.JWT_SECRET, { expiresIn: "1h" });
  assert.equal((await raw("POST", "/api/mobile/devices", { token: web, body: { deviceId: "dev-a", token: TOKEN_FCM } })).status, 403);

  const del = await raw("DELETE", "/api/mobile/devices/dev-a", { token: t });
  assert.equal(del.status, 200);
  assert.equal(del.body.dihapus, 1);

  await raw("POST", "/api/mobile/devices", { token: t, body: { deviceId: "dev-a", token: TOKEN_FCM } });
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { userId: u.user.id } }), 1);
  await raw("POST", "/api/mobile/auth/logout", { token: t, body: {} });
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { userId: u.user.id } }), 0, "logout menghapus token push perangkat");
  rows = await testPrisma.mobileSession.findMany({ where: { userId: u.user.id } });
  assert.ok(rows.every((s) => s.revokedAt));
});

test("Token push yang sama dipindah ke pengguna lain → baris lama dihapus (satu token = satu pemilik)", async () => {
  const u1 = await createLoginUser({ roles: ["FINANCE"] });
  const u2 = await createLoginUser({ roles: ["FINANCE"] });
  const b1 = await loginMobile(u1, DEVICE("dev-a"));
  const b2 = await loginMobile(u2, DEVICE("dev-b"));
  const TOKEN = "z".repeat(50);
  await raw("POST", "/api/mobile/devices", { token: b1.accessToken, body: { deviceId: "dev-a", token: TOKEN } });
  await raw("POST", "/api/mobile/devices", { token: b2.accessToken, body: { deviceId: "dev-b", token: TOKEN } });
  const rows = await testPrisma.mobileDeviceToken.findMany({ where: { fcmToken: TOKEN } });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].userId, u2.user.id);
});

test("GET /api/mobile/config publik (tanpa login) dan tidak membocorkan rahasia", async () => {
  const r = await raw("GET", "/api/mobile/config");
  assert.equal(r.status, 200);
  assert.equal(typeof r.body.minVersionCode, "number");
  assert.equal(r.body.maintenance.active, false);
  assert.ok(r.body.serverTime);
  assert.ok(!JSON.stringify(r.body).includes("PRIVATE KEY"));
});
