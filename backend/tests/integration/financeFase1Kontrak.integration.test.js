// FINANCE FASE 1 — KONTRAK ANGKA. Yang dikunci (fixture: DP lintas bulan, pembayaran sebelum saldo awal, pembayaran belum dibukukan, beda tanggal UTC/WIB,
// transfer antarbank berbiaya, tagihan+pembayaran supplier, uang muka + pertanggungjawaban):
//  - GET /kontrak-metrik: izin + isi; /jembatan/uang-masuk-kas: Uang Masuk Terverifikasi → Kas Masuk Buku, tiap Payment di TEPAT SATU kelas, residual Rp0 terhadap B yang dibaca langsung;
//  - Arus Kas: transfer antarbank tidak menambah Kas Masuk/Keluar gross, biaya admin transfer TETAP keluar, saldo akhir Arus Kas = Kas & Bank menurut buku;
//  - Audit hitung ganda bersih untuk alur resmi (supplier, uang muka, transfer), dan MENDETEKSI anomali yang ditanam langsung ke DB.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postPaymentReceived } from "../../src/services/finance/posting/orderRevenue.js";
import { postCashTransfer } from "../../src/services/finance/posting/cash.js";
import { METRIK } from "../../src/services/finance/kontrakMetrik.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let seq = 0;
async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "BCA Operasional", kind: "BANK", accountId: akunBank.id } });
  const bank2 = await testPrisma.finCashAccount.create({ data: { name: "Mandiri", kind: "BANK", accountId: akunBank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Tunai", kind: "KAS", accountId: akunKas.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return { bank, bank2, kas, admin, finance, sales, a: makeClient(server.baseUrl, admin.token), f: makeClient(server.baseUrl, finance.token), s: makeClient(server.baseUrl, sales.token) };
}

async function bayar(w, { tgl, nominal, rek = w.bank, verif = true, post = true }) {
  seq += 1;
  const c = await testPrisma.customer.create({ data: { name: `Pelanggan ${seq}`, phone: `62813${String(seq).padStart(7, "0")}`, pipelineStage: "TRANSACTION" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: nominal, category: "LAYANAN", orderNumber: `F1-${Date.now()}-${seq}`, status: "DELIVERED", paymentStatus: "DP" } });
  const p = await testPrisma.payment.create({ data: { orderId: o.id, amount: nominal, method: "TRANSFER", recordedById: w.sales.user.id, createdAt: new Date(tgl), ...(rek && { cashAccountId: rek.id }) } });
  if (verif) await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: w.finance.user.id } });
  if (post) await testPrisma.$transaction((tx) => postPaymentReceived(tx, { paymentId: p.id, userId: w.finance.user.id }));
  return p;
}
const kelas = (b, k) => b.detail[k] ?? [];
const langkah = (b, k) => b.langkah.find((l) => l.kunci === k);

test("GET /kontrak-metrik: semua pengguna login 200 dengan kontrak lengkap (definisi statis); tanpa login 401", async () => {
  const w = await dunia();
  const r = await w.f.get("/api/finance/kontrak-metrik");
  assert.equal(r.status, 200);
  assert.equal(r.body.metrik.length, METRIK.length);
  assert.ok(r.body.metrik.every((m) => m.definisi && m.rumus && m.basisLabel));
  assert.equal(r.body.zonaWaktu, "Asia/Jakarta (WIB, UTC+7)");
  assert.equal((await w.a.get("/api/finance/kontrak-metrik")).status, 200);
  assert.equal((await w.s.get("/api/finance/kontrak-metrik")).status, 200, "definisi statis — semua pengguna login (Laporan Sales memakainya)");
  assert.equal((await makeClient(server.baseUrl, null).get("/api/finance/kontrak-metrik")).status, 401);
});

test("JEMBATAN Uang Masuk → Kas Masuk: tiap Payment tepat satu kelas; sebelum saldo awal, belum dibukukan, beda tanggal UTC/WIB; residual 0 terhadap B dari jurnal", async () => {
  const w = await dunia();
  await bayar(w, { tgl: "2026-09-20T05:00:00Z", nominal: 1_000_000 });                       // normal, masuk kas
  await bayar(w, { tgl: "2026-09-10T05:00:00Z", nominal: 500_000 });                         // sebelum cutoff 18 Sep → Laba Ditahan, kas tidak bertambah
  await bayar(w, { tgl: "2026-09-22T05:00:00Z", nominal: 300_000, rek: null });              // rekening belum dipetakan → belum dibukukan (gap)
  await bayar(w, { tgl: "2026-09-30T18:00:00Z", nominal: 200_000 });                         // 1 Okt 01:00 WIB, jurnal bertanggal 30 Sep (UTC)
  await bayar(w, { tgl: "2026-09-25T05:00:00Z", nominal: 700_000, verif: false });           // belum diverifikasi tetapi SUDAH dijurnal → bukan Uang Masuk, tetap ada di buku (gross)
  const r = await w.f.get("/api/finance/jembatan/uang-masuk-kas?from=2026-09-01&to=2026-09-30");
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const b = r.body;
  assert.equal(b.uangMasukTerverifikasi, 1_800_000, "1.000.000 + 500.000 + 300.000 (tanggal WIB 30 Sep ≤ 23:59); 200.000 jatuh 1 Okt WIB");
  assert.equal(langkah(b, "SEBELUM_SALDO_AWAL").jumlah, 500_000);
  assert.equal(langkah(b, "BELUM_DIBUKUKAN").jumlah, 300_000);
  assert.equal(langkah(b, "BEDA_TANGGAL_MASUK").jumlah, 200_000, "jurnal bertanggal 30 Sep, tanggal bayar WIB 1 Okt");
  assert.equal(langkah(b, "TIDAK_LAGI_AKTIF").jumlah, 700_000, "jurnal dari Payment yang belum terverifikasi tetap terhitung di buku");
  assert.equal(b.kasMasukBuku, 1_900_000, "1.000.000 + 200.000 (beda tanggal) + 700.000 (belum terverifikasi, sudah dijurnal)");
  assert.equal(b.residual, 0);
  assert.equal(b.status.perhitungan, "COCOK");
  assert.equal(b.status.perluDitinjau, true, "ada yang belum dibukukan");
  assert.equal(b.selisih, -100_000);
  // tiap Payment tepat satu kelas — tidak ada yang muncul di dua kelas
  const semuaId = ["SEBELUM_SALDO_AWAL", "BELUM_DIBUKUKAN", "BEDA_TANGGAL_KELUAR", "SELISIH_NOMINAL"].flatMap((k) => kelas(b, k).map((x) => x.paymentId));
  assert.equal(new Set(semuaId).size, semuaId.length);
  // Oktober: simetris — pembayaran 1 Okt WIB masuk Uang Masuk, jurnalnya bertanggal 30 Sep = di luar periode
  const okt = (await w.f.get("/api/finance/jembatan/uang-masuk-kas?from=2026-10-01&to=2026-10-31")).body;
  assert.equal(okt.uangMasukTerverifikasi, 200_000);
  assert.equal(langkah(okt, "BEDA_TANGGAL_KELUAR").jumlah, 200_000);
  assert.equal(okt.kasMasukBuku, 0);
  assert.equal(okt.residual, 0);
  // Jumlah dua periode berurutan menutup: A(Sep)+A(Okt) − belum/sebelum = B(Sep)+B(Okt)
  assert.equal(b.uangMasukTerverifikasi + okt.uangMasukTerverifikasi - 500_000 - 300_000 + 700_000, b.kasMasukBuku + okt.kasMasukBuku);
});

test("JEMBATAN: validasi periode 400; periode kosong semua Rp0 'cocok' dan tidak perlu ditinjau; izin Sales 403", async () => {
  const w = await dunia();
  const kosong = (await w.f.get("/api/finance/jembatan/uang-masuk-kas?from=2026-03-01&to=2026-03-31")).body;
  assert.equal(kosong.residual, 0);
  assert.equal(kosong.uangMasukTerverifikasi, 0);
  assert.equal(kosong.status.perluDitinjau, false);
  assert.equal((await w.s.get("/api/finance/jembatan/uang-masuk-kas?from=2026-09-01&to=2026-09-30")).status, 403);
});

test("ARUS KAS: transfer antarbank berbiaya tidak menambah Kas Masuk/Keluar gross, biaya admin tetap keluar, saldo akhir Arus Kas = Kas & Bank buku; rincian per sumber ada", async () => {
  const w = await dunia();
  await bayar(w, { tgl: "2026-09-20T05:00:00Z", nominal: 1_000_000 });
  const tf = await testPrisma.finCashTransfer.create({ data: { transferNumber: `TRF-${Date.now()}`, date: new Date("2026-09-21T00:00:00Z"), amount: 400_000, fromAccountId: w.bank.id, toAccountId: w.bank2.id, feeAmount: 6_500, createdById: w.finance.user.id } });
  await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: tf.id, userId: w.finance.user.id }));
  const cf = (await w.f.get("/api/finance/reports/cash-flow?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(cf.ringkasan.masuk, 1_000_000, "transfer tidak menambah Kas Masuk");
  assert.equal(cf.ringkasan.keluar, 6_500, "hanya biaya admin transfer yang benar-benar keluar");
  assert.equal(cf.ringkasan.saldoAkhir, 1_000_000 - 6_500);
  const kasBuku = await testPrisma.finJournalLine.aggregate({ where: { account: { systemKey: { in: ["KAS", "BANK"] } }, entry: { status: { in: ["POSTED", "REVERSED"] }, date: { lte: new Date("2026-09-30T00:00:00Z") } } }, _sum: { debit: true, credit: true } });
  assert.equal(Number(kasBuku._sum.debit) - Number(kasBuku._sum.credit), cf.ringkasan.saldoAkhir, "Saldo Akhir Arus Kas = Kas & Bank menurut buku");
  const per = Object.fromEntries(cf.rincianSumber.map((x) => [x.sumber, x]));
  assert.equal(per.PEMBAYARAN_ORDER.masuk, 1_000_000);
  assert.equal(per.TRANSFER_KAS.keluar, 6_500);
  assert.equal(per.TRANSFER_KAS.masuk, 0);
});

test("AUDIT hitung ganda: alur resmi supplier + uang muka + transfer + pembayaran → semua pemeriksaan OK; kas keluar tiap kejadian TEPAT SEKALI", async () => {
  const w = await dunia();
  await bayar(w, { tgl: "2026-09-20T05:00:00Z", nominal: 2_000_000 });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-1", name: "CV Busa" } });
  const bill = await w.a.post("/api/finance/bills", { supplierId: sup.id, billDate: "2026-09-21", amount: 600_000, description: "Busa", billType: "JASA_OPERASIONAL", expenseCategoryId: kat.id });
  assert.equal(bill.status, 201, JSON.stringify(bill.body));
  assert.equal((await w.a.post(`/api/finance/bills/${bill.body.id}/approve`, {})).status, 200);
  const sp = await w.a.post("/api/finance/supplier-payments", { supplierId: sup.id, date: "2026-09-22", cashAccountId: w.bank.id, allocations: [{ billId: bill.body.id, amount: 600_000 }] });
  assert.equal(sp.status, 201, JSON.stringify(sp.body));
  const driver = await createTestUser({ roles: ["DRIVER"] });
  const um = await w.a.post("/api/finance/uang-muka", { holderId: driver.user.id, division: "DELIVERY", purpose: "Uang jalan", date: "2026-09-23", dueDate: "2026-09-30", amount: 300_000, cashAccountId: w.bank.id });
  assert.equal(um.status, 201, JSON.stringify(um.body));
  const pj = await w.a.post(`/api/finance/uang-muka/${um.body.id}/pertanggungjawaban`, { date: "2026-09-24", amount: 250_000, description: "BBM", categoryId: kat.id, payeeName: "SPBU", receiptUrl: "/media/finance-receipts/" + "d".repeat(40) + ".jpg" });
  assert.equal(pj.status, 201, JSON.stringify(pj.body));
  assert.equal((await w.a.post(`/api/finance/expenses/${pj.body.id}/approve`, {})).status, 200);

  const au = (await w.f.get("/api/finance/audit-konsistensi")).body;
  assert.equal(au.bacaSaja, true);
  for (const p of au.pemeriksaan) assert.equal(p.status, "OK", `${p.kunci}: ${JSON.stringify(p.contoh)}`);
  assert.equal(au.ringkasan.perluDitinjau, 0);
  assert.equal(au.pemeriksaan.length, 8);

  // Kas keluar: supplier 600.000 SEKALI + uang muka 300.000 SEKALI; pertanggungjawaban 250.000 tidak mengurangi kas lagi
  const cf = (await w.f.get("/api/finance/reports/cash-flow?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(cf.ringkasan.keluar, 600_000 + 300_000);
  const per = Object.fromEntries(cf.rincianSumber.map((x) => [x.sumber, x]));
  assert.equal(per.PEMBAYARAN_SUPPLIER.keluar, 600_000);
  assert.equal(per.UANG_MUKA_OPERASIONAL.keluar, 300_000);
  assert.equal(per.PENGELUARAN?.keluar ?? 0, 0, "biaya yang dipertanggungjawabkan dengan uang muka tidak mengeluarkan kas lagi");
});

test("AUDIT mendeteksi anomali yang ditanam langsung ke DB (alokasi ≠ nominal, pembayaran supplier > tagihan, refund > uang masuk) — tanpa mengubah data", async () => {
  const w = await dunia();
  const p = await bayar(w, { tgl: "2026-09-20T05:00:00Z", nominal: 1_000_000 });
  await testPrisma.finPaymentAllocation.create({ data: { paymentId: p.id, orderId: p.orderId, amount: 900_000 } });
  const kat = await testPrisma.finExpenseCategory.findUnique({ where: { code: "PERLENGKAPAN" } });
  const sup = await testPrisma.finSupplier.create({ data: { code: "SUP-2", name: "Toko X" } });
  const bill = (await w.a.post("/api/finance/bills", { supplierId: sup.id, billDate: "2026-09-21", amount: 100_000, description: "x", billType: "JASA_OPERASIONAL", expenseCategoryId: kat.id })).body;
  await w.a.post(`/api/finance/bills/${bill.id}/approve`, {});
  const pay = await testPrisma.finSupplierPayment.create({ data: { paymentNumber: `PAYOUT-${Date.now()}`, supplierId: sup.id, date: new Date("2026-09-22T00:00:00Z"), amount: 150_000, cashAccountId: w.bank.id, createdById: w.admin.user.id } });
  await testPrisma.finSupplierPaymentAllocation.create({ data: { paymentId: pay.id, billId: bill.id, amount: 150_000 } });
  const p2 = await bayar(w, { tgl: "2026-09-21T05:00:00Z", nominal: 400_000 });
  await testPrisma.finRefund.create({ data: { refundNumber: `RF-${Date.now()}`, orderId: p2.orderId, amount: 500_000, status: "DISETUJUI", reason: "uji", cashAccountId: w.bank.id, createdById: w.finance.user.id, date: new Date("2026-09-25T00:00:00Z") } });
  const sebelum = { pay: await testPrisma.payment.count(), je: await testPrisma.finJournalEntry.count(), alok: await testPrisma.finPaymentAllocation.count() };

  const au = (await w.f.get("/api/finance/audit-konsistensi")).body;
  const per = Object.fromEntries(au.pemeriksaan.map((x) => [x.kunci, x]));
  assert.equal(per.ALOKASI_TIDAK_SAMA.status, "PERLU_DITINJAU");
  assert.equal(per.ALOKASI_TIDAK_SAMA.nilai, 100_000);
  assert.equal(per.SUPPLIER_BAYAR_LEBIH.status, "PERLU_DITINJAU");
  assert.equal(per.SUPPLIER_BAYAR_LEBIH.nilai, 50_000);
  assert.equal(per.REFUND_LEBIH.status, "PERLU_DITINJAU");
  assert.equal(per.REFUND_LEBIH.nilai, 100_000);
  assert.equal(per.PAYMENT_JURNAL_GANDA.status, "OK");
  assert.deepEqual({ pay: await testPrisma.payment.count(), je: await testPrisma.finJournalEntry.count(), alok: await testPrisma.finPaymentAllocation.count() }, sebelum, "audit tidak menulis apa pun");
});

test("EXPORT: setiap modul memuat sheet 'Definisi Angka' + baris basis tanggal & zona waktu WIB di kepala; angka sheet data TIDAK berubah", async () => {
  const { unduhExport } = await import("./setup/exportHelper.js");
  const w = await dunia();
  await bayar(w, { tgl: "2026-09-20T05:00:00Z", nominal: 1_000_000 });
  for (const modul of ["pembayaran", "pemasukan", "pengeluaran", "kasbon", "uang-muka", "supplier-utang"]) {
    const r = await unduhExport(server.baseUrl, w.finance.token, modul, { periode: { from: "2026-09-01", to: "2026-09-30" } });
    assert.equal(r.status, 200, `${modul}: ${JSON.stringify(r.json)}`);
    const def = r.wb.getWorksheet("Definisi Angka");
    assert.ok(def, `${modul}: sheet Definisi Angka tidak ada`);
    assert.ok(def.rowCount >= 7, `${modul}: Definisi Angka kosong`);
    assert.equal(def.getRow(6).getCell(1).value, "Angka");
    const sheetData = r.wb.worksheets.find((s) => s.name !== "Definisi Angka");
    assert.match(String(sheetData.getRow(5).getCell(1).value), /^Basis tanggal: .+ · Zona waktu: WIB \(UTC\+7\)$/, `${modul}: baris basis tanggal`);
  }
});

test("DASHBOARD: 'Pembayaran Belum Diverifikasi' = jumlah TOTAL (60), bukan panjang daftar yang dipotong 50 baris", async () => {
  const w = await dunia();
  const c = await testPrisma.customer.create({ data: { name: "Banyak Bayar", phone: "628130000999", pipelineStage: "TRANSACTION" } });
  const o = await testPrisma.order.create({ data: { customerId: c.id, value: 10_000_000, category: "LAYANAN", orderNumber: `F1-BANYAK-${Date.now()}`, status: "READY", paymentStatus: "DP" } });
  await testPrisma.payment.createMany({ data: Array.from({ length: 60 }, (_, i) => ({ orderId: o.id, amount: 10_000 + i, method: "TRANSFER", recordedById: w.sales.user.id, createdAt: new Date(`2026-09-2${i % 9}T05:00:00Z`) })) });
  const d = (await w.f.get("/api/finance/dashboard?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(d.antrean.jumlahPembayaranBelumVerifikasi, 60);
  assert.equal(d.antrean.pembayaranBelumVerifikasi.length, 50, "daftar tetap dipotong 50");
});

test("PEMBELIAN & PENGELUARAN: total aktif memisahkan Dibatalkan/Ditolak dari total semua status; ringkasan dari SEMUA baris (bukan hanya yang dimuat); Excel TOTAL AKTIF = kartu layar", async () => {
  const { unduhExport, bacaSheet } = await import("./setup/exportHelper.js");
  const w = await dunia();
  const kat = await testPrisma.finPurchaseCategory.findUnique({ where: { code: "BAHAN_BAKU_MANUAL" } });
  let n = 0;
  const buat = (status, amount) => testPrisma.finPurchase.create({ data: { purchaseNumber: `PUR-F1-${++n}`, date: new Date("2026-09-15T00:00:00Z"), amount, description: `uji ${status}`, categoryId: kat.id, status, createdById: w.finance.user.id } });
  await buat("DISETUJUI", 1_000_000); await buat("DIBAYAR", 500_000); await buat("MENUNGGU_APPROVAL", 200_000); await buat("DIBATALKAN", 700_000); await buat("DITOLAK", 100_000);
  const r = (await w.f.get("/api/finance/purchases?from=2026-09-01&to=2026-09-30")).body;
  assert.equal(r.total, 2_500_000, "semua status");
  assert.equal(r.ringkasan.totalAktif, 1_700_000, "di luar dibatalkan/ditolak");
  assert.equal(r.ringkasan.tidakDihitung.nominal, 800_000);
  assert.equal(r.ringkasan.jumlahSemua, 5);
  assert.equal(r.terpotong, false);
  const filterDibatalkan = (await w.f.get("/api/finance/purchases?from=2026-09-01&to=2026-09-30&status=DIBATALKAN")).body;
  assert.equal(filterDibatalkan.total, 700_000, "filter status tertentu: total apa adanya");
  const x = await unduhExport(server.baseUrl, w.finance.token, "pembelian", { periode: { from: "2026-09-01", to: "2026-09-30" } });
  assert.equal(x.status, 200);
  const s = bacaSheet(x.wb, "Pembelian");
  assert.match(String(s.total?.[Object.keys(s.total)[0]]), /^TOTAL AKTIF \(3 pembelian/);
  assert.equal(s.total["Nominal (Rp)"] ?? s.total[Object.keys(s.total).find((k) => /Nominal/.test(k))], 1_700_000, "Excel TOTAL AKTIF = kartu layar");
});
