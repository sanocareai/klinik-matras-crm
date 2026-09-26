// Bagi Hasil Investor: akun 3-4200 (Distribusi Laba, ekuitas, saldo normal Debit) dan 2-1800 (Utang Bagi Hasil Investor).
// Bukan beban: tidak masuk Laba Rugi / Pengeluaran; tampil sebagai pengurang ekuitas di Neraca yang tetap seimbang.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { neraca, neracaSaldo, labaRugi, arusKas } from "../../src/services/finance/reports.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

const TGL = (s) => new Date(`${s}T00:00:00Z`);
const baris = (arr, kode) => arr.find((r) => r.code === kode);

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = Object.fromEntries((await testPrisma.finAccount.findMany()).map((a) => [a.code, a]));
  const bankCoa = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const bank = await testPrisma.finCashAccount.create({ data: { name: "Bank Uji", kind: "BANK", accountId: bankCoa.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  return { akun, bank, admin: admin.user, client: makeClient(server.baseUrl, admin.token) };
}

async function jurnal(c, tanggal, baris) {
  const lines = baris.map(([kode, d = 0, k = 0]) => (kode === "BANK"
    ? { accountId: c.bank.accountId, cashAccountId: c.bank.id, debit: d, credit: k }
    : { accountId: c.akun[kode].id, debit: d, credit: k }));
  return testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: `uji ${tanggal}`, source: "MANUAL", userId: c.admin.id, lines }));
}

test("COA: 3-4200 (Ekuitas, Debit) dan 2-1800 (Kewajiban Lancar, Kredit) ada dengan atribut benar, tepat satu, induk terpasang, idempoten", async () => {
  const c = await siapkan();
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx)); // panggilan kedua: tidak menggandakan
  const a = await testPrisma.finAccount.findMany({ where: { code: { in: ["3-4200", "2-1800"] } }, include: { parent: true } });
  assert.equal(a.length, 2);
  const bh = a.find((x) => x.code === "3-4200"); const utang = a.find((x) => x.code === "2-1800");
  assert.equal(bh.name, "Distribusi Laba / Bagi Hasil Investor");
  assert.equal(bh.type, "EKUITAS"); assert.equal(bh.normalBalance, "DEBIT");
  assert.equal(bh.isPostable, true); assert.equal(bh.active, true); assert.equal(bh.parent.code, "3-0000");
  assert.match(bh.description, /pembagian laba\/profit sharing kepada investor/);
  assert.equal(utang.name, "Utang Bagi Hasil Investor");
  assert.equal(utang.type, "KEWAJIBAN"); assert.equal(utang.normalBalance, "KREDIT");
  assert.equal(utang.isPostable, true); assert.equal(utang.parent.code, "2-1000");
  void c;
});

test("Migrasi idempoten: dijalankan ulang tidak menggandakan maupun menimpa akun yang sudah ada (mis. nama yang sudah disesuaikan)", async () => {
  await siapkan();
  await testPrisma.finAccount.update({ where: { code: "3-4200" }, data: { name: "Nama Disesuaikan Finance" } });
  const sql = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../prisma/migrations/20260927170000_coa_bagi_hasil_investor/migration.sql"), "utf8");
  for (const stmt of sql.split(/(?=INSERT INTO)/).filter((s) => s.trim().startsWith("INSERT"))) await testPrisma.$executeRawUnsafe(stmt);
  assert.equal(await testPrisma.finAccount.count({ where: { code: { in: ["3-4200", "2-1800"] } } }), 2);
  assert.equal((await testPrisma.finAccount.findUnique({ where: { code: "3-4200" } })).name, "Nama Disesuaikan Finance");
});

test("Bisa dipilih di Jurnal Umum: muncul di daftar akun (aktif + bisa diposting) dan jurnal manual diterima", async () => {
  const c = await siapkan();
  const r = await c.client.get("/api/finance/accounts");
  assert.equal(r.status, 200);
  for (const kode of ["3-4200", "2-1800"]) {
    const a = r.body.accounts.find((x) => x.code === kode);
    assert.ok(a && a.isPostable && a.active !== false, kode);
  }
  const j = await c.client.post("/api/finance/journal", {
    date: "2026-09-30", description: "Bagi hasil investor September",
    lines: [{ accountId: c.akun["3-4200"].id, debit: 500_000, credit: 0 }, { accountId: c.bank.accountId, cashAccountId: c.bank.id, debit: 0, credit: 500_000 }],
  });
  assert.ok([200, 201].includes(j.status), JSON.stringify(j.body));
});

test("Dibayar langsung (Dr 3-4200, Cr Bank): bukan beban — Laba Rugi tak berubah; Neraca seimbang dengan 3-4200 sebagai PENGURANG ekuitas; arus kas = pendanaan", async () => {
  const c = await siapkan();
  await jurnal(c, "2026-09-01", [["BANK", 10_000_000, 0], ["3-1100", 0, 10_000_000]]); // modal
  await jurnal(c, "2026-09-05", [["BANK", 2_000_000, 0], ["4-1100", 0, 2_000_000]]); // pendapatan
  const lrSebelum = await labaRugi(testPrisma, { from: TGL("2026-09-01"), to: TGL("2026-09-30") });
  await jurnal(c, "2026-09-30", [["3-4200", 500_000, 0], ["BANK", 0, 500_000]]);

  const lr = await labaRugi(testPrisma, { from: TGL("2026-09-01"), to: TGL("2026-09-30") });
  assert.deepEqual(lr.ringkasan, lrSebelum.ringkasan, "Laba Rugi identik: bagi hasil bukan beban");
  assert.ok(!lr.bebanOperasional.some((r) => r.code === "3-4200") && !lr.bebanPokok.some((r) => r.code === "3-4200"));
  assert.equal(lr.ringkasan.bebanOperasional, 0);

  const n = await neraca(testPrisma, { to: TGL("2026-09-30") });
  assert.equal(n.ringkasan.seimbang, true, `selisih ${n.ringkasan.selisih}`);
  assert.equal(baris(n.ekuitas, "3-4200").nilai, -500_000, "tampil sebagai pengurang ekuitas");
  assert.equal(n.ringkasan.totalEkuitas, 10_000_000 + 2_000_000 - 500_000);
  assert.equal(n.ringkasan.totalAset, 11_500_000);

  const ns = await neracaSaldo(testPrisma, { from: TGL("2026-09-01"), to: TGL("2026-09-30") });
  assert.equal(ns.ringkasan?.seimbang ?? true, true);

  const ak = await arusKas(testPrisma, { from: TGL("2026-09-30"), to: TGL("2026-09-30") });
  const keluar = ak.pendanaan.reduce((s, r) => s + (r.keluar ?? 0), 0) || ak.ringkasan.keluar;
  assert.equal(Math.round(keluar), 500_000, "kas keluar 500.000 diklasifikasikan pendanaan, bukan operasi");
  assert.equal(ak.operasi.length === 0 || ak.operasi.every((r) => !/3-4200/.test(JSON.stringify(r))), true);
});

test("Diakui dulu lalu dibayar (Dr 3-4200 Cr 2-1800; lalu Dr 2-1800 Cr Bank): Neraca seimbang di setiap tahap, 2-1800 kembali nol", async () => {
  const c = await siapkan();
  await jurnal(c, "2026-09-01", [["BANK", 10_000_000, 0], ["3-1100", 0, 10_000_000]]);
  await jurnal(c, "2026-09-30", [["3-4200", 750_000, 0], ["2-1800", 0, 750_000]]);
  let n = await neraca(testPrisma, { to: TGL("2026-09-30") });
  assert.equal(n.ringkasan.seimbang, true, `selisih ${n.ringkasan.selisih}`);
  assert.equal(baris(n.kewajiban, "2-1800").nilai, 750_000);
  assert.equal(baris(n.ekuitas, "3-4200").nilai, -750_000);
  await jurnal(c, "2026-10-05", [["2-1800", 750_000, 0], ["BANK", 0, 750_000]]);
  n = await neraca(testPrisma, { to: TGL("2026-10-31") });
  assert.equal(n.ringkasan.seimbang, true);
  assert.equal(baris(n.kewajiban, "2-1800"), undefined, "utang lunas: saldo nol tidak tampil");
  assert.equal(baris(n.ekuitas, "3-4200").nilai, -750_000);
  assert.equal(n.ringkasan.totalAset, 9_250_000);
});

test("GUARD: 3-4200 tidak bisa dijadikan/dialihkan sebagai kategori biaya (POST dan PATCH), dan tidak ada FinExpense tercipta; kategori beban tetap bisa", async () => {
  const c = await siapkan();
  const post = await c.client.post("/api/finance/expense-categories", { code: "BAGI_HASIL_X", name: "Bagi hasil", accountId: c.akun["3-4200"].id });
  assert.equal(post.status, 400, JSON.stringify(post.body));
  assert.match(post.body.error, /Beban/);
  const kat = await testPrisma.finExpenseCategory.findFirst({ where: { account: { code: "6-1900" } } });
  assert.ok(kat, "ada kategori bawaan di 6-1900");
  for (const kode of ["3-4200", "2-1800"]) {
    const patch = await c.client.patch(`/api/finance/expense-categories/${kat.id}`, { accountId: c.akun[kode].id });
    assert.equal(patch.status, 400, `${kode}: ${JSON.stringify(patch.body)}`);
  }
  assert.equal((await testPrisma.finExpenseCategory.findUnique({ where: { id: kat.id } })).accountId, kat.accountId, "kategori tidak berubah");
  const ok = await c.client.patch(`/api/finance/expense-categories/${kat.id}`, { accountId: c.akun["6-1600"].id });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(await testPrisma.finExpenseCategory.count({ where: { account: { code: { in: ["3-4200", "2-1800"] } } } }), 0);
  await jurnal(c, "2026-09-30", [["3-4200", 100_000, 0], ["BANK", 0, 100_000]]);
  assert.equal(await testPrisma.finExpense.count(), 0, "jurnal bagi hasil tidak membuat/mengubah pengeluaran");
  const daftar = await c.client.get("/api/finance/expenses");
  assert.equal(daftar.status, 200);
  assert.equal((daftar.body.expenses || daftar.body.items || []).length, 0);
});
