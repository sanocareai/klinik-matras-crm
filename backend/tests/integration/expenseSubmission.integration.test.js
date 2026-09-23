// Test integrasi Pengajuan Biaya Lintas Divisi (ExpenseSubmission) — pilot
// Delivery. Fokus pada JAMINAN INTI yang wajib bertahan: satu pengajuan =
// satu FinExpense (termasuk saat double-click/retry paralel), permission
// server-side, aturan edit per status, sinkron status dua arah dengan
// FinExpense, dan VehicleExpense yang tertaut TIDAK diposting dua kali.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { makeRaw } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postVehicleExpense } from "../../src/services/finance/posting/expense.js";

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

async function buatVehicle(overrides = {}) {
  return testPrisma.vehicle.create({
    data: { plateNumber: `B ${Math.floor(Math.random() * 9000 + 1000)} UJI`, type: "Box", capacitySlots: 10, active: true, ...overrides },
  });
}

const pengajuanBadan = (extra = {}) => ({
  workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-20", amount: 150_000,
  vendorName: "SPBU Uji", metadata: { liters: 10 }, ...extra,
});

test("Pengajuan Delivery: draf -> ajukan menghasilkan SATU FinExpense tertaut, divisi & kategori sesuai", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });

  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan() });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.status, "DRAFT");
  assert.equal(created.body.finExpense, null);

  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token, headers: { "Idempotency-Key": "pb-uji-satu" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  assert.equal(diajukan.body.status, "MENUNGGU_PERSETUJUAN");
  assert.ok(diajukan.body.finExpenseId, "finExpenseId wajib terisi setelah diajukan");
  assert.equal(diajukan.body.finExpense.status, "MENUNGGU_APPROVAL");

  const fe = await testPrisma.finExpense.findUnique({
    where: { id: diajukan.body.finExpenseId },
    include: { category: true },
  });
  assert.equal(fe.division, "DELIVERY");
  assert.match(fe.category.name, /BBM/i);
  assert.equal(fe.mode, "REIMBURSEMENT", "Dispatcher tidak punya FINANCE_POST — mode wajib REIMBURSEMENT, bukan LANGSUNG dari kas perusahaan");

  const jumlahFinExpense = await testPrisma.finExpense.count({ where: { id: fe.id } });
  assert.equal(jumlahFinExpense, 1);
});

test("Double-click / retry paralel pada ajukan TIDAK PERNAH membuat FinExpense kedua", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan() });
  const id = created.body.id;
  const sebelum = await testPrisma.finExpense.count();

  // Dua permintaan BENAR-BENAR paralel dengan kunci sama: middleware
  // idempotency di level HTTP (middleware/idempotency.js, mounted di
  // expenseSubmissionRouter) menolak yang datang SAAT yang pertama masih
  // diproses dengan 409 IDEMPOTENCY_IN_PROGRESS ("coba lagi") — itu bukan
  // kegagalan, itu jaminan level HTTP supaya permintaan kedua tidak ikut
  // memproses dari awal. Yang wajib benar: TEPAT SATU dari keduanya sukses,
  // dan cuma SATU FinExpense yang lahir.
  const kunci = { "Idempotency-Key": "pb-uji-paralel" };
  const [a, b] = await Promise.all([
    raw("POST", `/api/finance/expense-submissions/${id}/ajukan`, { token, headers: kunci }),
    raw("POST", `/api/finance/expense-submissions/${id}/ajukan`, { token, headers: kunci }),
  ]);
  const statuses = [a.status, b.status].sort();
  assert.ok(
    (statuses[0] === 200 && statuses[1] === 200) || (statuses[0] === 200 && statuses[1] === 409),
    `kombinasi status tak terduga: ${JSON.stringify(statuses)} — ${JSON.stringify([a.body, b.body])}`
  );
  const sukses = [a, b].find((r) => r.status === 200);
  assert.ok(sukses.body.finExpenseId, "salah satu permintaan paralel wajib berhasil dan menautkan FinExpense");

  const sesudahParalel = await testPrisma.finExpense.count();
  assert.equal(sesudahParalel, sebelum + 1, "cuma satu FinExpense boleh lahir dari dua klik paralel");

  // Retry SETELAH sukses (klik ulang beberapa detik kemudian, tidak lagi
  // bersamaan) — masih harus no-op, mengembalikan FinExpense yang SAMA.
  const c = await raw("POST", `/api/finance/expense-submissions/${id}/ajukan`, { token, headers: kunci });
  assert.equal(c.status, 200, JSON.stringify(c.body));
  assert.equal(c.body.finExpenseId, sukses.body.finExpenseId);
  const sesudahRetry = await testPrisma.finExpense.count();
  assert.equal(sesudahRetry, sebelum + 1);
});

test("Permission: role tanpa hak pengajuan biaya ditolak 403", async () => {
  const { token } = await createTestUser({ roles: ["QC_LEAD"] });
  const res = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan() });
  assert.equal(res.status, 403);
});

test("Aturan edit: draf bebas diedit; setelah diajukan terkunci sampai ditarik kembali", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan() });
  const id = created.body.id;

  const edit1 = await raw("PATCH", `/api/finance/expense-submissions/${id}`, { token, body: { amount: 200_000 } });
  assert.equal(edit1.status, 200);
  assert.equal(edit1.body.amount, 200_000);

  await raw("POST", `/api/finance/expense-submissions/${id}/ajukan`, { token, headers: { "Idempotency-Key": "pb-uji-edit" } });

  const edit2 = await raw("PATCH", `/api/finance/expense-submissions/${id}`, { token, body: { amount: 300_000 } });
  assert.equal(edit2.status, 409, "tidak boleh mengedit pengajuan yang sudah menunggu persetujuan");

  const tarik = await raw("POST", `/api/finance/expense-submissions/${id}/tarik`, { token });
  assert.equal(tarik.status, 200);
  assert.equal(tarik.body.status, "DRAFT");
  assert.equal(tarik.body.finExpenseId, null);

  const edit3 = await raw("PATCH", `/api/finance/expense-submissions/${id}`, { token, body: { amount: 300_000 } });
  assert.equal(edit3.status, 200, "setelah ditarik, draf harus bisa diedit lagi");
  assert.equal(edit3.body.amount, 300_000);
});

test("Status sinkron DUA ARAH: approve & pay FinExpense mengubah status pengajuan otomatis", async () => {
  const { token: tokenDispatcher } = await createTestUser({ roles: ["DISPATCHER"] });
  const { token: tokenFinance } = await createTestUser({ roles: ["FINANCE"] });

  const kas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Uji Delivery", kind: "KAS", accountId: kas.id } });

  const created = await raw("POST", "/api/finance/expense-submissions", { token: tokenDispatcher, body: pengajuanBadan() });
  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token: tokenDispatcher, headers: { "Idempotency-Key": "pb-uji-sinkron" },
  });
  const finExpenseId = diajukan.body.finExpenseId;
  // Mode REIMBURSEMENT (dispatcher tidak punya FINANCE_POST) selalu wajib
  // nota sebelum disetujui (lihat services/finance/receipts.js#notaWajibDenganAmbang)
  // — di luar cakupan test ini, jadi dipenuhi langsung di sini.
  await testPrisma.finExpense.update({ where: { id: finExpenseId }, data: { receiptUrl: "https://example.test/nota-uji.jpg" } });

  const approve = await raw("POST", `/api/finance/expenses/${finExpenseId}/approve`, { token: tokenFinance });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));

  const afterApprove = await raw("GET", `/api/finance/expense-submissions/${created.body.id}`, { token: tokenDispatcher });
  assert.equal(afterApprove.body.status, "DISETUJUI");

  const pay = await raw("POST", `/api/finance/expenses/${finExpenseId}/pay`, {
    token: tokenFinance, body: { cashAccountId: rekening.id },
  });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));

  const afterPay = await raw("GET", `/api/finance/expense-submissions/${created.body.id}`, { token: tokenDispatcher });
  assert.equal(afterPay.body.status, "DIBAYAR");
});

test("VehicleExpense yang tertaut ke pengajuan TIDAK diposting ganda oleh sinkronisasi lama (BIAYA_KENDARAAN)", async () => {
  const vehicle = await buatVehicle();
  const ve = await testPrisma.vehicleExpense.create({
    data: { vehicleId: vehicle.id, date: new Date("2026-09-20"), category: "BBM", amount: 150_000, odometerKm: 1000, liters: 10 },
  });
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", {
    token, body: pengajuanBadan({ vehicleId: vehicle.id, vehicleExpenseId: ve.id }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));

  const hasil = await testPrisma.$transaction((tx) => postVehicleExpense(tx, { vehicleExpenseId: ve.id }));
  assert.equal(hasil.posted, false);
  assert.equal(hasil.skipped, true);

  const jurnalLama = await testPrisma.finJournalEntry.findFirst({ where: { idempotencyKey: `BIAYA_KENDARAAN:${ve.id}` } });
  assert.equal(jurnalLama, null, "VehicleExpense yang tertaut pengajuan tidak boleh dibukukan lewat jalur lama");
});
