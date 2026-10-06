// Payment menunggu verifikasi dari BULAN LALU harus tetap tampil di antrean "Perlu Verifikasi" (layar & export), bukan hilang saat bulan berganti.
// Kasus nyata: RES-21092026-130, Payment 30 Sep 19:00 belum diverifikasi → tak terlihat di tampilan default Oktober.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const fin = await createTestUser({ roles: ["FINANCE"] });
  const sales = (await createTestUser({ roles: ["SALES"] })).user;
  const cust = await testPrisma.customer.create({ data: { name: "Sara Uji", assignedSalesId: sales.id } });
  const order = await testPrisma.order.create({ data: { customerId: cust.id, value: 3_726_000, category: "LAYANAN", orderNumber: "RES-UJI-130", status: "DELIVERED", paymentStatus: "LUNAS", paidAt: new Date() } });
  // Payment menunggu BULAN LALU (30 Sep 19:00 WIB = 12:00 UTC) dan satu bulan ini
  const lama = await testPrisma.payment.create({ data: { orderId: order.id, amount: 3_726_000, method: "CARD", recordedById: sales.id, createdAt: new Date("2026-09-30T12:00:00Z") } });
  const baru = await testPrisma.payment.create({ data: { orderId: order.id, amount: 100_000, method: "TRANSFER", recordedById: sales.id, createdAt: new Date("2026-10-03T03:00:00Z") } });
  return { c: makeClient(server.baseUrl, fin.token), token: fin.token, lama, baru };
}

test("Layar: periode Oktober saja TIDAK memuat Payment 30 Sep (perilaku periode tetap); rentang lebar (tab Perlu Verifikasi) memuatnya", async () => {
  const w = await dunia();
  const okt = await w.c.get("/api/finance/customer-payments?from=2026-10-01&to=2026-10-31&status=belum_verifikasi");
  assert.equal(okt.status, 200);
  assert.deepEqual(okt.body.payments.map((p) => p.id), [w.baru.id], "periode Oktober: hanya yang Oktober");
  const semua = await w.c.get("/api/finance/customer-payments?from=2000-01-01&to=2100-01-01&status=belum_verifikasi");
  assert.deepEqual(semua.body.payments.map((p) => p.id).sort(), [w.lama.id, w.baru.id].sort(), "antrean memuat Payment bulan lalu");
});

test("Export tab Perlu Verifikasi: server memuat Payment menunggu SEMUA periode walau klien mengirim periode Oktober; label periode jujur", async () => {
  const w = await dunia();
  const r = await unduhExport(server.baseUrl, w.token, "pembayaran", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { status: "belum_verifikasi", sertakanKlaim: true } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = bacaSheet(r.wb, "Payment Menunggu");
  assert.equal(s.baris.length, 2, "Payment 30 Sep ikut");
  const kepala = r.wb.worksheets.flatMap((ws) => [1, 2, 3, 4].map((i) => String(ws.getRow(i).getCell(1).value ?? ""))).join(" | ");
  assert.match(kepala, /Semua periode/);
});

test("Export tab selain Perlu Verifikasi (Terverifikasi) tetap terikat periode", async () => {
  const w = await dunia();
  const r = await unduhExport(server.baseUrl, w.token, "pembayaran", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { status: "belum_verifikasi" } });
  assert.equal(r.status, 200, JSON.stringify(r.json));
  const s = bacaSheet(r.wb, r.wb.worksheets[0].name);
  assert.equal(s.baris.length, 1, "tanpa sertakanKlaim: tetap per periode (hanya Oktober)");
});
