// REKENING PADA BARIS JURNAL (2 Okt 2026). Kasus nyata: saldo PT Sano di SANSS lebih tinggi dari bank karena (1) baris beban biaya admin ikut ditandai rekening (dihitung uang masuk) dan
// (2) jurnal manual Bank tanpa rekening (JV-25092026-731, Rp6.715.170) tidak mengubah saldo rekening mana pun. Yang dikunci: tanda hanya boleh pada akun rekening itu sendiri, jurnal MANUAL
// wajib memilih rekening untuk akun kas/bank, biaya admin transfer mengurangi saldo rekening sebesar nominal + biaya, dan skrip perapian data lama.
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { createTestUser } from "./setup/fixtures.js";
import { buildTestApp, startTestServer } from "./setup/testApp.js";
import { makeClient } from "./setup/httpClient.js";
import { ensureDefaultChartOfAccounts, SYSTEM_KEYS } from "../../src/services/finance/accounts.js";
import { postJournal } from "../../src/services/finance/journal.js";
import { postCashTransfer } from "../../src/services/finance/posting/cash.js";
import { saldoKasBank } from "../../src/services/finance/reports.js";

let server;
test.before(async () => { await truncateAll(); server = await startTestServer(buildTestApp()); });
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await server.close(); await testPrisma.$disconnect(); });

async function dunia() {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const akunBank = await testPrisma.finAccount.findUnique({ where: { systemKey: SYSTEM_KEYS.BANK } });
  const modal = await testPrisma.finAccount.findUnique({ where: { code: "3-1100" } });
  const bebanAdmin = await testPrisma.finAccount.findUnique({ where: { code: "6-1700" } });
  const dist = await testPrisma.finAccount.findUnique({ where: { code: "3-4200" } });
  const ptSano = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: akunBank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM", kind: "BANK", accountId: akunBank.id } });
  const admin = await createTestUser({ roles: ["ADMIN"] });
  return { akunBank, modal, bebanAdmin, dist, ptSano, kem, admin: makeClient(server.baseUrl, admin.token), adminUser: admin.user };
}
const saldo = async (nama) => (await saldoKasBank(testPrisma)).find((s) => s.name === nama).saldo;
const jurnal = (w, lines) => testPrisma.$transaction((tx) => postJournal(tx, { date: "2026-10-01", description: "uji", source: "PENGELUARAN", lines, userId: w.adminUser.id }));

test("Baris yang ditandai rekening harus berakun SAMA dengan akun rekening itu; menandai baris beban ditolak", async () => {
  const w = await dunia();
  await assert.rejects(() => jurnal(w, [
    { accountId: w.bebanAdmin.id, debit: 2500, cashAccountId: w.ptSano.id },
    { accountId: w.akunBank.id, credit: 2500, cashAccountId: w.ptSano.id },
  ]), /hanya boleh dipakai pada akun kas\/bank-nya sendiri/);
  assert.equal(await testPrisma.finJournalEntry.count(), 0, "tidak ada yang tersimpan");
  await jurnal(w, [{ accountId: w.bebanAdmin.id, debit: 2500 }, { accountId: w.akunBank.id, credit: 2500, cashAccountId: w.ptSano.id }]);
  assert.equal(await saldo("PT Sano"), -2500);
  await assert.rejects(() => jurnal(w, [{ accountId: w.bebanAdmin.id, debit: 100 }, { accountId: w.akunBank.id, credit: 100, cashAccountId: "00000000-0000-4000-8000-000000000000" }]), /rekening tidak ditemukan/);
});

test("Transfer antar rekening berbiaya: saldo asal turun nominal + biaya (bukan nominal saja), saldo tujuan naik nominal, biaya jadi beban", async () => {
  const w = await dunia();
  const tf = await testPrisma.finCashTransfer.create({ data: { transferNumber: "TRF-UJI", date: new Date("2026-10-01T00:00:00Z"), amount: 1_000_000, fromAccountId: w.ptSano.id, toAccountId: w.kem.id, feeAmount: 2_500, createdById: w.adminUser.id } });
  await testPrisma.$transaction((tx) => postCashTransfer(tx, { transferId: tf.id, userId: w.adminUser.id }));
  assert.equal(await saldo("PT Sano"), -1_002_500, "bank memotong nominal + biaya admin");
  assert.equal(await saldo("KEM"), 1_000_000);
  const beban = await testPrisma.finJournalLine.findMany({ where: { accountId: w.bebanAdmin.id } });
  assert.equal(beban.length, 1);
  assert.equal(beban[0].cashAccountId, null, "baris beban tidak ditandai rekening");
});

test("Jurnal MANUAL (API): baris akun kas/bank WAJIB memilih rekening; tanpa rekening ditolak 400 dan tidak tersimpan; dengan rekening saldo berubah; akun lain tidak butuh rekening", async () => {
  const w = await dunia();
  const tanpa = await w.admin.post("/api/finance/journal", { date: "2026-10-01", description: "Fee Farhan Agustus", lines: [{ accountId: w.dist.id, debit: 6_715_170 }, { accountId: w.akunBank.id, credit: 6_715_170 }] });
  assert.equal(tanpa.status, 400, JSON.stringify(tanpa.body));
  assert.match(tanpa.body.error, /wajib memilih rekeningnya/);
  assert.equal(await testPrisma.finJournalEntry.count(), 0);

  const dengan = await w.admin.post("/api/finance/journal", { date: "2026-10-01", description: "Fee Farhan Agustus", lines: [{ accountId: w.dist.id, debit: 6_715_170 }, { accountId: w.akunBank.id, credit: 6_715_170, cashAccountId: w.ptSano.id }] });
  assert.equal(dengan.status, 201, JSON.stringify(dengan.body));
  assert.equal(await saldo("PT Sano"), -6_715_170, "saldo rekening ikut turun");

  const biasa = await w.admin.post("/api/finance/journal", { date: "2026-10-01", description: "Koreksi non-kas", lines: [{ accountId: w.dist.id, debit: 1000 }, { accountId: w.modal.id, credit: 1000 }] });
  assert.equal(biasa.status, 201, "akun non-kas tidak butuh rekening");
  const salah = await w.admin.post("/api/finance/journal", { date: "2026-10-01", description: "Rekening di akun salah", lines: [{ accountId: w.dist.id, debit: 500, cashAccountId: w.ptSano.id }, { accountId: w.akunBank.id, credit: 500, cashAccountId: w.ptSano.id }] });
  assert.equal(salah.status, 400);
});

test("Skrip rapikan-tanda-rekening-biaya-admin: dry-run tidak menulis; --apply mengosongkan tanda baris beban (nominal tetap, jurnal tetap seimbang), saldo rekening turun sebesar bebannya, diaudit; ulang = tidak ada perubahan", async () => {
  const { execFileSync } = await import("node:child_process");
  const w = await dunia();
  await testPrisma.user.update({ where: { id: w.adminUser.id }, data: { email: "admin-uji@example.test" } });
  // meniru data produksi lama: baris beban ditandai rekening (dibuat langsung, melewati aturan baru)
  const entry = await testPrisma.finJournalEntry.create({ data: { entryNumber: "JV-LAMA-1", date: new Date("2026-09-29T00:00:00Z"), description: "transfer berbiaya lama", source: "TRANSFER_KAS", status: "POSTED", lines: { create: [
    { lineNo: 1, accountId: w.akunBank.id, debit: 1_000_000, credit: 0, cashAccountId: w.kem.id },
    { lineNo: 2, accountId: w.akunBank.id, debit: 0, credit: 1_002_500, cashAccountId: w.ptSano.id },
    { lineNo: 3, accountId: w.bebanAdmin.id, debit: 2_500, credit: 0, cashAccountId: w.ptSano.id },
  ] } } });
  assert.equal(await saldo("PT Sano"), -1_000_000, "kondisi lama: saldo salah Rp2.500 terlalu tinggi");
  const jalankan = (...arg) => execFileSync(process.execPath, ["scripts/rapikan-tanda-rekening-biaya-admin.js", "--actor", "admin-uji@example.test", ...arg], { cwd: new URL("../..", import.meta.url), env: process.env, encoding: "utf8" });

  assert.match(jalankan(), /DRY-RUN: 1 baris/);
  assert.equal(await saldo("PT Sano"), -1_000_000, "dry-run tidak menulis");
  assert.match(jalankan("--apply"), /SELESAI/);
  assert.equal(await saldo("PT Sano"), -1_002_500, "saldo kini = bank sebenarnya");
  const lines = await testPrisma.finJournalLine.findMany({ where: { entryId: entry.id } });
  assert.equal(lines.reduce((a, l) => a + Number(l.debit) - Number(l.credit), 0), 0, "jurnal tetap seimbang");
  assert.equal(Number(lines.find((l) => l.accountId === w.bebanAdmin.id).debit), 2_500, "nominal tidak berubah");
  const log = await testPrisma.activityEvent.findMany({ where: { entityId: "koreksi-tanda-rekening-biaya-admin" } });
  assert.equal(log.length, 1);
  assert.match(jalankan("--apply"), /Tidak ada yang perlu dirapikan/);
  assert.equal(await testPrisma.activityEvent.count({ where: { entityId: "koreksi-tanda-rekening-biaya-admin" } }), 1, "idempoten");
});
