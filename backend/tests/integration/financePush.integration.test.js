// Push Finance (S11) lewat endpoint ASLI: register/rotasi/hapus token, logout & revoke menghapus token, preferensi per kategori memfilter pengiriman,
// pemicu (ajukan → penyetuju; putusan → pengaju) tanpa mengubah respons endpoint, dan AMAN saat FINANCE_PUSH_ENABLED off.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setExpoFetchForTests } from "../../src/services/financeNotifications.js";
import { runFinanceReminderCycle } from "../../src/services/financeReminderJob.js";

let server;
let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { delete process.env.FINANCE_PUSH_ENABLED; setExpoFetchForTests(null); await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
async function masuk(roles, deviceId = "device-a") {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE(deviceId) } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return { ...u, token: r.body.accessToken, refresh: r.body.refreshToken, deviceId };
}
const kunci = () => ({ "Idempotency-Key": randomUUID() });
const post = (u, path, body) => raw("POST", path, { token: u.token, headers: kunci(), body: body ?? {} });
const daftar = (u, token, extra = {}) => post(u, "/api/mobile/devices", { deviceId: u.deviceId, token, provider: "expo", platform: "android", appVersion: "1.0.0", ...extra });
const tunggu = async (fn, ms = 3000) => { const t = Date.now(); while (Date.now() - t < ms) { if (await fn()) return true; await new Promise((r) => setTimeout(r, 40)); } return false; };

async function siapkanAkun() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "KEM Bank", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "SERVIS_KENDARAAN" } });
  return { bank, kat };
}
const ajukan = (u, s, ket = "Servis") => post(u, "/api/finance/expenses", { description: ket, amount: "150000", categoryId: s.kat.id, mode: "LANGSUNG", cashAccountId: s.bank.id });

test("Token: daftar, rotasi (token baru menggantikan), deviceId asing ditolak, token pindah pengguna, hapus, token tidak valid ditolak", async () => {
  const u = await masuk(["FINANCE"]);
  assert.equal((await daftar(u, "ExponentPushToken[aaa]")).status, 201);
  assert.equal((await daftar(u, "ExponentPushToken[bbb]")).status, 201, "rotasi token pada perangkat yang sama");
  const baris = await testPrisma.mobileDeviceToken.findMany({ where: { userId: u.user.id } });
  assert.equal(baris.length, 1);
  assert.equal(baris[0].fcmToken, "ExponentPushToken[bbb]");
  assert.equal((await daftar(u, "bukan-token")).status, 400, "token expo harus berpola Expo");
  assert.equal((await post(u, "/api/mobile/devices", { deviceId: "perangkat-lain", token: "ExponentPushToken[ccc]", provider: "expo" })).status, 400, "deviceId harus milik sesi ini");
  const v = await masuk(["FINANCE"], "device-b");
  assert.equal((await daftar(v, "ExponentPushToken[bbb]")).status, 201);
  const pemilik = await testPrisma.mobileDeviceToken.findMany({ where: { fcmToken: "ExponentPushToken[bbb]" } });
  assert.equal(pemilik.length, 1);
  assert.equal(pemilik[0].userId, v.user.id);
  assert.equal((await raw("DELETE", `/api/mobile/devices/${v.deviceId}`, { token: v.token })).status, 200);
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { userId: v.user.id } }), 0);
});

test("Logout menghapus token push perangkat itu (tidak ada push ke perangkat yang sudah keluar)", async () => {
  const u = await masuk(["FINANCE"]);
  await daftar(u, "ExponentPushToken[out]");
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { userId: u.user.id } }), 1);
  assert.equal((await raw("POST", "/api/mobile/auth/logout", { body: { refreshToken: u.refresh } })).status, 200);
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { userId: u.user.id } }), 0);
});

test("Preferensi: default aktif; PUT memvalidasi; kategori yang dimatikan tidak dikirimi; kategori lain tetap", async () => {
  process.env.FINANCE_PUSH_ENABLED = "true";
  const s = await siapkanAkun();
  const pengaju = await masuk(["FINANCE"], "d-pengaju");
  const owner = await masuk(["OWNER"], "d-owner");
  await daftar(owner, "ExponentPushToken[owner]");
  const pesan = [];
  setExpoFetchForTests(async (_u, o) => { pesan.push(...JSON.parse(o.body)); return resp(200, { data: [{ status: "ok" }] }); });

  const p0 = (await raw("GET", "/api/mobile/notification-prefs", { token: owner.token })).body;
  assert.deepEqual(p0.categories, { approval: true, pembayaran: true, piutang: true, supplier: true, sensitif: true });
  assert.equal(p0.pushEnabled, true);
  assert.equal((await raw("PUT", "/api/mobile/notification-prefs", { token: owner.token, body: { categories: { lainnya: true } } })).status, 400);
  assert.equal((await raw("PUT", "/api/mobile/notification-prefs", { token: owner.token, body: { categories: { approval: "ya" } } })).status, 400);

  const a = await ajukan(pengaju, s);
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.ok(await tunggu(() => pesan.length === 1), "approval baru terkirim ke owner");
  assert.equal(pesan[0].to, "ExponentPushToken[owner]");
  assert.equal(pesan[0].data.path, `/persetujuan/expense/${a.body.id}`);
  assert.doesNotMatch(`${pesan[0].title} ${pesan[0].body}`, /Rp|150|Servis/, "tanpa nominal/isi dokumen di teks");
  assert.equal(pesan[0].channelId, "approval");

  const put = await raw("PUT", "/api/mobile/notification-prefs", { token: owner.token, body: { categories: { approval: false } } });
  assert.equal(put.status, 200);
  assert.equal(put.body.categories.approval, false);
  assert.equal(put.body.categories.sensitif, true, "kategori lain tidak berubah");
  pesan.length = 0;
  await ajukan(pengaju, s);
  await new Promise((r) => setTimeout(r, 500));
  assert.equal(pesan.length, 0, "approval dimatikan → tidak ada push");
});

test("Putusan → pengaju dikirimi; respons endpoint tidak berubah", async () => {
  process.env.FINANCE_PUSH_ENABLED = "true";
  const s = await siapkanAkun();
  const pengaju = await masuk(["FINANCE"], "d1");
  const owner = await masuk(["OWNER"], "d2");
  await daftar(pengaju, "ExponentPushToken[pengaju]");
  await daftar(owner, "ExponentPushToken[owner]");
  const pesan = [];
  setExpoFetchForTests(async (_u, o) => { pesan.push(...JSON.parse(o.body)); return resp(200, { data: [{ status: "ok" }] }); });

  const d = await ajukan(pengaju, s, "Bensin");
  await tunggu(() => pesan.length === 1);
  pesan.length = 0;
  const tolak = await post(owner, `/api/finance/expenses/${d.body.id}/reject`, { reason: "nota kurang" });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));
  assert.ok(await tunggu(() => pesan.length === 1));
  assert.equal(pesan[0].to, "ExponentPushToken[pengaju]");
  assert.equal(pesan[0].data.decision, "rejected");
  assert.equal(pesan[0].data.path, `/tx/pengeluaran/${d.body.id}`);
});

test("AMAN: push off → tidak ada jaringan & job berhenti; kegagalan Expo tidak menggagalkan endpoint", async () => {
  const s = await siapkanAkun();
  const pengaju = await masuk(["FINANCE"], "d1");
  const owner = await masuk(["OWNER"], "d2");
  await daftar(owner, "ExponentPushToken[owner]");
  let jaringan = 0;
  setExpoFetchForTests(async () => { jaringan++; throw new Error("jaringan mati"); });
  const a = await ajukan(pengaju, s, "X");
  assert.equal(a.status, 201);
  assert.deepEqual(await runFinanceReminderCycle(testPrisma), { dilewati: "push_nonaktif" });
  await new Promise((r) => setTimeout(r, 400));
  assert.equal(jaringan, 0);
  process.env.FINANCE_PUSH_ENABLED = "true";
  const b = await ajukan(pengaju, s, "Y");
  assert.equal(b.status, 201, "Expo gagal, endpoint tetap sukses");
  assert.ok(await tunggu(() => jaringan >= 1));
});
