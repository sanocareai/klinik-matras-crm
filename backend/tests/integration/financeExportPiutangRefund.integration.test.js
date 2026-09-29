// EXPORT EXCEL FINANCE — PIUTANG & REFUND (B3.9). Yang dikunci: dua sheet (Piutang, Refund) + Ringkasan Umur = data yang SAMA dengan layar
// (GET /reports/receivables & GET /refunds): baris, urutan, nominal (ANGKA), total, kartu ember umur; mode id (baris yang tampil setelah
// filter/pencarian di klien) menghormati urutan layar; izin (SALES 403, tanpa login 401); kolom sensitif hanya Admin Keuangan; formula dinetralkan.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postRevenueRecognition, postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const SAMPAI = "2026-12-31";
let n = 0;

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Kemal", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales1 = await createTestUser({ roles: ["SALES"] });
  const sales2 = await createTestUser({ roles: ["SALES"] });
  const a = makeClient(server.baseUrl, admin.token);

  // Order yang sudah diserahkan (pendapatan diakui → piutang). `dibayar` = uang yang sudah masuk & diposting.
  const order = async ({ nama, value, dibayar = 0, sales, umurHari = 5 }) => {
    const customer = await testPrisma.customer.create({ data: { name: nama, assignedSalesId: sales?.user.id || null } });
    const o = await testPrisma.order.create({
      data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `PTG-${String(++n).padStart(3, "0")}`, status: "DELIVERED", paymentStatus: dibayar ? "DP" : "BELUM_BAYAR", createdAt: new Date(Date.parse(`${SAMPAI}T00:00:00Z`) - umurHari * 86_400_000) },
    });
    if (dibayar) {
      const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: dibayar, method: "TRANSFER", cashAccountId: bank.id, recordedById: admin.user.id } });
      await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: admin.user.id }));
    }
    await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o.id, userId: admin.user.id }));
    return o;
  };
  const o1 = await order({ nama: "Ibu Erni", value: 3_000_000, dibayar: 1_000_000, sales: sales1, umurHari: 20 });
  const o2 = await order({ nama: "+62 Pak Budi", value: 4_000_000, sales: sales2, umurHari: 200 }); // nama berawalan "+" → uji formula
  const o3 = await order({ nama: "Bu Sari", value: 1_500_000, sales: sales1, umurHari: 45 });

  // Refund: satu disetujui (dengan biaya BI-FAST), satu menunggu, satu ditolak. Uang diterima dulu supaya batas refund terpenuhi.
  const uangRefund = async (nama, value) => {
    const customer = await testPrisma.customer.create({ data: { name: nama } });
    const o = await testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `RFO-${String(++n).padStart(3, "0")}`, status: "DELIVERED", paymentStatus: "LUNAS" } });
    const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: value, method: "TRANSFER", cashAccountId: bank.id, recordedById: admin.user.id } });
    await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: admin.user.id }));
    return o;
  };
  const oR1 = await uangRefund("Refund Satu", 2_000_000);
  const oR2 = await uangRefund("Refund Dua", 1_000_000);
  const oR3 = await uangRefund("Refund Tiga", 800_000);
  const buatRefund = async (o, amount, reason, extra = {}) => {
    const r = await a.post("/api/finance/refunds", { orderId: o.id, date: "2026-09-22", amount, reason, cashAccountId: bank.id, ...extra });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    return r.body;
  };
  const r1 = await buatRefund(oR1, 300_000, "Kasur tidak sesuai", { paymentMethod: "TRANSFER", transferFeeType: "BI_FAST", attachmentUrl: "/media/finance-receipts/lampiran-1.jpg" });
  const r2 = await buatRefund(oR2, 150_000, "=HYPERLINK(\"http://x\")");
  const r3 = await buatRefund(oR3, 100_000, "Salah pesan");
  assert.equal((await a.post(`/api/finance/refunds/${r1.id}/approve`, {})).status, 200);
  const tolak = await a.post(`/api/finance/refunds/${r3.id}/reject`, { reason: "Tidak sesuai kebijakan" });
  assert.equal(tolak.status, 200, JSON.stringify(tolak.body));
  return { bank, admin, finance, sales1, sales2, a, o1, o2, o3, r1, r2, r3 };
}

const layarPiutang = async (a) => (await a.get(`/api/finance/reports/receivables?to=${SAMPAI}`)).body;
const layarRefund = async (a) => (await a.get("/api/finance/refunds")).body.refunds;

test("Piutang = data layar: baris & urutan (paling lama dulu), nilai order & sisa (ANGKA), total, umur, kelompok umur; sheet Ringkasan Umur = kartu layar", async () => {
  const c = await siapkan();
  const ar = await layarPiutang(c.a);
  assert.equal(ar.baris.length, 3);
  const r = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", { periode: { to: SAMPAI }, filter: {}, filterLabel: "Tanpa filter (semua data)" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Piutang_Refund_sampai_2026-12-31\.xlsx"/);
  const s = bacaSheet(r.wb, "Piutang");
  assert.deepEqual(s.baris.map((b) => b["No. Order"]), ar.baris.map((b) => b.orderNumber), "urutan = layar");
  assert.deepEqual(s.baris.map((b) => b["Sisa Tagihan (Rp)"]), ar.baris.map((b) => b.sisaTagihan));
  assert.deepEqual(s.baris.map((b) => b["Nilai Order (Rp)"]), ar.baris.map((b) => b.nilaiOrder));
  for (const b of s.baris) { assert.equal(typeof b["Sisa Tagihan (Rp)"], "number"); assert.equal(typeof b["Umur (hari lewat jatuh tempo)"], "number"); }
  assert.equal(s.total["Sisa Tagihan (Rp)"], ar.total);
  assert.equal(s.total["Nilai Order (Rp)"], ar.baris.reduce((x, b) => x + b.nilaiOrder, 0));
  assert.deepEqual(s.baris.map((b) => b["Umur (hari lewat jatuh tempo)"]), ar.baris.map((b) => Math.max(b.hariLewat, 0)));
  const emberLabel = Object.fromEntries(ar.ember.map((e) => [e.key, e.label]));
  assert.deepEqual(s.baris.map((b) => b["Kelompok Umur"]), ar.baris.map((b) => emberLabel[b.ember]));
  assert.deepEqual(s.baris.map((b) => b["Sales"]), ar.baris.map((b) => b.salesName));
  assert.ok(s.baris.every((b) => b["Acuan Umur"] === "tanggal order"));
  assert.ok(s.header.includes("Jatuh Tempo") && s.header.includes("Kelompok Umur"));

  // Ringkasan Umur dibaca mentah (baris "Total Piutang" berawalan TOTAL dianggap baris total oleh bacaSheet).
  const ws = r.wb.getWorksheet("Ringkasan Umur");
  assert.equal(ws.getCell("A6").value, "Keterangan");
  const ring = {};
  for (let i = 7; i <= 7 + ar.ember.length + 1; i++) ring[ws.getCell(`A${i}`).value] = { jumlah: ws.getCell(`B${i}`).value, nominal: ws.getCell(`C${i}`).value };
  assert.equal(ring["Total Piutang"].nominal, ar.total);
  assert.equal(ring["Total Piutang"].jumlah, ar.baris.length);
  for (const e of ar.ember) {
    assert.equal(ring[e.label].nominal, ar.ringkasan[e.key], `ember ${e.key}`);
    assert.equal(ring[e.label].jumlah, ar.baris.filter((b) => b.ember === e.key).length);
  }
  assert.equal(ar.baris.find((b) => b.ember === "90_plus")?.orderNumber, c.o2.orderNumber, "uji ini memang mencakup ember 90+");
  assert.ok(Object.keys(ring).some((k) => /^Ditandai Lunas oleh sales/.test(k)));
});

test("Tanpa periode: posisi piutang = default layar (akhir bulan berjalan), sama dengan GET /reports/receivables tanpa parameter", async () => {
  const c = await siapkan();
  const ar = (await c.a.get("/api/finance/reports/receivables")).body;
  const r = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", {});
  const s = bacaSheet(r.wb, "Piutang");
  assert.deepEqual(s.baris.map((b) => b["No. Order"]), ar.baris.map((b) => b.orderNumber));
  assert.equal(s.total["Sisa Tagihan (Rp)"], ar.total);
  assert.match(r.headers.get("content-disposition"), /Finance_Piutang_Refund_per_\d{4}-\d{2}-\d{2}\.xlsx/);
});

test("Mode id: piutangIds & refundIds (baris yang tampil setelah filter klien) → hanya baris itu, urutan id dihormati, total dihitung ulang; ringkasan tetap seluruh piutang; id kosong/sampah aman", async () => {
  const c = await siapkan();
  const ar = await layarPiutang(c.a);
  const id = (o) => ar.baris.find((b) => b.orderNumber === o.orderNumber).orderId;
  const rf = await layarRefund(c.a);
  const r = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", {
    periode: { to: SAMPAI }, filter: { piutangIds: [id(c.o3), id(c.o1)], refundIds: [c.r2.id, c.r1.id] },
  });
  const s = bacaSheet(r.wb, "Piutang");
  assert.deepEqual(s.baris.map((b) => b["No. Order"]), [c.o3.orderNumber, c.o1.orderNumber], "urutan mengikuti piutangIds");
  assert.equal(s.total["Sisa Tagihan (Rp)"], 1_500_000 + 2_000_000);
  const sr = bacaSheet(r.wb, "Refund");
  assert.deepEqual(sr.baris.map((b) => b["No. Refund"]), [c.r2.refundNumber, c.r1.refundNumber], "urutan mengikuti refundIds");
  assert.equal(sr.total["Nominal (Rp)"], 300_000, "total hanya refund Disetujui pada baris yang diekspor");
  assert.equal(rf.length, 3);
  const ws = r.wb.getWorksheet("Ringkasan Umur");
  assert.equal(ws.getCell("C7").value, ar.total, "kartu ringkasan = seluruh piutang, tidak ikut filter");

  const kosong = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", { periode: { to: SAMPAI }, filter: { piutangIds: [], refundIds: [] } });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Piutang").baris.length, 0);
  assert.equal(bacaSheet(kosong.wb, "Refund").baris.length, 0);
  const sampah = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", { periode: { to: SAMPAI }, filter: { piutangIds: ["tidak-ada"], refundIds: ["bukan-uuid", c.r3.id] } });
  assert.equal(sampah.status, 200);
  assert.equal(bacaSheet(sampah.wb, "Piutang").baris.length, 0);
  assert.deepEqual(bacaSheet(sampah.wb, "Refund").baris.map((b) => b["No. Refund"]), [c.r3.refundNumber]);
});

test("Refund = data layar: baris & urutan, nominal/biaya/total keluar (ANGKA), status, rekening, total hanya Disetujui; alasan penolakan & lampiran sensitif", async () => {
  const c = await siapkan();
  const rf = await layarRefund(c.a);
  const r = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", { periode: { to: SAMPAI } });
  const s = bacaSheet(r.wb, "Refund");
  assert.deepEqual(s.baris.map((b) => b["No. Refund"]), rf.map((x) => x.refundNumber), "urutan = layar (terbaru dulu)");
  assert.deepEqual(s.baris.map((b) => b["Nominal (Rp)"]), rf.map((x) => x.amount));
  for (const b of s.baris) assert.equal(typeof b["Nominal (Rp)"], "number");
  const b1 = s.baris.find((b) => b["No. Refund"] === c.r1.refundNumber);
  assert.equal(b1["Status"], "Disetujui");
  assert.equal(b1["Biaya Transfer (Rp)"], 2500);
  assert.equal(b1["Total Keluar Rekening (Rp)"], 302_500);
  assert.equal(b1["Cara Bayar"], "Transfer");
  assert.equal(b1["Metode Transfer"], "BI-FAST");
  assert.equal(b1["Rekening Sumber"], "SANOBANK Kemal");
  assert.equal(b1["Alasan Refund"], "Kasur tidak sesuai");
  assert.equal(b1["Diajukan Oleh"], c.admin.user.name);
  assert.equal(b1["Diputuskan Oleh (setuju/tolak)"], c.admin.user.name);
  assert.ok(b1["Tanggal"] instanceof Date && b1["Tanggal"].toISOString().slice(0, 10) === "2026-09-22");
  assert.ok(b1["Tanggal & Jam Diajukan"] instanceof Date);
  assert.equal(s.baris.find((b) => b["No. Refund"] === c.r2.refundNumber)["Status"], "Menunggu Persetujuan");
  assert.equal(s.baris.find((b) => b["No. Refund"] === c.r3.refundNumber)["Status"], "Ditolak");
  assert.equal(s.total["Nominal (Rp)"], 300_000);
  assert.equal(s.total["Biaya Transfer (Rp)"], 2500);
  assert.equal(s.total["Total Keluar Rekening (Rp)"], 302_500);
  assert.match(String(s.total["No. Refund"]), /^TOTAL disetujui \(1 refund\)/);
  // Admin melihat kolom sensitif.
  assert.equal(b1["Tautan Lampiran"], "/media/finance-receipts/lampiran-1.jpg");
  assert.equal(s.baris.find((b) => b["No. Refund"] === c.r3.refundNumber)["Alasan Penolakan / Pembatalan"], "Tidak sesuai kebijakan");
});

test("Izin & keamanan: 401 tanpa login, SALES 403 (sama dengan layar); FINANCE boleh tetapi tanpa kolom sensitif; formula di nama pelanggan & alasan refund dinetralkan", async () => {
  const c = await siapkan();
  assert.equal((await unduhExport(server.baseUrl, null, "piutang-refund")).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales1.token, "piutang-refund")).status, 403);
  assert.equal((await makeClient(server.baseUrl, c.sales1.token).get("/api/finance/refunds")).status, 403);
  assert.equal((await makeClient(server.baseUrl, c.sales1.token).get("/api/finance/reports/receivables")).status, 403);

  const fin = await unduhExport(server.baseUrl, c.finance.token, "piutang-refund", { periode: { to: SAMPAI } });
  assert.equal(fin.status, 200);
  const sf = bacaSheet(fin.wb, "Refund");
  assert.ok(!sf.header.includes("Tautan Lampiran") && !sf.header.includes("Alasan Penolakan / Pembatalan"), "kolom sensitif tidak ikut untuk FINANCE");
  assert.ok(sf.header.includes("Alasan Refund"), "alasan refund tampil di layar untuk FINANCE, jadi ikut");

  const adm = await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", { periode: { to: SAMPAI } });
  const pel = bacaSheet(adm.wb, "Piutang").baris.map((b) => b["Pelanggan"]);
  assert.ok(pel.includes("'+62 Pak Budi"), `nama berawalan + dinetralkan: ${JSON.stringify(pel)}`);
  const alasan = bacaSheet(adm.wb, "Refund").baris.find((b) => b["No. Refund"] === c.r2.refundNumber)["Alasan Refund"];
  assert.equal(alasan, "'=HYPERLINK(\"http://x\")");
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "piutang-refund", { filter: { piutangIds: "x" }, periode: { to: "2026-02-31" } })).status, 400);
});
