// GET /api/finance/saldo-riil (read-only): saldo buku dihitung pada TANGGAL BUKU YANG SAMA dengan saldo riil terkonfirmasi (jurnal sesudah cutoff tidak ikut),
// selisih = buku − riil, Kas belum dikonfirmasi → tidak dibandingkan, izin & tidak ada efek ke jurnal/saldo. Plus fungsi murni bandingkanSaldoRiil.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createLoginUser, makeRaw, DEVICE } from "./setup/authFixtures.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { resetRateLimits } from "../../src/lib/rateLimit.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { toMoney } from "../../src/services/finance/money.js";
import { bandingkanSaldoRiil, SALDO_RIIL_TERKONFIRMASI } from "../../src/services/finance/saldoRiil.js";

let server; let raw;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); raw = makeRaw(server.baseUrl); });
test.beforeEach(() => resetRateLimits());
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

test("bandingkanSaldoRiil (murni): sesuai, selisih (buku lebih tinggi = positif), belum dikonfirmasi, rekening tanpa saldo riil; nama tak peka kapital/spasi", () => {
  const konfig = { saldo: { "PT Sano": "1000", "KEM - Sano Bank": "500.50", Kas: null } };
  const r = bandingkanSaldoRiil([{ id: "1", name: " pt sano ", kind: "BANK", saldo: 1000 }, { id: "2", name: "KEM - Sano Bank", kind: "BANK", saldo: 1200.75 }, { id: "3", name: "Kas", kind: "KAS", saldo: 90 }, { id: "4", name: "Lain", kind: "BANK", saldo: 5 }], konfig);
  assert.deepEqual(r.map((x) => x.status), ["SESUAI", "SELISIH", "BELUM_DIKONFIRMASI", "TIDAK_ADA_SALDO_RIIL"]);
  assert.equal(r[0].selisih, 0);
  assert.equal(r[1].selisih, 700.25);
  assert.equal(r[2].saldoRiil, null); assert.equal(r[2].selisih, null);
  assert.equal(r[3].saldoRiil, null);
});

test("Konstanta produksi: PT Sano 39.180.615, KEM 4.912.088, Kas belum dikonfirmasi; label cutoff & sumber tersedia", () => {
  assert.equal(SALDO_RIIL_TERKONFIRMASI.saldo["PT Sano"], "39180615");
  assert.equal(SALDO_RIIL_TERKONFIRMASI.saldo["KEM - Sano Bank"], "4912088");
  assert.equal(SALDO_RIIL_TERKONFIRMASI.saldo["Uang Kas Sano"], null);
  assert.match(SALDO_RIIL_TERKONFIRMASI.cutoffLabel, /21 Sep 2026 pukul 20\.00 WIB/);
  assert.match(SALDO_RIIL_TERKONFIRMASI.catatan, /Rekonsiliasi sementara tanpa rekening koran/);
});

test("Route: saldo buku pada tanggal cutoff (bukan 'sekarang'), selisih KEM/PT/Kas, jurnal sesudah cutoff tidak ikut, tanpa efek ke jurnal; izin & 401", async () => {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akun = (systemKey) => testPrisma.finAccount.findUnique({ where: { systemKey } });
  const bank = await akun(SYSTEM_KEYS.BANK); const kasAkun = await akun(SYSTEM_KEYS.KAS);
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: bank.id } });
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bank.id } });
  const kas = await testPrisma.finCashAccount.create({ data: { name: "Uang Kas Sano", kind: "KAS", accountId: kasAkun.id } });
  const modal = await testPrisma.finAccount.findFirst({ where: { code: "3-1100" } });
  const admin = (await createTestUser({ roles: ["ADMIN"] })).user;
  const post = async (tanggal, rek, nilai) => testPrisma.$transaction((tx) => postJournal(tx, { date: tanggal, description: `uji ${tanggal}`, source: "MANUAL", userId: admin.id, lines: [{ accountId: rek.accountId, cashAccountId: rek.id, debit: toMoney(nilai) }, { accountId: modal.id, credit: toMoney(nilai) }] }));
  await post("2026-09-21", kem, "7439069"); await post("2026-09-21", pt, "39180615"); await post("2026-09-21", kas, "92500");
  await post("2026-09-22", kem, "1000000"); // sesudah cutoff → TIDAK ikut

  const j0 = await testPrisma.finJournalEntry.count();
  const fin = await createLoginUser({ roles: ["FINANCE"] });
  const login = await raw("POST", "/api/mobile/auth/login", { body: { email: fin.email, password: fin.password, device: DEVICE() } });
  const r = await raw("GET", "/api/finance/saldo-riil", { token: login.body.accessToken });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  const per = Object.fromEntries(r.body.rekening.map((x) => [x.name, x]));
  assert.equal(per["KEM - Sano Bank"].saldoBuku, 7439069, "saldo buku pada 21 Sep (jurnal 22 Sep tidak ikut)");
  assert.equal(per["KEM - Sano Bank"].saldoRiil, 4912088);
  assert.equal(per["KEM - Sano Bank"].selisih, 2526981);
  assert.equal(per["KEM - Sano Bank"].status, "SELISIH");
  assert.equal(per["PT Sano"].selisih, 0); assert.equal(per["PT Sano"].status, "SESUAI");
  assert.equal(per["Uang Kas Sano"].status, "BELUM_DIKONFIRMASI"); assert.equal(per["Uang Kas Sano"].selisih, null);
  assert.equal(r.body.tanggalBuku, "2026-09-21"); assert.match(r.body.sumber, /belum berdasarkan rekening koran/);
  assert.equal(await testPrisma.finJournalEntry.count(), j0, "tidak ada jurnal baru");

  assert.equal((await fetch(`${server.baseUrl}/api/finance/saldo-riil`)).status, 401);
  const sales = await createLoginUser({ roles: ["SALES"] });
  const ls = await raw("POST", "/api/mobile/auth/login", { body: { email: sales.email, password: sales.password, device: DEVICE() } });
  if (ls.status === 200) assert.equal((await raw("GET", "/api/finance/saldo-riil", { token: ls.body.accessToken })).status, 403);
});
