// /api/analytics/overview — KPI "New Leads" Dashboard TERMASUK SPAM (keputusan user 10 Nov 2026), field aditif.
// Kontrak: newLeadsTermasukSpam = semua customer baru di periode kecuali B2B_DIRECT/PENJUALAN_KARYAWAN (sama dengan "Total lead (+spam)" Marketing);
// newCustomers/totalCustomers (dan Conversion) TETAP tanpa spam; newLeadsSpam = selisihnya; growth dari periode sebelumnya dengan aturan sama.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const wib = (d) => new Date(d.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
let seq = 0;
const pelanggan = (data) => { seq += 1; return testPrisma.customer.create({ data: { phone: `6281377${String(seq).padStart(6, "0")}`, name: `Uji ${seq}`, ...data } }); };

async function admin() {
  const u = await createLoginUser({ roles: ["ADMIN"] });
  const r = await raw("POST", "/api/auth/login", { body: { email: u.email, password: u.password } });
  assert.equal(r.status, 200);
  return { ...u, token: r.body.token };   // makeRaw menerima objek login (sama dengan tes integrasi lain)
}

test("New Leads termasuk spam; tanpa B2B/penjualan karyawan; field lama & Conversion tetap tanpa spam; growth dari periode sebelumnya", async () => {
  const token = await admin();
  const hariIni = new Date(); const kemarin = new Date(Date.now() - 86_400_000);
  // Periode ini (hari ini): 3 lead biasa (1 sudah order), 2 spam, 1 B2B, 1 penjualan karyawan
  const a = await pelanggan({ pipelineStage: "TRANSACTION", leadSource: "META_ADS", createdAt: hariIni });
  await pelanggan({ pipelineStage: "NEW", leadSource: "INSTAGRAM", createdAt: hariIni });
  await pelanggan({ pipelineStage: "PROSPECT", leadSource: "WHATSAPP_DIRECT", createdAt: hariIni });
  await pelanggan({ pipelineStage: "SPAM", leadSource: "META_ADS", createdAt: hariIni });
  await pelanggan({ pipelineStage: "SPAM", leadSource: "INSTAGRAM", createdAt: hariIni });
  await pelanggan({ pipelineStage: "TRANSACTION", leadSource: "B2B_DIRECT", createdAt: hariIni });
  await pelanggan({ pipelineStage: "TRANSACTION", leadSource: "PENJUALAN_KARYAWAN", createdAt: hariIni });
  await testPrisma.order.create({ data: { customerId: a.id, value: 1_000_000, category: "LAYANAN", status: "PROCESSING", orderNumber: "RES-NL-0001" } });
  // Periode sebelumnya (kemarin): 1 lead biasa + 1 spam
  await pelanggan({ pipelineStage: "NEW", leadSource: "META_ADS", createdAt: kemarin });
  await pelanggan({ pipelineStage: "SPAM", leadSource: "META_ADS", createdAt: kemarin });

  const h = wib(hariIni);
  const r = await raw("GET", `/api/analytics/overview?from=${h}&to=${h}`, token);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const ov = r.body;
  assert.equal(ov.newLeadsTermasukSpam, 5, "3 lead + 2 spam; B2B & penjualan karyawan tidak dihitung");
  assert.equal(ov.newLeadsSpam, 2);
  assert.equal(ov.newCustomers, 3, "field lama tetap tanpa spam");
  assert.equal(ov.totalCustomers, 3);
  assert.equal(ov.customersWithOrders, 1);
  assert.equal(ov.growthNewLeadsTermasukSpam, 150, "5 vs 2 (kemarin: 1 lead + 1 spam) = +150%");
  assert.equal(ov.growthCustomers, 200, "field lama: 3 vs 1 = +200% (tidak berubah)");
});
