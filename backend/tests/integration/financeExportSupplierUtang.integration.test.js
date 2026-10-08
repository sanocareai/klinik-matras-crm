// EXPORT EXCEL FINANCE — SUPPLIER & UTANG (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /bills, /supplier-payments,
// /suppliers, /reports/payables), mengikuti TAB aktif + mode `ids` (baris yang tampil setelah filter klien, urutan layar), nominal ANGKA,
// total sesuai dasar kartu layar, izin (401/403), kolom sensitif hanya Admin Keuangan, tanggal WIB, formula dinetralkan.
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

const hariIni = () => new Date(Date.now() + 7 * 3600 * 1000).toISOString().slice(0, 10);

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  const s1 = await testPrisma.finSupplier.create({ data: { code: "SUP-A", name: "CV Tekstil", phone: "0812", bankName: "BCA", bankAccount: "1234567890", bankHolder: "CV Tekstil Jaya", paymentTermDays: 30, notes: "=SUPPLIER RAHASIA" } });
  const s2 = await testPrisma.finSupplier.create({ data: { code: "SUP-B", name: "Toko Busa" } });
  const s3 = await testPrisma.finSupplier.create({ data: { code: "SUP-C", name: "Nonaktif Sejahtera", active: false } });
  const a = makeClient(server.baseUrl, admin.token);

  const buat = async (supplier, extra) => {
    const r = await a.post("/api/finance/bills", { supplierId: supplier.id, billDate: "2026-09-10", amount: 1_000_000, description: "Jasa jahit", billType: "JASA_OPERASIONAL", expenseCategoryId: kat.id, ...extra, ...(extra.dueDate && { alasanTermin: "Uji" }) });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const setujui = async (b) => assert.equal((await a.post(`/api/finance/bills/${b.id}/approve`, {})).status, 200);
  const b1 = await buat(s1, { supplierRef: "=INV-77", dueDate: "2026-09-01" });                        // lewat jatuh tempo
  const b2 = await buat(s2, { amount: 500_000, supplierRef: "INV-2", description: "Busa", dueDate: "2027-01-01" }); // belum jatuh tempo
  const b3 = await buat(s1, { amount: 300_000, description: "Menunggu" });                              // belum disetujui
  await setujui(b1); await setujui(b2);
  const p1 = await a.post("/api/finance/supplier-payments", { supplierId: s2.id, date: hariIni(), cashAccountId: bank.id, reference: "TRF-1", allocations: [{ billId: b2.id, amount: 200_000 }] });
  assert.equal(p1.status, 201, JSON.stringify(p1.body));
  const p2 = await a.post("/api/finance/supplier-payments", { supplierId: s1.id, date: hariIni(), cashAccountId: bank.id, allocations: [{ billId: b1.id, amount: 100_000 }] });
  assert.equal(p2.status, 201, JSON.stringify(p2.body));
  assert.equal((await a.post(`/api/finance/supplier-payments/${p2.body.id}/cancel`, { reason: "salah rekening" })).status, 200);
  return { bank, admin, finance, sales, a, s1, s2, s3, b1, b2, b3, p1: p1.body, p2: p2.body };
}

const B = { nomor: "No. Tagihan", nilai: "Nilai (Rp)", terbayar: "Terbayar (Rp)", sisa: "Sisa (Rp)" };

test("Tab Tagihan (tanpa ids) = GET /bills: baris, urutan, nominal ANGKA, status, lewat tempo, total sedasar kartu Total Utang Usaha", async () => {
  const ctx = await siapkan();
  const layar = (await ctx.a.get("/api/finance/bills")).body.bills;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan" } });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Supplier_Utang_per_\d{4}-\d{2}-\d{2}\.xlsx"/);
  const s = bacaSheet(r.wb, "Tagihan");
  assert.deepEqual(s.baris.map((b) => b[B.nomor]), layar.map((b) => b.billNumber), "urutan = urutan layar");
  for (const b of layar) {
    const x = s.baris.find((y) => y[B.nomor] === b.billNumber);
    assert.equal(typeof x[B.nilai], "number");
    assert.equal(x[B.nilai], b.amount); assert.equal(x[B.terbayar], b.terbayar); assert.equal(x[B.sisa], b.sisa);
    assert.equal(x["Jenis Tagihan"], b.jenisTagihan.label);
  }
  const x1 = s.baris.find((y) => y[B.nomor] === ctx.b1.billNumber);
  assert.equal(x1["Status"], "Disetujui");
  assert.equal(x1["Lewat Jatuh Tempo"], "Ya");
  assert.ok(x1["Hari Lewat Tempo"] >= 28, "jatuh tempo 1 Sep 2026, hari lewat dihitung terhadap hari ini WIB");
  assert.equal(s.baris.find((y) => y[B.nomor] === ctx.b2.billNumber)["Lewat Jatuh Tempo"], "Tidak");
  assert.equal(s.baris.find((y) => y[B.nomor] === ctx.b3.billNumber)["Status"], "Menunggu Persetujuan");
  const tgl = x1["Tanggal Tagihan"];
  assert.ok(tgl instanceof Date && tgl.toISOString().slice(0, 10) === "2026-09-10", "tanggal Excel = tanggal WIB");

  // total = tagihan Disetujui/Dibayar Sebagian saja; sama dengan kartu Total Utang Usaha (GET /reports/payables)
  const aging = (await ctx.a.get("/api/finance/reports/payables")).body;
  assert.equal(s.total[B.sisa], aging.total);
  assert.equal(s.total[B.sisa], layar.filter((b) => ["DISETUJUI", "DIBAYAR_SEBAGIAN"].includes(b.status)).reduce((a, b) => a + b.sisa, 0));
  assert.equal(s.total[B.nilai], 1_500_000);
  assert.equal(s.total[B.terbayar], 200_000, "pembayaran yang dibatalkan tidak dihitung");
});

test("Sheet Ringkasan & Umur Utang mereproduksi kartu layar (Total Utang Usaha, Lewat Jatuh Tempo, Menunggu Persetujuan, Penerimaan Belum Ditagih)", async () => {
  const ctx = await siapkan();
  const aging = (await ctx.a.get("/api/finance/reports/payables")).body;
  const belumDitagih = (await ctx.a.get("/api/finance/bills/unbilled-receipts")).body.receipts;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "supplier" } });
  const ring = bacaSheet(r.wb, "Ringkasan");
  const rowOf = (teks) => ring.baris.find((b) => String(b["Indikator"]).startsWith(teks));
  assert.equal(rowOf("Utang Usaha")["Nilai (Rp)"], aging.total);
  assert.equal(rowOf("Utang Usaha")["Jumlah"], aging.baris.length);
  const lewat = aging.baris.filter((b) => b.hariLewat > 0);
  assert.equal(rowOf("Lewat Jatuh Tempo")["Jumlah"], lewat.length);
  assert.equal(rowOf("Lewat Jatuh Tempo")["Nilai (Rp)"], lewat.reduce((a, b) => a + b.sisa, 0));
  assert.equal(rowOf("Tagihan Menunggu Persetujuan")["Jumlah"], 1);
  assert.equal(rowOf("Penerimaan Barang Belum Ditagih")["Jumlah"], belumDitagih.length);
  const umur = bacaSheet(r.wb, "Umur Utang");
  assert.equal(umur.baris.length, aging.baris.length);
  assert.equal(umur.total["Sisa (Rp)"], aging.total);
  for (const b of aging.baris) assert.equal(umur.baris.find((x) => x["No. Tagihan"] === b.billNumber)["Hari Lewat"], b.hariLewat);
});

test("Mode ids: hanya baris yang tampil di layar, URUTAN ids dihormati; server-filter (status, lewat tempo) sama dengan parameter layar", async () => {
  const ctx = await siapkan();
  const ids = [ctx.b3.id, ctx.b2.id];
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan" }, ids, filterLabel: "Status: Menunggu; Pencarian: x" });
  const s = bacaSheet(r.wb, "Tagihan");
  assert.deepEqual(s.baris.map((b) => b[B.nomor]), [ctx.b3.billNumber, ctx.b2.billNumber]);
  assert.match(s.kepala[2], /Filter: Status: Menunggu; Pencarian: x/);
  assert.equal(s.total[B.sisa], 300_000, "total hanya menghitung baris Disetujui/Dibayar Sebagian yang tampil (b2 sisa 300.000)");
  const kosong = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan" }, ids: [] });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Tagihan").baris.length, 0, "ids kosong = layar kosong, bukan 'semua data'");
  const tak = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan" }, ids: ["bukan-uuid", ctx.b1.id] });
  assert.deepEqual(bacaSheet(tak.wb, "Tagihan").baris.map((b) => b[B.nomor]), [ctx.b1.billNumber]);

  const status = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan", status: "MENUNGGU_APPROVAL" } });
  assert.deepEqual(bacaSheet(status.wb, "Tagihan").baris.map((b) => b[B.nomor]), [ctx.b3.billNumber]);
  const layarLewat = (await ctx.a.get("/api/finance/bills?jatuhTempo=lewat")).body.bills;
  const lewat = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan", jatuhTempo: "lewat" } });
  assert.deepEqual(bacaSheet(lewat.wb, "Tagihan").baris.map((b) => b[B.nomor]), layarLewat.map((b) => b.billNumber));
});

test("Tab Pembayaran = GET /supplier-payments (bulan berjalan): baris, nominal ANGKA, status batal, total tanpa yang dibatalkan, sheet Alokasi", async () => {
  const ctx = await siapkan();
  const layar = (await ctx.a.get("/api/finance/supplier-payments")).body.payments;
  assert.equal(layar.length, 2);
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "pembayaran" } });
  const s = bacaSheet(r.wb, "Pembayaran");
  assert.deepEqual(s.baris.map((b) => b["No. Pembayaran"]).sort(), layar.map((p) => p.paymentNumber).sort());
  const aktif = s.baris.find((b) => b["No. Pembayaran"] === ctx.p1.paymentNumber);
  assert.equal(typeof aktif["Nominal (Rp)"], "number");
  assert.equal(aktif["Nominal (Rp)"], 200_000);
  assert.equal(aktif["Status"], "Terposting");
  assert.equal(aktif["Dari Rekening"], "BCA Operasional");
  assert.equal(aktif["Tagihan yang Dilunasi"], ctx.b2.billNumber);
  assert.equal(aktif["No. Referensi"], "TRF-1");
  const batal = s.baris.find((b) => b["No. Pembayaran"] === ctx.p2.paymentNumber);
  assert.equal(batal["Status"], "Dibatalkan");
  assert.equal(batal["Alasan Pembatalan"], "salah rekening");
  assert.equal(s.total["Nominal (Rp)"], 200_000, "pembayaran dibatalkan tidak dijumlahkan");
  assert.match(s.kepala[1], /Periode: 1 \w+ \d{4} – \d{1,2} \w+ \d{4}/, "periode = bulan berjalan seperti layar");
  const al = bacaSheet(r.wb, "Alokasi");
  assert.equal(al.baris.length, 2);
  assert.equal(al.total["Nominal Dialokasikan (Rp)"], 200_000);
  // ids: hanya satu pembayaran
  const one = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "pembayaran" }, ids: [ctx.p2.id] });
  assert.deepEqual(bacaSheet(one.wb, "Pembayaran").baris.map((b) => b["No. Pembayaran"]), [ctx.p2.paymentNumber]);
});

test("Tab Master Supplier = GET /suppliers: sisa utang sama, kolom sensitif (No. Rekening, Atas Nama, Catatan) hanya ADMIN; ids diikuti", async () => {
  const ctx = await siapkan();
  const layar = (await ctx.a.get("/api/finance/suppliers")).body.suppliers;
  const r = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "supplier" } });
  const s = bacaSheet(r.wb, "Master Supplier");
  assert.deepEqual(s.baris.map((b) => b["Kode"]), layar.map((x) => x.code));
  assert.equal(s.baris.length, 2, "supplier nonaktif tidak tampil di layar bawaan");
  for (const sup of layar) {
    const x = s.baris.find((b) => b["Kode"] === sup.code);
    assert.equal(x["Sisa Utang (Rp)"], sup.sisaUtang);
    assert.equal(x["Tagihan Terbuka"], sup.jumlahTagihanTerbuka);
  }
  assert.equal(s.total["Sisa Utang (Rp)"], layar.reduce((a, x) => a + x.sisaUtang, 0));
  const x1 = s.baris.find((b) => b["Kode"] === "SUP-A");
  assert.equal(x1["No. Rekening"], "1234567890");
  assert.equal(x1["Catatan Internal"], "'=SUPPLIER RAHASIA", "catatan berawalan = dinetralkan");
  assert.equal(x1["Termin Bayar (hari)"], 30);

  const fin = await unduhExport(server.baseUrl, ctx.finance.token, "supplier-utang", { filter: { tab: "supplier" } });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Master Supplier");
  assert.ok(!sf.header.includes("No. Rekening") && !sf.header.includes("Atas Nama Rekening") && !sf.header.includes("Catatan Internal"));
  assert.ok(sf.header.includes("Bank"));

  const ids = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "supplier" }, ids: [ctx.s3.id, ctx.s2.id] });
  assert.deepEqual(bacaSheet(ids.wb, "Master Supplier").baris.map((b) => b["Kode"]), ["SUP-C", "SUP-B"]);
});

test("Izin & keamanan: 401 tanpa login, 403 SALES, tautan lampiran sensitif hanya ADMIN, formula (No. Faktur =INV-77) dinetralkan, angka bertipe number", async () => {
  const ctx = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "supplier-utang")).status, 401);
  assert.equal((await unduhExport(server.baseUrl, ctx.sales.token, "supplier-utang")).status, 403);
  assert.equal((await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { periode: { from: "2026-02-31" } })).status, 400);
  await testPrisma.finSupplierBill.update({ where: { id: ctx.b1.id }, data: { attachmentUrl: "/media/finance-receipts/rahasia.jpg" } });
  const adm = await unduhExport(server.baseUrl, ctx.admin.token, "supplier-utang", { filter: { tab: "tagihan" } });
  const sa = bacaSheet(adm.wb, "Tagihan");
  assert.ok(sa.header.includes("Tautan Lampiran"));
  assert.equal(sa.baris.find((b) => b[B.nomor] === ctx.b1.billNumber)["No. Faktur Supplier"], "'=INV-77");
  const fin = await unduhExport(server.baseUrl, ctx.finance.token, "supplier-utang", { filter: { tab: "tagihan" } });
  const sf = bacaSheet(fin.wb, "Tagihan");
  assert.ok(!sf.header.includes("Tautan Lampiran") && !sf.header.includes("Alasan Penolakan"));
  for (const b of sf.baris) for (const k of [B.nilai, B.terbayar, B.sisa]) assert.equal(typeof b[k], "number");
});
