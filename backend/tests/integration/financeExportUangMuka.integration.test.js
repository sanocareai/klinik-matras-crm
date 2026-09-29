// EXPORT EXCEL FINANCE — UANG MUKA OPERASIONAL (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /uang-muka, /uang-muka/riwayat,
// /expenses?mode=UANG_MUKA), mengikuti TAB aktif, kartu ringkasan & total sedasar layar, nominal ANGKA, izin (401/403),
// kolom sensitif (tautan bukti, catatan, alasan batal) hanya Admin Keuangan, tanggal WIB, formula dinetralkan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const nota = "/media/finance-receipts/" + "d".repeat(40) + ".jpg";

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const driver1 = await createTestUser({ roles: ["DRIVER"] });
  const driver2 = await createTestUser({ roles: ["DRIVER"] });
  await testPrisma.user.update({ where: { id: driver1.user.id }, data: { name: "Driver Satu" } });
  await testPrisma.user.update({ where: { id: driver2.user.id }, data: { name: "Driver Dua" } });
  const a = makeClient(server.baseUrl, admin.token);

  const berikan = async (holder, extra) => {
    const r = await a.post("/api/finance/uang-muka", { holderId: holder.user.id, division: "DELIVERY", purpose: "Uang jalan Bandung", date: "2026-09-20", dueDate: "2026-09-27", amount: 1_000_000, cashAccountId: bank.id, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const um1 = await berikan(driver1, { purpose: "=Uang jalan Bandung" });            // lewat tenggat, dipakai + dikembalikan
  const um2 = await berikan(driver2, { purpose: "Uang tol", amount: 500_000, dueDate: "2027-01-01" });
  const um3 = await berikan(driver2, { purpose: "Salah catat", amount: 250_000 });
  assert.equal((await a.post(`/api/finance/uang-muka/${um3.id}/batal`, { reason: "Perjalanan dibatalkan" })).status, 200);
  await testPrisma.finOperationalAdvance.update({ where: { id: um1.id }, data: { receiptUrl: nota, notes: "=CATATAN RAHASIA" } });

  // um1: pertanggungjawaban 300.000 (disetujui) + pengembalian 200.000. um2: pertanggungjawaban 100.000 belum disetujui.
  const pj = async (um, amount, desc) => {
    const r = await a.post(`/api/finance/uang-muka/${um.id}/pertanggungjawaban`, { date: "2026-09-21", amount, description: desc, categoryId: kat.id, payeeName: "SPBU", receiptUrl: nota });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const e1 = await pj(um1, 300_000, "BBM & tol");
  assert.equal((await a.post(`/api/finance/expenses/${e1.id}/approve`, {})).status, 200);
  const e2 = await pj(um2, 100_000, "Parkir");
  const kb = await a.post(`/api/finance/uang-muka/${um1.id}/kembalikan`, { amount: 200_000, cashAccountId: bank.id, note: "Sisa uang jalan", date: "2026-09-22" });
  assert.equal(kb.status, 201, JSON.stringify(kb.body));
  return { bank, admin, finance, sales, a, driver1, driver2, um1, um2, um3, e1, e2 };
}

const U = { nomor: "No. Uang Muka", nominal: "Nominal (Rp)", pj: "Dipertanggungjawabkan (Rp)", kembali: "Dikembalikan (Rp)", saldo: "Saldo (Rp)" };

test("Tab Saldo Aktif = GET /uang-muka: baris, nominal ANGKA, saldo, lewat tenggat; total saldo = kartu Saldo Uang Muka Aktif; Saldo per Pemegang & Ringkasan sama dengan layar", async () => {
  const ctx = await siapkan();
  const layar = (await ctx.a.get("/api/finance/uang-muka")).body;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "SALDO" }, filterLabel: "Tab: Saldo Aktif" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Uang_Muka_per_\d{4}-\d{2}-\d{2}\.xlsx"/);
  const s = bacaSheet(r.wb, "Uang Muka");
  assert.deepEqual(s.baris.map((b) => b[U.nomor]), layar.items.map((u) => u.advanceNumber), "urutan = urutan layar");
  for (const u of layar.items) {
    const x = s.baris.find((b) => b[U.nomor] === u.advanceNumber);
    assert.equal(typeof x[U.nominal], "number");
    assert.equal(x[U.nominal], u.amount); assert.equal(x[U.pj], u.dipertanggungjawabkan); assert.equal(x[U.kembali], u.dikembalikan); assert.equal(x[U.saldo], u.saldo);
    assert.equal(x["Lewat Tenggat"], u.lewatTempo ? "Ya" : "Tidak");
    assert.equal(x["Divisi"], "Delivery");
  }
  const x1 = s.baris.find((b) => b[U.nomor] === ctx.um1.advanceNumber);
  assert.equal(x1["Status"], "Sebagian");
  assert.equal(x1[U.saldo], 500_000);
  assert.equal(x1["Lewat Tenggat"], "Ya");
  assert.equal(x1["Pemegang"], "Driver Satu");
  assert.equal(x1["Tujuan"], "'=Uang jalan Bandung", "tujuan berawalan = dinetralkan");
  assert.equal(x1["Rekening Sumber"], "BCA Operasional");
  assert.ok(x1["Tanggal Diberikan"] instanceof Date && x1["Tanggal Diberikan"].toISOString().slice(0, 10) === "2026-09-20");
  assert.equal(s.baris.find((b) => b[U.nomor] === ctx.um3.advanceNumber)["Status"], "Dibatalkan");
  // total: saldo hanya uang muka aktif (= kartu); nominal tidak menghitung yang dibatalkan
  assert.equal(s.total[U.saldo], layar.ringkasan.totalSaldoAktif);
  assert.equal(s.total[U.nominal], 1_500_000);
  assert.equal(s.total[U.pj], 300_000);
  assert.equal(s.total[U.kembali], 200_000);
  const pp = bacaSheet(r.wb, "Saldo per Pemegang");
  assert.deepEqual(pp.baris.map((b) => [b["Pemegang"], b["Saldo (Rp)"]]), layar.ringkasan.perPemegang.map((p) => [p.nama, p.saldo]));
  assert.equal(pp.total["Saldo (Rp)"], layar.ringkasan.totalSaldoAktif);
  const ring = bacaSheet(r.wb, "Ringkasan");
  const rowOf = (t) => ring.baris.find((b) => String(b["Indikator"]).startsWith(t));
  assert.equal(rowOf("Saldo Uang Muka Aktif")["Nilai (Rp)"], layar.ringkasan.totalSaldoAktif);
  assert.equal(rowOf("Uang Muka Aktif")["Jumlah"], layar.ringkasan.jumlahAktif);
  assert.equal(rowOf("Lewat Tenggat")["Jumlah"], layar.ringkasan.jumlahLewatTempo);
  assert.equal(rowOf("Pemegang")["Jumlah"], layar.ringkasan.perPemegang.length);
  assert.throws(() => bacaSheet(r.wb, "Riwayat"), /tidak ada/, "tab Saldo hanya memuat sheet tab itu");
});

test("Tab Pertanggungjawaban = GET /expenses?mode=UANG_MUKA; Pengembalian & Riwayat = GET /uang-muka/riwayat", async () => {
  const ctx = await siapkan();
  const layarExp = (await ctx.a.get("/api/finance/expenses?mode=UANG_MUKA&from=2020-01-01&to=2099-12-31")).body.expenses;
  assert.equal(layarExp.length, 2);
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "PERTANGGUNGJAWABAN" } });
  const s = bacaSheet(r.wb, "Pertanggungjawaban");
  assert.deepEqual(s.baris.map((b) => b["No. Pengeluaran"]), layarExp.map((e) => e.expenseNumber));
  const disetujui = s.baris.find((b) => b["No. Pengeluaran"] === ctx.e1.expenseNumber);
  assert.equal(disetujui["Nominal (Rp)"], 300_000); assert.equal(disetujui["Dari Uang Muka (Rp)"], 300_000); assert.equal(disetujui["Selisih / Utang (Rp)"], 0);
  assert.equal(disetujui["Status"], "Dibayar", "mode uang muka: disetujui langsung tercatat Dibayar (tanpa langkah bayar)");
  assert.equal(disetujui["No. Uang Muka"], ctx.um1.advanceNumber);
  const menunggu = s.baris.find((b) => b["No. Pengeluaran"] === ctx.e2.expenseNumber);
  assert.equal(menunggu["Dari Uang Muka (Rp)"], null, "belum disetujui: kolom kosong seperti layar ('menunggu')");
  assert.equal(s.total["Nominal (Rp)"], 300_000, "total hanya pengeluaran disetujui");
  const ids = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "PERTANGGUNGJAWABAN" }, ids: [ctx.e2.id, ctx.e1.id] });
  assert.deepEqual(bacaSheet(ids.wb, "Pertanggungjawaban").baris.map((b) => b["No. Pengeluaran"]), [ctx.e2.expenseNumber, ctx.e1.expenseNumber]);

  const riwayat = (await ctx.a.get("/api/finance/uang-muka/riwayat")).body.items;
  const pk = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "PENGEMBALIAN" } });
  const sp = bacaSheet(pk.wb, "Pengembalian");
  assert.equal(sp.baris.length, riwayat.filter((x) => x.jenis === "PENGEMBALIAN").length);
  assert.equal(sp.baris[0]["Nominal (Rp)"], 200_000);
  assert.equal(sp.baris[0]["Keterangan"], "Sisa uang jalan");
  assert.equal(sp.total["Nominal (Rp)"], 200_000);
  const rw = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "RIWAYAT" } });
  const sr = bacaSheet(rw.wb, "Riwayat");
  sr.baris = sr.baris.filter((b) => !String(b["No. Uang Muka"]).startsWith("Riwayat memuat")); // baris catatan di bawah tabel (sheet tanpa baris total)
  assert.equal(sr.baris.length, riwayat.length);
  assert.deepEqual(sr.baris.map((b) => b["Jenis"]), riwayat.map((x) => ({ DIBERIKAN: "Diberikan", PERTANGGUNGJAWABAN: "Pertanggungjawaban", PENGEMBALIAN: "Pengembalian" })[x.jenis]));
  assert.ok(sr.baris.some((b) => b["Status"] === "Dibatalkan" && b["Alasan Pembatalan"] === "Perjalanan dibatalkan"));
});

test("Tanpa tab: semua sheet; ids pada tab Saldo mengikuti urutan layar tetapi kartu tetap dari seluruh uang muka", async () => {
  const ctx = await siapkan();
  const semua = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", {});
  for (const n of ["Uang Muka", "Pertanggungjawaban", "Pengembalian", "Riwayat", "Ringkasan"]) assert.ok(semua.wb.getWorksheet(n), `sheet ${n}`);
  const layar = (await ctx.a.get("/api/finance/uang-muka")).body;
  const ids = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "SALDO" }, ids: [ctx.um2.id, ctx.um1.id] });
  assert.deepEqual(bacaSheet(ids.wb, "Uang Muka").baris.map((b) => b[U.nomor]), [ctx.um2.advanceNumber, ctx.um1.advanceNumber]);
  assert.equal(bacaSheet(ids.wb, "Ringkasan").baris[0]["Nilai (Rp)"], layar.ringkasan.totalSaldoAktif);
  const kosong = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "SALDO" }, ids: [] });
  assert.equal(bacaSheet(kosong.wb, "Uang Muka").baris.length, 0);
});

test("Izin & keamanan: 401 tanpa login, 403 SALES, FINANCE boleh tetapi tautan bukti/catatan/alasan batal TIDAK ikut; ADMIN dapat; periode rusak 400", async () => {
  const ctx = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "uang-muka")).status, 401);
  assert.equal((await unduhExport(server.baseUrl, ctx.sales.token, "uang-muka")).status, 403);
  assert.equal((await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { periode: { to: "2026-13-01" } })).status, 400);
  const fin = await unduhExport(server.baseUrl, ctx.finance.token, "uang-muka", { filter: { tab: "SALDO" } });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Uang Muka");
  for (const k of ["Tautan Bukti", "Catatan Internal", "Alasan Pembatalan"]) assert.ok(!sf.header.includes(k), `${k} tidak boleh ada untuk FINANCE`);
  const adm = await unduhExport(server.baseUrl, ctx.admin.token, "uang-muka", { filter: { tab: "SALDO" } });
  const sa = bacaSheet(adm.wb, "Uang Muka");
  const x1 = sa.baris.find((b) => b[U.nomor] === ctx.um1.advanceNumber);
  assert.equal(x1["Tautan Bukti"], nota);
  assert.equal(x1["Catatan Internal"], "'=CATATAN RAHASIA");
  assert.equal(sa.baris.find((b) => b[U.nomor] === ctx.um3.advanceNumber)["Alasan Pembatalan"], "Perjalanan dibatalkan");
});
