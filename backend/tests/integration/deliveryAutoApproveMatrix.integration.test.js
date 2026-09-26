// Matriks kebijakan auto-approve (BBM/tol/parkir <= Rp300.000) pada pengajuan Delivery:
// role x kategori x nominal. Akun own-only (Driver/Helper/Leader Driver) TIDAK pernah auto-approve;
// aktor/role lama tetap seperti sebelumnya. Aktor diturunkan server-side dari izin (bukan dari body).
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
let n = 0;
const K = (p = "aa") => ({ "Idempotency-Key": `${p}-${Date.now()}-${++n}-abcdef` });
const OWN_ONLY = ["DRIVER", "HELPER", "LEADER_DRIVER"];
const LAMA = ["DISPATCHER", "ADMIN", "OWNER", "FINANCE", "SALES"];
const KATEGORI = ["BBM", "TOL", "PARKIR", "SERVIS"];
const NOMINAL = [250_000, 300_000, 300_001];
const OTOMATIS_KATEGORI = ["BBM", "TOL", "PARKIR"];

async function ajukan(user, expenseType, amount, extra = {}) {
  const c = await raw("POST", P, {
    token: user.token, headers: K("c"),
    body: { workspace: "DELIVERY", expenseType, date: "2026-09-20", amount, vendorName: "Uji", sumberDana: "TALANGAN_PRIBADI", metadata: { liters: 10, odometerKm: 1000 }, ...extra },
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  // nota terlampir (reimbursement wajib nota agar jalur otomatis bisa terjadi) — bypass multipart
  await testPrisma.expenseSubmissionProof.create({ data: { submissionId: c.body.id, url: "https://example.test/nota.jpg", version: 1 } });
  return raw("POST", `${P}/${c.body.id}/ajukan`, { token: user.token, headers: K("aj") });
}

test("MATRIKS role x kategori x nominal: own-only selalu MENUNGGU_PERSETUJUAN; aktor lama otomatis hanya BBM/tol/parkir <= 300.000", async () => {
  const pengguna = {};
  for (const r of [...OWN_ONLY, ...LAMA]) pengguna[r] = await createTestUser({ roles: [r] });
  const salah = [];
  let diperiksa = 0;
  for (const role of [...OWN_ONLY, ...LAMA]) {
    for (const kat of KATEGORI) {
      for (const nominal of NOMINAL) {
        const res = await ajukan(pengguna[role], kat, nominal);
        const harusOtomatis = LAMA.includes(role) && OTOMATIS_KATEGORI.includes(kat) && nominal <= 300_000;
        const harapan = harusOtomatis ? "OTOMATIS_DISETUJUI" : "MENUNGGU_PERSETUJUAN";
        diperiksa += 1;
        if (res.status !== 200 || res.body.status !== harapan) salah.push(`${role}/${kat}/${nominal}: status ${res.status} ${res.body?.status ?? JSON.stringify(res.body)} (harapan ${harapan})`);
      }
    }
  }
  assert.equal(diperiksa, [...OWN_ONLY, ...LAMA].length * KATEGORI.length * NOMINAL.length, "seluruh sel matriks diperiksa (8 role x 4 kategori x 3 nominal = 96)");
  assert.deepEqual(salah, [], salah.join("\n"));
});

test("pengajuan mandiri yang memenuhi aturan otomatis tetap tercatat jelas di audit dan FinExpense-nya MENUNGGU_APPROVAL (tanpa persetujuan otomatis)", async () => {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const res = await ajukan(driver, "BBM", 100_000);
  assert.equal(res.body.status, "MENUNGGU_PERSETUJUAN");
  assert.equal(res.body.finExpense.status, "MENUNGGU_APPROVAL");
  const fe = await testPrisma.finExpense.findUnique({ where: { id: res.body.finExpenseId } });
  assert.equal(fe.approvedById, null);
  assert.equal(fe.approvedAt, null);
  const audit = await testPrisma.expenseSubmissionAudit.findMany({ where: { submissionId: res.body.id } });
  assert.ok(audit.some((a) => a.after === "MENUNGGU_PERSETUJUAN" && /auto-approve tidak berlaku/.test(a.reason || "")), "audit menjelaskan");
  assert.ok(!audit.some((a) => a.after === "OTOMATIS_DISETUJUI"));
});

test("sumber/aktor tidak bisa dipilih klien: field 'source', 'autoApprove', 'requestedById' di body diabaikan/ditolak", async () => {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const c = await raw("POST", P, {
    token: driver.token, headers: K("c"),
    body: { workspace: "DELIVERY", expenseType: "TOL", date: "2026-09-20", amount: 50_000, sumberDana: "TALANGAN_PRIBADI", source: "DISPATCHER", autoApprove: true, mode: "LANGSUNG" },
  });
  assert.equal(c.status, 201, JSON.stringify(c.body));
  await testPrisma.expenseSubmissionProof.create({ data: { submissionId: c.body.id, url: "https://example.test/nota.jpg", version: 1 } });
  const aj = await raw("POST", `${P}/${c.body.id}/ajukan`, { token: driver.token, headers: { ...K("aj"), "X-Actor-Role": "DISPATCHER" }, body: { autoApprove: true, source: "DISPATCHER" } });
  assert.equal(aj.status, 200, JSON.stringify(aj.body));
  assert.equal(aj.body.status, "MENUNGGU_PERSETUJUAN");
  const atasNama = await raw("POST", P, { token: driver.token, headers: K("c"), body: { workspace: "DELIVERY", expenseType: "TOL", date: "2026-09-20", amount: 1000, requestedById: "orang-lain" } });
  assert.equal(atasNama.status, 403);
});

test("workspace: own-only tidak bisa memakai workspace lain; aktor lama di workspace tanpa kebijakan tidak auto-approve", async () => {
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const lain = await raw("POST", P, { token: driver.token, headers: K("c"), body: { workspace: "PRODUKSI", expenseType: "BBM", date: "2026-09-20", amount: 1000 } });
  assert.equal(lain.status, 403);
  const dispatcher = await createTestUser({ roles: ["DISPATCHER"] });
  // C1: workspace PRODUKSI kini khusus PRODUCTION_LEAD/Finance — Dispatcher (jalur Delivery) tidak lagi boleh membukanya.
  assert.equal((await raw("GET", `${P}/config?workspace=PRODUKSI`, { token: dispatcher.token })).status, 403);
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const cfg = await raw("GET", `${P}/config?workspace=PRODUKSI`, { token: finance.token });
  assert.equal(cfg.status, 200);
  assert.equal(cfg.body.autoApprove, null, "PRODUKSI tidak punya kebijakan auto-approve");
});
