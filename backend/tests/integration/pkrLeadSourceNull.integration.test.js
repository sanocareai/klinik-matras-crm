// KETERSEDIAAN CUSTOMER ber-leadSource NULL setelah ada sumber PENJUALAN_KARYAWAN, terhadap PostgreSQL sungguhan.
// Pelajaran nyata: filter Prisma `leadSource: { not: "X" }` ikut MEMBUANG baris NULL (semantik SQL), sehingga papan pipeline dan statistik MCP kehilangan
// pelanggan tanpa sumber. Dikunci: NULL tetap tampil; PENJUALAN_KARYAWAN (pembeli aktual PKR) dan profil karyawan tidak masuk papan/pelanggan baru.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { registerReadOnlyTools } from "../../src/mcp/tools.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function seedCustomer() {
  const mk = (name, extra) => testPrisma.customer.create({ data: { name, phone: `62812${Math.floor(Math.random() * 1e8)}`, pipelineStage: "NEW", ...extra } });
  const staff = await testPrisma.user.create({ data: { name: "Karyawan Uji", email: `k-${Date.now()}@example.test`, passwordHash: "x", role: "PRODUCTION_WORKER" } });
  return {
    tanpaSumber: await mk("Pelanggan Tanpa Sumber", { leadSource: null }),
    organik: await mk("Pelanggan Organik", { leadSource: "WHATSAPP_DIRECT" }),
    pembeliPkr: await mk("Pembeli PKR Aktual", { leadSource: "PENJUALAN_KARYAWAN" }),
    profilStaf: await mk("Profil Karyawan", { leadSource: null, staffUserId: staff.id }),
  };
}

test("papan pipeline: customer tanpa sumber (NULL) tetap tampil; pembeli PKR dan profil karyawan tidak", async () => {
  const c = await seedCustomer();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const api = makeClient(server.baseUrl, token);
  const res = await api.get("/api/pipeline/board");
  assert.equal(res.status, 200);
  const semua = Object.values(res.body).flat().map((x) => x.id);
  assert.ok(semua.includes(c.tanpaSumber.id), "leadSource NULL harus tetap di papan");
  assert.ok(semua.includes(c.organik.id));
  assert.ok(!semua.includes(c.pembeliPkr.id), "pembeli PKR aktual bukan lead Sales");
  assert.ok(!semua.includes(c.profilStaf.id), "profil karyawan bukan lead Sales");
});

test("MCP ringkasan_penjualan: pelangganBaru menghitung NULL, tidak menghitung pembeli PKR/profil karyawan", async () => {
  await seedCustomer();
  const tools = new Map();
  registerReadOnlyTools({ registerTool: (nama, _meta, fn) => tools.set(nama, fn) });
  const fn = tools.get("ringkasan_penjualan");
  assert.equal(typeof fn, "function");
  const hari = new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);
  const r = await fn({ dari: hari, sampai: hari });
  const data = r.structuredContent ?? JSON.parse(r.content[0].text);
  assert.equal(data.pelangganBaru, 2, "tanpa sumber + organik; PKR aktual dan profil karyawan dikecualikan");
});
