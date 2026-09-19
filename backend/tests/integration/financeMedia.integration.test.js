// Test integrasi AKSES FOTO NOTA: tidak lagi publik-by-URL. Harus Bearer+izin
// atau URL bertanda-tangan berumur pendek.

import "./setup/env.js";
import { TMP_RECEIPTS_DIR } from "./setup/receiptsTmpEnv.js"; // WAJIB sebelum testApp
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { signFile } from "../../src/lib/mediaSigning.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

const FILE = "a".repeat(40) + ".jpg";
const THUMB = "a".repeat(40) + "_t.jpg";
const LAIN = "b".repeat(40) + ".jpg";
const URL_FOTO = `/media/finance-receipts/${FILE}`;
const ISI = Buffer.from("FOTO-NOTA-RAHASIA");

let server;
let raw;
test.before(async () => {
  await truncateAll();
  fs.writeFileSync(path.join(TMP_RECEIPTS_DIR, FILE), ISI);
  fs.writeFileSync(path.join(TMP_RECEIPTS_DIR, THUMB), Buffer.from("THUMB"));
  fs.writeFileSync(path.join(TMP_RECEIPTS_DIR, LAIN), Buffer.from("LAIN"));
  server = await startTestServer(buildTestApp());
  raw = makeRaw(server.baseUrl);
});
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => {
  await truncateAll(); await server.close(); await testPrisma.$disconnect();
  fs.rmSync(TMP_RECEIPTS_DIR, { recursive: true, force: true });
});

async function ambil(pathUrl, token) {
  const res = await fetch(`${server.baseUrl}${pathUrl}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });
  return { status: res.status, type: res.headers.get("content-type"), cache: res.headers.get("cache-control"), buf: Buffer.from(await res.arrayBuffer()) };
}

test("Tanpa login / tanpa tanda tangan → 401 (tidak lagi publik-by-URL), di kedua path", async () => {
  assert.equal((await ambil(`/media/finance-receipts/${FILE}`)).status, 401);
  assert.equal((await ambil(`/api/finance/media/receipts/${FILE}`)).status, 401);
});

test("Finance dengan Bearer: 200, image/jpeg, cache private; alias /api/finance/media/receipts juga", async () => {
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  const a = await ambil(`/media/finance-receipts/${FILE}`, token);
  assert.equal(a.status, 200);
  assert.equal(a.type, "image/jpeg");
  assert.match(a.cache, /private/);
  assert.deepEqual(a.buf, ISI);
  assert.equal((await ambil(`/api/finance/media/receipts/${FILE}`, token)).status, 200);
  assert.equal((await ambil(`/media/finance-receipts/${THUMB}`, token)).status, 200);
});

test("Peran tanpa izin finance (SALES/DRIVER) → 403; nama file tidak valid / tidak ada → 404; path traversal ditolak", async () => {
  const sales = await createTestUser({ roles: ["SALES"] });
  assert.equal((await ambil(`/media/finance-receipts/${FILE}`, sales.token)).status, 403);
  const driver = await createTestUser({ roles: ["DRIVER"] });
  assert.equal((await ambil(`/media/finance-receipts/${FILE}`, driver.token)).status, 403);

  const fin = await createTestUser({ roles: ["FINANCE"] });
  assert.equal((await ambil(`/media/finance-receipts/${"c".repeat(40)}.jpg`, fin.token)).status, 404);
  assert.equal((await ambil(`/media/finance-receipts/..%2F..%2F.env`, fin.token)).status, 404);
  assert.equal((await ambil(`/media/finance-receipts/abc.jpg`, fin.token)).status, 404);
});

test("URL bertanda-tangan: sah → 200 tanpa Bearer; sig salah / file lain / kedaluwarsa → 403", async () => {
  const s = signFile(FILE);
  assert.equal((await ambil(`/media/finance-receipts/${FILE}?exp=${s.exp}&sig=${s.sig}`)).status, 200);

  const salah = s.sig.slice(0, -2) + (s.sig.endsWith("00") ? "11" : "00");
  assert.equal((await ambil(`/media/finance-receipts/${FILE}?exp=${s.exp}&sig=${salah}`)).status, 403);
  // Tanda tangan untuk file A tidak berlaku untuk file B.
  assert.equal((await ambil(`/media/finance-receipts/${LAIN}?exp=${s.exp}&sig=${s.sig}`)).status, 403);
  // exp dimundurkan = tanda tangan tidak cocok.
  assert.equal((await ambil(`/media/finance-receipts/${FILE}?exp=${s.exp + 999999}&sig=${s.sig}`)).status, 403);
  // Kedaluwarsa (tanda tangan sah tapi lewat waktu).
  const lama = signFile(FILE, { now: Date.now() - 3600_000, ttlSeconds: 60 });
  assert.equal((await ambil(`/media/finance-receipts/${FILE}?exp=${lama.exp}&sig=${lama.sig}`)).status, 403);
  // Tanpa exp.
  assert.equal((await ambil(`/media/finance-receipts/${FILE}?sig=${s.sig}`)).status, 403);
});

test("POST /media/sign: finance mendapat URL bertanda-tangan yang benar-benar bisa dibuka; peran tanpa izin mendapat kosong; URL non-nota diabaikan", async () => {
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const r = await raw("POST", "/api/finance/media/sign", { token: fin.token, body: { urls: [URL_FOTO, "/media/payment-proofs/x.jpg", "https://evil.example/x.jpg"] } });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(Object.keys(r.body.signed), [URL_FOTO]);
  const { url, thumbUrl, expiresAt } = r.body.signed[URL_FOTO];
  assert.ok(new Date(expiresAt).getTime() > Date.now());
  assert.equal((await ambil(url)).status, 200);
  assert.equal((await ambil(thumbUrl)).status, 200);

  const sales = await createTestUser({ roles: ["SALES"] });
  const kosong = await raw("POST", "/api/finance/media/sign", { token: sales.token, body: { urls: [URL_FOTO] } });
  assert.equal(kosong.status, 200);
  assert.deepEqual(kosong.body.signed, {});

  assert.equal((await raw("POST", "/api/finance/media/sign", { token: fin.token, body: {} })).status, 400);
  assert.equal((await raw("POST", "/api/finance/media/sign", { body: { urls: [URL_FOTO] } })).status, 401);
  assert.equal((await raw("POST", "/api/finance/media/sign", { token: fin.token, body: { urls: Array(61).fill(URL_FOTO) } })).status, 400);
});

test("Pemegang izin ajukan-saja (SALES) hanya melihat foto pada dokumen MILIKNYA sendiri", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const sales = await createTestUser({ roles: ["SALES"] });
  const lain = await createTestUser({ roles: ["SALES"] });

  const ajukan = await raw("POST", "/api/finance/expenses", {
    token: sales.token,
    body: { date: "2026-09-19", amount: 75_000, description: "Bensin kunjungan", categoryId: kat.id, receiptUrl: URL_FOTO },
  });
  assert.equal(ajukan.status, 201, JSON.stringify(ajukan.body));

  assert.equal((await ambil(`/media/finance-receipts/${FILE}`, sales.token)).status, 200, "pengaju melihat foto ajuannya");
  assert.equal((await ambil(`/media/finance-receipts/${THUMB}`, sales.token)).status, 200, "termasuk thumbnail");
  assert.equal((await ambil(`/media/finance-receipts/${LAIN}`, sales.token)).status, 403, "foto lain tetap tertutup");
  assert.equal((await ambil(`/media/finance-receipts/${FILE}`, lain.token)).status, 403, "orang lain tidak melihat foto ajuan ini");

  const r = await raw("POST", "/api/finance/media/sign", { token: sales.token, body: { urls: [URL_FOTO, `/media/finance-receipts/${LAIN}`] } });
  assert.deepEqual(Object.keys(r.body.signed), [URL_FOTO]);
});

test("Token MOBILE: akses lewat Bearer OK; sesi dicabut → 401 pada media juga; token mobile boleh meminta URL bertanda-tangan", async () => {
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const login = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  const t = login.body.accessToken;
  assert.equal((await ambil(`/media/finance-receipts/${FILE}`, t)).status, 200);
  assert.equal((await ambil(`/api/finance/media/receipts/${FILE}`, t)).status, 200);
  const sign = await raw("POST", "/api/finance/media/sign", { token: t, body: { urls: [URL_FOTO] } });
  assert.equal(sign.status, 200, "media/sign dikecualikan dari kewajiban Idempotency-Key");
  assert.ok(sign.body.signed[URL_FOTO]);

  await raw("POST", "/api/mobile/auth/logout", { token: t, body: {} });
  assert.equal((await ambil(`/media/finance-receipts/${FILE}`, t)).status, 401);
});
