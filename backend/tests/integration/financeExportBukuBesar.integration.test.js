// EXPORT EXCEL FINANCE — BUKU BESAR (B3.9). Yang dikunci: berkas = data layar (GET /reports/ledger/:accountId): saldo awal, tiap mutasi dengan saldo
// berjalan, total debit/kredit, saldo akhir; filter klien layar (ids) menghasilkan baris yang sama dengan urutan layar TANPA mengubah saldo berjalan;
// mutasi > 500 baris (batas layar) tetap ikut; nominal angka; periode diikuti; izin (401/403); formula dinetralkan; akun wajib/valid.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal, reverseJournal } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let urut = 0;
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const kasA = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: kasA.id } });
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  const beban = await testPrisma.finAccount.findFirst({ where: { type: "BEBAN", isPostable: true } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const customer = await testPrisma.customer.create({ data: { name: "Ibu Erni" } });
  return { kasA, kas, modal, beban, admin, finance, sales, customer, a: makeClient(server.baseUrl, admin.token) };
}
const jurnal = (c, { tanggal = "2026-09-10", desc = "uji", source = "MANUAL", baris }) => testPrisma.$transaction((tx) => postJournal(tx, {
  date: tanggal, description: desc, source, idempotencyKey: `BB:${++urut}`, userId: c.admin.user.id, lines: baris,
}));
const masuk = (c, nilai, extra = {}) => jurnal(c, { ...extra, baris: [
  { accountId: c.kasA.id, cashAccountId: c.kas.id, debit: toMoney(nilai), customerId: c.customer.id },
  { accountId: c.modal.id, credit: toMoney(nilai) },
] });
const keluar = (c, nilai, extra = {}) => jurnal(c, { source: "PENGELUARAN", ...extra, baris: [
  { accountId: c.beban.id, debit: toMoney(nilai) },
  { accountId: c.kasA.id, cashAccountId: c.kas.id, credit: toMoney(nilai) },
] });
const PER = "from=2026-09-01&to=2026-09-30";
const periode = { from: "2026-09-01", to: "2026-09-30" };

async function dataLengkap() {
  const c = await siapkan();
  await masuk(c, 1_000_000, { tanggal: "2026-08-31", desc: "Saldo dari Agustus" });
  await masuk(c, 5_000_000, { tanggal: "2026-09-10", desc: "Setoran modal" });
  await keluar(c, 80_000.5, { tanggal: "2026-09-12", desc: "Beli ATK" });
  const salah = (await masuk(c, 300_000, { tanggal: "2026-09-15", desc: "=HYPERLINK(\"http://x\")" })).entry;
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: salah.id, date: "2026-09-20", reason: "salah input", userId: c.admin.user.id }));
  await masuk(c, 42, { tanggal: "2026-10-01", desc: "Oktober" });
  return c;
}
const layarKas = async (c, q = "") => (await c.a.get(`/api/finance/reports/ledger/${c.kasA.id}?${PER}${q}`)).body;

test("Berkas Buku Besar = data layar: saldo awal, mutasi berurut dengan saldo berjalan, total debit/kredit, saldo akhir", async () => {
  const c = await dataLengkap();
  const layar = await layarKas(c);
  assert.equal(layar.baris.length, 4, "Sep: setoran, ATK, jurnal salah, jurnal balik");
  const r = await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: c.kasA.id } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Buku_Besar_2026-09-01_sd_2026-09-30\.xlsx"/);
  const s = bacaSheet(r.wb, "Buku Besar");
  assert.match(s.kepala[0], new RegExp(`Buku Besar — ${layar.account.code} · ${layar.account.name}`));
  assert.match(s.kepala[1], /Periode: 1 Sep 2026 – 30 Sep 2026/);

  // baris pertama = saldo awal; sisanya = mutasi persis urutan layar
  assert.equal(s.baris[0]["Keterangan"], "Saldo awal periode");
  assert.equal(s.baris[0]["Saldo Berjalan (Rp)"], layar.saldoAwal);
  assert.equal(layar.saldoAwal, 1_000_000);
  const mutasi = s.baris.slice(1);
  assert.equal(mutasi.length, layar.baris.length);
  layar.baris.forEach((b, i) => {
    const x = mutasi[i];
    assert.equal(x["No. Jurnal"], b.entryNumber, `urutan #${i}`);
    assert.equal(typeof x["Saldo Berjalan (Rp)"], "number");
    assert.equal(x["Saldo Berjalan (Rp)"], b.saldo, `saldo berjalan #${i}`);
    assert.equal(x["Debit (Rp)"], b.debit);
    assert.equal(x["Kredit (Rp)"], b.kredit);
  });
  const atk = mutasi.find((x) => x["Keterangan"] === "Beli ATK");
  assert.equal(atk["Kredit (Rp)"], 80_000.5);
  assert.equal(atk["Sumber"], "Pengeluaran");
  assert.equal(atk["Rekening Kas/Bank"], "Kas Kantor");
  const modalMasuk = mutasi.find((x) => x["Keterangan"] === "Setoran modal");
  assert.equal(modalMasuk["Pelanggan"], "Ibu Erni");
  assert.equal(modalMasuk["Tanggal"].toISOString().slice(0, 10), "2026-09-10");
  assert.equal(mutasi.filter((x) => x["Status"] === "Dibalik").length, 1, "jurnal yang dibalik tetap tampil dengan statusnya");

  // total & saldo akhir = kartu layar
  assert.equal(s.total["Debit (Rp)"], layar.baris.reduce((a, b) => a + b.debit, 0));
  assert.equal(s.total["Kredit (Rp)"], layar.baris.reduce((a, b) => a + b.kredit, 0));
  assert.equal(s.total["Saldo Berjalan (Rp)"], layar.saldoAkhir);
  const ring = bacaSheet(r.wb, "Ringkasan");
  assert.deepEqual(ring.baris.slice(0, 4).map((b) => b["Nilai (Rp)"]), [layar.saldoAwal, layar.baris.reduce((a, b) => a + b.debit, 0), layar.baris.reduce((a, b) => a + b.kredit, 0), layar.saldoAkhir]);
  assert.match(ring.baris[0]["Uraian"], /Saldo Awal \(per 2026-09-01\)/);
});

test("Filter klien layar (ids): hanya baris itu, urutan layar, saldo berjalan TETAP saldo seluruh periode; label filter di kepala; periode lain memakai saldo awal berbeda", async () => {
  const c = await dataLengkap();
  const layar = await layarKas(c);
  const dipilih = layar.baris.filter((b) => b.source === "MANUAL" && b.status === "POSTED");   // mis. filter "Sumber = Jurnal Manual, Status = Terposting"
  assert.ok(dipilih.length >= 1 && dipilih.length < layar.baris.length);
  const r = await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: c.kasA.id }, ids: dipilih.map((b) => b.lineId), filterLabel: "Akun: Kas; Sumber: Jurnal Manual" });
  const s = bacaSheet(r.wb, "Buku Besar");
  assert.equal(s.baris.length - 1, dipilih.length);
  assert.deepEqual(s.baris.slice(1).map((b) => b["No. Jurnal"]), dipilih.map((b) => b.entryNumber));
  assert.deepEqual(s.baris.slice(1).map((b) => b["Saldo Berjalan (Rp)"]), dipilih.map((b) => b.saldo), "saldo berjalan tidak dihitung ulang");
  assert.match(s.kepala[2], /Filter: Akun: Kas; Sumber: Jurnal Manual/);
  assert.equal(s.total["Debit (Rp)"], dipilih.reduce((a, b) => a + b.debit, 0));
  assert.equal(s.total["Saldo Berjalan (Rp)"], layar.saldoAkhir);
  // ringkasan tetap seluruh periode
  assert.equal(bacaSheet(r.wb, "Ringkasan").baris[3]["Nilai (Rp)"], layar.saldoAkhir);
  // ids kosong (filter tidak cocok) → hanya saldo awal
  const kosong = await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: c.kasA.id }, ids: [] });
  assert.equal(bacaSheet(kosong.wb, "Buku Besar").baris.length, 1);
  // id yang bukan mutasi akun/periode ini diabaikan (tidak bocor)
  const asing = await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: c.kasA.id }, ids: [randomUUID()] });
  assert.equal(bacaSheet(asing.wb, "Buku Besar").baris.length, 1);

  // periode Oktober: saldo awal = saldo akhir September
  const okt = await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode: { from: "2026-10-01", to: "2026-10-31" }, filter: { accountId: c.kasA.id } });
  const so = bacaSheet(okt.wb, "Buku Besar");
  assert.equal(so.baris[0]["Saldo Berjalan (Rp)"], layar.saldoAkhir);
  assert.equal(so.baris.length, 2);
  assert.equal(so.baris[1]["Debit (Rp)"], 42);
});

test("Mutasi lebih dari 500 baris (batas layar) tetap ikut penuh di berkas dengan saldo akhir benar", async () => {
  const c = await siapkan();
  for (let i = 0; i < 505; i++) {
    await testPrisma.finJournalEntry.create({ data: {
      entryNumber: `JV-BULK-${String(i).padStart(4, "0")}`, date: new Date("2026-09-10T00:00:00.000Z"), description: `Bulk ${i}`, source: "MANUAL", status: "POSTED", createdById: c.admin.user.id,
      lines: { create: [
        { lineNo: 1, accountId: c.kasA.id, cashAccountId: c.kas.id, debit: 1000, credit: 0 },
        { lineNo: 2, accountId: c.modal.id, debit: 0, credit: 1000 },
      ] },
    } });
  }
  const layar = await layarKas(c);
  assert.equal(layar.baris.length, 500);
  assert.equal(layar.terpotong, true);
  const r = await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: c.kasA.id } });
  const s = bacaSheet(r.wb, "Buku Besar");
  assert.equal(s.baris.length, 1 + 505);
  assert.equal(s.total["Saldo Berjalan (Rp)"], 505_000);
  assert.equal(s.total["Debit (Rp)"], 505_000);
  assert.equal(s.baris[500]["Saldo Berjalan (Rp)"], layar.baris[499].saldo, "500 baris pertama identik dengan layar");
});

test("Izin & validasi: 401/403; FINANCE boleh; akun wajib/valid/ada; formula dinetralkan; periode rusak 400", async () => {
  const c = await dataLengkap();
  const body = { periode, filter: { accountId: c.kasA.id } };
  assert.equal((await unduhExport(server.baseUrl, null, "buku-besar", body)).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales.token, "buku-besar", body)).status, 403);
  const fin = await unduhExport(server.baseUrl, c.finance.token, "buku-besar", body);
  assert.equal(fin.status, 200);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode })).status, 400, "tanpa akun");
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: "bukan-uuid" } })).status, 400);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode, filter: { accountId: randomUUID() } })).status, 404);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "buku-besar", { periode: { to: "2026-13-01" }, filter: { accountId: c.kasA.id } })).status, 400);
  const s = bacaSheet(fin.wb, "Buku Besar");
  assert.ok(s.baris.some((b) => b["Keterangan"] === "'=HYPERLINK(\"http://x\")"), "keterangan berawalan = dinetralkan");
});
