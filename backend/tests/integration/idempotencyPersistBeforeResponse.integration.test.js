// Regresi: hasil idempotensi (DONE) harus TERSIMPAN sebelum respons sampai ke klien, sehingga retry
// segera dengan kunci yang sama SELALU mendapat hasil pertama (replay), tidak pernah 409 "sedang diproses".
// Ditemukan di run integrasi penuh ke-2 (24 Sep 2026): tes void gagal 409 !== 200 secara acak.
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
test.afterEach(async () => { await truncateAll(); await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const P = "/api/finance/expense-submissions";
const body = (i) => ({ workspace: "DELIVERY", expenseType: "TOL", date: "2026-09-20", amount: 10_000 + i, sumberDana: "TALANGAN_PRIBADI" });

test("begitu respons diterima, baris kunci sudah DONE (30 percobaan berturut-turut)", async () => {
  const u = await createTestUser({ roles: ["DISPATCHER"] });
  for (let i = 0; i < 30; i++) {
    const key = `persist-${Date.now()}-${i}-abcdef`;
    const res = await raw("POST", P, { token: u.token, headers: { "Idempotency-Key": key }, body: body(i) });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const baris = await testPrisma.apiIdempotencyKey.findFirst({ where: { key, userId: u.user.id } });
    assert.equal(baris?.state, "DONE", `percobaan ${i}: status ${baris?.state}`);
    assert.equal(baris.responseStatus, 201);
  }
});

test("retry SEGERA setelah respons (tanpa jeda) selalu mendapat replay hasil pertama, bukan 409", async () => {
  const u = await createTestUser({ roles: ["DISPATCHER"] });
  for (let i = 0; i < 20; i++) {
    const h = { "Idempotency-Key": `retry-${Date.now()}-${i}-abcdef` };
    const a = await raw("POST", P, { token: u.token, headers: h, body: body(100 + i) });
    const b = await raw("POST", P, { token: u.token, headers: h, body: body(100 + i) });
    assert.equal(a.status, 201);
    assert.equal(b.status, 201, `percobaan ${i}: ${JSON.stringify(b.body)}`);
    assert.equal(b.headers.get("idempotent-replayed"), "true");
    assert.equal(b.body.id, a.body.id);
  }
  assert.equal(await testPrisma.expenseSubmission.count(), 20, "tidak ada dokumen ganda");
});

test("respons gagal (4xx) melepas kunci sebelum klien menerima respons: koreksi lalu kirim ulang dengan kunci yang sama langsung lolos", async () => {
  const u = await createTestUser({ roles: ["DISPATCHER"] });
  const key = `gagal-${Date.now()}-abcdef`;
  const buruk = await raw("POST", P, { token: u.token, headers: { "Idempotency-Key": key }, body: { ...body(1), amount: -5 } });
  assert.equal(buruk.status, 400, JSON.stringify(buruk.body));
  assert.equal(await testPrisma.apiIdempotencyKey.count({ where: { key } }), 0, "kunci dilepas");
  const ok = await raw("POST", P, { token: u.token, headers: { "Idempotency-Key": key }, body: body(2) });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
});
