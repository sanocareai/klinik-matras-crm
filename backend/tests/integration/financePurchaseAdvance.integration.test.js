// Test integrasi "TERAPKAN UANG MUKA" (FinPurchaseAdvanceApplication)
// terhadap PostgreSQL sungguhan.
//
// Skenario inti dari spesifikasi fitur: pembelian 2.100.000, DP 600.000
// diterapkan mengurangi Utang Usaha, sisa 1.500.000 dibayar tunai — total
// debit=kredit, tidak ada beban/kas yang dihitung dua kali. Lihat juga
// posting/purchaseAdvance.js dan komentar model FinPurchaseAdvanceApplication
// (schema.prisma) untuk arah jurnalnya.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { toMoney } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

const NOTA_TES = "/media/finance-receipts/tes.jpg";

let server;
test.before(async () => {
  await truncateAll();
  server = await startTestServer(buildTestApp());
});
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkanFinance() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekeningKas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, rekeningKas.id);
  return { rekeningKas };
}

async function kategori(code) {
  return testPrisma.finPurchaseCategory.findUnique({ where: { code } });
}

async function buatSupplier(name) {
  return testPrisma.finSupplier.create({ data: { code: randomUUID().slice(0, 8), name } });
}

async function saldoAkun(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { debit: true, credit: true },
  });
  return baris.reduce((acc, b) => acc.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

async function assertBukuBesarSeimbang() {
  const semua = await testPrisma.finJournalLine.findMany({
    where: { entry: { status: { in: STATUS_DIHITUNG } } },
    select: { debit: true, credit: true },
  });
  const totalDebit = semua.reduce((a, b) => a.plus(toMoney(b.debit)), toMoney(0));
  const totalKredit = semua.reduce((a, b) => a.plus(toMoney(b.credit)), toMoney(0));
  assert.equal(totalDebit.toFixed(2), totalKredit.toFixed(2), "buku besar tidak seimbang — total debit harus persis sama dengan total kredit");
}

/** Buat DP (kategori UANG_MUKA_PEMBELIAN, mode LANGSUNG) sampai berstatus DIBAYAR. */
async function buatDanBayarDP(client, { supplierId, amount, date = "2026-09-10", cashAccountId, description }) {
  const kat = await kategori("UANG_MUKA_PEMBELIAN");
  const created = await client.post("/api/finance/purchases", {
    receiptUrl: NOTA_TES, date, amount, description: description || `DP ${amount}`,
    categoryId: kat.id, mode: "LANGSUNG", cashAccountId, supplierId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await client.post(`/api/finance/purchases/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DIBAYAR");
  return approved.body;
}

/** Buat pembelian mode UTANG sampai berstatus DISETUJUI (Utang Usaha lahir, belum dibayar). */
async function buatUtangDisetujui(client, { supplierId, amount, date = "2026-09-15", description = "Pembelian" }) {
  const kat = await kategori("BAHAN_BAKU_MANUAL");
  const created = await client.post("/api/finance/purchases", {
    receiptUrl: NOTA_TES, date, amount, description, categoryId: kat.id, mode: "UTANG", supplierId,
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const approved = await client.post(`/api/finance/purchases/${created.body.id}/approve`, {});
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, "DISETUJUI");
  return approved.body;
}

function idemKey(label) {
  return { "Idempotency-Key": `test-${label}-${randomUUID()}` };
}

// ═══════════════════════════════════════════════════════════════════════
// SKENARIO INTI DARI SPESIFIKASI
// ═══════════════════════════════════════════════════════════════════════

test("Skenario inti: pembelian 2.100.000, DP 600.000 diterapkan, sisa 1.500.000 dibayar — tidak ada penghitungan ganda", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("CV Label Garansi");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 600_000, cashAccountId: rekeningKas.id });
  assert.equal(await saldoAkun("1-1500"), "600000.00");

  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 2_100_000, description: "Label garansi kasur" });
  assert.equal(await saldoAkun("5-1150"), "2100000.00", "beban/persediaan diakui SEKALI sebesar total pembelian");
  assert.equal(await saldoAkun("2-1100"), "-2100000.00", "Utang Usaha penuh sebelum DP diterapkan");

  const terapkan = await client.post(
    "/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 600_000 },
    idemKey("inti-1")
  );
  assert.equal(terapkan.status, 201, JSON.stringify(terapkan.body));
  assert.equal(terapkan.body.amount, 600000);
  assert.equal(terapkan.body.status, "ACTIVE");
  assert.ok(terapkan.body.journal?.entryNumber, "respons membawa link ke jurnal");

  assert.equal(await saldoAkun("1-1500"), "0.00", "saldo DP habis dipakai");
  assert.equal(await saldoAkun("2-1100"), "-1500000.00", "Utang Usaha berkurang jadi sisa 1.500.000");

  const ringkasan = await client.get(`/api/finance/purchases/${beli.id}/advance-summary`);
  assert.equal(ringkasan.status, 200);
  assert.equal(ringkasan.body.sebagaiTujuanPembelian.dpDiterapkan, 600000);
  assert.equal(ringkasan.body.sebagaiTujuanPembelian.sisaUtang, 1500000);

  const bayar = await client.post(`/api/finance/purchases/${beli.id}/pay`, { cashAccountId: rekeningKas.id });
  assert.equal(bayar.status, 200, JSON.stringify(bayar.body));
  assert.equal(bayar.body.status, "DIBAYAR");

  assert.equal(await saldoAkun("2-1100"), "0.00", "Utang Usaha lunas total");
  assert.equal(await saldoAkun("1-1100"), "-2100000.00", "kas keluar TOTAL 600.000(DP)+1.500.000(sisa)=2.100.000, BUKAN 2.700.000");
  assert.equal(await saldoAkun("5-1150"), "2100000.00", "beban tetap SATU KALI, tidak dobel");

  await assertBukuBesarSeimbang();
});

test("DP sebagian: menerapkan kurang dari saldo tersedia menyisakan saldo DP", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Toko Bahan Sejahtera");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 1_000_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 400_000 });

  const terapkan = await client.post(
    "/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 300_000 },
    idemKey("partial-1")
  );
  assert.equal(terapkan.status, 201, JSON.stringify(terapkan.body));

  assert.equal(await saldoAkun("1-1500"), "700000.00", "700.000 dari DP 1.000.000 masih tersedia");
  assert.equal(await saldoAkun("2-1100"), "-100000.00", "sisa utang 400.000-300.000=100.000");

  const eligible = await client.get(`/api/finance/purchases/${beli.id}/advance-eligible`);
  assert.equal(eligible.status, 200);
  const kandidat = eligible.body.eligible.find((k) => k.id === dp.id);
  assert.equal(kandidat.saldoTersedia, 700000);
  await assertBukuBesarSeimbang();
});

test("Beberapa DP diterapkan ke SATU pembelian sampai lunas via DP (tidak ada kas keluar saat /pay)", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Multi DP");

  const dp1 = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 400_000, cashAccountId: rekeningKas.id, description: "DP1" });
  const dp2 = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id, description: "DP2" });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 900_000 });

  const r1 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp1.id, targetPurchaseId: beli.id, amount: 400_000 }, idemKey("multi-dp-1"));
  assert.equal(r1.status, 201, JSON.stringify(r1.body));
  const r2 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp2.id, targetPurchaseId: beli.id, amount: 500_000 }, idemKey("multi-dp-2"));
  assert.equal(r2.status, 201, JSON.stringify(r2.body));

  assert.equal(await saldoAkun("2-1100"), "0.00", "Utang Usaha lunas dari DUA DP");

  const kasSebelumBayar = await saldoAkun("1-1100");
  const bayar = await client.post(`/api/finance/purchases/${beli.id}/pay`, {});
  assert.equal(bayar.status, 200, JSON.stringify(bayar.body));
  assert.equal(bayar.body.status, "DIBAYAR", "tetap boleh pindah status DIBAYAR walau tidak ada kas keluar");
  assert.equal(await saldoAkun("1-1100"), kasSebelumBayar, "TIDAK ADA kas tambahan keluar — sudah lunas via DP");

  await assertBukuBesarSeimbang();
});

test("SATU DP diterapkan ke BEBERAPA pembelian sampai habis", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Satu DP Banyak Pembelian");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 1_000_000, cashAccountId: rekeningKas.id });
  const beliA = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 600_000, description: "Beli A" });
  const beliB = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 700_000, description: "Beli B" });

  const rA = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beliA.id, amount: 600_000 }, idemKey("split-a"));
  assert.equal(rA.status, 201, JSON.stringify(rA.body));
  const rB = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beliB.id, amount: 400_000 }, idemKey("split-b"));
  assert.equal(rB.status, 201, JSON.stringify(rB.body));

  assert.equal(await saldoAkun("1-1500"), "0.00", "saldo DP habis persis di dua pembelian");

  const ringkasanDp = await client.get(`/api/finance/purchases/${dp.id}/advance-summary`);
  assert.equal(ringkasanDp.body.sebagaiSumberUangMuka.saldoTersedia, 0);
  assert.equal(ringkasanDp.body.sebagaiSumberUangMuka.histori.length, 2);

  assert.equal(await saldoAkun("2-1100"), "-300000.00", "beliB masih sisa 300.000 (700.000-400.000), beliA lunas");
  await assertBukuBesarSeimbang();
});

// ═══════════════════════════════════════════════════════════════════════
// ATURAN BISNIS — PENOLAKAN
// ═══════════════════════════════════════════════════════════════════════

test("Supplier berbeda ditolak", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplierA = await buatSupplier("Supplier A");
  const supplierB = await buatSupplier("Supplier B");

  const dp = await buatDanBayarDP(client, { supplierId: supplierA.id, amount: 500_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplierB.id, amount: 500_000 });

  const res = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 500_000 }, idemKey("beda-supplier"));
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /supplier yang sama/i);
});

test("DP yang belum DIBAYAR (masih menunggu approval), DITOLAK, atau sudah DIBATALKAN ditolak", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Status DP");
  const kat = await kategori("UANG_MUKA_PEMBELIAN");

  // Belum di-approve (masih MENUNGGU_APPROVAL).
  const belumApprove = await client.post("/api/finance/purchases", {
    receiptUrl: NOTA_TES, date: "2026-09-10", amount: 300_000, description: "DP belum approve",
    categoryId: kat.id, mode: "LANGSUNG", cashAccountId: rekeningKas.id, supplierId: supplier.id,
  });
  const beli1 = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 300_000 });
  const r1 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: belumApprove.body.id, targetPurchaseId: beli1.id, amount: 300_000 }, idemKey("status-1"));
  assert.equal(r1.status, 409, JSON.stringify(r1.body));

  // Ditolak.
  const calonDitolak = await client.post("/api/finance/purchases", {
    receiptUrl: NOTA_TES, date: "2026-09-10", amount: 300_000, description: "DP ditolak",
    categoryId: kat.id, mode: "LANGSUNG", cashAccountId: rekeningKas.id, supplierId: supplier.id,
  });
  const ditolak = await client.post(`/api/finance/purchases/${calonDitolak.body.id}/reject`, { reason: "salah nominal" });
  assert.equal(ditolak.status, 200, JSON.stringify(ditolak.body));
  const beli2 = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 300_000 });
  const r2 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: calonDitolak.body.id, targetPurchaseId: beli2.id, amount: 300_000 }, idemKey("status-2"));
  assert.equal(r2.status, 409, JSON.stringify(r2.body));

  // Dibatalkan (sempat DIBAYAR, lalu dibatalkan).
  const dpDibatalkan = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 300_000, cashAccountId: rekeningKas.id, description: "DP akan dibatalkan" });
  const batal = await client.post(`/api/finance/purchases/${dpDibatalkan.id}/cancel`, { reason: "salah supplier" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  const beli3 = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 300_000 });
  const r3 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dpDibatalkan.id, targetPurchaseId: beli3.id, amount: 300_000 }, idemKey("status-3"));
  assert.equal(r3.status, 409, JSON.stringify(r3.body));
});

test("Nominal melebihi saldo DP tersedia ditolak", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Lebih Saldo");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 200_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 1_000_000 });

  const res = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 300_000 }, idemKey("lebih-saldo"));
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /saldo uang muka tersedia/i);
});

test("Nominal melebihi sisa utang pembelian tujuan ditolak", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Lebih Utang");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 1_000_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 200_000 });

  const res = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 300_000 }, idemKey("lebih-utang"));
  assert.equal(res.status, 400, JSON.stringify(res.body));
  assert.match(res.body.error, /sisa utang/i);
});

test("Target mode REIMBURSEMENT dan target berkategori Uang Muka Pembelian ditolak", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Mode Salah");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id });

  const katBBM = await kategori("BAHAN_BAKU_MANUAL");
  const reimburse = await client.post("/api/finance/purchases", {
    receiptUrl: NOTA_TES, date: "2026-09-16", amount: 200_000, description: "Beli reimburse",
    categoryId: katBBM.id, mode: "REIMBURSEMENT", supplierId: supplier.id,
  });
  const approvedReimburse = await client.post(`/api/finance/purchases/${reimburse.body.id}/approve`, {});
  assert.equal(approvedReimburse.body.status, "DISETUJUI");
  const r1 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: reimburse.body.id, amount: 200_000 }, idemKey("mode-reim"));
  assert.equal(r1.status, 400, JSON.stringify(r1.body));
  assert.match(r1.body.error, /mode Utang/i);

  const dp2 = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id, description: "DP kedua" });
  const r2 = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: dp2.id, amount: 100_000 }, idemKey("target-dp"));
  assert.equal(r2.status, 400, JSON.stringify(r2.body));
  assert.match(r2.body.error, /uang muka lain/i);
});

// ═══════════════════════════════════════════════════════════════════════
// KONKURENSI & IDEMPOTENSI
// ═══════════════════════════════════════════════════════════════════════

test("Double-click / request paralel dengan Idempotency-Key sama menghasilkan SATU penerapan dan SATU jurnal", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Double Click");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 500_000 });

  const headers = { "Idempotency-Key": `double-click-${randomUUID()}` };
  const payload = { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 200_000 };
  const [r1, r2] = await Promise.all([
    client.post("/api/finance/purchases/advance-applications", payload, headers),
    client.post("/api/finance/purchases/advance-applications", payload, headers),
  ]);

  const statuses = [r1.status, r2.status];
  assert.ok(statuses.some((s) => s === 200 || s === 201), `setidaknya satu request harus berhasil: ${statuses}`);
  assert.ok(statuses.every((s) => [200, 201, 409].includes(s)), `status tak terduga: ${statuses}`);

  const baris = await testPrisma.finPurchaseAdvanceApplication.count({
    where: { advancePurchaseId: dp.id, targetPurchaseId: beli.id },
  });
  assert.equal(baris, 1, "double-click hanya boleh menghasilkan SATU baris aplikasi");

  const jurnal = await testPrisma.finJournalEntry.count({
    where: { idempotencyKey: `PEMBELIAN_TERAPKAN_DP:${headers["Idempotency-Key"]}` },
  });
  assert.equal(jurnal, 1, "double-click hanya boleh menghasilkan SATU jurnal");

  await assertBukuBesarSeimbang();
});

test("Pembayaran & penerapan DP paralel pada pembelian yang sama tidak menghasilkan sisa negatif", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Race Pay Apply");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 500_000 });

  const [rPay, rApply] = await Promise.all([
    client.post(`/api/finance/purchases/${beli.id}/pay`, { cashAccountId: rekeningKas.id }),
    client.post("/api/finance/purchases/advance-applications",
      { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 500_000 }, idemKey("race-pay-apply")),
  ]);

  // Row lock pada fin_purchases menyerialkan kedua transaksi — urutan mana
  // pun yang menang, HASIL AKHIRNYA harus tetap sehat: Utang Usaha (akun
  // kredit-normal) tidak boleh bersaldo DEBIT (positif) — itu berarti
  // "utang minus"/kelebihan bayar, kombinasi bug yang persis diminta
  // dicegah aturan bisnis "tidak boleh menghasilkan sisa utang negatif".
  const utangAkhir = Number(await saldoAkun("2-1100"));
  assert.ok(utangAkhir <= 0, `Utang Usaha tidak boleh bersaldo debit (utang minus): ${utangAkhir}`);

  // Kas yang keluar total (DP 500rb yang sudah lebih dulu, + kemungkinan
  // pelunasan tunai kalau /pay menang duluan) tidak boleh melebihi total
  // pembelian (500.000) + DP (500.000) — tidak boleh dobel dihitung.
  const kasAkhir = Number(await saldoAkun("1-1100"));
  assert.ok(kasAkhir >= -1_000_000, `kas keluar melebihi wajar: ${kasAkhir}`);

  assert.ok([rPay.status, rApply.status].some((s) => s === 200 || s === 201), "salah satu operasi harus berhasil");
  await assertBukuBesarSeimbang();
});

// ═══════════════════════════════════════════════════════════════════════
// PEMBATALAN (REVERSAL)
// ═══════════════════════════════════════════════════════════════════════

test("Batalkan penerapan DP: saldo DP tersedia & Utang Usaha target kembali seperti semula", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Batal DP");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 500_000 });

  const terapkan = await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 500_000 }, idemKey("batal-dp"));
  assert.equal(terapkan.status, 201, JSON.stringify(terapkan.body));
  assert.equal(await saldoAkun("1-1500"), "0.00");
  assert.equal(await saldoAkun("2-1100"), "0.00");

  const batal = await client.post(`/api/finance/purchases/advance-applications/${terapkan.body.id}/cancel`, { reason: "salah pilih pembelian" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(batal.body.status, "REVERSED");

  assert.equal(await saldoAkun("1-1500"), "500000.00", "saldo DP kembali tersedia penuh");
  assert.equal(await saldoAkun("2-1100"), "-500000.00", "Utang Usaha target kembali penuh");

  const eligible = await client.get(`/api/finance/purchases/${beli.id}/advance-eligible`);
  const kandidat = eligible.body.eligible.find((k) => k.id === dp.id);
  assert.equal(kandidat.saldoTersedia, 500000, "DP bisa dipakai lagi setelah penerapannya dibatalkan");

  // Tidak boleh dibatalkan dua kali.
  const batalLagi = await client.post(`/api/finance/purchases/advance-applications/${terapkan.body.id}/cancel`, { reason: "coba lagi" });
  assert.equal(batalLagi.status, 409, JSON.stringify(batalLagi.body));

  await assertBukuBesarSeimbang();
});

test("Pembelian dengan penerapan DP aktif tidak bisa dibatalkan/dikoreksi sebelum penerapannya dibatalkan dulu", async () => {
  const { rekeningKas } = await siapkanFinance();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const client = makeClient(server.baseUrl, token);
  const supplier = await buatSupplier("Supplier Guard Cancel");

  const dp = await buatDanBayarDP(client, { supplierId: supplier.id, amount: 500_000, cashAccountId: rekeningKas.id });
  const beli = await buatUtangDisetujui(client, { supplierId: supplier.id, amount: 500_000 });
  await client.post("/api/finance/purchases/advance-applications",
    { advancePurchaseId: dp.id, targetPurchaseId: beli.id, amount: 500_000 }, idemKey("guard-1"));

  const batalTarget = await client.post(`/api/finance/purchases/${beli.id}/cancel`, { reason: "coba batalkan" });
  assert.equal(batalTarget.status, 409, JSON.stringify(batalTarget.body));

  const batalSumber = await client.post(`/api/finance/purchases/${dp.id}/cancel`, { reason: "coba batalkan DP" });
  assert.equal(batalSumber.status, 409, JSON.stringify(batalSumber.body));

  const koreksiTarget = await client.post(`/api/finance/purchases/${beli.id}/koreksi`, { reason: "ubah nominal", amount: 400_000 });
  assert.equal(koreksiTarget.status, 409, JSON.stringify(koreksiTarget.body));
});
