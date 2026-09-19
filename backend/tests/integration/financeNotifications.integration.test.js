// Test integrasi DISPATCH NOTIFIKASI FINANCE: penerima berdasarkan izin,
// tidak ada push tanpa FINANCE_PUSH_ENABLED / kredensial, pembersihan token mati.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { generateKeyPairSync } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import {
  dispatchFinanceNotification, usersWithPermission, notifyApprovalRequested, notifyApprovalDecided,
  setExpoFetchForTests,
} from "../../src/services/financeNotifications.js";
import { setFcmTransportForTests } from "../../src/services/fcmTransport.js";
import { PERMISSIONS as P } from "../../src/constants/permissions.js";

const ENV = ["FINANCE_PUSH_ENABLED", "FCM_SERVICE_ACCOUNT_JSON", "FCM_PROJECT_ID", "FCM_CLIENT_EMAIL", "FCM_PRIVATE_KEY"];
const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048, privateKeyEncoding: { type: "pkcs8", format: "pem" }, publicKeyEncoding: { type: "spki", format: "pem" } });

test.before(async () => { await truncateAll(); });
test.afterEach(async () => {
  for (const k of ENV) delete process.env[k];
  setExpoFetchForTests(null);
  await truncateAll();
});
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

async function daftarToken(userId, deviceId, token, provider) {
  return testPrisma.mobileDeviceToken.create({ data: { userId, deviceId, fcmToken: token, provider } });
}
function pasangFcm() {
  process.env.FCM_PROJECT_ID = "p";
  process.env.FCM_CLIENT_EMAIL = "svc@p.iam.gserviceaccount.com";
  process.env.FCM_PRIVATE_KEY = privateKey;
}
const resp = (status, body) => ({ ok: status >= 200 && status < 300, status, json: async () => body });

test("usersWithPermission: pemegang FINANCE_APPROVE = FINANCE/ADMIN/OWNER aktif, bukan SALES atau akun nonaktif", async () => {
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const adm = await createTestUser({ roles: ["ADMIN"] });
  const own = await createTestUser({ roles: ["OWNER"] });
  const sal = await createTestUser({ roles: ["SALES"] });
  const off = await createTestUser({ roles: ["FINANCE"] });
  await testPrisma.user.update({ where: { id: off.user.id }, data: { active: false } });
  await testPrisma.userRole.createMany({ data: [fin, adm, own, sal, off].map((u) => ({ userId: u.user.id, role: u.user.role })) });

  const ids = await usersWithPermission(testPrisma, P.FINANCE_APPROVE);
  assert.deepEqual(new Set(ids), new Set([fin.user.id, adm.user.id, own.user.id]));
  const pay = await usersWithPermission(testPrisma, P.PAYMENT_WRITE);
  assert.deepEqual(pay, [fin.user.id], "hanya FINANCE yang bisa verifikasi pembayaran");
});

test("AMAN BY DEFAULT: FINANCE_PUSH_ENABLED tidak diset → tidak ada satu pun panggilan jaringan", async () => {
  const fin = await createTestUser({ roles: ["FINANCE"] });
  await daftarToken(fin.user.id, "d1", "ExponentPushToken[abc]", "expo");
  await daftarToken(fin.user.id, "d2", "f".repeat(40), "fcm");
  let jaringan = 0;
  setExpoFetchForTests(async () => { jaringan++; return resp(200, { data: [] }); });
  setFcmTransportForTests({ fetch: async () => { jaringan++; return resp(200, {}); } });
  const r = await dispatchFinanceNotification({ title: "t", body: "b", userIds: [fin.user.id] });
  assert.equal(r.dilewati, "push_nonaktif");
  assert.equal(jaringan, 0);
});

test("Push aktif tapi kredensial FCM belum ada: token FCM dilewati (tidak ada panggilan FCM), token Expo tetap dikirim", async () => {
  process.env.FINANCE_PUSH_ENABLED = "true";
  const fin = await createTestUser({ roles: ["FINANCE"] });
  await daftarToken(fin.user.id, "d1", "ExponentPushToken[abc]", "expo");
  await daftarToken(fin.user.id, "d2", "f".repeat(40), "fcm");
  let fcmDipanggil = 0;
  const expoPesan = [];
  setFcmTransportForTests({ fetch: async () => { fcmDipanggil++; return resp(200, {}); } });
  setExpoFetchForTests(async (url, opts) => { expoPesan.push(...JSON.parse(opts.body)); return resp(200, { data: [{ status: "ok" }] }); });

  const r = await dispatchFinanceNotification({ title: "Judul", body: "Isi", data: { a: 1 }, userIds: [fin.user.id], channelId: "approval" });
  assert.equal(r.dilewati, "tanpa_kredensial_fcm");
  assert.equal(fcmDipanggil, 0);
  assert.equal(expoPesan.length, 1);
  assert.equal(expoPesan[0].to, "ExponentPushToken[abc]");
  assert.equal(expoPesan[0].channelId, "approval");
  assert.equal(r.terkirim, 1);
});

test("FCM + Expo aktif: pelaku aksi (excludeUserId) tidak dikirimi; token mati (UNREGISTERED / DeviceNotRegistered) dihapus", async () => {
  process.env.FINANCE_PUSH_ENABLED = "true";
  pasangFcm();
  const pengaju = await createTestUser({ roles: ["FINANCE"] });
  const owner = await createTestUser({ roles: ["OWNER"] });
  await testPrisma.userRole.createMany({ data: [pengaju, owner].map((u) => ({ userId: u.user.id, role: u.user.role })) });
  await daftarToken(pengaju.user.id, "p1", "TOKEN-PENGAJU-FCM-" + "x".repeat(20), "fcm");
  const fcmHidup = await daftarToken(owner.user.id, "o1", "TOKEN-OWNER-HIDUP-" + "y".repeat(20), "fcm");
  const fcmMati = await daftarToken(owner.user.id, "o2", "TOKEN-OWNER-MATI--" + "z".repeat(20), "fcm");
  const expoMati = await daftarToken(owner.user.id, "o3", "ExponentPushToken[mati]", "expo");

  const dikirimKe = [];
  setFcmTransportForTests({
    now: () => Date.now(),
    fetch: async (url, opts) => {
      if (String(url).includes("oauth2")) return resp(200, { access_token: "AT", expires_in: 3600 });
      const msg = JSON.parse(opts.body).message;
      dikirimKe.push(msg.token);
      return msg.token === fcmMati.fcmToken ? resp(404, { error: { status: "UNREGISTERED" } }) : resp(200, {});
    },
  });
  setExpoFetchForTests(async () => resp(200, { data: [{ status: "error", details: { error: "DeviceNotRegistered" } }] }));

  const r = await notifyApprovalRequested({ jenis: "expense", id: "abc", nomor: "EXP-1", actorId: pengaju.user.id });
  assert.equal(r.penerima, 1, "hanya owner (pengaju dikecualikan)");
  assert.ok(!dikirimKe.some((t) => t.startsWith("TOKEN-PENGAJU")), "pengaju tidak dikirimi");
  assert.ok(dikirimKe.includes(fcmHidup.fcmToken));
  assert.equal(r.terkirim, 1);
  assert.equal(r.dihapus, 2);
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { id: { in: [fcmMati.id, expoMati.id] } } }), 0);
  assert.equal(await testPrisma.mobileDeviceToken.count({ where: { id: fcmHidup.id } }), 1);
});

test("Isi push aman di layar terkunci: tanpa nominal/nama; detail hanya di data; putusan hanya ke pengaju", async () => {
  process.env.FINANCE_PUSH_ENABLED = "true";
  const pengaju = await createTestUser({ roles: ["FINANCE"] });
  const lain = await createTestUser({ roles: ["FINANCE"] });
  await daftarToken(pengaju.user.id, "p1", "ExponentPushToken[pengaju]", "expo");
  await daftarToken(lain.user.id, "l1", "ExponentPushToken[lain]", "expo");
  const pesan = [];
  setExpoFetchForTests(async (url, opts) => { pesan.push(...JSON.parse(opts.body)); return resp(200, { data: [{ status: "ok" }] }); });

  await notifyApprovalDecided({ jenis: "expense", id: "id-1", nomor: "EXP-9", decision: "approved", submitterId: pengaju.user.id });
  assert.equal(pesan.length, 1);
  assert.equal(pesan[0].to, "ExponentPushToken[pengaju]");
  assert.doesNotMatch(`${pesan[0].title} ${pesan[0].body}`, /Rp|\d{3}/, "tanpa nominal di teks yang tampil");
  assert.equal(pesan[0].data.url, "sanofinance://expense/id-1");
  assert.equal(pesan[0].data.decision, "approved");
});

test("Kegagalan pengiriman tidak pernah dilempar ke pemanggil (fire-and-forget)", async () => {
  process.env.FINANCE_PUSH_ENABLED = "true";
  const fin = await createTestUser({ roles: ["FINANCE"] });
  await daftarToken(fin.user.id, "d1", "ExponentPushToken[abc]", "expo");
  setExpoFetchForTests(async () => { throw new Error("jaringan putus"); });
  const r = await dispatchFinanceNotification({ title: "t", body: "b", userIds: [fin.user.id] });
  assert.equal(r.terkirim, 0);
  assert.equal(await testPrisma.mobileDeviceToken.count(), 1, "token tidak dihapus karena galat sementara");
});
