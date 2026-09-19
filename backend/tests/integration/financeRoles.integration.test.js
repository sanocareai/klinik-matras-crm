// Test integrasi RBAC Finance: FINANCE vs OWNER vs ACCOUNTANT vs APPROVER pada endpoint NYATA.
// Pelajaran CLAUDE.md §19: uji dengan akun peran sungguhan, bukan admin.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
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

async function masuk(roles) {
  const u = await createLoginUser({ roles });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: u.email, password: u.password, device: DEVICE() } });
  assert.equal(r.status, 200, `${roles} → ${JSON.stringify(r.body)}`);
  return { ...u, token: r.body.accessToken, caps: r.body.capabilities };
}

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekening.id);
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  return { rekening, kat };
}

test("Login mobile + capabilities untuk keempat peran keuangan (dan preset tata letak)", async () => {
  const kasus = {
    FINANCE: { financeRead: true, financePost: true, financeApprove: true, financeAdmin: false, paymentWrite: true, preset: "FINANCE" },
    OWNER: { financeRead: true, financePost: true, financeApprove: true, financeAdmin: true, paymentWrite: false, preset: "OWNER" },
    ACCOUNTANT: { financeRead: true, financePost: true, financeApprove: false, financeAdmin: false, paymentRead: true, paymentWrite: false, preset: "ACCOUNTANT" },
    APPROVER: { financeRead: true, financePost: false, financeApprove: true, financeAdmin: false, paymentRead: true, paymentWrite: false, preset: "APPROVER" },
  };
  for (const [role, ekspektasi] of Object.entries(kasus)) {
    const u = await masuk([role]);
    for (const [k, v] of Object.entries(ekspektasi)) assert.equal(u.caps[k], v, `${role}.${k}`);
    assert.equal(u.caps.financeApp, true);
    const me = await raw("GET", "/api/auth/me", { token: u.token });
    assert.deepEqual(me.body.capabilities, u.caps);
  }
});

test("Role lama tetap kompatibel: SALES ditolak masuk app Finance; ADMIN memakai preset OWNER; login web tidak berubah", async () => {
  const sales = await createLoginUser({ roles: ["SALES"] });
  const r = await raw("POST", "/api/mobile/auth/login", { body: { email: sales.email, password: sales.password, device: DEVICE() } });
  assert.equal(r.status, 403);
  assert.equal(r.body.code, "NOT_FINANCE_TEAM");

  const adm = await masuk(["ADMIN"]);
  assert.equal(adm.caps.preset, "OWNER");
  assert.equal(adm.caps.paymentWrite, false);

  const web = await createLoginUser({ roles: ["ACCOUNTANT"] });
  const login = await raw("POST", "/api/auth/login", { body: { email: web.email, password: web.password } });
  assert.equal(login.status, 200);
  assert.equal(login.body.user.capabilities.preset, "ACCOUNTANT");
  assert.ok(login.body.user.portals.some((p) => p.key === "finance"), "portal Finance terbuka untuk ACCOUNTANT");
});

test("Endpoint nyata: baca boleh untuk semua peran keuangan; mencatat hanya yang punya FINANCE_POST", async () => {
  const { rekening, kat } = await siapkan();
  const badan = { date: "2026-09-20", amount: 50_000, description: "Kertas", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: rekening.id };
  const hasil = {};
  for (const role of ["FINANCE", "OWNER", "ACCOUNTANT", "APPROVER"]) {
    const u = await masuk([role]);
    const baca = await raw("GET", "/api/finance/dashboard", { token: u.token });
    const catat = await raw("POST", "/api/finance/expenses", { token: u.token, headers: { "Idempotency-Key": `catat-${role}-0001` }, body: badan });
    hasil[role] = { baca: baca.status, catat: catat.status };
  }
  assert.deepEqual(hasil.FINANCE, { baca: 200, catat: 201 });
  assert.deepEqual(hasil.OWNER, { baca: 200, catat: 201 });
  assert.deepEqual(hasil.ACCOUNTANT, { baca: 200, catat: 201 });
  assert.deepEqual(hasil.APPROVER, { baca: 200, catat: 403 }, "APPROVER tidak boleh mencatat");
});

test("Approve: ACCOUNTANT ditolak 403 (tanpa izin); APPROVER lolos gerbang izin", async () => {
  const { rekening, kat } = await siapkan();
  await setSetting(testPrisma, SETTING_KEYS.EXPENSE_APPROVAL_THRESHOLD, "1000");
  const akuntan = await masuk(["ACCOUNTANT"]);
  const a = await raw("POST", "/api/finance/expenses", {
    token: akuntan.token, headers: { "Idempotency-Key": "ajuan-akuntan-0001" },
    body: { date: "2026-09-20", amount: 2_000_000, description: "Pengajuan", categoryId: kat.id, mode: "LANGSUNG", cashAccountId: rekening.id },
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));

  const tolakAkuntan = await raw("POST", `/api/finance/expenses/${a.body.id}/approve`, { token: akuntan.token, headers: { "Idempotency-Key": "akuntan-setuju-01" }, body: {} });
  assert.equal(tolakAkuntan.status, 403);

  const approver = await masuk(["APPROVER"]);
  const ok = await raw("POST", `/api/finance/expenses/${a.body.id}/approve`, { token: approver.token, headers: { "Idempotency-Key": "approver-setuju-01" }, body: {} });
  assert.notEqual(ok.status, 403, JSON.stringify(ok.body)); // 422 (aturan nota) boleh; yang diuji: izin
});

test("Verifikasi pembayaran (PAYMENT_WRITE) KHUSUS FINANCE: OWNER/ACCOUNTANT/APPROVER/ADMIN semuanya 403", async () => {
  const status = {};
  for (const role of ["FINANCE", "OWNER", "ACCOUNTANT", "APPROVER", "ADMIN"]) {
    const u = await masuk([role]);
    const r = await raw("POST", "/api/finance/penerimaan/verifikasi", {
      token: u.token, headers: { "Idempotency-Key": `verif-${role}-0001` }, body: { orderId: "tidak-ada", mode: "REKENING" },
    });
    status[role] = r.status;
  }
  assert.notEqual(status.FINANCE, 403, "FINANCE lolos gerbang izin (gagal karena data, bukan 403)");
  for (const role of ["OWNER", "ACCOUNTANT", "APPROVER", "ADMIN"]) assert.equal(status[role], 403, role);

  const owner = await masuk(["OWNER"]);
  const lama = await raw("POST", "/api/armada/payments/x/verify", { token: owner.token, body: {} });
  assert.ok([403, 404].includes(lama.status));
});

test("Tutup periode (FINANCE_ADMIN): hanya OWNER/ADMIN; ACCOUNTANT, APPROVER, FINANCE 403", async () => {
  const hasil = {};
  for (const role of ["OWNER", "ACCOUNTANT", "APPROVER", "FINANCE"]) {
    const u = await masuk([role]);
    const r = await raw("POST", "/api/finance/periods/close", { token: u.token, headers: { "Idempotency-Key": `tutup-${role}-0001` }, body: { year: 2020, month: 1 } });
    hasil[role] = r.status;
  }
  assert.notEqual(hasil.OWNER, 403);
  for (const role of ["ACCOUNTANT", "APPROVER", "FINANCE"]) assert.equal(hasil[role], 403, role);
});

test("Multi-peran menjumlahkan izin: FINANCE + APPROVER tidak mengurangi apa pun", async () => {
  const u = await masuk(["FINANCE", "APPROVER"]);
  assert.equal(u.caps.paymentWrite, true);
  assert.equal(u.caps.financeApprove, true);
  assert.equal(u.caps.preset, "FINANCE");
});
