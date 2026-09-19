// Test integrasi modul KASBON (uang muka gaji) terhadap PostgreSQL sungguhan.
// Yang dikunci: arah jurnal (piutang karyawan, BUKAN beban), pelunasan
// potong-gaji vs tunai, alokasi FIFO per karyawan, batas kasbon, dan
// pembatalan lewat reversal.

import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";

import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { setSetting, SETTING_KEYS } from "../../src/services/finance/settings.js";
import { toMoney } from "../../src/services/finance/money.js";
import { STATUS_DIHITUNG } from "../../src/services/finance/journal.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function siapkan() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunKas = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.KAS } });
  const rekening = await testPrisma.finCashAccount.create({ data: { name: "Kas Kantor", kind: "KAS", accountId: akunKas.id } });
  return { rekening };
}

async function saldo(code) {
  const akun = await testPrisma.finAccount.findUnique({ where: { code } });
  const baris = await testPrisma.finJournalLine.findMany({
    where: { accountId: akun.id, entry: { status: { in: STATUS_DIHITUNG } } }, select: { debit: true, credit: true },
  });
  return baris.reduce((a, b) => a.plus(toMoney(b.debit)).minus(toMoney(b.credit)), toMoney(0)).toFixed(2);
}

const baru = (rekening, extra = {}) => ({
  date: "2026-09-19", amount: 500_000, employeeName: "imam", urgency: "anak sakit, perlu biaya berobat",
  cashAccountId: rekening.id, ...extra,
});

test("Kasbon diberikan: Dr Piutang Karyawan (aset) / Cr Kas, bukan beban; urgensi wajib; nama dirapikan", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);

  const tanpaUrgensi = await c.post("/api/finance/kasbon", baru(rekening, { urgency: "" }));
  assert.equal(tanpaUrgensi.status, 400);

  const r = await c.post("/api/finance/kasbon", baru(rekening, { employeeName: "  UJANG sigit " }));
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.match(r.body.kasbonNumber, /^KSB-/);
  assert.equal(r.body.employeeName, "Ujang Sigit");
  assert.equal(r.body.sisa, 500_000);
  assert.equal(await saldo("1-1350"), "500000.00");
  assert.equal(await saldo("1-1100"), "-500000.00");
  assert.equal(await saldo("6-1100"), "0.00", "kasbon bukan beban gaji");
});

test("Potong gaji: Dr Beban Gaji / Cr Piutang, kas tidak tersentuh; lunas penuh jadi LUNAS; melebihi yang belum dipotong ditolak", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  const k = (await c.post("/api/finance/kasbon", baru(rekening))).body;

  const lebih = await c.post(`/api/finance/kasbon/${k.id}/pelunasan`, { method: "POTONG_GAJI", amount: 600_000 });
  assert.equal(lebih.status, 400);

  const sebagian = await c.post(`/api/finance/kasbon/${k.id}/pelunasan`, { method: "POTONG_GAJI", amount: 200_000, date: "2026-09-25" });
  assert.equal(sebagian.status, 201, JSON.stringify(sebagian.body));
  assert.equal(sebagian.body.kasbon.sisa, 300_000);
  assert.equal(sebagian.body.kasbon.status, "AKTIF");
  assert.equal(await saldo("1-1350"), "300000.00");
  assert.equal(await saldo("6-1100"), "200000.00");
  assert.equal(await saldo("1-1100"), "-500000.00", "potong gaji tidak menyentuh kas");

  const sisa = await c.post(`/api/finance/kasbon/${k.id}/pelunasan`, { method: "POTONG_GAJI", amount: 300_000 });
  assert.equal(sisa.body.kasbon.status, "LUNAS");
  assert.equal(await saldo("1-1350"), "0.00");
});

test("Kasbon tidak bisa dilunasi dengan cara lain: hanya potong gaji (kasbon bukan pinjaman)", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  const k = (await c.post("/api/finance/kasbon", baru(rekening))).body;

  const tunai = await c.post(`/api/finance/kasbon/${k.id}/pelunasan`, { method: "TUNAI", amount: 100_000, cashAccountId: rekening.id });
  assert.equal(tunai.status, 400);
  assert.equal(await saldo("1-1350"), "500000.00", "tidak ada yang berubah");
});

test("Potong per karyawan dialokasikan FIFO ke kasbon tertua; nama beda huruf besar tetap satu orang", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  const a = (await c.post("/api/finance/kasbon", baru(rekening, { date: "2026-09-01", amount: 300_000, employeeName: "rifki" }))).body;
  const b = (await c.post("/api/finance/kasbon", baru(rekening, { date: "2026-09-10", amount: 400_000, employeeName: "RIFKI" }))).body;

  const r = await c.post("/api/finance/kasbon/pelunasan-karyawan", { employeeName: "Rifki", amount: 500_000, method: "POTONG_GAJI" });
  assert.equal(r.status, 201, JSON.stringify(r.body));
  assert.equal(r.body.dialokasikan.length, 2);

  const daftar = (await c.get("/api/finance/kasbon")).body;
  const kA = daftar.kasbon.find((x) => x.id === a.id);
  const kB = daftar.kasbon.find((x) => x.id === b.id);
  assert.equal(kA.status, "LUNAS", "yang tertua lunas dulu");
  assert.equal(kB.sisa, 200_000);
  assert.equal(daftar.perKaryawan.length, 1);
  assert.equal(daftar.perKaryawan[0].sisa, 200_000);
  assert.equal(daftar.totalSisa, 200_000);

  const lebih = await c.post("/api/finance/kasbon/pelunasan-karyawan", { employeeName: "rifki", amount: 999_999, method: "POTONG_GAJI" });
  assert.equal(lebih.status, 400);
});

test("Batas kasbon aktif: ditolak 422 melewati batas; admin boleh lewat dengan izin eksplisit", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  await setSetting(testPrisma, SETTING_KEYS.KASBON_BATAS_AKTIF, "700000");

  assert.equal((await c.post("/api/finance/kasbon", baru(rekening, { amount: 500_000 }))).status, 201);
  const lewat = await c.post("/api/finance/kasbon", baru(rekening, { amount: 300_000 }));
  assert.equal(lewat.status, 422);
  assert.equal(lewat.body.kodeBatas, true);
  const izin = await c.post("/api/finance/kasbon", baru(rekening, { amount: 300_000, lewatBatas: true }));
  assert.equal(izin.status, 201, JSON.stringify(izin.body));
});

test("Batalkan pelunasan: kasbon aktif lagi dan jurnal dibalik; kasbon yang masih punya pelunasan tidak bisa dibatalkan", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  const k = (await c.post("/api/finance/kasbon", baru(rekening, { amount: 400_000 }))).body;
  const p = (await c.post(`/api/finance/kasbon/${k.id}/pelunasan`, { method: "POTONG_GAJI", amount: 400_000 })).body;
  assert.equal(p.kasbon.status, "LUNAS");

  const rid = p.kasbon.repayments[0].id;
  const tanpaAlasan = await c.post(`/api/finance/kasbon/${k.id}/pelunasan/${rid}/batal`, {});
  assert.equal(tanpaAlasan.status, 400);
  const batalP = await c.post(`/api/finance/kasbon/${k.id}/pelunasan/${rid}/batal`, { reason: "salah input" });
  assert.equal(batalP.status, 200, JSON.stringify(batalP.body));
  assert.equal(batalP.body.status, "AKTIF");
  assert.equal(batalP.body.sisa, 400_000);
  assert.equal(await saldo("6-1100"), "0.00", "jurnal potong gaji dibalik");
  assert.equal(await saldo("1-1350"), "400000.00");

  await c.post(`/api/finance/kasbon/${k.id}/pelunasan`, { method: "POTONG_GAJI", amount: 100_000 });
  const gagal = await c.post(`/api/finance/kasbon/${k.id}/batal`, { reason: "coba" });
  assert.equal(gagal.status, 409, "masih ada pelunasan aktif");
});

test("Batal kasbon tanpa pelunasan: jurnal dibalik, status DIBATALKAN, keluar dari ringkasan", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  const k = (await c.post("/api/finance/kasbon", baru(rekening))).body;
  const batal = await c.post(`/api/finance/kasbon/${k.id}/batal`, { reason: "salah orang" });
  assert.equal(batal.status, 200, JSON.stringify(batal.body));
  assert.equal(batal.body.status, "DIBATALKAN");
  assert.equal(await saldo("1-1350"), "0.00");
  assert.equal(await saldo("1-1100"), "0.00");
  assert.equal((await c.get("/api/finance/kasbon")).body.totalSisa, 0);
});

test("Edit kasbon: alasan wajib; nominal tidak bisa diubah lewat edit", async () => {
  const { rekening } = await siapkan();
  const { token } = await createTestUser({ roles: ["ADMIN"] });
  const c = makeClient(server.baseUrl, token);
  const k = (await c.post("/api/finance/kasbon", baru(rekening))).body;
  assert.equal((await c.patch(`/api/finance/kasbon/${k.id}`, { urgency: "baru" })).status, 400);
  const ok = await c.patch(`/api/finance/kasbon/${k.id}`, { urgency: "biaya sekolah anak", employeeName: "IMAM SAPUTRA", reason: "koreksi data" });
  assert.equal(ok.status, 200, JSON.stringify(ok.body));
  assert.equal(ok.body.employeeName, "Imam Saputra");
  const nominal = await c.patch(`/api/finance/kasbon/${k.id}`, { amount: 1, reason: "coba ubah nominal" });
  assert.equal(nominal.status, 400, "amount bukan field yang diterima, jadi tidak ada perubahan");
});
