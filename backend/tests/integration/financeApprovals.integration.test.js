// Inbox Persetujuan Finance (S4): read-model gabungan + keputusan lewat endpoint asli, dengan token mobile & peran sungguhan.
// Yang dijaga: pemetaan tab, filter/pencarian/pagination, `aksi` yang dihitung server (izin + pemisahan tugas + syarat nota),
// lampiran bertanda-tangan, riwayat, dan keamanan keputusan (Idempotency-Key, kunci baris, alasan wajib, kapabilitas dicabut).

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { tahapDari } from "../../src/services/finance/approvals.js";

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
  return { ...u, token: r.body.accessToken };
}

const k = () => ({ "Idempotency-Key": randomUUID() });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekening.id);
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const katBeli = await testPrisma.finPurchaseCategory.findFirst();
  const supplier = await testPrisma.finSupplier.create({ data: { code: "SUP-UJI", name: "CV Tekstil Jaya" } });
  return { rekening, kat, katBeli, supplier };
}

let nomor = 0;
const no = (p) => `${p}-TEST-${String(++nomor).padStart(4, "0")}`;

async function buatExpense(ctx, { status = "MENUNGGU_APPROVAL", by, amount = 50_000, desc = "Kertas HVS", waktu = new Date(), receiptUrl = null, mode = "LANGSUNG" } = {}) {
  return testPrisma.finExpense.create({
    data: {
      expenseNumber: no("EXP"), date: new Date("2026-09-15T00:00:00Z"), amount, description: desc, categoryId: ctx.kat.id, mode,
      cashAccountId: ctx.rekening.id, status, submittedAt: waktu, createdAt: waktu, createdById: by.user.id, receiptUrl,
      payeeName: "Toko Maju",
      ...(status === "DITOLAK" && { rejectReason: "Nota tidak jelas", approvedById: by.user.id, approvedAt: new Date() }),
    },
  });
}
async function buatPurchase(ctx, { status = "MENUNGGU_APPROVAL", by, amount = 75_000, desc = "Busa HD", waktu = new Date() } = {}) {
  return testPrisma.finPurchase.create({
    data: {
      purchaseNumber: no("PUR"), date: new Date("2026-09-16T00:00:00Z"), amount, description: desc, categoryId: ctx.katBeli.id, mode: "LANGSUNG",
      cashAccountId: ctx.rekening.id, supplierId: ctx.supplier.id, status, submittedAt: waktu, createdAt: waktu, createdById: by.user.id,
      receiptUrl: "/media/finance-receipts/" + "a".repeat(40) + ".jpg",
    },
  });
}
async function buatBill(ctx, { status = "MENUNGGU_APPROVAL", by, amount = 1_000_000, waktu = new Date() } = {}) {
  return testPrisma.finSupplierBill.create({
    data: {
      billNumber: no("BILL"), supplierRef: no("INV"), billType: "JASA_OPERASIONAL", supplierId: ctx.supplier.id, billDate: new Date("2026-09-10T00:00:00Z"),
      amount, description: "Kain Ekstra Fleece", expenseCategoryId: ctx.kat.id, status, createdAt: waktu, createdById: by.user.id,
    },
  });
}
async function buatRefund(ctx, { status = "MENUNGGU_APPROVAL", by, amount = 300_000, waktu = new Date() } = {}) {
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  const order = await testPrisma.order.create({ data: { customerId: customer.id, value: 1_000_000, category: "LAYANAN", orderNumber: no("RES"), status: "DELIVERED" } });
  return testPrisma.finRefund.create({
    data: { refundNumber: no("RFD"), orderId: order.id, date: new Date("2026-09-17T00:00:00Z"), amount, reason: "Kasur tidak sesuai", cashAccountId: ctx.rekening.id, status, createdAt: waktu, createdById: by.user.id },
  });
}

const daftar = (u, q = "") => raw("GET", `/api/finance/approvals${q}`, { token: u.token });

test("Pemetaan tab: 4 jenis dokumen, DRAFT/DIBATALKAN tidak masuk inbox, hitung per tab benar", async () => {
  const ctx = await siapkan();
  const pemohon = await masuk(["FINANCE"]);
  await buatExpense(ctx, { by: pemohon });
  await buatPurchase(ctx, { by: pemohon });
  await buatBill(ctx, { by: pemohon });
  await buatRefund(ctx, { by: pemohon });
  await buatExpense(ctx, { by: pemohon, status: "DISETUJUI", mode: "REIMBURSEMENT" }); // DIPROSES
  await buatBill(ctx, { by: pemohon, status: "DIBAYAR_SEBAGIAN" }); // DIPROSES
  await buatExpense(ctx, { by: pemohon, status: "DIBAYAR" }); // DISETUJUI
  await buatBill(ctx, { by: pemohon, status: "LUNAS" }); // DISETUJUI
  await buatRefund(ctx, { by: pemohon, status: "DISETUJUI" }); // DISETUJUI
  await buatExpense(ctx, { by: pemohon, status: "DITOLAK" }); // DITOLAK
  await buatExpense(ctx, { by: pemohon, status: "DRAFT" }); // tidak tampil
  await buatBill(ctx, { by: pemohon, status: "DIBATALKAN" }); // tidak tampil

  const approver = await masuk(["APPROVER"]);
  const r = await daftar(approver);
  assert.equal(r.status, 200, JSON.stringify(r.body));
  assert.deepEqual(r.body.hitung, { MENUNGGU: 4, DIPROSES: 2, DISETUJUI: 3, DITOLAK: 1 });
  assert.equal(r.body.total, 4);
  assert.deepEqual(r.body.items.map((i) => i.jenis).sort(), ["bill", "expense", "purchase", "refund"]);
  for (const i of r.body.items) assert.equal(i.tahap, "MENUNGGU");

  for (const [tab, n] of [["DIPROSES", 2], ["DISETUJUI", 3], ["DITOLAK", 1]]) {
    const t = await daftar(approver, `?tab=${tab}`);
    assert.equal(t.body.items.length, n, tab);
    assert.ok(t.body.items.every((i) => i.tahap === tab));
  }
  assert.equal(tahapDari("expense", "DRAFT"), null);
  assert.equal(tahapDari("bill", "DIBATALKAN"), null);
});

test("Bentuk item: nomor, pemohon, nominal (angka), umur, kategori, rekening, pihak, lampiran, aksi; yang menunggu urut paling lama dulu", async () => {
  const ctx = await siapkan();
  const pemohon = await masuk(["FINANCE"]);
  const lama = new Date(Date.now() - 5 * 86400000);
  await buatExpense(ctx, { by: pemohon, waktu: new Date(), desc: "Baru" });
  const tua = await buatExpense(ctx, { by: pemohon, waktu: lama, desc: "Tua", amount: 125_000, receiptUrl: "/media/finance-receipts/" + "b".repeat(40) + ".jpg" });

  const approver = await masuk(["APPROVER"]);
  const r = await daftar(approver);
  assert.equal(r.body.items[0].id, tua.id, "paling lama dulu");
  const i = r.body.items[0];
  assert.equal(i.jenis, "expense");
  assert.equal(i.jenisLabel, "Pengeluaran");
  assert.equal(i.nomor, tua.expenseNumber);
  assert.equal(i.nominal, 125000);
  assert.equal(i.pemohon.name, pemohon.user.name);
  assert.ok(i.umurHari >= 4 && i.umurHari <= 6, `umur ${i.umurHari}`);
  assert.equal(i.kategori, "Perlengkapan kantor".length ? i.kategori : "");
  assert.equal(i.rekening, "Kas Kantor");
  assert.equal(i.pihak, "Toko Maju");
  assert.equal(i.adaLampiran, true);
  assert.equal(i.statusLabel, "Menunggu persetujuan");
  assert.equal(i.aksi.setujui.boleh, true);
  assert.equal(i.aksi.setujui.path, `/finance/expenses/${tua.id}/approve`);
  assert.equal(i.aksi.tolak.alasanWajib, true);
});

test("Filter jenis / pemohon / periode, pencarian (nomor, vendor, nominal) dan pagination", async () => {
  const ctx = await siapkan();
  const a = await masuk(["FINANCE"]);
  const b = await masuk(["ACCOUNTANT"]);
  const e1 = await buatExpense(ctx, { by: a, desc: "Lakban coklat", amount: 88_000 });
  await buatExpense(ctx, { by: b, desc: "Spidol" });
  await buatPurchase(ctx, { by: a });
  await buatBill(ctx, { by: b });
  const approver = await masuk(["APPROVER"]);

  assert.equal((await daftar(approver, "?jenis=purchase")).body.total, 1);
  assert.equal((await daftar(approver, "?jenis=expense,bill")).body.total, 3);
  assert.equal((await daftar(approver, `?pemohonId=${b.user.id}`)).body.total, 2);
  assert.equal((await daftar(approver, "?q=lakban")).body.total, 1);
  assert.equal((await daftar(approver, "?q=CV%20Tekstil")).body.total, 2, "cari nama supplier (pembelian + tagihan)");
  assert.equal((await daftar(approver, "?q=88.000")).body.items[0].id, e1.id, "cari nominal");
  assert.equal((await daftar(approver, "?q=tidak-ada-sama-sekali")).body.total, 0);
  assert.equal((await daftar(approver, "?from=2026-09-15&to=2026-09-15")).body.total, 2, "periode = tanggal dokumen");
  assert.equal((await daftar(approver, "?from=2026-01-01&to=2026-01-31")).body.total, 0);

  const p1 = (await daftar(approver, "?limit=3&page=1")).body;
  const p2 = (await daftar(approver, "?limit=3&page=2")).body;
  assert.equal(p1.items.length, 3);
  assert.equal(p1.adaLagi, true);
  assert.equal(p2.items.length, 1);
  assert.equal(p2.adaLagi, false);
  const semuaId = [...p1.items, ...p2.items].map((i) => i.id);
  assert.equal(new Set(semuaId).size, 4, "tanpa duplikat lintas halaman");
  // hitung per tab menghormati filter (kecuali tab)
  assert.equal((await daftar(approver, "?jenis=purchase")).body.hitung.MENUNGGU, 1);
});

test("Matriks izin `aksi`: FINANCE (bukan pembuat) ya; pembuat sendiri tidak; OWNER pembuat ya (FINANCE_ADMIN); ACCOUNTANT tidak; APPROVER ya", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const owner = await masuk(["OWNER"]);
  const akuntan = await masuk(["ACCOUNTANT"]);
  const approver = await masuk(["APPROVER"]);
  const milikFinance = await buatExpense(ctx, { by: finance });
  const milikOwner = await buatExpense(ctx, { by: owner });

  const aksi = async (u, id) => (await daftar(u)).body.items.find((i) => i.id === id).aksi;

  const a1 = await aksi(finance, milikFinance.id);
  assert.equal(a1.setujui.boleh, false);
  assert.match(a1.setujui.alasan, /disetujui orang lain/);
  assert.equal(a1.tolak.boleh, true, "menolak dokumen sendiri tidak dilarang backend");

  assert.equal((await aksi(owner, milikFinance.id)).setujui.boleh, true);
  assert.equal((await aksi(approver, milikFinance.id)).setujui.boleh, true);
  assert.equal((await aksi(owner, milikOwner.id)).setujui.boleh, true, "OWNER punya FINANCE_ADMIN → pengecualian yang ada di backend");

  const a2 = await aksi(akuntan, milikFinance.id);
  assert.equal(a2.setujui.boleh, false);
  assert.equal(a2.tolak.boleh, false);
  assert.match(a2.setujui.alasan, /tidak punya izin/);
});

test("Syarat nota dihitung server: pengeluaran ≥ ambang tanpa foto → setujui tidak boleh (pesan), approve nyata 422", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const doc = await buatExpense(ctx, { by: finance, amount: 2_000_000 });
  const approver = await masuk(["APPROVER"]);
  const item = (await daftar(approver)).body.items[0];
  assert.equal(item.aksi.setujui.boleh, false);
  assert.match(item.aksi.setujui.alasan, /foto nota/);
  assert.equal(item.syarat.terpenuhi, false);
  const r = await raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: approver.token, headers: k(), body: {} });
  assert.equal(r.status, 422);
});

test("Peran tanpa akses: SALES 403; pemegang EXPENSE_SUBMIT saja 403; tanpa token 401", async () => {
  const tanpa = await createLoginUser({ roles: ["SALES"] });
  const web = await raw("POST", "/api/auth/login", { body: { email: tanpa.email, password: tanpa.password } });
  assert.equal(web.status, 200);
  for (const path of ["/api/finance/approvals", "/api/finance/approvals/ringkasan", "/api/finance/approvals/pemohon", `/api/finance/approvals/expense/${randomUUID()}`]) {
    const r = await raw("GET", path, { token: web.body.token });
    assert.equal(r.status, 403, path);
  }
  assert.equal((await raw("GET", "/api/finance/approvals")).status, 401);
});

test("Detail: lampiran bertanda-tangan berumur pendek, riwayat lengkap (diajukan → ditolak dengan alasan), rincian", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const file = "c".repeat(40) + ".jpg";
  const doc = await buatExpense(ctx, { by: finance, receiptUrl: `/media/finance-receipts/${file}` });
  const approver = await masuk(["APPROVER"]);

  const d = await raw("GET", `/api/finance/approvals/expense/${doc.id}`, { token: approver.token });
  assert.equal(d.status, 200, JSON.stringify(d.body));
  assert.equal(d.body.lampiran.length, 1);
  assert.equal(d.body.lampiran[0].jenis, "foto");
  assert.match(d.body.lampiran[0].url, new RegExp(`^/media/finance-receipts/${file}\\?exp=\\d+&sig=[a-f0-9]+`));
  assert.match(d.body.lampiran[0].thumbUrl, /_t\.jpg\?exp=/);
  assert.ok(new Date(d.body.lampiran[0].kedaluwarsa) > new Date());
  assert.deepEqual(d.body.riwayat.map((r) => r.peristiwa), ["DIAJUKAN"]);

  const tolak = await raw("POST", `/api/finance/expenses/${doc.id}/reject`, { token: approver.token, headers: k(), body: { reason: "Foto buram" } });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));

  const d2 = await raw("GET", `/api/finance/approvals/expense/${doc.id}`, { token: approver.token });
  assert.equal(d2.body.status, "DITOLAK");
  assert.equal(d2.body.tahap, "DITOLAK");
  assert.equal(d2.body.alasanTolak, "Foto buram");
  assert.equal(d2.body.diputuskanOleh.name, approver.user.name);
  assert.deepEqual(d2.body.riwayat.map((r) => r.peristiwa), ["DIAJUKAN", "DOCUMENT_REJECTED"]);
  assert.equal(d2.body.riwayat[1].catatan, "Foto buram");
  assert.equal(d2.body.riwayat[1].oleh, approver.user.name);
  assert.equal(d2.body.aksi.setujui.boleh, false, "sudah diputuskan");

  // URL bertanda-tangan benar-benar bisa diunduh tanpa token; tanpa tanda tangan butuh login (foto tidak ada di disk → 404 setelah lolos auth).
  const tanpaSig = await fetch(`${server.baseUrl}/media/finance-receipts/${file}`);
  assert.equal(tanpaSig.status, 401);
  const salah = await fetch(`${server.baseUrl}${d.body.lampiran[0].url.replace(/sig=[a-f0-9]+/, "sig=" + "0".repeat(64))}`);
  assert.equal(salah.status, 403);
  const bertanda = await fetch(`${server.baseUrl}${d.body.lampiran[0].url}`);
  assert.equal(bertanda.status, 404, "tanda tangan sah lolos; file uji memang tidak ada di disk");

  assert.equal((await raw("GET", `/api/finance/approvals/expense/${randomUUID()}`, { token: approver.token })).status, 404);
  assert.equal((await raw("GET", `/api/finance/approvals/lain/${doc.id}`, { token: approver.token })).status, 404);
});

test("Keputusan nyata: setujui → status resmi berubah & pindah tab; alasan tolak wajib; tanpa Idempotency-Key ditolak (428) pada token mobile", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const doc1 = await buatExpense(ctx, { by: finance });
  const doc2 = await buatExpense(ctx, { by: finance, desc: "Lain" });
  const approver = await masuk(["APPROVER"]);

  const tanpaKunci = await raw("POST", `/api/finance/expenses/${doc1.id}/approve`, { token: approver.token, body: {} });
  assert.equal(tanpaKunci.status, 428);
  assert.equal((await testPrisma.finExpense.findUnique({ where: { id: doc1.id } })).status, "MENUNGGU_APPROVAL");

  const ok = await raw("POST", `/api/finance/expenses/${doc1.id}/approve`, { token: approver.token, headers: k(), body: {} });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  const setelah = (await daftar(approver, "?tab=DISETUJUI")).body;
  assert.equal(setelah.items.find((i) => i.id === doc1.id).status, "DIBAYAR", "LANGSUNG: disetujui = dibayar");
  assert.equal((await daftar(approver)).body.total, 1);
  assert.equal((await raw("GET", "/api/finance/approvals/ringkasan", { token: approver.token })).body.menunggu, 1);

  const kosong = await raw("POST", `/api/finance/expenses/${doc2.id}/reject`, { token: approver.token, headers: k(), body: { reason: "   " } });
  assert.equal(kosong.status, 400);
  assert.match(kosong.body.error, /Alasan penolakan wajib/);
  const tolak = await raw("POST", `/api/finance/expenses/${doc2.id}/reject`, { token: approver.token, headers: k(), body: { reason: "Bukan kebutuhan kantor" } });
  assert.equal(tolak.status, 200);
  assert.equal((await daftar(approver, "?tab=DITOLAK")).body.items[0].alasanTolak, "Bukan kebutuhan kantor");

  // audit trail atomik: satu peristiwa per keputusan
  const audit = await testPrisma.activityEvent.findMany({ where: { entityType: "fin_expense" }, orderBy: { createdAt: "asc" } });
  assert.deepEqual(audit.map((a) => a.eventType), ["DOCUMENT_APPROVED", "DOCUMENT_REJECTED"]);
});

test("Sudah diproses pengguna lain → 409 berbahasa Indonesia, tidak ada efek ganda", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const doc = await buatExpense(ctx, { by: finance });
  const a = await masuk(["APPROVER"]);
  const owner = await masuk(["OWNER"]);
  assert.equal((await raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: a.token, headers: k(), body: {} })).status, 200);
  const kedua = await raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: owner.token, headers: k(), body: {} });
  assert.equal(kedua.status, 409);
  assert.match(kedua.body.error, /sudah berstatus/);
  const tolakSetelah = await raw("POST", `/api/finance/expenses/${doc.id}/reject`, { token: owner.token, headers: k(), body: { reason: "terlambat" } });
  assert.equal(tolakSetelah.status, 409);
  const jurnal = await testPrisma.finJournalEntry.count({ where: { idempotencyKey: { contains: doc.id } } });
  assert.equal(jurnal, 1, "tepat satu jurnal");
});

test("BALAPAN: dua penyetuju menyetujui dokumen yang sama bersamaan → tepat satu 200, satu 409, satu jurnal", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  for (const jenis of ["expense", "purchase", "bill"]) {
    const doc = jenis === "expense" ? await buatExpense(ctx, { by: finance }) : jenis === "purchase" ? await buatPurchase(ctx, { by: finance }) : await buatBill(ctx, { by: finance });
    const a = await masuk(["APPROVER"]);
    const o = await masuk(["OWNER"]);
    const path = jenis === "expense" ? "expenses" : jenis === "purchase" ? "purchases" : "bills";
    const hasil = await Promise.all([
      raw("POST", `/api/finance/${path}/${doc.id}/approve`, { token: a.token, headers: k(), body: {} }),
      raw("POST", `/api/finance/${path}/${doc.id}/approve`, { token: o.token, headers: k(), body: {} }),
    ]);
    const status = hasil.map((h) => h.status).sort();
    assert.deepEqual(status, [200, 409], `${jenis}: ${JSON.stringify(hasil.map((h) => h.body))}`);
    const jurnal = await testPrisma.finJournalEntry.count({ where: { idempotencyKey: { contains: doc.id } } });
    assert.equal(jurnal, 1, `${jenis}: satu jurnal`);
  }
});

test("BALAPAN: setujui vs tolak bersamaan → satu menang; status akhir konsisten dengan pemenang", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const doc = await buatExpense(ctx, { by: finance });
  const a = await masuk(["APPROVER"]);
  const o = await masuk(["OWNER"]);
  const [s, t] = await Promise.all([
    raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: a.token, headers: k(), body: {} }),
    raw("POST", `/api/finance/expenses/${doc.id}/reject`, { token: o.token, headers: k(), body: { reason: "tidak perlu" } }),
  ]);
  assert.deepEqual([s.status, t.status].sort(), [200, 409]);
  const akhir = await testPrisma.finExpense.findUnique({ where: { id: doc.id } });
  assert.equal(akhir.status, s.status === 200 ? "DIBAYAR" : "DITOLAK");
  const jurnal = await testPrisma.finJournalEntry.count({ where: { idempotencyKey: { contains: doc.id } } });
  assert.equal(jurnal, s.status === 200 ? 1 : 0);
});

test("DOUBLE-TAP: Idempotency-Key SAMA dikirim dua kali bersamaan → tepat satu keputusan tercatat", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const doc = await buatExpense(ctx, { by: finance });
  const a = await masuk(["APPROVER"]);
  const kunci = { "Idempotency-Key": randomUUID() };
  const hasil = await Promise.all([
    raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: a.token, headers: kunci, body: {} }),
    raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: a.token, headers: kunci, body: {} }),
  ]);
  assert.ok(hasil.every((h) => [200, 409].includes(h.status)), JSON.stringify(hasil.map((h) => [h.status, h.body])));
  assert.ok(hasil.some((h) => h.status === 200));
  assert.equal(await testPrisma.finJournalEntry.count({ where: { idempotencyKey: { contains: doc.id } } }), 1);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "fin_expense", entityId: doc.id } }), 1);
  // Ulang setelah selesai (kunci sama) → balasan yang sama, bukan keputusan baru.
  const ulang = await raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: a.token, headers: kunci, body: {} });
  assert.equal(ulang.status, 200);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "fin_expense", entityId: doc.id } }), 1);
});

test("Izin dicabut di tengah sesi: token lama tetap hidup tetapi keputusan & daftar langsung 403", async () => {
  const ctx = await siapkan();
  const finance = await masuk(["FINANCE"]);
  const doc = await buatExpense(ctx, { by: finance });
  const a = await masuk(["APPROVER"]);
  assert.equal((await daftar(a)).status, 200);

  await testPrisma.userRole.deleteMany({ where: { userId: a.user.id } });
  await testPrisma.user.update({ where: { id: a.user.id }, data: { role: "SALES" } });

  const setuju = await raw("POST", `/api/finance/expenses/${doc.id}/approve`, { token: a.token, headers: k(), body: {} });
  assert.ok([401, 403].includes(setuju.status), `status ${setuju.status}`);
  assert.equal((await testPrisma.finExpense.findUnique({ where: { id: doc.id } })).status, "MENUNGGU_APPROVAL");
  assert.ok([401, 403].includes((await daftar(a)).status));
});

test("Verifikasi pembayaran TETAP terpisah: approver/owner/akuntan tidak bisa memverifikasi; capabilities tidak memuat PAYMENT_WRITE", async () => {
  for (const role of ["APPROVER", "OWNER", "ACCOUNTANT"]) {
    const u = await masuk([role]);
    const me = await raw("GET", "/api/auth/me", { token: u.token });
    assert.equal(me.body.capabilities.paymentWrite, false, role);
    const r = await raw("POST", "/api/finance/penerimaan/verifikasi", { token: u.token, headers: k(), body: { orderId: "x", mode: "REKENING" } });
    assert.equal(r.status, 403, role);
  }
});

test("Ringkasan lencana & pilihan pemohon", async () => {
  const ctx = await siapkan();
  const a = await masuk(["FINANCE"]);
  const b = await masuk(["ACCOUNTANT"]);
  await buatExpense(ctx, { by: a });
  await buatBill(ctx, { by: b });
  await buatRefund(ctx, { by: b });
  await buatExpense(ctx, { by: a, status: "DIBAYAR" });
  const approver = await masuk(["APPROVER"]);
  const r = await raw("GET", "/api/finance/approvals/ringkasan", { token: approver.token });
  assert.deepEqual(r.body, { menunggu: 3, perJenis: { expense: 1, purchase: 0, bill: 1, refund: 1 } });
  const p = await raw("GET", "/api/finance/approvals/pemohon", { token: approver.token });
  assert.deepEqual(p.body.pemohon.map((x) => x.id).sort(), [a.user.id, b.user.id].sort());
});
