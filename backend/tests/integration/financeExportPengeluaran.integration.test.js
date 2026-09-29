// EXPORT EXCEL FINANCE — PENGELUARAN (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /expenses) untuk periode, status,
// pencarian, kategori, divisi, cara bayar, rekening, dan bukti yang sama (isi, URUTAN, nominal, total); mode `ids` mengikuti urutan layar;
// nominal = angka Excel; tanggal WIB; izin (tanpa login 401, SALES 403); kolom sensitif hanya Admin Keuangan; formula dinetralkan.
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

const nota = "/media/finance-receipts/" + "f".repeat(40) + ".jpg";
const PERIODE = { from: "2026-09-01", to: "2026-09-30" };
const LABEL_STATUS = { DRAFT: "Draf", MENUNGGU_APPROVAL: "Menunggu Persetujuan", DISETUJUI: "Disetujui", DIBAYAR: "Dibayar", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan" };

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Tunai", kind: "KAS", accountId: akunKas.id } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const kat2 = await testPrisma.finExpenseCategory.findUnique({ where: { code: "ADMIN_BANK" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = makeClient(server.baseUrl, admin.token);

  const buat = async (body, { setujui = false } = {}) => {
    const r = await a.post("/api/finance/expenses", { mode: "LANGSUNG", categoryId: kat.id, ...body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (setujui) assert.equal((await a.post(`/api/finance/expenses/${r.body.id}/approve`, {})).status, 200);
    return r.body;
  };
  // e1 DIBAYAR (bayar langsung, transfer BI-FAST → ada biaya admin), e2 DISETUJUI (reimbursement, divisi Produksi), e3 MENUNGGU (tanpa nota),
  // e4 di luar periode. Deskripsi/catatan berawalan karakter rumus untuk uji formula injection.
  const e1 = await buat({ date: "2026-09-05", amount: 100_000, description: "=Beli kain oscar", cashAccountId: bank.id, payeeName: "Toko Maju", receiptUrl: nota, notes: "+CATATAN RAHASIA", paymentMethod: "TRANSFER", transferFeeType: "BI_FAST" }, { setujui: true });
  const e2 = await buat({ date: "2026-09-12", amount: 250_000, description: "Bensin kunjungan", mode: "REIMBURSEMENT", division: "PRODUKSI", receiptUrl: nota }, { setujui: true });
  const e3 = await buat({ date: "2026-09-20", amount: 75_000, description: "Biaya admin bank", categoryId: kat2.id, cashAccountId: kas.id });
  const e4 = await buat({ date: "2026-10-03", amount: 50_000, description: "Bulan depan", cashAccountId: kas.id });
  return { kas, bank, kat, kat2, admin, finance, sales, a, e1, e2, e3, e4 };
}

const layarQuery = (q) => "?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
const nomorBerkas = (s) => s.baris.map((b) => b["No. Pengeluaran"]);

test("PARITAS layar: berkas memuat baris, URUTAN, nominal (ANGKA), status, dan total yang SAMA dengan GET /expenses untuk periode yang sama", async () => {
  const c = await siapkan();
  const layar = (await c.a.get(`/api/finance/expenses${layarQuery({ ...PERIODE })}`)).body;
  assert.equal(layar.expenses.length, 3, "e4 di luar periode");
  const r = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, filterLabel: "Tanpa filter (semua data)" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Pengeluaran_2026-09-01_sd_2026-09-30\.xlsx"/);
  const s = bacaSheet(r.wb, "Pengeluaran");
  assert.deepEqual(nomorBerkas(s), layar.expenses.map((e) => e.expenseNumber), "isi & urutan identik dengan layar");
  for (const e of layar.expenses) {
    const b = s.baris.find((x) => x["No. Pengeluaran"] === e.expenseNumber);
    assert.equal(typeof b["Nominal (Rp)"], "number");
    assert.equal(b["Nominal (Rp)"], e.amount);
    assert.equal(b["Biaya Admin Transfer (Rp)"], e.biayaAdmin);
    assert.equal(b["Total Keluar Rekening (Rp)"], e.totalKeluarRekening);
    assert.equal(b["Status"], LABEL_STATUS[e.status]);
    assert.equal(b["Kategori Biaya"], e.category.name);
    assert.equal(b["Keterangan"], e.description.startsWith("=") ? `'${e.description}` : e.description);
  }
  // total = kartu "Total di Filter Ini"; ringkasan per status = kartu "Menunggu Persetujuan" / "Disetujui, Belum Dibayar"
  assert.equal(s.total["Nominal (Rp)"], layar.total);
  assert.equal(s.total["Nominal (Rp)"], 425_000);
  assert.equal(s.total["Biaya Admin Transfer (Rp)"], layar.expenses.reduce((a, e) => a + e.biayaAdmin, 0));
  assert.ok(s.total["Biaya Admin Transfer (Rp)"] > 0, "biaya admin BI-FAST tercatat");
  assert.match(s.total["No. Pengeluaran"], /^TOTAL \(3 pengeluaran\)/);
  const ring = bacaSheet(r.wb, "Ringkasan");
  assert.equal(ring.total["Nominal (Rp)"], layar.total);
  assert.equal(ring.baris.find((x) => x["Status"] === "Menunggu Persetujuan")["Jumlah Dokumen"], layar.expenses.filter((e) => e.status === "MENUNGGU_APPROVAL").length);
  assert.equal(ring.baris.find((x) => x["Status"] === "Disetujui")["Jumlah Dokumen"], layar.expenses.filter((e) => e.status === "DISETUJUI").length);
  // kepala berkas + header Indonesia
  assert.match(s.kepala[0], /Pengeluaran & Reimbursement/);
  assert.match(s.kepala[1], /Periode: 1 Sep 2026 – 30 Sep 2026/);
  for (const h of ["Tanggal", "Keterangan", "Kategori Biaya", "Divisi", "Cara Bayar", "Sumber Dana", "Ditalangi Oleh", "Dibayarkan Kepada", "Status", "Verifikasi Bukti", "Diajukan Oleh", "Disetujui Oleh", "Dibayar Oleh"]) assert.ok(s.header.includes(h), `header "${h}"`);
});

test("Tanggal = tanggal kalender WIB (kolom DATE apa adanya); waktu dokumen dikonversi ke WIB; nilai kategori/divisi/cara bayar berlabel Indonesia", async () => {
  const c = await siapkan();
  const r = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE });
  const s = bacaSheet(r.wb, "Pengeluaran");
  const b1 = s.baris.find((b) => b["No. Pengeluaran"] === c.e1.expenseNumber);
  assert.ok(b1["Tanggal"] instanceof Date && b1["Tanggal"].toISOString().slice(0, 10) === "2026-09-05");
  assert.ok(b1["Diajukan Pada (WIB)"] instanceof Date);
  const selisih = b1["Diajukan Pada (WIB)"].getTime() - (Date.now() + 7 * 3600 * 1000);
  assert.ok(Math.abs(selisih) < 3600 * 1000, "jam dinding WIB (UTC+7) — bukan jam UTC");
  const b2 = s.baris.find((b) => b["No. Pengeluaran"] === c.e2.expenseNumber);
  assert.equal(b2["Divisi"], "Produksi");
  assert.equal(b2["Cara Bayar"], "Reimbursement");
  assert.equal(b2["Sumber Dana"], "belum dibayar", "sama dengan teks layar untuk reimbursement yang belum dibayar");
  assert.equal(b1["Cara Bayar"], "Bayar langsung");
  assert.equal(b1["Sumber Dana"], "BCA Operasional");
  assert.equal(b1["Metode Pembayaran"], "Transfer");
  assert.equal(b1["Metode Transfer"], "BI-FAST");
  assert.equal(b1["Bukti Nota"], "Ada");
  assert.equal(b1["Verifikasi Bukti"], "Belum diverifikasi");
  assert.equal(s.baris.find((b) => b["No. Pengeluaran"] === c.e3.expenseNumber)["Verifikasi Bukti"], "Tanpa bukti");
  assert.ok(String(b1["Disetujui Oleh"]).length > 0);
});

test("Filter layar diikuti: status, cari (q), kategori, divisi, cara bayar, rekening, bukti — baris & urutan sama dengan GET /expenses", async () => {
  const c = await siapkan();
  const kasus = [
    { status: "DISETUJUI" }, { status: "MENUNGGU_APPROVAL" }, { status: "DIBAYAR" }, { q: "bensin" }, { q: "100.000" }, { q: "toko maju" },
    { categoryId: c.kat2.id }, { division: "PRODUKSI" }, { mode: "REIMBURSEMENT" }, { mode: "LANGSUNG" }, { cashAccountId: c.bank.id },
    { bukti: "tanpa" }, { bukti: "ada" }, { bukti: "belum" }, { bukti: "terverifikasi" }, { status: "DIBAYAR", mode: "LANGSUNG", q: "kain" },
  ];
  for (const k of kasus) {
    const layar = (await c.a.get(`/api/finance/expenses${layarQuery({ ...PERIODE, ...k })}`)).body.expenses;
    const r = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, filter: k });
    assert.equal(r.status, 200, JSON.stringify(k));
    const s = bacaSheet(r.wb, "Pengeluaran");
    assert.deepEqual(nomorBerkas(s), layar.map((e) => e.expenseNumber), `filter ${JSON.stringify(k)}`);
  }
  // filter yang menyaring sesuatu benar-benar menyempit; hasil kosong tetap berkas valid
  const kosong = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, filter: { status: "DITOLAK" } });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Pengeluaran").baris.length, 0);
  const sempit = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, filter: { status: "DISETUJUI" } });
  assert.deepEqual(nomorBerkas(bacaSheet(sempit.wb, "Pengeluaran")), [c.e2.expenseNumber]);
  // periode lain → data lain
  const okt = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: { from: "2026-10-01", to: "2026-10-31" } });
  assert.deepEqual(nomorBerkas(bacaSheet(okt.wb, "Pengeluaran")), [c.e4.expenseNumber]);
  // label filter otomatis (klien tidak mengirim filterLabel) menyebut nama kategori
  const lbl = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, filter: { categoryId: c.kat2.id, status: "MENUNGGU_APPROVAL" } });
  assert.match(bacaSheet(lbl.wb, "Pengeluaran").kepala[2], /Status: Menunggu Persetujuan; Kategori: .+/);
});

test("Mode ids: baris yang dikirim klien dimuat ulang lewat fungsi baca yang sama, URUTAN mengikuti ids; id asing/bukan-UUID dilewati", async () => {
  const c = await siapkan();
  const r = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, ids: [c.e3.id, "bukan-uuid", c.e1.id, "00000000-0000-4000-8000-000000000000"] });
  assert.equal(r.status, 200);
  const s = bacaSheet(r.wb, "Pengeluaran");
  assert.deepEqual(nomorBerkas(s), [c.e3.expenseNumber, c.e1.expenseNumber]);
  assert.equal(s.total["Nominal (Rp)"], 175_000);
});

test("Filter tidak valid ditolak 400 (bukan galat database / injeksi operator); periode rusak 400", async () => {
  const c = await siapkan();
  for (const filter of [{ status: "ASAL" }, { division: "X" }, { mode: "Y" }, { bukti: "z" }, { categoryId: "bukan-uuid" }, { cashAccountId: "1" }, { status: { not: "DIBAYAR" } }, { q: { contains: "a" } }]) {
    const r = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE, filter });
    assert.equal(r.status, 400, JSON.stringify(filter));
  }
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: { from: "2026-02-31" } })).status, 400);
});

test("Izin: tanpa login 401, SALES (hanya finance:expense:submit) 403; FINANCE boleh tetapi kolom sensitif TIDAK ikut; ADMIN mendapat kolomnya; formula dinetralkan", async () => {
  const c = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "pengeluaran", { periode: PERIODE })).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales.token, "pengeluaran", { periode: PERIODE })).status, 403);
  const fin = await unduhExport(server.baseUrl, c.finance.token, "pengeluaran", { periode: PERIODE });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Pengeluaran");
  for (const h of ["Catatan Internal", "Tautan Foto Nota", "Alasan Penolakan"]) assert.ok(!sf.header.includes(h), `FINANCE tidak boleh melihat "${h}"`);
  assert.ok(!JSON.stringify(sf.baris).includes("RAHASIA") && !JSON.stringify(sf.baris).includes("finance-receipts"), "isi sensitif tidak bocor ke sel manapun");
  const adm = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE });
  const sa = bacaSheet(adm.wb, "Pengeluaran");
  const b1 = sa.baris.find((b) => b["No. Pengeluaran"] === c.e1.expenseNumber);
  assert.equal(b1["Catatan Internal"], "'+CATATAN RAHASIA", "catatan berawalan + dinetralkan");
  assert.equal(b1["Tautan Foto Nota"], nota);
  assert.equal(b1["Keterangan"], "'=Beli kain oscar", "keterangan berawalan = dinetralkan");
});

test("Batas layar 300 baris: layar terpotong, berkas memuat SEMUA baris cocok (300 teratas identik dengan layar) dan menyebut hal itu di catatan", async () => {
  const c = await siapkan();
  const dasar = await testPrisma.finExpense.findFirst({ where: { id: c.e1.id } });
  const data = Array.from({ length: 302 }, (_, i) => ({
    expenseNumber: `EXP-MASS-${String(i).padStart(4, "0")}`, date: new Date(`2026-09-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z`), amount: 1000 + i,
    description: `Massal ${i}`, categoryId: dasar.categoryId, division: "UMUM", mode: "LANGSUNG", cashAccountId: c.kas.id, status: "DIBAYAR", createdById: c.admin.user.id,
    createdAt: new Date(Date.now() - i * 1000),
  }));
  await testPrisma.finExpense.createMany({ data });
  const layar = (await c.a.get(`/api/finance/expenses${layarQuery({ ...PERIODE })}`)).body;
  assert.equal(layar.expenses.length, 300);
  assert.equal(layar.terpotong, true);
  const r = await unduhExport(server.baseUrl, c.admin.token, "pengeluaran", { periode: PERIODE });
  assert.equal(r.status, 200);
  const s = bacaSheet(r.wb, "Pengeluaran");
  assert.equal(s.baris.length, 305, "3 dokumen awal dalam periode + 302 massal");
  assert.deepEqual(nomorBerkas(s).slice(0, 300), layar.expenses.map((e) => e.expenseNumber), "300 baris pertama identik dengan layar (isi & urutan)");
  const ws = r.wb.getWorksheet("Pengeluaran");
  const teks = [];
  ws.eachRow((row) => { const v = row.getCell(1).value; if (typeof v === "string") teks.push(v); });
  assert.ok(teks.some((t) => /Layar hanya menampilkan 300 baris teratas; berkas ini memuat seluruh 305 baris/.test(t)), "catatan menjelaskan selisih dengan layar");
});
