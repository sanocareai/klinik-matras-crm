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

// Nominal SENGAJA di atas ambang auto-approve Delivery (Rp300.000, lihat
// config.js#WORKSPACES.DELIVERY.autoApprove) — supaya test yang memakai
// helper ini tetap menguji jalur MANUAL (MENUNGGU_PERSETUJUAN) seperti
// sebelum auto-approve ada, tidak diam-diam ikut ter-auto-approve dan
// gagal karena belum ada nota. Test khusus auto-approve pakai nominal
// & fixture nota sendiri (lihat describe blok "Auto-approve").
const pengajuanBadan = (extra = {}) => ({
  workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-20", amount: 500_000,
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

  // Nominal edit SENGAJA tetap di atas ambang auto-approve (lihat catatan di
  // pengajuanBadan()) supaya test ini murni menguji aturan KUNCI-EDIT-PER-
  // STATUS, tidak tercampur perilaku auto-approve.
  const edit1 = await raw("PATCH", `/api/finance/expense-submissions/${id}`, { token, body: { amount: 350_000 } });
  assert.equal(edit1.status, 200);
  assert.equal(edit1.body.amount, 350_000);

  await raw("POST", `/api/finance/expense-submissions/${id}/ajukan`, { token, headers: { "Idempotency-Key": "pb-uji-edit" } });

  const edit2 = await raw("PATCH", `/api/finance/expense-submissions/${id}`, { token, body: { amount: 400_000 } });
  assert.equal(edit2.status, 409, "tidak boleh mengedit pengajuan yang sudah menunggu persetujuan");

  const tarik = await raw("POST", `/api/finance/expense-submissions/${id}/tarik`, { token });
  assert.equal(tarik.status, 200);
  assert.equal(tarik.body.status, "DRAFT");
  assert.equal(tarik.body.finExpenseId, null);

  const edit3 = await raw("PATCH", `/api/finance/expense-submissions/${id}`, { token, body: { amount: 400_000 } });
  assert.equal(edit3.status, 200, "setelah ditarik, draf harus bisa diedit lagi");
  assert.equal(edit3.body.amount, 400_000);
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

// ── D-181: rapat ulang arsitektur pilot Delivery (24 September 2026) ────────

async function lampirkanBuktiLangsung(submissionId) {
  // Bypass upload multipart sungguhan (di luar cakupan test ini) — cukup
  // baris ExpenseSubmissionProof aktif, sama seperti yang dihasilkan
  // POST .../bukti, supaya ajukanPengajuan() menemukannya dan meneruskan
  // ke FinExpense.receiptUrl.
  return testPrisma.expenseSubmissionProof.create({
    data: { submissionId, url: "https://example.test/nota-otomatis.jpg", version: 1 },
  });
}

test("Auto-approve: BBM rutin bernilai kecil (≤ ambang) menghasilkan TEPAT SATU FinExpense langsung DISETUJUI, tetap audit-able", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ amount: 100_000 }) });
  await lampirkanBuktiLangsung(created.body.id);
  const sebelum = await testPrisma.finExpense.count();

  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token, headers: { "Idempotency-Key": "pb-uji-otomatis" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  assert.equal(diajukan.body.status, "OTOMATIS_DISETUJUI");
  assert.ok(diajukan.body.finExpenseId);
  assert.equal(diajukan.body.finExpense.status, "DISETUJUI");

  const sesudah = await testPrisma.finExpense.count();
  assert.equal(sesudah, sebelum + 1, "auto-approve tetap cuma boleh melahirkan SATU FinExpense");

  const fe = await testPrisma.finExpense.findUnique({ where: { id: diajukan.body.finExpenseId } });
  assert.equal(fe.approvedById, null, "tidak ada manusia yang menyetujui — approvedById harus null");
  assert.equal(fe.status, "DISETUJUI");

  // Audit-able (req #3): jejak SubmissionAudit eksplisit + ActivityEvent bertanda SYSTEM.
  const audit = await testPrisma.expenseSubmissionAudit.findFirst({ where: { submissionId: created.body.id, field: "status", after: "OTOMATIS_DISETUJUI" } });
  assert.ok(audit, "auto-approve wajib meninggalkan jejak audit eksplisit");
  assert.equal(audit.actorId, null);
  assert.match(audit.reason, /Auto-approve/);

  const aktivitas = await testPrisma.activityEvent.findFirst({ where: { entityType: "fin_expense", entityId: fe.id, eventType: "DOCUMENT_APPROVED" } });
  assert.ok(aktivitas, "persetujuan otomatis tetap tercatat di linimasa aktivitas");
  assert.equal(aktivitas.actorType, "SYSTEM");
  assert.equal(aktivitas.metadata?.otomatis, true);
});

test("Auto-approve TETAP memblokir tanpa nota — kebijakan otomatis tidak mengecualikan syarat bukti", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ amount: 100_000 }) });
  // TIDAK melampirkan bukti — REIMBURSEMENT selalu wajib nota, termasuk jalur otomatis.
  const res = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token, headers: { "Idempotency-Key": "pb-uji-otomatis-tanpa-nota" },
  });
  assert.equal(res.status, 422, JSON.stringify(res.body));

  const ulang = await raw("GET", `/api/finance/expense-submissions/${created.body.id}`, { token });
  assert.equal(ulang.body.status, "DRAFT", "gagal auto-approve harus membatalkan SELURUH pengajuan (rollback), bukan setengah jalan");
  assert.equal(ulang.body.finExpenseId, null);
});

test("Auto-approve: double-click paralel tetap SATU FinExpense (jaminan idempotensi berlaku juga di jalur otomatis)", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ amount: 100_000 }) });
  await lampirkanBuktiLangsung(created.body.id);
  const sebelum = await testPrisma.finExpense.count();

  const kunci = { "Idempotency-Key": "pb-uji-otomatis-paralel" };
  const [a, b] = await Promise.all([
    raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, { token, headers: kunci }),
    raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, { token, headers: kunci }),
  ]);
  const sukses = [a, b].find((r) => r.status === 200);
  assert.ok(sukses, `salah satu wajib berhasil — ${JSON.stringify([a.status, b.status])}`);
  assert.equal(sukses.body.status, "OTOMATIS_DISETUJUI");

  const sesudah = await testPrisma.finExpense.count();
  assert.equal(sesudah, sebelum + 1);
});

test("Reimbursement TIDAK mengurangi kas/bank saat diajukan atau saat disetujui — cuma saat benar-benar dibayar", async () => {
  const { token: tokenDispatcher } = await createTestUser({ roles: ["DISPATCHER"] });
  const { token: tokenFinance } = await createTestUser({ roles: ["FINANCE"] });
  const kas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Uji Reimburse", kind: "KAS", accountId: kas.id } });

  const jumlahJurnalKasSebelum = async () => testPrisma.finJournalLine.count({ where: { cashAccountId: rekening.id } });
  const sebelumSemua = await jumlahJurnalKasSebelum();

  const created = await raw("POST", "/api/finance/expense-submissions", { token: tokenDispatcher, body: pengajuanBadan({ sumberDana: "TALANGAN_PRIBADI" }) });
  assert.equal(await jumlahJurnalKasSebelum(), sebelumSemua, "membuat draf tidak pernah menyentuh kas/bank");

  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token: tokenDispatcher, headers: { "Idempotency-Key": "pb-uji-reimburse-kas" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  const finExpenseId = diajukan.body.finExpenseId;
  const feSetelahAjukan = await testPrisma.finExpense.findUnique({ where: { id: finExpenseId } });
  assert.equal(feSetelahAjukan.mode, "REIMBURSEMENT", "sumberDana TALANGAN_PRIBADI wajib jadi mode REIMBURSEMENT");
  assert.equal(await jumlahJurnalKasSebelum(), sebelumSemua, "diajukan (MENUNGGU_APPROVAL) tidak pernah menyentuh kas/bank");

  await testPrisma.finExpense.update({ where: { id: finExpenseId }, data: { receiptUrl: "https://example.test/nota-reimburse.jpg" } });
  const approve = await raw("POST", `/api/finance/expenses/${finExpenseId}/approve`, { token: tokenFinance });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));
  assert.equal(await jumlahJurnalKasSebelum(), sebelumSemua, "DISETUJUI (beban diakui) masih belum boleh menyentuh kas/bank — REIMBURSEMENT baru jadi utang");

  const pay = await raw("POST", `/api/finance/expenses/${finExpenseId}/pay`, { token: tokenFinance, body: { cashAccountId: rekening.id } });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  assert.equal(await jumlahJurnalKasSebelum(), sebelumSemua + 1, "baru SAAT /pay kas/bank boleh berkurang");
});

test("BAN & SEWA: kategori terpasang -> sukses diajukan dengan akun yang benar; kategori BELUM terpasang -> diblokir (BUKAN fallback ke kategori lain)", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });

  const ban = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ expenseType: "BAN" }) });
  const diajukanBan = await raw("POST", `/api/finance/expense-submissions/${ban.body.id}/ajukan`, { token, headers: { "Idempotency-Key": "pb-uji-ban" } });
  assert.equal(diajukanBan.status, 200, JSON.stringify(diajukanBan.body));
  const feBan = await testPrisma.finExpense.findUnique({ where: { id: diajukanBan.body.finExpenseId }, include: { category: true } });
  assert.equal(feBan.category.code, "BAN_KENDARAAN");

  const sewa = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ expenseType: "SEWA" }) });
  const diajukanSewa = await raw("POST", `/api/finance/expense-submissions/${sewa.body.id}/ajukan`, { token, headers: { "Idempotency-Key": "pb-uji-sewa" } });
  assert.equal(diajukanSewa.status, 200, JSON.stringify(diajukanSewa.body));
  const feSewa = await testPrisma.finExpense.findUnique({ where: { id: diajukanSewa.body.finExpenseId }, include: { category: true } });
  assert.equal(feSewa.category.code, "SEWA_KENDARAAN");

  // Nonaktifkan kategori BAN (simulasi "belum dipasang Finance") — submit berikutnya HARUS diblokir, bukan jatuh ke kategori lain.
  await testPrisma.finExpenseCategory.update({ where: { code: "BAN_KENDARAAN" }, data: { active: false } });
  const banKedua = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ expenseType: "BAN" }) });
  const gagalBan = await raw("POST", `/api/finance/expense-submissions/${banKedua.body.id}/ajukan`, { token, headers: { "Idempotency-Key": "pb-uji-ban-blokir" } });
  assert.equal(gagalBan.status, 422, JSON.stringify(gagalBan.body));
  const banKeduaUlang = await raw("GET", `/api/finance/expense-submissions/${banKedua.body.id}`, { token });
  assert.equal(banKeduaUlang.body.finExpenseId, null, "diblokir berarti TIDAK ADA FinExpense sama sekali, bukan nyasar ke kategori lain");
});

test("Catat atas nama: Dispatcher boleh mengajukan untuk driver lain; reimbursement kembali ke driver, bukan ke Dispatcher; role tanpa izin ditolak", async () => {
  const { token: tokenDispatcher } = await createTestUser({ roles: ["DISPATCHER"] });
  const { user: driver } = await createTestUser({ roles: ["DRIVER"] });
  const { token: tokenDriverLain } = await createTestUser({ roles: ["DRIVER"] });

  const created = await raw("POST", "/api/finance/expense-submissions", {
    token: tokenDispatcher,
    body: pengajuanBadan({ requestedById: driver.id, urgentReason: "Ban pecah di jalan", sourceNote: "Chat WA Agung 23/9 14:20" }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.requestedBy.id, driver.id, "pemohon asli harus driver, bukan dispatcher yang mengetik");

  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token: tokenDispatcher, headers: { "Idempotency-Key": "pb-uji-atas-nama" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  const fe = await testPrisma.finExpense.findUnique({ where: { id: diajukan.body.finExpenseId } });
  assert.equal(fe.reimburseToId, driver.id, "uang reimbursement harus kembali ke driver yang sebenarnya mengeluarkan, bukan ke dispatcher");

  // Role driver biasa (bukan Finance/Dispatcher) TIDAK boleh mencatat atas nama orang lain.
  const ditolak = await raw("POST", "/api/finance/expense-submissions", {
    token: tokenDriverLain, body: pengajuanBadan({ requestedById: driver.id }),
  });
  assert.equal(ditolak.status, 403, JSON.stringify(ditolak.body));
});

test("Cutover: VehicleExpense BARU (lahir setelah cutover) tanpa tautan pengajuan TIDAK bisa diposting lewat jalur lama — harus lewat ExpenseSubmission", async () => {
  const vehicle = await buatVehicle();
  const veBaru = await testPrisma.vehicleExpense.create({
    data: {
      vehicleId: vehicle.id, date: new Date("2026-09-25"), category: "BBM", amount: 50_000,
      createdAt: new Date("2026-09-25T08:00:00+07:00"), // SETELAH cutover (posting/expense.js#CUTOVER_PENGAJUAN_BIAYA)
    },
  });
  const hasil = await testPrisma.$transaction((tx) => postVehicleExpense(tx, { vehicleExpenseId: veBaru.id }));
  assert.equal(hasil.posted, false);
  assert.equal(hasil.skipped, true);
  assert.equal(hasil.reason, "wajib_lewat_pengajuan_biaya");
});

test("Cutover TIDAK meregresi data lama: VehicleExpense yang lahir SEBELUM cutover tetap bisa diposting seperti biasa", async () => {
  const vehicle = await buatVehicle();
  const veLama = await testPrisma.vehicleExpense.create({
    data: {
      vehicleId: vehicle.id, date: new Date("2026-08-01"), category: "TOL", amount: 20_000,
      createdAt: new Date("2026-08-01T08:00:00+07:00"), // SEBELUM cutover
    },
  });
  const hasil = await testPrisma.$transaction((tx) => postVehicleExpense(tx, { vehicleExpenseId: veLama.id }));
  assert.equal(hasil.posted, true, "data lama (sebelum cutover) tidak boleh ikut terblokir — tidak ada regresi");
  assert.ok(hasil.entry);
});

// ── Wave 2 (24 September 2026): input cepat + 4 sumber dana + koreksi pasca-approval ──

test("Urgent via Finance: FINANCE mencatat atas nama driver, sumberDana UANG_MUKA_OPERASIONAL -> mode UTANG (bukan crash 400 minta cashAccountId)", async () => {
  const { user: driver } = await createTestUser({ roles: ["DRIVER"] });
  const { token: tokenFinance } = await createTestUser({ roles: ["FINANCE"] });

  const created = await raw("POST", "/api/finance/expense-submissions", {
    token: tokenFinance,
    body: pengajuanBadan({
      expenseType: "SERVIS", amount: 800_000, requestedById: driver.id, sumberDana: "UANG_MUKA_OPERASIONAL",
      urgentReason: "Mobil mogok di jalan, servis darurat", sourceNote: "Telepon Agung 23/9 16:40",
    }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.requestedBy.id, driver.id);

  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token: tokenFinance, headers: { "Idempotency-Key": "pb-uji-urgent-finance" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body), "sebelum perbaikan modeDariSumberDana ini gagal 400 (cashAccountId wajib untuk LANGSUNG)");
  const fe = await testPrisma.finExpense.findUnique({ where: { id: diajukan.body.finExpenseId } });
  assert.equal(fe.mode, "UTANG");
  assert.equal(fe.cashAccountId, null, "UTANG belum butuh rekening spesifik — dipilih Finance nanti saat /pay");
});

test("Sumber dana kosong (belum ditentukan) dari pemohon ber-FINANCE_POST TETAP aman -> default UTANG, bukan crash LANGSUNG", async () => {
  const { token: tokenFinance } = await createTestUser({ roles: ["FINANCE"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token: tokenFinance, body: pengajuanBadan({ expenseType: "SEWA" }) });
  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token: tokenFinance, headers: { "Idempotency-Key": "pb-uji-sumberdana-kosong" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  const fe = await testPrisma.finExpense.findUnique({ where: { id: diajukan.body.finExpenseId } });
  assert.equal(fe.mode, "UTANG");
});

test("Sumber dana BELUM_DIBAYAR -> mode UTANG utk pemohon ber-FINANCE_POST, sumberDana asli tetap tersimpan apa adanya (bukan hilang jadi murni teknis)", async () => {
  const { token } = await createTestUser({ roles: ["FINANCE"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ sumberDana: "BELUM_DIBAYAR" }) });
  assert.equal(created.body.sumberDana, "BELUM_DIBAYAR");
  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token, headers: { "Idempotency-Key": "pb-uji-belum-dibayar" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  const fe = await testPrisma.finExpense.findUnique({ where: { id: diajukan.body.finExpenseId } });
  assert.equal(fe.mode, "UTANG");
  const bacaUlang = await raw("GET", `/api/finance/expense-submissions/${created.body.id}`, { token });
  assert.equal(bacaUlang.body.sumberDana, "BELUM_DIBAYAR", "field sumberDana pemohon tetap terbaca apa adanya walau mode teknisnya sama dengan REKENING_PERUSAHAAN/UANG_MUKA");
});

test("Sumber dana BELUM_DIBAYAR dari pemohon TANPA FINANCE_POST -> tetap dipaksa REIMBURSEMENT (aturan penalangan sendiri berlaku, sumberDana cuma hint)", async () => {
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token, body: pengajuanBadan({ sumberDana: "BELUM_DIBAYAR" }) });
  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token, headers: { "Idempotency-Key": "pb-uji-belum-dibayar-nonfinance" },
  });
  assert.equal(diajukan.status, 200, JSON.stringify(diajukan.body));
  const fe = await testPrisma.finExpense.findUnique({ where: { id: diajukan.body.finExpenseId } });
  assert.equal(fe.mode, "REIMBURSEMENT", "tanpa FINANCE_POST, buatFinExpense() memaksa REIMBURSEMENT terlepas dari hint sumberDana");
});

test("Edit SETELAH disetujui (DISETUJUI, belum dibayar): koreksi metadata via /metadata TETAP bisa, nominal/akun TIDAK bisa lewat sini", async () => {
  const { token: tokenDispatcher } = await createTestUser({ roles: ["DISPATCHER"] });
  const { token: tokenFinance } = await createTestUser({ roles: ["FINANCE"] });
  const created = await raw("POST", "/api/finance/expense-submissions", { token: tokenDispatcher, body: pengajuanBadan() });
  const diajukan = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/ajukan`, {
    token: tokenDispatcher, headers: { "Idempotency-Key": "pb-uji-koreksi-pasca-approve" },
  });
  await testPrisma.finExpense.update({ where: { id: diajukan.body.finExpenseId }, data: { receiptUrl: "https://example.test/nota-koreksi.jpg" } });
  const approve = await raw("POST", `/api/finance/expenses/${diajukan.body.finExpenseId}/approve`, { token: tokenFinance });
  assert.equal(approve.status, 200, JSON.stringify(approve.body));

  // Koreksi metadata (vendorName) — SAH, disetujui bukan berarti beku total.
  const koreksi = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/metadata`, {
    token: tokenDispatcher, body: { reason: "Nama vendor salah ketik", changes: { vendorName: "SPBU Uji Koreksi" } },
  });
  assert.equal(koreksi.status, 200, JSON.stringify(koreksi.body));
  assert.equal(koreksi.body.vendorName, "SPBU Uji Koreksi");
  const audit = await testPrisma.expenseSubmissionAudit.findFirst({ where: { submissionId: created.body.id, field: "vendorName" } });
  assert.ok(audit, "koreksi metadata pasca-approval wajib meninggalkan jejak audit before/after");
  assert.equal(audit.reason, "Nama vendor salah ketik");

  // Coba koreksi field FINANSIAL lewat jalur ini — WAJIB ditolak (bukan silent no-op).
  const tolakFinansial = await raw("POST", `/api/finance/expense-submissions/${created.body.id}/metadata`, {
    token: tokenDispatcher, body: { reason: "Coba ubah nominal", changes: { amount: 999_999 } },
  });
  assert.equal(tolakFinansial.status, 400, JSON.stringify(tolakFinansial.body));
});

test("Integrasi kendaraan/PIC: snapshot kendaraan+driver+helper tersimpan persis saat pengajuan dibuat (bertahan walau master datanya berubah nanti)", async () => {
  const vehicle = await buatVehicle({ plateNumber: `B ${Math.floor(Math.random() * 9000 + 1000)} SNAP` });
  const { user: driver } = await createTestUser({ roles: ["DRIVER"] });
  const { user: helper } = await createTestUser({ roles: ["HELPER"] });
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });

  const created = await raw("POST", "/api/finance/expense-submissions", {
    token, body: pengajuanBadan({ vehicleId: vehicle.id, driverId: driver.id, helperId: helper.id, picUserId: driver.id }),
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  assert.equal(created.body.vehiclePlateSnapshot, vehicle.plateNumber);
  assert.equal(created.body.driverNameSnapshot, driver.name);
  assert.equal(created.body.helperNameSnapshot, helper.name);
  assert.equal(created.body.picNameSnapshot, driver.name);

  // Master berubah nanti (nama diedit) — snapshot pengajuan TIDAK ikut berubah.
  await testPrisma.user.update({ where: { id: driver.id }, data: { name: "Nama Baru Setelah Ganti" } });
  const bacaUlang = await raw("GET", `/api/finance/expense-submissions/${created.body.id}`, { token });
  assert.equal(bacaUlang.body.driverNameSnapshot, driver.name, "snapshot histori tidak boleh ikut berubah walau nama master di-update belakangan");
});

test("Peringatan duplikat mempertimbangkan PIC & status bukti — tidak pernah memblokir submit", async () => {
  const vehicle = await buatVehicle();
  const { user: driverA } = await createTestUser({ roles: ["DRIVER"] });
  const { user: driverB } = await createTestUser({ roles: ["DRIVER"] });
  const { token } = await createTestUser({ roles: ["DISPATCHER"] });

  const asli = await raw("POST", "/api/finance/expense-submissions", {
    token, body: pengajuanBadan({ vehicleId: vehicle.id, picUserId: driverA.id, amount: 275_000 }),
  });
  assert.equal(asli.status, 201, JSON.stringify(asli.body));

  // PIC SAMA -> harus muncul sebagai kandidat.
  const cekSamaPic = await raw("GET", `/api/finance/expense-submissions/duplicate-check?division=DELIVERY&vehicleId=${vehicle.id}&expenseType=BBM&date=2026-09-20&amount=275000&picUserId=${driverA.id}`, { token });
  assert.equal(cekSamaPic.status, 200);
  assert.ok(cekSamaPic.body.kandidat.some((k) => k.id === asli.body.id), "PIC sama, kendaraan/tanggal/nominal sama -> wajib muncul sebagai kandidat");
  assert.equal(cekSamaPic.body.kandidat.find((k) => k.id === asli.body.id).adaBukti, false);

  // PIC BEDA -> tidak muncul (dipersempit oleh PIC, mengurangi false-positive antar-driver).
  const cekBedaPic = await raw("GET", `/api/finance/expense-submissions/duplicate-check?division=DELIVERY&vehicleId=${vehicle.id}&expenseType=BBM&date=2026-09-20&amount=275000&picUserId=${driverB.id}`, { token });
  assert.equal(cekBedaPic.status, 200);
  assert.ok(!cekBedaPic.body.kandidat.some((k) => k.id === asli.body.id), "PIC beda -> tidak boleh ikut dianggap kandidat duplikat");

  // Submit KEDUA (mirip persis) TETAP boleh — cuma peringatan, tidak pernah memblokir.
  const kedua = await raw("POST", "/api/finance/expense-submissions", {
    token, body: pengajuanBadan({ vehicleId: vehicle.id, picUserId: driverA.id, amount: 275_000 }),
  });
  assert.equal(kedua.status, 201, "peringatan duplikat tidak pernah memblokir pembuatan draf baru");
});
