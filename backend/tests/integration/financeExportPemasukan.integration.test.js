// EXPORT EXCEL FINANCE — PEMASUKAN (B3.9). Yang dikunci: berkas = data yang SAMA dengan layar (GET /pemasukan, semua halaman): baris, urutan, nilai (ANGKA),
// status, total (tanpa Dikecualikan/Ditolak); kategori/status/pencarian/rekening/periode diikuti; tanggal WIB (pembayaran 00:00-07:00 WIB); izin (401/403);
// formula dinetralkan; rekap klasifikasi konsisten dengan baris.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { unduhExport, bacaSheet } from "./setup/exportHelper.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { bukukanPembayaran } from "../../src/services/finance/hooks.js";
import { postRevenueRecognition } from "../../src/services/finance/posting/orderRevenue.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { toMoney } from "../../src/services/finance/money.js";
import { randomUUID } from "node:crypto";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

let no = 0;
async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = (systemKey) => testPrisma.finAccount.findUnique({ where: { systemKey } });
  const bankA = await akun(SYSTEM_KEYS.BANK); const kasA = await akun(SYSTEM_KEYS.KAS);
  const bank = await testPrisma.finCashAccount.create({ data: { name: "SANOBANK Kemal", kind: "BANK", accountId: bankA.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: kasA.id } });
  await setSetting(testPrisma, SETTING_KEYS.CASH_ACCOUNT_CASH, kas.id);
  const kode = (c) => testPrisma.finAccount.findFirst({ where: { code: c } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  const finance = await createTestUser({ roles: ["FINANCE"] });
  const sales = await createTestUser({ roles: ["SALES"] });
  return { bank, kas, bankA, modal: await kode("3-1100"), lain: await kode("4-9100"), admin, finance, sales, a: makeClient(server.baseUrl, admin.token) };
}
const jurnal = (c, { source, tanggal = "2026-09-10", baris, desc = "uji" }) => testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: desc, source, idempotencyKey: `PMX:${randomUUID()}`, userId: c.admin.user.id, lines: baris }));
async function buatOrder({ value, nama, createdAt = new Date("2026-09-05T03:00:00Z") }) {
  const customer = await testPrisma.customer.create({ data: { name: nama } });
  return testPrisma.order.create({ data: { customerId: customer.id, value, category: "LAYANAN", orderNumber: `SAN-PX-${String(++no).padStart(4, "0")}`, status: "DELIVERED", paymentStatus: "BELUM_BAYAR", createdAt } });
}
async function bayar(c, order, { amount, tanggal, verif }) {
  const p = await testPrisma.payment.create({ data: { orderId: order.id, amount, method: "TRANSFER", cashAccountId: c.bank.id, recordedById: c.admin.user.id, createdAt: tanggal } });
  if (verif) {
    await testPrisma.$transaction((tx) => bukukanPembayaran(tx, { paymentId: p.id, userId: c.admin.user.id }));
    await testPrisma.paymentVerification.create({ data: { paymentId: p.id, verifiedById: c.admin.user.id } });
  }
  return p;
}
const PER = "from=2026-09-01&to=2026-09-30";
const periode = { from: "2026-09-01", to: "2026-09-30" };

async function dataLengkap() {
  const c = await siapkan();
  const o1 = await buatOrder({ value: 1_000_000, nama: "Ibu Erni" });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o1.id, userId: c.admin.user.id, date: "2026-09-10" }));
  const o2 = await buatOrder({ value: 750_000, nama: "Pak Budi" });
  await testPrisma.$transaction((tx) => postRevenueRecognition(tx, { orderId: o2.id, userId: c.admin.user.id, date: "2026-09-11" }));
  // pembayaran terverifikasi jam 01:30 WIB tanggal 10 Sep (= 09 Sep 18:30 UTC) — kasus batas WIB
  const pTerverif = await bayar(c, o1, { amount: 500_000, tanggal: new Date("2026-09-09T18:30:00Z"), verif: true });
  const pMenunggu = await bayar(c, o2, { amount: 100_000, tanggal: new Date("2026-09-11T03:00:00Z"), verif: false });
  await jurnal(c, { source: "PEMASUKAN_LAIN", tanggal: "2026-09-12", desc: "=cmd|' /C calc'!A0", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(250_000.75) }, { accountId: c.lain.id, credit: toMoney(250_000.75) }] });
  await jurnal(c, { source: "MANUAL", tanggal: "2026-09-15", desc: "Setoran modal pemilik", baris: [{ accountId: c.bankA.id, cashAccountId: c.bank.id, debit: toMoney(5_000_000) }, { accountId: c.modal.id, credit: toMoney(5_000_000) }] });
  await jurnal(c, { source: "TRANSFER_KAS", tanggal: "2026-09-16", desc: "Transfer ke kas", baris: [{ accountId: c.kas.accountId, cashAccountId: c.kas.id, debit: toMoney(2_000_000) }, { accountId: c.bankA.id, cashAccountId: c.bank.id, credit: toMoney(2_000_000) }] });
  return { c, o1, o2, pTerverif, pMenunggu };
}

// Ambil SEMUA baris layar (semua halaman, limit 100) untuk query tertentu.
async function layarSemua(c, q = "") {
  const semua = []; let total; let totalNilai;
  for (let page = 1; page < 50; page++) {
    const r = (await c.a.get(`/api/finance/pemasukan?${PER}&limit=100&page=${page}${q}`));
    assert.equal(r.status, 200, JSON.stringify(r.body));
    semua.push(...r.body.items); total = r.body.total; totalNilai = r.body.totalNilai;
    if (!r.body.adaLagi) break;
  }
  return { items: semua, total, totalNilai };
}

test("Berkas Pemasukan (semua kategori) = data layar: baris, urutan, nilai ANGKA, status, total layar; kepala memuat periode & filter", async () => {
  const { c } = await dataLengkap();
  const layar = await layarSemua(c);
  assert.ok(layar.total >= 6, `layar punya ${layar.total} baris`);
  const r = await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode, filterLabel: "Kategori: (semua)" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-disposition"), /filename="Finance_Pemasukan_2026-09-01_sd_2026-09-30\.xlsx"/);
  const s = bacaSheet(r.wb, "Pemasukan");
  assert.equal(s.baris.length, layar.items.length);
  layar.items.forEach((b, i) => {
    const x = s.baris[i];
    assert.equal(x["Nomor"], b.nomor, `urutan #${i}`);
    assert.equal(x["Sumber"], b.sumberLabel);
    assert.equal(typeof x["Nilai (Rp)"], "number");
    assert.equal(x["Nilai (Rp)"], Number(b.nilai), `nilai #${i}`);
    assert.equal(x["Status"], b.statusLabel);
    assert.equal(x["Klasifikasi"], b.kategoriLabel);
    assert.equal(x["Tanggal"].toISOString().slice(0, 10), b.tanggal);
  });
  assert.equal(s.total["Nilai (Rp)"], Number(layar.totalNilai), "total = total di layar (tanpa Dikecualikan/Ditolak/Dibatalkan)");
  assert.match(s.kepala[1], /Periode: 1 Sep 2026 – 30 Sep 2026/);
  assert.match(s.kepala[2], /Filter: Kategori: \(semua\)/);
  assert.ok(s.header.includes("Nilai (Rp)") && s.header.includes("Pelanggan/Pembayar") && s.header.includes("Status Pembayaran"));

  // total layar memang berbeda dari jumlah semua baris (transfer dikecualikan) — dan berkas menjelaskannya lewat rekap
  const jumlahSemua = s.baris.reduce((a, x) => a + (x["Nilai (Rp)"] || 0), 0);
  assert.notEqual(jumlahSemua, s.total["Nilai (Rp)"]);
  const rekap = bacaSheet(r.wb, "Rekap Klasifikasi");
  const jumlahRekap = rekap.baris.filter((x) => typeof x["Jumlah Baris"] === "number").reduce((a, x) => a + x["Jumlah Baris"], 0);
  assert.equal(jumlahRekap, s.baris.length, "rekap mencakup semua baris");
  assert.equal(Math.round(rekap.total["Nilai (Rp)"] * 100), Math.round(jumlahSemua * 100));
  assert.ok(rekap.baris.some((x) => x["Klasifikasi"] === "Dikecualikan"));

  // Pendapatan diakui membawa status pembayaran dari server; kolom bruto/retur terisi
  const pend = s.baris.filter((x) => x["Klasifikasi"] === "Pendapatan Diakui");
  assert.equal(pend.length, 2);
  assert.ok(pend.every((x) => x["Status Pembayaran"]), "status pembayaran ikut");
  assert.equal(pend.find((x) => x["Nilai (Rp)"] === 1_000_000)["Penjualan Bruto (Rp)"], 1_000_000);
});

test("Kategori & filter diikuti persis layar: Uang Masuk + status MENUNGGU, pencarian, pihak, rekening, periode", async () => {
  const { c, pTerverif } = await dataLengkap();
  const kasus = [
    [{ kategori: "PENDAPATAN" }, "&kategori=PENDAPATAN"],
    [{ kategori: "PEMBAYARAN" }, "&kategori=PEMBAYARAN"],
    [{ kategori: "PEMBAYARAN", status: "MENUNGGU" }, "&kategori=PEMBAYARAN&status=MENUNGGU"],
    [{ kategori: "DANA" }, "&kategori=DANA"],
    [{ kategori: "LAIN" }, "&kategori=LAIN"],
    [{ q: "budi" }, "&q=budi"],
    [{ pihak: "erni" }, "&pihak=erni"],
    [{ rekening: c.bank.id }, `&rekening=${c.bank.id}`],
  ];
  for (const [filter, query] of kasus) {
    const layar = await layarSemua(c, query);
    const r = await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode, filter });
    assert.equal(r.status, 200, JSON.stringify(filter));
    const s = bacaSheet(r.wb, "Pemasukan");
    assert.deepEqual(s.baris.map((x) => [x["Nomor"], x["Nilai (Rp)"]]), layar.items.map((b) => [b.nomor, Number(b.nilai)]), JSON.stringify(filter));
    assert.equal(s.total["Nilai (Rp)"], Number(layar.totalNilai), JSON.stringify(filter));
    assert.ok(layar.items.length >= 1, `filter ${JSON.stringify(filter)} punya hasil`);
  }
  const menunggu = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode, filter: { kategori: "PEMBAYARAN", status: "MENUNGGU" } })).wb, "Pemasukan");
  assert.equal(menunggu.baris.length, 1);
  assert.equal(menunggu.baris[0]["Status"], "Menunggu verifikasi");
  assert.equal(menunggu.baris[0]["Nilai (Rp)"], 100_000);
  const lain = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode, filter: { kategori: "LAIN" } })).wb, "Pemasukan");
  assert.equal(lain.baris[0]["Nilai (Rp)"], 250_000.75, "desimal ikut sebagai angka");
  assert.equal(lain.baris[0]["Keterangan"], "'=cmd|' /C calc'!A0", "keterangan berawalan = dinetralkan");
  assert.match(lain.kepala[0], /Pemasukan — Pemasukan Lain/);

  // filter tanpa hasil tetap berkas valid
  const kosong = await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode, filter: { q: "tidak-ada-yang-cocok" } });
  assert.equal(kosong.status, 200);
  assert.equal(bacaSheet(kosong.wb, "Pemasukan").baris.length, 0);

  // kategori tak dikenal ditolak dengan pesan Indonesia
  const rusak = await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode, filter: { kategori: "NGAWUR" } });
  assert.equal(rusak.status, 400);
  assert.match(rusak.json.error, /Kategori tidak dikenal/);
  assert.ok(pTerverif);
});

test("Tanggal WIB: pembayaran 01:30 WIB (= 18:30 UTC hari sebelumnya) masuk periode tanggal WIB-nya, bukan tanggal UTC", async () => {
  const { c } = await dataLengkap();
  const filter = { kategori: "PEMBAYARAN" };
  const tgl10 = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode: { from: "2026-09-10", to: "2026-09-10" }, filter })).wb, "Pemasukan");
  assert.equal(tgl10.baris.length, 1);
  assert.equal(tgl10.baris[0]["Nilai (Rp)"], 500_000);
  assert.equal(tgl10.baris[0]["Tanggal"].toISOString().slice(0, 10), "2026-09-10", "tanggal WIB, bukan 09 Sep (UTC)");
  const tgl9 = bacaSheet((await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode: { from: "2026-09-01", to: "2026-09-09" }, filter })).wb, "Pemasukan");
  assert.equal(tgl9.baris.length, 0, "tidak ikut periode tanggal 9 walau UTC-nya tanggal 9");
  const layar = (await c.a.get("/api/finance/pemasukan?from=2026-09-10&to=2026-09-10&kategori=PEMBAYARAN")).body;
  assert.equal(layar.items.length, 1, "layar sepakat");
});

test("Izin: tanpa login 401, SALES 403; FINANCE boleh (tidak ada kolom sensitif: isi = layar); periode rusak 400; ADMIN & FINANCE mendapat berkas sama", async () => {
  const { c } = await dataLengkap();
  assert.equal((await unduhExport(server.baseUrl, null, "pemasukan", { periode })).status, 401);
  assert.equal((await unduhExport(server.baseUrl, c.sales.token, "pemasukan", { periode })).status, 403);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode: { from: "2026-09-31" } })).status, 400);
  assert.equal((await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode: { from: "2026-09-30", to: "2026-09-01" } })).status, 400);
  const fin = await unduhExport(server.baseUrl, c.finance.token, "pemasukan", { periode });
  assert.equal(fin.status, 200);
  const adm = await unduhExport(server.baseUrl, c.admin.token, "pemasukan", { periode });
  assert.deepEqual(bacaSheet(fin.wb, "Pemasukan").header, bacaSheet(adm.wb, "Pemasukan").header);
  assert.deepEqual(bacaSheet(fin.wb, "Pemasukan").baris, bacaSheet(adm.wb, "Pemasukan").baris);
});
