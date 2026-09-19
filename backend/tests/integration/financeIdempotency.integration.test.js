// Test integrasi Idempotency-Key untuk command uang /api/finance/*.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

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

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekening.id);
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  return { rekening, kat };
}

const badan = (rekening, kat, extra = {}) => ({
  date: "2026-09-19", amount: 50_000, description: "Kertas HVS", categoryId: kat.id,
  mode: "LANGSUNG", cashAccountId: rekening.id, ...extra,
});

async function tungguDone(key, userId) {
  for (let i = 0; i < 40; i++) {
    const r = await testPrisma.apiIdempotencyKey.findUnique({ where: { userId_key: { userId, key } } });
    if (r?.state === "DONE") return r;
    await new Promise((res) => setTimeout(res, 50));
  }
  return null;
}

test("Kunci sama + isi sama: dokumen hanya SATU, respons kedua = putar ulang (Idempotent-Replayed)", async () => {
  const { rekening, kat } = await siapkan();
  const { user, token } = await createTestUser({ roles: ["FINANCE"] });
  const H = { "Idempotency-Key": "kunci-uji-0001" };

  const a = await raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat) });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  assert.equal(a.headers.get("idempotent-replayed"), null);
  await tungguDone("kunci-uji-0001", user.id);
  const jurnalSebelum = await testPrisma.finJournalEntry.count();

  const b = await raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat) });
  assert.equal(b.status, 201);
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(b.body.id, a.body.id);
  assert.equal(b.body.expenseNumber, a.body.expenseNumber);

  assert.equal(await testPrisma.finExpense.count(), 1);
  assert.equal(await testPrisma.finJournalEntry.count(), jurnalSebelum, "pengiriman ulang tidak menambah jurnal");
});

test("Kunci sama + isi BERBEDA → 422 dan tidak ada dokumen baru", async () => {
  const { rekening, kat } = await siapkan();
  const { user, token } = await createTestUser({ roles: ["FINANCE"] });
  const H = { "Idempotency-Key": "kunci-uji-0002" };
  const a = await raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat) });
  assert.equal(a.status, 201);
  await tungguDone("kunci-uji-0002", user.id);
  const b = await raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat, { amount: 999_000 }) });
  assert.equal(b.status, 422);
  assert.equal(b.body.code, "IDEMPOTENCY_KEY_REUSED");
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Dua permintaan PARALEL dengan kunci sama: hanya satu dokumen terbentuk", async () => {
  const { rekening, kat } = await siapkan();
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  const H = { "Idempotency-Key": "kunci-uji-0003" };
  const hasil = await Promise.all([1, 2, 3].map(() => raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat) })));
  const sukses = hasil.filter((h) => h.status === 201);
  assert.ok(sukses.length >= 1);
  for (const h of hasil) assert.ok([201, 409].includes(h.status), `status tak terduga ${h.status}`);
  assert.equal(await testPrisma.finExpense.count(), 1, JSON.stringify(hasil.map((h) => h.status)));
});

test("Respons gagal (mis. validasi 400) TIDAK mengunci kunci: koreksi lalu kirim ulang dengan kunci yang sama lolos", async () => {
  const { rekening, kat } = await siapkan();
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  const H = { "Idempotency-Key": "kunci-uji-0004" };
  const gagal = await raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat, { description: "" }) });
  assert.equal(gagal.status, 400);
  await new Promise((r) => setTimeout(r, 150));
  const ok = await raw("POST", "/api/finance/expenses", { token, headers: H, body: badan(rekening, kat) });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});

test("Tanpa header: perilaku web lama persis (opsional) — dua kiriman = dua dokumen", async () => {
  const { rekening, kat } = await siapkan();
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  assert.equal((await raw("POST", "/api/finance/expenses", { token, body: badan(rekening, kat) })).status, 201);
  assert.equal((await raw("POST", "/api/finance/expenses", { token, body: badan(rekening, kat) })).status, 201);
  assert.equal(await testPrisma.finExpense.count(), 2);
});

test("Format kunci tidak valid → 400", async () => {
  const { rekening, kat } = await siapkan();
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  const r = await raw("POST", "/api/finance/expenses", { token, headers: { "Idempotency-Key": "pendek" }, body: badan(rekening, kat) });
  assert.equal(r.status, 400);
  assert.equal(r.body.code, "IDEMPOTENCY_KEY_INVALID");
  assert.equal(await testPrisma.finExpense.count(), 0);
});

test("Kunci dilingkupi per pengguna: pengguna lain boleh memakai string kunci yang sama", async () => {
  const { rekening, kat } = await siapkan();
  const u1 = await createTestUser({ roles: ["FINANCE"] });
  const u2 = await createTestUser({ roles: ["FINANCE"] });
  const H = { "Idempotency-Key": "kunci-uji-0005" };
  assert.equal((await raw("POST", "/api/finance/expenses", { token: u1.token, headers: H, body: badan(rekening, kat) })).status, 201);
  assert.equal((await raw("POST", "/api/finance/expenses", { token: u2.token, headers: H, body: badan(rekening, kat) })).status, 201);
  assert.equal(await testPrisma.finExpense.count(), 2);
});

test("Token MOBILE: header WAJIB pada command uang (428); GET tidak butuh; dengan header lolos & idempoten", async () => {
  const { rekening, kat } = await siapkan();
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const login = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  const t = login.body.accessToken;

  assert.equal((await raw("GET", "/api/finance/cash-accounts", { token: t })).status, 200);

  const tanpa = await raw("POST", "/api/finance/expenses", { token: t, body: badan(rekening, kat) });
  assert.equal(tanpa.status, 428);
  assert.equal(tanpa.body.code, "IDEMPOTENCY_KEY_REQUIRED");
  assert.equal(await testPrisma.finExpense.count(), 0);

  const H = { "Idempotency-Key": "mobile-kunci-0001" };
  const a = await raw("POST", "/api/finance/expenses", { token: t, headers: H, body: badan(rekening, kat) });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  await tungguDone("mobile-kunci-0001", u.user.id);
  const b = await raw("POST", "/api/finance/expenses", { token: t, headers: H, body: badan(rekening, kat) });
  assert.equal(b.headers.get("idempotent-replayed"), "true");
  assert.equal(await testPrisma.finExpense.count(), 1);
});

test("Berlaku untuk router lain: kasbon & transfer (mobile); approve tidak dieksekusi dua kali", async () => {
  const { rekening, kat } = await siapkan();
  const u = await createLoginUser({ roles: ["FINANCE"] });
  const login = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  const t = login.body.accessToken;

  const kasbon = { date: "2026-09-19", amount: 500_000, employeeName: "budi", urgency: "Biaya berobat", cashAccountId: rekening.id };
  assert.equal((await raw("POST", "/api/finance/kasbon", { token: t, body: kasbon })).status, 428);
  const H = { "Idempotency-Key": "mobile-kasbon-001" };
  const k1 = await raw("POST", "/api/finance/kasbon", { token: t, headers: H, body: kasbon });
  assert.equal(k1.status, 201, JSON.stringify(k1.body));
  await tungguDone("mobile-kasbon-001", u.user.id);
  const k2 = await raw("POST", "/api/finance/kasbon", { token: t, headers: H, body: kasbon });
  assert.equal(k2.headers.get("idempotent-replayed"), "true");
  assert.equal(await testPrisma.finKasbon.count(), 1);

  // Pengeluaran besar → MENUNGGU_APPROVAL; approve oleh admin lain dengan kunci yang sama diputar ulang.
  await setSetting(testPrisma, SETTING_KEYS.EXPENSE_APPROVAL_THRESHOLD, "1000");
  const ex = await raw("POST", "/api/finance/expenses", { token: t, headers: { "Idempotency-Key": "mobile-exp-000001" }, body: badan(rekening, kat, { amount: 2_000_000 }) });
  assert.equal(ex.status, 201, JSON.stringify(ex.body));
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const HA = { "Idempotency-Key": "admin-approve-001" };
  const ap1 = await raw("POST", `/api/finance/expenses/${ex.body.id}/approve`, { token: admin.token, headers: HA, body: {} });
  assert.ok([200, 422].includes(ap1.status), JSON.stringify(ap1.body));
  await tungguDone("admin-approve-001", admin.user.id);
  if (ap1.status === 200) {
    const ap2 = await raw("POST", `/api/finance/expenses/${ex.body.id}/approve`, { token: admin.token, headers: HA, body: {} });
    assert.equal(ap2.status, 200, "tanpa idempotency ini akan 409 (sudah disetujui)");
    assert.equal(ap2.headers.get("idempotent-replayed"), "true");
    assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "PENGELUARAN" } }), 1);
  }
});
