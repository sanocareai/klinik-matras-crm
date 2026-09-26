// Delivery Control — status bukti Finance di detail pengajuan (untuk tombol Verifikasi) tanpa membocorkan path berkas.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
let raw;
test.before(async () => {
  await truncateAll();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  server = await startTestServer(buildTestApp());
  raw = makeRaw(server.baseUrl);
});
test.beforeEach(() => resetRateLimits());
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const P = "/api/finance/expense-submissions";

test("detail pengajuan: finExpense membawa adaBukti/receiptVerifiedAt/createdById, TANPA receiptUrl", async () => {
  const u = await createTestUser({ roles: ["DISPATCHER"] });
  const buat = await raw("POST", P, { token: u.token, headers: { "Idempotency-Key": `dc-fa-${Date.now()}-abcdef` }, body: { workspace: "DELIVERY", expenseType: "SERVIS", date: "2026-09-26", amount: 450000, sumberDana: "TALANGAN_PRIBADI" } });
  assert.equal(buat.status, 201, JSON.stringify(buat.body));
  const aj = await raw("POST", `${P}/${buat.body.id}/ajukan`, { token: u.token, headers: { "Idempotency-Key": `dc-fa-aj-${Date.now()}-abcdef` }, body: {} });
  assert.equal(aj.status, 200, JSON.stringify(aj.body));

  const d = await raw("GET", `${P}/${buat.body.id}`, { token: u.token });
  assert.equal(d.status, 200);
  const fe = d.body.finExpense;
  assert.ok(fe, "finExpense ada setelah diajukan");
  assert.equal(fe.adaBukti, false);
  assert.equal(fe.receiptVerifiedAt, null);
  assert.equal(fe.createdById !== undefined, true);
  assert.equal("receiptUrl" in fe, false, "path bukti tidak dikirim");

  const l = await raw("GET", `${P}?division=DELIVERY&limit=5`, { token: u.token });
  assert.equal(l.status, 200);
  for (const r of l.body.submissions) if (r.finExpense) assert.equal("receiptUrl" in r.finExpense, false);
});
