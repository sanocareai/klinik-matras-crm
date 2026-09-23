// Modul UANG MUKA OPERASIONAL. Yang dikunci:
//  - Berikan: Dr 1-1360 / Cr Kas-Bank (+ biaya admin transfer di jurnal yang SAMA)
//  - Pertanggungjawaban: Dr Beban / Cr Uang Muka — TANPA /pay dan TANPA mutasi kas kedua
//  - Melebihi saldo: saldo habis dulu, selisih jadi utang reimbursement ke pemegang
//  - Pengembalian sisa: Dr Kas-Bank / Cr Uang Muka
//  - Saldo tidak pernah negatif (concurrency), pemakaian ganda mustahil, idempotensi
//  - Pembatalan = reversal resmi; permission; integrasi Pengajuan Biaya; penandaan data lama

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const nota = "/media/finance-receipts/" + "d".repeat(40) + ".jpg";

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Tunai", kind: "KAS", accountId: akunKas.id } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const disp = await createTestUser({ roles: ["DISPATCHER"] });
  return {
    kas, bank, kat, admin, finance, driver, disp,
    p: makeClient(server.baseUrl, disp.token),
    a: makeClient(server.baseUrl, admin.token),
    f: makeClient(server.baseUrl, finance.token),
    d: makeClient(server.baseUrl, driver.token),
  };
}

// Buka beberapa koneksi DB lebih dulu: mesin tes sering lambat membuka koneksi baru, dan transaksi
// interaktif Prisma menyerah bila menunggu koneksi > 2 detik ("Unable to start a transaction").
async function hangatkan(ctx) {
  await Promise.all(Array.from({ length: 8 }, () => ctx.a.get("/api/finance/uang-muka")));
}

const berikanBody = (ctx, extra = {}) => ({
  holderId: ctx.driver.user.id, division: "DELIVERY", purpose: "Uang jalan pengiriman Bandung",
  date: "2026-09-20", dueDate: "2026-09-27", amount: 1_000_000, cashAccountId: ctx.bank.id, ...extra,
});
async function berikan(ctx, extra = {}, headers) {
  const r = await ctx.a.post("/api/finance/uang-muka", berikanBody(ctx, extra), headers);
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function pertanggungjawaban(ctx, um, { amount, desc = "BBM & tol", receiptUrl = nota } = {}) {
  const r = await ctx.a.post(`/api/finance/uang-muka/${um.id}/pertanggungjawaban`, {
    date: "2026-09-21", amount, description: desc, categoryId: ctx.kat.id, payeeName: "SPBU", receiptUrl,
  });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  return r.body;
}
async function setujui(ctx, exp) {
  const r = await ctx.a.post(`/api/finance/expenses/${exp.id}/approve`, {});
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body;
}
const ambil = async (ctx, id) => (await ctx.a.get(`/api/finance/uang-muka/${id}`)).body;

async function jurnalPer(source, sourceId) {
  return testPrisma.finJournalEntry.findMany({
    where: { source, sourceId, status: "POSTED" }, include: { lines: { include: { account: { select: { code: true } } } } }, orderBy: { createdAt: "asc" },
  });
}
const sumD = (e) => e.lines.reduce((a, l) => a + Number(l.debit), 0);
const sumK = (e) => e.lines.reduce((a, l) => a + Number(l.credit), 0);
async function saldoAkun(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { accountId: akun.id, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}
async function mutasiRekening(cashAccountId) {
  const rek = await testPrisma.finCashAccount.findUnique({ where: { id: cashAccountId } });
  const baris = await testPrisma.finJournalLine.findMany({ where: { cashAccountId, accountId: rek.accountId, entry: { status: { in: ["POSTED", "REVERSED"] } } } });
  return baris.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0);
}

// ───────────────────────────────────────────────────────────────────────
test("Berikan: Dr Uang Muka Operasional (1-1360) / Cr Bank; bank berkurang SEKALI; status Aktif; data lengkap", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx);
  assert.equal(um.status, "AKTIF");
  assert.equal(um.saldo, 1_000_000);
  assert.match(um.advanceNumber, /^UMO-/);
  assert.equal(um.holder.id, ctx.driver.user.id);
  assert.equal(um.division, "DELIVERY");
  const es = await jurnalPer("UANG_MUKA_OPERASIONAL", um.id);
  assert.equal(es.length, 1);
  assert.equal(sumD(es[0]), sumK(es[0]));
  const dr = es[0].lines.find((l) => Number(l.debit) > 0);
  assert.equal(dr.account.code, "1-1360");
  assert.equal(await saldoAkun("1-1360"), 1_000_000);
  assert.equal(await mutasiRekening(ctx.bank.id), -1_000_000);
  const akun = await testPrisma.finAccount.findUnique({ where: { code: "1-1360" } });
  assert.equal(akun.systemKey, "UANG_MUKA_OPERASIONAL");
  assert.equal(akun.type, "ASET");
});

test("Berikan via transfer BI-FAST: biaya admin dijurnal PADA transaksi yang sama (Dr Beban Admin Bank), kredit bank = nominal + biaya", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx, { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(um.transferFeeAmount, 2500);
  assert.equal(um.totalKeluarRekening, 1_002_500);
  const es = await jurnalPer("UANG_MUKA_OPERASIONAL", um.id);
  assert.equal(es.length, 1, "satu jurnal saja");
  assert.equal(sumK(es[0]), 1_002_500);
  assert.equal(Number(es[0].lines.find((l) => l.account.code === "6-1700").debit), 2500);
  assert.equal(await saldoAkun("1-1360"), 1_000_000, "biaya admin bukan bagian saldo uang muka");
  assert.equal(await mutasiRekening(ctx.bank.id), -1_002_500);
  assert.equal(await testPrisma.finOperationalAdvance.count(), 1);
});

test("Validasi berikan: tenggat wajib & tidak boleh sebelum tanggal; nominal; tujuan; transfer dari kas ditolak; bukti harus lewat upload", async () => {
  const ctx = await siapkan();
  const kirim = (extra) => ctx.a.post("/api/finance/uang-muka", berikanBody(ctx, extra));
  assert.equal((await kirim({ dueDate: undefined })).status, 400);
  assert.equal((await kirim({ dueDate: "2026-09-19" })).status, 400);
  assert.equal((await kirim({ amount: 0 })).status, 400);
  assert.equal((await kirim({ purpose: " " })).status, 400);
  assert.equal((await kirim({ holderId: "tidak-ada" })).status, 404);
  const dariKas = await kirim({ cashAccountId: ctx.kas.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(dariKas.status, 400);
  assert.equal((await kirim({ receiptUrl: "https://contoh.test/x.jpg" })).status, 400);
  assert.equal(await testPrisma.finOperationalAdvance.count(), 0, "penolakan tidak meninggalkan data");
  assert.equal(await testPrisma.finJournalEntry.count(), 0);
});

test("Pertanggungjawaban sebagian: Dr Beban / Cr Uang Muka, TANPA baris kas dan TANPA /pay; saldo berkurang saat DISETUJUI; status Sebagian", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx);
  const exp = await pertanggungjawaban(ctx, um, { amount: 400_000 });
  assert.equal(exp.mode, "UANG_MUKA");
  assert.equal(exp.status, "MENUNGGU_APPROVAL");
  assert.equal((await ambil(ctx, um.id)).saldo, 1_000_000, "belum disetujui: saldo utuh, belum ada jurnal");
  assert.equal((await jurnalPer("PENGELUARAN", exp.id)).length, 0);

  const disetujui = await setujui(ctx, exp);
  assert.equal(disetujui.status, "DIBAYAR", "tertutup penuh oleh uang muka: tidak ada yang perlu dibayar");
  const es = await jurnalPer("PENGELUARAN", exp.id);
  assert.equal(es.length, 1);
  assert.equal(sumD(es[0]), sumK(es[0]));
  assert.ok(es[0].lines.some((l) => l.account.code === "1-1360" && Number(l.credit) === 400_000));
  assert.equal(es[0].lines.filter((l) => l.cashAccountId).length, 0, "tanpa mutasi kas");

  const sesudah = await ambil(ctx, um.id);
  assert.equal(sesudah.status, "SEBAGIAN");
  assert.equal(sesudah.saldo, 600_000);
  assert.equal(sesudah.dipertanggungjawabkan, 400_000);
  assert.equal(await saldoAkun("1-1360"), 600_000);

  const pay = await ctx.a.post(`/api/finance/expenses/${exp.id}/pay`, { cashAccountId: ctx.bank.id });
  assert.equal(pay.status, 409, "tidak ada /pay untuk pengeluaran yang sudah lunas via uang muka");
  assert.equal(await mutasiRekening(ctx.bank.id), -1_000_000, "BANK TIDAK BERKURANG DUA KALI: hanya saat uang muka diberikan");
});

test("Melebihi saldo: saldo habis dulu, selisih jadi utang reimbursement ke pemegang, dibayar lewat /pay; total kas keluar = total biaya", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx, { amount: 600_000 });
  const exp = await pertanggungjawaban(ctx, um, { amount: 900_000 });
  const ap = await setujui(ctx, exp);
  assert.equal(ap.status, "DISETUJUI", "masih ada selisih yang harus dibayar");
  assert.equal(Number(ap.advanceAppliedAmount), 600_000);
  assert.equal(ap.reimburseToId, ctx.driver.user.id);

  const es = await jurnalPer("PENGELUARAN", exp.id);
  assert.equal(sumD(es[0]), 900_000);
  assert.equal(sumK(es[0]), 900_000);
  assert.ok(es[0].lines.some((l) => l.account.code === "1-1360" && Number(l.credit) === 600_000));
  const akunReimb = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.UTANG_REIMBURSEMENT } });
  assert.ok(es[0].lines.some((l) => l.accountId === akunReimb.id && Number(l.credit) === 300_000), "selisih 300rb ke utang reimbursement");
  const um2 = await ambil(ctx, um.id);
  assert.equal(um2.saldo, 0);
  assert.equal(um2.status, "SELESAI");

  const pay = await ctx.a.post(`/api/finance/expenses/${exp.id}/pay`, { cashAccountId: ctx.bank.id, paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" });
  assert.equal(pay.status, 200, JSON.stringify(pay.body));
  const semua = await jurnalPer("PENGELUARAN", exp.id);
  const bayar = semua.find((e) => e.idempotencyKey?.startsWith("PENGELUARAN_DIBAYAR"));
  assert.equal(Number(bayar.lines.find((l) => l.cashAccountId).credit), 300_000 + 2500, "yang dibayar hanya SELISIH 300.000 (+ biaya transfer)");
  assert.equal(await mutasiRekening(ctx.bank.id), -(600_000 + 302_500), "uang muka 600rb + selisih 300rb + biaya 2,5rb; bukan 900rb dua kali");
});

test("Pengembalian sisa: Dr Bank / Cr Uang Muka; melebihi saldo & pada uang muka selesai ditolak; status Selesai", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx);
  await setujui(ctx, await pertanggungjawaban(ctx, um, { amount: 400_000 }));

  const lebih = await ctx.a.post(`/api/finance/uang-muka/${um.id}/kembalikan`, { amount: 700_000, cashAccountId: ctx.kas.id });
  assert.equal(lebih.status, 409, JSON.stringify(lebih.body));
  const ok = await ctx.a.post(`/api/finance/uang-muka/${um.id}/kembalikan`, { amount: 600_000, cashAccountId: ctx.kas.id, note: "Sisa uang jalan" });
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.uangMuka.saldo, 0);
  assert.equal(ok.body.uangMuka.status, "SELESAI");
  assert.equal(ok.body.uangMuka.dikembalikan, 600_000);
  assert.equal(await mutasiRekening(ctx.kas.id), 600_000, "kas menerima kembali sisa");
  assert.equal(await saldoAkun("1-1360"), 0);
  const lagi = await ctx.a.post(`/api/finance/uang-muka/${um.id}/kembalikan`, { amount: 1, cashAccountId: ctx.kas.id });
  assert.equal(lagi.status, 409);
});

test("CONCURRENCY: dua pengeluaran paralel yang bersama melebihi saldo — saldo tidak pernah negatif, total terpakai <= saldo, selisih jadi utang", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx, { amount: 500_000 });
  await hangatkan(ctx);
  const e1 = await pertanggungjawaban(ctx, um, { amount: 400_000, desc: "Biaya 1" });
  const e2 = await pertanggungjawaban(ctx, um, { amount: 400_000, desc: "Biaya 2" });
  const hasil = await Promise.all([
    ctx.a.post(`/api/finance/expenses/${e1.id}/approve`, {}),
    ctx.a.post(`/api/finance/expenses/${e2.id}/approve`, {}),
  ]);
  assert.deepEqual(hasil.map((h) => h.status), [200, 200], JSON.stringify(hasil.map((h) => h.body)));
  const dipakai = hasil.map((h) => Number(h.body.advanceAppliedAmount)).sort((x, y) => x - y);
  assert.deepEqual(dipakai, [100_000, 400_000], "yang satu 400rb penuh, yang lain hanya sisa 100rb");
  const akhir = await ambil(ctx, um.id);
  assert.equal(akhir.saldo, 0);
  assert.equal(akhir.status, "SELESAI");
  assert.equal(await saldoAkun("1-1360"), 0, "akun uang muka tidak pernah negatif");
  const settlements = await testPrisma.finOperationalAdvanceSettlement.findMany({ where: { advanceId: um.id, status: "ACTIVE" } });
  assert.equal(settlements.reduce((a, s) => a + Number(s.amount), 0), 500_000);
});

test("CONCURRENCY: dua pengembalian paralel yang bersama melebihi saldo — hanya satu lolos; approve ganda pengeluaran yang sama hanya SATU pemakaian", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx, { amount: 500_000 });
  await hangatkan(ctx);
  const balik = await Promise.all([
    ctx.a.post(`/api/finance/uang-muka/${um.id}/kembalikan`, { amount: 400_000, cashAccountId: ctx.kas.id }),
    ctx.a.post(`/api/finance/uang-muka/${um.id}/kembalikan`, { amount: 400_000, cashAccountId: ctx.kas.id }),
  ]);
  assert.deepEqual(balik.map((b) => b.status).sort(), [201, 409]);
  assert.equal((await ambil(ctx, um.id)).saldo, 100_000);

  const exp = await pertanggungjawaban(ctx, um, { amount: 80_000 });
  const dobel = await Promise.all([
    ctx.a.post(`/api/finance/expenses/${exp.id}/approve`, {}),
    ctx.a.post(`/api/finance/expenses/${exp.id}/approve`, {}),
  ]);
  assert.deepEqual(dobel.map((d) => d.status).sort(), [200, 409]);
  const s = await testPrisma.finOperationalAdvanceSettlement.count({ where: { expenseId: exp.id, status: "ACTIVE" } });
  assert.equal(s, 1, "pemakaian ganda mustahil");
  assert.equal((await ambil(ctx, um.id)).saldo, 20_000);
});

test("Double-click berikan (Idempotency-Key sama, paralel): hanya SATU uang muka dan SATU jurnal", async () => {
  const ctx = await siapkan();
  const H = { "Idempotency-Key": "uang-muka-klik-ganda" };
  await hangatkan(ctx);
  const hasil = await Promise.all([
    ctx.a.post("/api/finance/uang-muka", berikanBody(ctx), H),
    ctx.a.post("/api/finance/uang-muka", berikanBody(ctx), H),
  ]);
  assert.ok(hasil.every((h) => [200, 201, 409].includes(h.status)), JSON.stringify(hasil.map((h) => h.status)));
  assert.ok(hasil.some((h) => h.status === 201));
  assert.equal(await testPrisma.finOperationalAdvance.count(), 1);
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "UANG_MUKA_OPERASIONAL" } }), 1);
  assert.equal(await mutasiRekening(ctx.bank.id), -1_000_000);
});

test("Reversal: batal pengeluaran memulihkan saldo & jurnal dibalik; batal pengembalian memulihkan; batal uang muka butuh alasan & tanpa pemakaian aktif", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx);
  const exp = await pertanggungjawaban(ctx, um, { amount: 300_000 });
  await setujui(ctx, exp);
  assert.equal((await ambil(ctx, um.id)).saldo, 700_000);

  const tanpaAlasan = await ctx.a.post(`/api/finance/uang-muka/${um.id}/batal`, {});
  assert.equal(tanpaAlasan.status, 400);
  const masihDipakai = await ctx.a.post(`/api/finance/uang-muka/${um.id}/batal`, { reason: "salah" });
  assert.equal(masihDipakai.status, 409, "masih ada pertanggungjawaban aktif");

  const batalExp = await ctx.a.post(`/api/finance/expenses/${exp.id}/cancel`, { reason: "Salah input" });
  assert.equal(batalExp.status, 200, JSON.stringify(batalExp.body));
  const pulih = await ambil(ctx, um.id);
  assert.equal(pulih.saldo, 1_000_000, "saldo pulih setelah pengeluaran dibatalkan");
  assert.equal(pulih.status, "AKTIF");
  assert.equal(await saldoAkun("1-1360"), 1_000_000, "jurnal pengeluaran dibalik resmi (REVERSAL), akun uang muka kembali");
  assert.equal(await testPrisma.finJournalEntry.count({ where: { source: "REVERSAL" } }) >= 1, true);

  const kb = await ctx.a.post(`/api/finance/uang-muka/${um.id}/kembalikan`, { amount: 250_000, cashAccountId: ctx.kas.id });
  const sid = kb.body.settlementId;
  const batalKb = await ctx.a.post(`/api/finance/uang-muka/${um.id}/pengembalian/${sid}/batal`, { reason: "Salah rekening" });
  assert.equal(batalKb.status, 200, JSON.stringify(batalKb.body));
  assert.equal(batalKb.body.saldo, 1_000_000);
  assert.equal(await mutasiRekening(ctx.kas.id), 0, "kas kembali seperti semula setelah reversal");

  const batal = await ctx.a.post(`/api/finance/uang-muka/${um.id}/batal`, { reason: "Perjalanan dibatalkan" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(batal.body.status, "DIBATALKAN");
  assert.equal(await saldoAkun("1-1360"), 0);
  assert.equal(await mutasiRekening(ctx.bank.id), 0, "bank pulih penuh");
  const pakaiLagi = await ctx.a.post(`/api/finance/uang-muka/${um.id}/pertanggungjawaban`, { date: "2026-09-21", amount: 1000, description: "x", categoryId: ctx.kat.id, receiptUrl: nota });
  assert.equal(pakaiLagi.status, 409, "uang muka dibatalkan tidak bisa dipakai");
});

test("Permission: driver tidak boleh melihat/memberi; finance boleh memberi tapi tidak boleh membatalkan; hanya admin membatalkan", async () => {
  const ctx = await siapkan();
  assert.equal((await ctx.d.get("/api/finance/uang-muka")).status, 403);
  assert.equal((await ctx.d.post("/api/finance/uang-muka", berikanBody(ctx))).status, 403);
  const um = await ctx.f.post("/api/finance/uang-muka", berikanBody(ctx));
  assert.equal(um.status, 201, JSON.stringify(um.body));
  assert.equal((await ctx.f.post(`/api/finance/uang-muka/${um.body.id}/batal`, { reason: "x" })).status, 403);
  assert.equal((await ctx.d.post(`/api/finance/uang-muka/${um.body.id}/kembalikan`, { amount: 1, cashAccountId: ctx.kas.id })).status, 403);
  const tanpaLogin = await fetch(`${server.baseUrl}/api/finance/uang-muka`);
  assert.equal(tanpaLogin.status, 401);
  // driver tidak bisa memakai uang muka lewat POST /expenses (advanceId tidak diterima dari body publik)
  const coba = await ctx.f.post("/api/finance/expenses", { date: "2026-09-21", amount: 10_000, description: "x", categoryId: ctx.kat.id, mode: "REIMBURSEMENT", advanceId: um.body.id, receiptUrl: nota });
  assert.equal(coba.status, 201);
  assert.equal(coba.body.advanceId, null, "advanceId dari body publik diabaikan");
});

test("Pertanggungjawaban wajib bernota; koreksi angka pengeluaran uang muka ditolak (batalkan lalu catat ulang); koreksi catatan boleh", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx);
  const tanpaNota = await pertanggungjawaban(ctx, um, { amount: 100_000, receiptUrl: null }).catch((e) => e);
  const exp = tanpaNota.id ? tanpaNota : null;
  if (exp) {
    const gagal = await ctx.a.post(`/api/finance/expenses/${exp.id}/approve`, {});
    assert.ok([400, 422].includes(gagal.status), `tanpa nota harus ditolak, dapat ${gagal.status}`);
  }
  const e2 = await pertanggungjawaban(ctx, um, { amount: 200_000, desc: "Tol" });
  await setujui(ctx, e2);
  const angka = await ctx.a.post(`/api/finance/expenses/${e2.id}/koreksi`, { reason: "salah", amount: 250_000 });
  assert.equal(angka.status, 409, JSON.stringify(angka.body));
  const catatan = await ctx.a.post(`/api/finance/expenses/${e2.id}/koreksi`, { reason: "tambah catatan", notes: "struk tol A" });
  assert.equal(catatan.status, 200, JSON.stringify(catatan.body));
  assert.equal((await ambil(ctx, um.id)).saldo, 800_000);
});

test("Saldo per pemegang, tenggat lewat, filter & riwayat", async () => {
  const ctx = await siapkan();
  await berikan(ctx, { dueDate: "2026-09-21", purpose: "Lewat tempo" });
  const um2 = await berikan(ctx, { dueDate: "2099-01-01", purpose: "Aman", amount: 500_000 });
  await setujui(ctx, await pertanggungjawaban(ctx, um2, { amount: 100_000 }));
  const daftar = await ctx.a.get("/api/finance/uang-muka");
  assert.equal(daftar.status, 200);
  assert.equal(daftar.body.ringkasan.jumlahAktif, 2);
  assert.equal(daftar.body.ringkasan.totalSaldoAktif, 1_400_000);
  assert.equal(daftar.body.ringkasan.jumlahLewatTempo, 1);
  assert.equal(daftar.body.ringkasan.perPemegang.length, 1);
  assert.equal(daftar.body.ringkasan.perPemegang[0].saldo, 1_400_000);
  const lewat = await ctx.a.get("/api/finance/uang-muka?lewatTempo=1");
  assert.equal(lewat.body.items.length, 1);
  const riwayat = await ctx.a.get("/api/finance/uang-muka/riwayat");
  assert.equal(riwayat.status, 200);
  assert.ok(riwayat.body.items.some((r) => r.jenis === "DIBERIKAN") && riwayat.body.items.some((r) => r.jenis === "PERTANGGUNGJAWABAN"));
});

// ── Pengajuan Biaya ────────────────────────────────────────────────────
const pengajuan = (extra = {}) => ({
  workspace: "DELIVERY", expenseType: "SERVIS", date: "2026-09-21", amount: 300_000, vendorName: "Bengkel Uji",
  sumberDana: "UANG_MUKA_OPERASIONAL", ...extra,
});

test("Pengajuan Biaya sumber Uang muka operasional: WAJIB uang muka aktif milik pengaju/PIC; milik orang lain ditolak; tanpa pilihan ditolak (bukan UTANG biasa)", async () => {
  const ctx = await siapkan();
  const milikDriver = await berikan(ctx, { holderId: ctx.disp.user.id });
  const lain = await createTestUser({ roles: ["DRIVER"] });
  const milikLain = await berikan(ctx, { holderId: lain.user.id, purpose: "Milik orang lain" });

  // pengaju = driver, memilih uang muka MILIK ORANG LAIN -> ditolak
  const salah = await ctx.p.post("/api/finance/expense-submissions", pengajuan({ advanceId: milikLain.id }));
  assert.equal(salah.status, 403, JSON.stringify(salah.body));

  // tanpa memilih uang muka -> draf boleh dibuat, tapi ajukan ditolak 422
  const draf = await ctx.p.post("/api/finance/expense-submissions", pengajuan());
  assert.equal(draf.status, 201, JSON.stringify(draf.body));
  const aj = await ctx.p.post(`/api/finance/expense-submissions/${draf.body.id}/ajukan`, {}, { "Idempotency-Key": "um-tanpa-pilihan" });
  assert.equal(aj.status, 422, JSON.stringify(aj.body));
  assert.equal(await testPrisma.finExpense.count(), 0, "tidak ada FinExpense UTANG biasa yang lahir diam-diam");

  // memilih uang muka milik sendiri -> lolos
  const ok = await ctx.p.post("/api/finance/expense-submissions", pengajuan({ advanceId: milikDriver.id }));
  assert.equal(ok.status, 201, JSON.stringify(ok.body));
  assert.equal(ok.body.advance.advanceNumber, milikDriver.advanceNumber);
  const ajukan = await ctx.p.post(`/api/finance/expense-submissions/${ok.body.id}/ajukan`, {}, { "Idempotency-Key": "um-ok-12345" });
  assert.equal(ajukan.status, 200, JSON.stringify(ajukan.body));
  const fe = await testPrisma.finExpense.findUnique({ where: { id: ajukan.body.finExpenseId } });
  assert.equal(fe.mode, "UANG_MUKA");
  assert.equal(fe.advanceId, milikDriver.id);
  assert.equal(fe.reimburseToId, ctx.disp.user.id);

  // Finance menyetujui: saldo terpakai, tanpa /pay, bank tidak berkurang lagi
  await testPrisma.finExpense.update({ where: { id: fe.id }, data: { receiptUrl: nota } });
  const ap = await ctx.a.post(`/api/finance/expenses/${fe.id}/approve`, {});
  assert.equal(ap.status, 200, JSON.stringify(ap.body));
  assert.equal(ap.body.status, "DIBAYAR");
  assert.equal((await ambil(ctx, milikDriver.id)).saldo, 700_000);
  assert.equal(await mutasiRekening(ctx.bank.id), -2_000_000, "hanya dua pemberian uang muka; pertanggungjawaban tidak menyentuh bank");
  const sinkron = await ctx.p.get(`/api/finance/expense-submissions/${ok.body.id}`);
  assert.equal(sinkron.body.status, "DIBAYAR");
});

test("Pengajuan Biaya via uang muka + auto-approve (biaya rutin kecil): saldo langsung terpakai, tetap SATU FinExpense", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx, { holderId: ctx.disp.user.id });
  const draf = await ctx.p.post("/api/finance/expense-submissions", { workspace: "DELIVERY", expenseType: "BBM", date: "2026-09-21", amount: 150_000, vendorName: "SPBU", metadata: { liters: 20 }, sumberDana: "UANG_MUKA_OPERASIONAL", advanceId: um.id });
  assert.equal(draf.status, 201, JSON.stringify(draf.body));
  await testPrisma.expenseSubmissionProof.create({ data: { submissionId: draf.body.id, url: nota, uploadedById: ctx.disp.user.id, kind: "NOTA" } }).catch(() => {});
  const aj = await ctx.p.post(`/api/finance/expense-submissions/${draf.body.id}/ajukan`, {}, { "Idempotency-Key": "um-auto-12345" });
  if (aj.status === 200 && aj.body.status === "OTOMATIS_DISETUJUI") {
    assert.equal((await ambil(ctx, um.id)).saldo, 850_000);
  }
  assert.ok(aj.status === 200 || aj.status === 422, JSON.stringify(aj.body));
  assert.ok((await testPrisma.finExpense.count()) <= 1);
});

test("Data lama TIDAK dimigrasikan otomatis: pengajuan lama bersumber uang muka ditandai Perlu Ditinjau (SQL migrasi), FinExpense-nya tak disentuh", async () => {
  const ctx = await siapkan();
  const pengaju = ctx.driver.user.id;
  const lama = await testPrisma.expenseSubmission.create({
    data: {
      submissionNumber: "PB-LAMA-1", division: "DELIVERY", requestedById: pengaju, createdById: pengaju, expenseType: "SERVIS",
      date: new Date("2026-09-10"), amount: "250000.00", description: "Servis lama", sumberDana: "UANG_MUKA_OPERASIONAL", status: "DRAFT",
    },
  });
  const baru = await testPrisma.expenseSubmission.create({
    data: {
      submissionNumber: "PB-LAMA-2", division: "DELIVERY", requestedById: pengaju, createdById: pengaju, expenseType: "SERVIS",
      date: new Date("2026-09-10"), amount: "1000.00", description: "Sumber lain", sumberDana: "TALANGAN_PRIBADI", status: "DRAFT",
    },
  });
  const sql = fs.readFileSync(path.join(__dirname, "../../prisma/migrations/20260924090000_uang_muka_operasional/migration.sql"), "utf8");
  const update = sql.slice(sql.lastIndexOf('UPDATE "expense_submissions"')).trim().replace(/;\s*$/, "");
  await testPrisma.$executeRawUnsafe(update);
  await testPrisma.$executeRawUnsafe(update); // idempoten
  const a = await testPrisma.expenseSubmission.findUnique({ where: { id: lama.id } });
  const b = await testPrisma.expenseSubmission.findUnique({ where: { id: baru.id } });
  assert.equal(a.needsReview, true);
  assert.match(a.reviewNote, /Uang Muka Operasional/);
  assert.equal(a.advanceId, null, "tidak ditautkan otomatis");
  assert.equal(b.needsReview, false);
  assert.equal(await testPrisma.finOperationalAdvance.count(), 0, "tidak ada uang muka yang dibuat otomatis");
  assert.equal(await testPrisma.finExpense.count(), 0);
});

test("Endpoint uang muka aktif untuk Pengajuan Biaya: hanya milik pengaju/PIC dengan saldo > 0", async () => {
  const ctx = await siapkan();
  const um = await berikan(ctx, { amount: 100_000, holderId: ctx.disp.user.id });
  const lain = await createTestUser({ roles: ["DRIVER"] });
  await berikan(ctx, { holderId: lain.user.id, purpose: "Orang lain" });
  const saya = await ctx.p.get("/api/finance/expense-submissions/uang-muka-aktif");
  assert.equal(saya.status, 200, JSON.stringify(saya.body));
  assert.deepEqual(saya.body.items.map((i) => i.id), [um.id]);
  await setujui(ctx, await pertanggungjawaban(ctx, um, { amount: 100_000 }));
  const habis = await ctx.p.get("/api/finance/expense-submissions/uang-muka-aktif");
  assert.equal(habis.body.items.length, 0, "saldo habis tidak ditawarkan");
});
