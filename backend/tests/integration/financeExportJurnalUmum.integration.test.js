// EXPORT EXCEL FINANCE — JURNAL UMUM (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /journal): nomor, nilai, status, sumber;
// filter (sumber/status/pencarian/periode) diikuti; export memuat SEMUA jurnal (layar hanya 100 terbaru); satu baris per baris jurnal dengan debit = kredit;
// nominal angka; tanggal buku; izin (401/403); kolom sensitif hanya Admin Keuangan; formula dinetralkan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
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
const jurnal = (c, { tanggal = "2026-09-10", desc = "uji", source = "MANUAL", baris, status } ) => testPrisma.$transaction((tx) => postJournal(tx, {
  date: tanggal, description: desc, source, idempotencyKey: `JU:${++urut}`, userId: c.admin.user.id, ...(status && { status }), lines: baris,
}));
const modalMasuk = (c, nilai, extra = {}) => jurnal(c, { ...extra, baris: [
  { accountId: c.kasA.id, cashAccountId: c.kas.id, debit: toMoney(nilai), description: "setor ke kas", customerId: c.customer.id },
  { accountId: c.modal.id, credit: toMoney(nilai) },
] });
const PER = "from=2026-09-01&to=2026-09-30";

test("Berkas Jurnal Umum = data layar: nomor, tanggal, sumber, status, Nilai per jurnal, total; baris jurnal debit = kredit dengan dimensi", async () => {
  const c = await siapkan();
  const j1 = (await modalMasuk(c, 5_000_000, { desc: "Setoran modal awal" })).entry;
  const j2 = (await modalMasuk(c, 1_250_000.55, { desc: "Setoran tambahan", tanggal: "2026-09-30" })).entry;
  await jurnal(c, { source: "PENGELUARAN", tanggal: "2026-09-12", desc: "Beli ATK", baris: [{ accountId: c.beban.id, debit: toMoney(80_000) }, { accountId: c.kasA.id, cashAccountId: c.kas.id, credit: toMoney(80_000) }] });
  await modalMasuk(c, 999, { tanggal: "2026-10-01", desc: "Di luar periode (Okt)" });
  await modalMasuk(c, 777, { tanggal: "2026-08-31", desc: "Di luar periode (Agu)" });

  const layar = (await c.a.get(`/api/finance/journal?${PER}&limit=500`)).body;
  assert.equal(layar.total, 3);
  const r = await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode: { from: "2026-09-01", to: "2026-09-30" } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Jurnal_Umum_2026-09-01_sd_2026-09-30\.xlsx"/);

  const daftar = bacaSheet(r.wb, "Daftar Jurnal");
  assert.deepEqual(daftar.baris.map((b) => b["No. Jurnal"]), layar.entries.map((e) => e.entryNumber), "urutan & isi sama dengan layar");
  for (const e of layar.entries) {
    const b = daftar.baris.find((x) => x["No. Jurnal"] === e.entryNumber);
    assert.equal(typeof b["Nilai (Rp)"], "number");
    assert.equal(b["Nilai (Rp)"], e.totalDebit);
    assert.equal(b["Keterangan"], e.description);
    assert.equal(b["Status"], "Terposting");
  }
  assert.equal(daftar.total["Nilai (Rp)"], layar.entries.reduce((a, e) => a + e.totalDebit, 0));
  assert.ok(daftar.baris.some((b) => b["Sumber"] === "Pengeluaran") && daftar.baris.some((b) => b["Sumber"] === "Jurnal Manual"), "label sumber = label layar");
  const t30 = daftar.baris.find((b) => b["No. Jurnal"] === j2.entryNumber)["Tanggal"];
  assert.equal(t30.toISOString().slice(0, 10), "2026-09-30", "tanggal akhir periode ikut (batas inklusif)");

  const barisJ = bacaSheet(r.wb, "Baris Jurnal");
  assert.equal(barisJ.baris.length, layar.entries.reduce((a, e) => a + e.lines.length, 0), "satu baris per baris jurnal");
  assert.equal(barisJ.total["Debit (Rp)"], barisJ.total["Kredit (Rp)"], "total debit = total kredit");
  assert.equal(barisJ.total["Debit (Rp)"], 5_000_000 + 1_250_000.55 + 80_000);
  const bagi = barisJ.baris.filter((b) => b["No. Jurnal"] === j1.entryNumber);
  assert.equal(bagi.length, 2);
  const kasBaris = bagi.find((b) => b["Debit (Rp)"] > 0);
  assert.equal(kasBaris["Debit (Rp)"], 5_000_000);
  assert.equal(typeof kasBaris["Debit (Rp)"], "number");
  assert.equal(kasBaris["Rekening Kas/Bank"], "Kas Kantor");
  assert.equal(kasBaris["Pelanggan"], "Ibu Erni");
  assert.equal(kasBaris["Keterangan Baris"], "setor ke kas");
  assert.match(kasBaris["Kode Akun"], /^\d-\d{4}$/);
  assert.equal(bagi.find((b) => b["Kredit (Rp)"] > 0)["Kredit (Rp)"], 5_000_000);
  assert.ok(barisJ.header.includes("Nama Akun") && barisJ.header.includes("Kode Akun"));
  assert.match(barisJ.kepala[1], /Periode: 1 Sep 2026 – 30 Sep 2026/);
});

test("Filter diikuti: sumber, status (jurnal dibalik), pencarian; jurnal Agu/Okt tidak ikut; filter tanpa hasil tetap berkas valid", async () => {
  const c = await siapkan();
  const asal = (await modalMasuk(c, 300_000, { desc: "Setoran yang salah" })).entry;
  await modalMasuk(c, 100_000, { desc: "Setoran benar" });
  await jurnal(c, { source: "PENGELUARAN", desc: "Beli ATK", baris: [{ accountId: c.beban.id, debit: toMoney(50_000) }, { accountId: c.kasA.id, cashAccountId: c.kas.id, credit: toMoney(50_000) }] });
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: asal.id, date: "2026-09-20", reason: "Salah input =rahasia", userId: c.admin.user.id }));
  const periode = { from: "2026-09-01", to: "2026-09-30" };

  for (const [filter, query] of [[{ source: "PENGELUARAN" }, "&source=PENGELUARAN"], [{ status: "REVERSED" }, "&status=REVERSED"], [{ search: "benar" }, "&search=benar"], [{ source: "MANUAL", status: "POSTED" }, "&source=MANUAL&status=POSTED"]]) {
    const layar = (await c.a.get(`/api/finance/journal?${PER}&limit=500${query}`)).body;
    const r = await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode, filter });
    assert.equal(r.status, 200);
    const s = bacaSheet(r.wb, "Daftar Jurnal");
    assert.deepEqual(s.baris.map((b) => b["No. Jurnal"]), layar.entries.map((e) => e.entryNumber), JSON.stringify(filter));
    assert.ok(layar.entries.length >= 1);
  }
  const dibalik = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode, filter: { status: "REVERSED" } })).wb, "Daftar Jurnal");
  assert.equal(dibalik.baris[0]["Status"], "Dibalik");
  assert.ok(dibalik.baris[0]["Dibalik Oleh Jurnal"], "nomor jurnal balik tercatat");
  const bal = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode, filter: { source: "REVERSAL" } })).wb, "Daftar Jurnal");
  assert.equal(bal.baris[0]["Membalik Jurnal"], asal.entryNumber);
  assert.equal(bal.baris[0]["Sumber"], "Jurnal Balik");

  const kosong = await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode, filter: { search: "tidak-ada-yang-cocok" } });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Baris Jurnal").baris.length, 0);
  assert.equal(kosong.wb.getWorksheet("Daftar Jurnal"), undefined, "sheet daftar kosong tidak dibuat");
});

test("Export memuat SEMUA jurnal, layar hanya 100 terbaru (batas take layar tidak membuang baris di berkas)", async () => {
  const c = await siapkan();
  for (let i = 0; i < 105; i++) await modalMasuk(c, 1_000 + i, { desc: `Setoran ${i}` });
  const layar = (await c.a.get(`/api/finance/journal?${PER}`)).body;
  assert.equal(layar.entries.length, 100);
  assert.equal(layar.total, 105);
  const r = await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode: { from: "2026-09-01", to: "2026-09-30" } });
  const s = bacaSheet(r.wb, "Daftar Jurnal");
  assert.equal(s.baris.length, 105);
  assert.deepEqual(s.baris.slice(0, 100).map((b) => b["No. Jurnal"]), layar.entries.map((e) => e.entryNumber), "100 pertama identik dengan layar");
  assert.equal(bacaSheet(r.wb, "Baris Jurnal").baris.length, 210);
});

test("Izin: 401/403/404; FINANCE boleh dan isinya sama dengan layar (tidak ada kolom sensitif); formula dinetralkan; periode rusak 400", async () => {
  const c = await siapkan();
  const asal = (await modalMasuk(c, 300_000, { desc: "=HYPERLINK(\"http://x\")" })).entry;
  await testPrisma.$transaction((tx) => reverseJournal(tx, { entryId: asal.id, date: "2026-09-20", reason: "=alasan rahasia", userId: c.admin.user.id }));
  const periode = { from: "2026-09-01", to: "2026-09-30" };
  assert.equal((await unduhExport(server.baseUrl, null, "jurnal-umum", { periode })).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales.token, "jurnal-umum", { periode })).status, 403);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode: { from: "2026-02-31" } })).status, 400);

  const fin = await unduhExport(server.baseUrl, c.finance.token, "jurnal-umum", { periode });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Daftar Jurnal");
  const adm = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "jurnal-umum", { periode })).wb, "Daftar Jurnal");
  // Alasan pembalikan SENSITIF (finance:admin saja): FINANCE tidak mendapat kolomnya, dan keterangan jurnal balik dipotong sebelum " — <alasan>".
  assert.ok(adm.header.includes("Alasan Pembalikan") && !sf.header.includes("Alasan Pembalikan"));
  assert.deepEqual(sf.header, adm.header.filter((h) => h !== "Alasan Pembalikan"));
  assert.equal(sf.baris.length, adm.baris.length);
  const balikFin = sf.baris.find((b) => b["Sumber"] === "Jurnal Balik" || /^Pembatalan /.test(String(b["Keterangan"])));
  assert.ok(balikFin && !/alasan rahasia/.test(JSON.stringify(sf.baris)), "alasan pembalikan tidak bocor lewat keterangan jurnal balik untuk FINANCE");
  assert.ok(/alasan rahasia/.test(JSON.stringify(adm.baris)), "ADMIN tetap mendapat alasan");
  const layar = (await makeClient(server.baseUrl, c.finance.token).get("/api/finance/journal?from=2026-09-01&to=2026-09-30")).body;
  assert.ok(layar.entries.some((e) => e.reversalReason === "=alasan rahasia"), "alasan pembalikan memang tampil di layar untuk FINANCE");
  const dibalik = adm.baris.find((b) => b["Status"] === "Dibalik");
  assert.equal(dibalik["Keterangan"], "'=HYPERLINK(\"http://x\")", "keterangan berawalan = dinetralkan");
  assert.equal(dibalik["Alasan Pembalikan"], "'=alasan rahasia", "alasan ada di jurnal asal yang dibalik; berawalan = dinetralkan");
});
