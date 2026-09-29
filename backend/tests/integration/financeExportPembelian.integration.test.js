// EXPORT EXCEL FINANCE — PEMBELIAN (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /purchases), termasuk indikator uang muka
// (DP diterapkan/Sisa utang, DP digunakan/DP tersedia), untuk periode/status/cari/jenis/divisi/cara bayar/rekening/bukti yang sama; mode `ids`;
// nominal angka; tanggal WIB; izin (401/403); kolom sensitif hanya Admin Keuangan; formula dinetralkan.
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
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";

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
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  const kat = async (code) => testPrisma.finPurchaseCategory.findUnique({ where: { code } });
  const katDp = await kat("UANG_MUKA_PEMBELIAN");
  const katBahan = await kat("BAHAN_BAKU_MANUAL");
  const katAlat = await kat("ASET_PERALATAN");
  const supplier = await testPrisma.finSupplier.create({ data: { code: randomUUID().slice(0, 8), name: "CV Busa Jaya" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const a = makeClient(server.baseUrl, admin.token);

  const buat = async (body, { setujui = false } = {}) => {
    const r = await a.post("/api/finance/purchases", { mode: "LANGSUNG", ...body });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    if (setujui) assert.equal((await a.post(`/api/finance/purchases/${r.body.id}/approve`, {})).status, 200);
    return r.body;
  };
  const p1 = await buat({ date: "2026-09-10", amount: 600_000, description: "DP busa", categoryId: katDp.id, cashAccountId: kas.id, supplierId: supplier.id, receiptUrl: nota, notes: "=CATATAN RAHASIA" }, { setujui: true });
  const p2 = await buat({ date: "2026-09-15", amount: 2_100_000, description: "Busa rebonded 10 lembar", categoryId: katBahan.id, mode: "UTANG", supplierId: supplier.id, receiptUrl: nota }, { setujui: true });
  const p3 = await buat({ date: "2026-09-20", amount: 300_000, description: "-Mesin jahit bekas", categoryId: katAlat.id, cashAccountId: kas.id, payeeName: "Toko Mesin" });
  const p5 = await buat({ date: "2026-09-22", amount: 150_000, description: "Benang & jarum", categoryId: katBahan.id, mode: "REIMBURSEMENT", division: "GUDANG", receiptUrl: nota }, { setujui: true });
  const p4 = await buat({ date: "2026-10-03", amount: 50_000, description: "Bulan depan", categoryId: katBahan.id, cashAccountId: kas.id });
  const dp = await a.post("/api/finance/purchases/advance-applications", { advancePurchaseId: p1.id, targetPurchaseId: p2.id, amount: 600_000 }, { "Idempotency-Key": `t-${randomUUID()}` });
  assert.equal(dp.status, 201, JSON.stringify(dp.body));
  return { kas, katDp, katBahan, katAlat, supplier, admin, finance, sales, a, p1, p2, p3, p4, p5 };
}

const layarQuery = (q) => "?" + new URLSearchParams(Object.entries(q).filter(([, v]) => v)).toString();
const nomorBerkas = (s) => s.baris.map((b) => b["No. Pembelian"]);

test("PARITAS layar: baris, URUTAN, nominal (ANGKA), status, indikator uang muka & total SAMA dengan GET /purchases", async () => {
  const c = await siapkan();
  const layar = (await c.a.get(`/api/finance/purchases${layarQuery({ ...PERIODE })}`)).body;
  assert.equal(layar.purchases.length, 4, "p4 di luar periode");
  const r = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE, filterLabel: "Tanpa filter (semua data)" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Pembelian_2026-09-01_sd_2026-09-30\.xlsx"/);
  const s = bacaSheet(r.wb, "Pembelian");
  assert.deepEqual(nomorBerkas(s), layar.purchases.map((p) => p.purchaseNumber), "isi & urutan identik dengan layar");
  for (const p of layar.purchases) {
    const b = s.baris.find((x) => x["No. Pembelian"] === p.purchaseNumber);
    assert.equal(typeof b["Nominal (Rp)"], "number");
    assert.equal(b["Nominal (Rp)"], p.amount);
    assert.equal(b["Status"], LABEL_STATUS[p.status]);
    assert.equal(b["Jenis Pembelian"], p.category.name);
    assert.equal(b["DP Diterapkan (Rp)"], p.dpDiterapkan ?? null);
    assert.equal(b["Sisa Utang Setelah DP (Rp)"], p.sisaUtang ?? null);
    assert.equal(b["DP Digunakan (Rp)"], p.dpDigunakan ?? null);
    assert.equal(b["DP Tersedia (Rp)"], p.dpTersedia ?? null);
  }
  // DP nyata: pembelian utang 2,1 jt menerima DP 600 rb → sisa 1,5 jt; DP sumber 600 rb terpakai penuh → tersedia 0
  const utang = s.baris.find((b) => b["No. Pembelian"] === c.p2.purchaseNumber);
  assert.equal(utang["DP Diterapkan (Rp)"], 600_000);
  assert.equal(utang["Sisa Utang Setelah DP (Rp)"], 1_500_000);
  const sumber = s.baris.find((b) => b["No. Pembelian"] === c.p1.purchaseNumber);
  assert.equal(sumber["DP Digunakan (Rp)"], 600_000);
  assert.equal(sumber["DP Tersedia (Rp)"], 0);
  assert.equal(s.total["Nominal (Rp)"], layar.total);
  assert.equal(s.total["Nominal (Rp)"], 3_150_000);
  assert.equal(s.total["Sisa Utang Setelah DP (Rp)"], 1_500_000);
  assert.match(s.total["No. Pembelian"], /^TOTAL \(4 pembelian\)/);
  const ring = bacaSheet(r.wb, "Ringkasan");
  assert.equal(ring.total["Nominal (Rp)"], layar.total);
  assert.equal(ring.baris.find((x) => x["Status"] === "Menunggu Persetujuan")["Jumlah Dokumen"], 1);
  assert.equal(ring.baris.find((x) => x["Status"] === "Disetujui")["Jumlah Dokumen"], layar.purchases.filter((p) => p.status === "DISETUJUI").length);
  assert.match(s.kepala[0], /Pembelian/);
  assert.match(s.kepala[1], /Periode: 1 Sep 2026 – 30 Sep 2026/);
  for (const h of ["Tanggal", "Keterangan", "Jenis Pembelian", "Divisi", "Cara Bayar", "Sumber Dana", "Dibeli Dari", "Status", "Verifikasi Bukti", "Diajukan Oleh", "Disetujui Oleh", "Dibayar Oleh"]) assert.ok(s.header.includes(h), `header "${h}"`);
  const tgl = sumber["Tanggal"];
  assert.ok(tgl instanceof Date && tgl.toISOString().slice(0, 10) === "2026-09-10", "tanggal WIB = tanggal kalender");
  assert.equal(sumber["Dibeli Dari"], "CV Busa Jaya");
  assert.equal(s.baris.find((b) => b["No. Pembelian"] === c.p3.purchaseNumber)["Dibeli Dari"], "Toko Mesin");
  assert.equal(s.baris.find((b) => b["No. Pembelian"] === c.p5.purchaseNumber)["Divisi"], "Gudang");
  assert.equal(s.baris.find((b) => b["No. Pembelian"] === c.p5.purchaseNumber)["Cara Bayar"], "Reimbursement");
});

test("Filter layar diikuti: status, cari (q), jenis, divisi, cara bayar, rekening, bukti — baris & urutan sama dengan GET /purchases", async () => {
  const c = await siapkan();
  const kasus = [
    { status: "DISETUJUI" }, { status: "MENUNGGU_APPROVAL" }, { status: "DIBAYAR" }, { q: "busa" }, { q: "2.100.000" }, { q: "toko mesin" },
    { categoryId: c.katBahan.id }, { categoryId: c.katDp.id }, { division: "GUDANG" }, { mode: "UTANG" }, { mode: "LANGSUNG" }, { cashAccountId: c.kas.id },
    { bukti: "tanpa" }, { bukti: "ada" }, { bukti: "belum" }, { status: "DISETUJUI", mode: "UTANG", q: "rebonded" },
  ];
  for (const k of kasus) {
    const layar = (await c.a.get(`/api/finance/purchases${layarQuery({ ...PERIODE, ...k })}`)).body.purchases;
    const r = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE, filter: k });
    assert.equal(r.status, 200, JSON.stringify(k));
    assert.deepEqual(nomorBerkas(bacaSheet(r.wb, "Pembelian")), layar.map((p) => p.purchaseNumber), `filter ${JSON.stringify(k)}`);
  }
  const kosong = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE, filter: { status: "DITOLAK" } });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Pembelian").baris.length, 0);
  const okt = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: { from: "2026-10-01", to: "2026-10-31" } });
  assert.deepEqual(nomorBerkas(bacaSheet(okt.wb, "Pembelian")), [c.p4.purchaseNumber]);
  const lbl = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE, filter: { categoryId: c.katBahan.id, mode: "UTANG" } });
  assert.match(bacaSheet(lbl.wb, "Pembelian").kepala[2], /Jenis: .+; Cara bayar: Utang/);
});

test("Mode ids: urutan mengikuti ids (baris layar); indikator DP tetap ikut; id asing dilewati; filter tidak valid 400", async () => {
  const c = await siapkan();
  const r = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE, ids: [c.p3.id, "bukan-uuid", c.p2.id, c.p1.id] });
  assert.equal(r.status, 200);
  const s = bacaSheet(r.wb, "Pembelian");
  assert.deepEqual(nomorBerkas(s), [c.p3.purchaseNumber, c.p2.purchaseNumber, c.p1.purchaseNumber]);
  assert.equal(s.baris[1]["DP Diterapkan (Rp)"], 600_000);
  assert.equal(s.total["Nominal (Rp)"], 3_000_000);
  for (const filter of [{ status: "ASAL" }, { categoryId: "x" }, { status: { not: "DIBAYAR" } }]) {
    assert.equal((await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE, filter })).status, 400, JSON.stringify(filter));
  }
});

test("Izin: tanpa login 401, SALES 403; FINANCE boleh tetapi kolom sensitif TIDAK ikut; ADMIN mendapat kolomnya; formula dinetralkan", async () => {
  const c = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "pembelian", { periode: PERIODE })).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales.token, "pembelian", { periode: PERIODE })).status, 403);
  const fin = await unduhExport(server.baseUrl, c.finance.token, "pembelian", { periode: PERIODE });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Pembelian");
  for (const h of ["Catatan Internal", "Tautan Foto Nota", "Alasan Penolakan"]) assert.ok(!sf.header.includes(h), `FINANCE tidak boleh melihat "${h}"`);
  assert.ok(!JSON.stringify(sf.baris).includes("RAHASIA") && !JSON.stringify(sf.baris).includes("finance-receipts"), "isi sensitif tidak bocor");
  const adm = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE });
  const sa = bacaSheet(adm.wb, "Pembelian");
  const b1 = sa.baris.find((b) => b["No. Pembelian"] === c.p1.purchaseNumber);
  assert.equal(b1["Catatan Internal"], "'=CATATAN RAHASIA");
  assert.equal(b1["Tautan Foto Nota"], nota);
  assert.equal(sa.baris.find((b) => b["No. Pembelian"] === c.p3.purchaseNumber)["Keterangan"], "'-Mesin jahit bekas");
});

test("Batas layar 300 baris: layar terpotong, berkas memuat SEMUA baris cocok; 300 teratas identik dengan layar", async () => {
  const c = await siapkan();
  const dasar = await testPrisma.finPurchase.findFirst({ where: { id: c.p3.id } });
  const data = Array.from({ length: 302 }, (_, i) => ({
    purchaseNumber: `PUR-MASS-${String(i).padStart(4, "0")}`, date: new Date(`2026-09-${String(1 + (i % 28)).padStart(2, "0")}T00:00:00.000Z`), amount: 1000 + i,
    description: `Massal ${i}`, categoryId: dasar.categoryId, division: "UMUM", mode: "LANGSUNG", cashAccountId: c.kas.id, status: "DIBAYAR", createdById: c.admin.user.id,
    createdAt: new Date(Date.now() - i * 1000),
  }));
  await testPrisma.finPurchase.createMany({ data });
  const layar = (await c.a.get(`/api/finance/purchases${layarQuery({ ...PERIODE })}`)).body;
  assert.equal(layar.purchases.length, 300);
  assert.equal(layar.terpotong, true);
  const r = await unduhExport(server.baseUrl, c.admin.token, "pembelian", { periode: PERIODE });
  assert.equal(r.status, 200);
  const s = bacaSheet(r.wb, "Pembelian");
  assert.equal(s.baris.length, 306, "4 dokumen awal dalam periode + 302 massal");
  assert.deepEqual(nomorBerkas(s).slice(0, 300), layar.purchases.map((p) => p.purchaseNumber));
  const teks = [];
  r.wb.getWorksheet("Pembelian").eachRow((row) => { const v = row.getCell(1).value; if (typeof v === "string") teks.push(v); });
  assert.ok(teks.some((t) => /Layar hanya menampilkan 300 baris teratas; berkas ini memuat seluruh 306 baris/.test(t)));
});
