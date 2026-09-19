// Test integrasi KEBIJAKAN BUKTI/NOTA (services/finance/receipts.js) —
// wajib nota sebelum disetujui, verifikasi HARUS orang lain, dan antrean
// tinjau. Yang dikunci: pembuat transaksi tidak bisa memverifikasi buktinya
// sendiri (inti kontrol saat yang menginput semua transaksi adalah finance).

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

const NOTA = "/media/finance-receipts/abc.jpg";

let server;
test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
});
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekening.id);
  const katBensin = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const katBahan = await testPrisma.finPurchaseCategory.findUnique({ where: { code: "BAHAN_BAKU_MANUAL" } });
  const katGaji = await testPrisma.finExpenseCategory.findUnique({ where: { code: "GAJI_KARYAWAN" } });
  return { rekening, katBensin, katBahan, katGaji };
}

test("Pembelian tanpa nota: approve ditolak 422; setelah nota dipasang, approve lolos", async () => {
  const { rekening, katBahan } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);

  const p = await client.post("/api/finance/purchases", {
    date: "2026-09-19", amount: 100_000, description: "Paku", categoryId: katBahan.id,
    mode: "LANGSUNG", cashAccountId: rekening.id,
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));

  const gagal = await client.post(`/api/finance/purchases/${p.body.id}/approve`, {});
  assert.equal(gagal.status, 422, JSON.stringify(gagal.body));
  assert.match(gagal.body.error, /nota/i);

  const pasang = await client.post(`/api/finance/purchases/${p.body.id}/bukti`, { receiptUrl: NOTA });
  assert.equal(pasang.status, 200, JSON.stringify(pasang.body));

  const ok = await client.post(`/api/finance/purchases/${p.body.id}/approve`, {});
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
});

test("Pengeluaran: kecil & non-reimbursement boleh tanpa nota; reimbursement, di atas ambang, dan kategori gaji sesuai aturan", async () => {
  const { rekening, katBensin, katGaji } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const buat = (extra) => client.post("/api/finance/expenses", {
    date: "2026-09-19", description: "Tes", categoryId: katBensin.id, cashAccountId: rekening.id, ...extra,
  });

  const kecil = await buat({ amount: 100_000, mode: "LANGSUNG" });
  assert.equal((await client.post(`/api/finance/expenses/${kecil.body.id}/approve`, {})).status, 200, "Rp100rb langsung: opsional");

  const besar = await buat({ amount: 600_000, mode: "LANGSUNG" });
  assert.equal((await client.post(`/api/finance/expenses/${besar.body.id}/approve`, {})).status, 422, "di atas ambang: wajib");

  const reimb = await buat({ amount: 50_000, mode: "REIMBURSEMENT" });
  assert.equal((await client.post(`/api/finance/expenses/${reimb.body.id}/approve`, {})).status, 422, "reimbursement selalu wajib");

  const gaji = await buat({ amount: 5_000_000, mode: "LANGSUNG", categoryId: katGaji.id });
  assert.equal((await client.post(`/api/finance/expenses/${gaji.body.id}/approve`, {})).status, 200, "gaji dikecualikan");
});

test("Verifikasi bukti: pembuat DILARANG memverifikasi sendiri; admin lain boleh; ganti foto mereset verifikasi", async () => {
  const { rekening, katBahan } = await siapkan();
  const natasha = await createTestUser({ roles: ["ADMIN"] });
  const owner = await createTestUser({ roles: ["ADMIN"] });
  const cNat = makeClient(server.baseUrl, natasha.token);
  const cOwner = makeClient(server.baseUrl, owner.token);

  const p = await cNat.post("/api/finance/purchases", {
    receiptUrl: NOTA, date: "2026-09-19", amount: 250_000, description: "Kain", categoryId: katBahan.id,
    mode: "LANGSUNG", cashAccountId: rekening.id,
  });
  assert.equal(p.status, 201, JSON.stringify(p.body));

  const sendiri = await cNat.post(`/api/finance/purchases/${p.body.id}/verifikasi-bukti`, {});
  assert.equal(sendiri.status, 403, JSON.stringify(sendiri.body));

  const lain = await cOwner.post(`/api/finance/purchases/${p.body.id}/verifikasi-bukti`, {});
  assert.equal(lain.status, 200, JSON.stringify(lain.body));
  let row = await testPrisma.finPurchase.findUnique({ where: { id: p.body.id } });
  assert.equal(row.receiptVerifiedById, owner.user.id);

  await cNat.post(`/api/finance/purchases/${p.body.id}/bukti`, { receiptUrl: "/media/finance-receipts/baru.jpg" });
  row = await testPrisma.finPurchase.findUnique({ where: { id: p.body.id } });
  assert.equal(row.receiptVerifiedAt, null, "foto diganti = verifikasi lama gugur");
});

test("Bukti wajib berupa URL hasil upload; foto yang sama di dua dokumen memunculkan peringatan dipakaiDi", async () => {
  const { rekening, katBahan } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const buat = () => client.post("/api/finance/purchases", {
    date: "2026-09-19", amount: 100_000, description: "X", categoryId: katBahan.id, mode: "LANGSUNG", cashAccountId: rekening.id,
  });
  const a = await buat();
  const b = await buat();

  const liar = await client.post(`/api/finance/purchases/${a.body.id}/bukti`, { receiptUrl: "https://evil.example/x.jpg" });
  assert.equal(liar.status, 400);

  const pertama = await client.post(`/api/finance/purchases/${a.body.id}/bukti`, { receiptUrl: NOTA });
  assert.deepEqual(pertama.body.dipakaiDi, []);
  const kedua = await client.post(`/api/finance/purchases/${b.body.id}/bukti`, { receiptUrl: NOTA });
  assert.equal(kedua.body.dipakaiDi.length, 1, "foto yang sama sudah dipakai dokumen lain");
});

test("Antrean tinjau: memuat yang belum diverifikasi & yang wajib nota tapi kosong; yang sudah diverifikasi keluar", async () => {
  const { rekening, katBahan } = await siapkan();
  const natasha = await createTestUser({ roles: ["ADMIN"] });
  const owner = await createTestUser({ roles: ["ADMIN"] });
  const cNat = makeClient(server.baseUrl, natasha.token);
  const cOwner = makeClient(server.baseUrl, owner.token);
  await setSetting(testPrisma, SETTING_KEYS.RECEIPT_POLICY_SINCE, "2020-01-01");

  const base = { date: "2026-09-19", amount: 100_000, categoryId: katBahan.id, mode: "LANGSUNG", cashAccountId: rekening.id };
  const dgnNota = await cNat.post("/api/finance/purchases", { ...base, description: "Ada nota", receiptUrl: NOTA });
  await cNat.post("/api/finance/purchases", { ...base, description: "Tanpa nota" });

  let q = await cOwner.get("/api/finance/bukti-review");
  assert.equal(q.status, 200, JSON.stringify(q.body));
  assert.equal(q.body.belumDiverifikasi, 1);
  assert.equal(q.body.tanpaNota, 1);

  await cOwner.post(`/api/finance/purchases/${dgnNota.body.id}/verifikasi-bukti`, {});
  q = await cOwner.get("/api/finance/bukti-review");
  assert.equal(q.body.belumDiverifikasi, 0);
  assert.equal(q.body.tanpaNota, 1);
});
