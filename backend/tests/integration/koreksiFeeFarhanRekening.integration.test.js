// Uji skrip koreksi dimensi rekening Fee Farhan (scripts/koreksiFeeFarhanRekening.js) pada DB terisolasi dengan rantai yang meniru produksi:
// EXP-25092026-328 → JV-25092026-624 (REVERSED) → pembalik JV-28092026-730 → JV-25092026-731 (MANUAL, kedua baris TANPA rekening).
import "./setup/env.js";
import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { testPrisma, truncateAll } from "./setup/testDb.js";
import { ensureDefaultChartOfAccounts } from "../../src/services/finance/accounts.js";
import { toMoney } from "../../src/services/finance/money.js";

const akar = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
test.afterEach(async () => { await truncateAll(); });
test.after(async () => { await truncateAll(); await testPrisma.$disconnect(); });

const N = 6715170;
async function dunia({ rekeningDiBaris = false, statusExp = "DIBAYAR", rekeningExp = "PT Sano" } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const A = async (code) => testPrisma.finAccount.findFirst({ where: { code } });
  const [bank, ekuitas, beban] = [await A("1-1200"), await A("3-4200"), await A("6-1900")];
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: bank.id } });
  const owner = await testPrisma.user.create({ data: { name: "OWNER (Admin)", email: `owner-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const kat = await testPrisma.finExpenseCategory.create({ data: { code: "LAIN", name: "Lain-lain", accountId: beban.id } });
  await testPrisma.finExpense.create({ data: { expenseNumber: "EXP-25092026-328", date: new Date("2026-09-25"), amount: N, description: "Fee Farhan Agustus", categoryId: kat.id, status: statusExp, mode: "LANGSUNG", paymentMethod: "TRANSFER", cashAccountId: rekeningExp === "PT Sano" ? pt.id : kem.id, createdById: owner.id } });
  const e = (data) => testPrisma.finJournalEntry.create({ data: { status: "POSTED", postedAt: new Date(), createdById: owner.id, postedById: owner.id, ...data } });
  // saldo awal supaya angka bukan nol: 100 jt di PT Sano, 20 jt di KEM
  await e({ entryNumber: "JV-18092026-001", date: new Date("2026-09-18"), description: "saldo awal", source: "SALDO_AWAL", lines: { create: [{ lineNo: 1, accountId: bank.id, cashAccountId: pt.id, debit: 100_000_000, credit: 0 }, { lineNo: 2, accountId: bank.id, cashAccountId: kem.id, debit: 20_000_000, credit: 0 }, { lineNo: 3, accountId: ekuitas.id, debit: 0, credit: 120_000_000 }] } });
  const asal = await e({ entryNumber: "JV-25092026-624", date: new Date("2026-09-25"), description: "Fee Farhan Agustus", source: "PENGELUARAN", status: "REVERSED", lines: { create: [{ lineNo: 1, accountId: beban.id, debit: N, credit: 0 }, { lineNo: 2, accountId: bank.id, cashAccountId: pt.id, debit: 0, credit: N }] } });
  await e({ entryNumber: "JV-28092026-730", date: new Date("2026-09-28"), description: "Pembatalan JV-25092026-624 — perubahan kategori", source: "REVERSAL", reversalOfId: asal.id, lines: { create: [{ lineNo: 1, accountId: beban.id, debit: 0, credit: N }, { lineNo: 2, accountId: bank.id, cashAccountId: pt.id, debit: N, credit: 0 }] } });
  await e({ entryNumber: "JV-25092026-731", date: new Date("2026-09-25"), description: "Fee Farhan Agustus", source: "MANUAL", lines: { create: [{ lineNo: 1, accountId: ekuitas.id, debit: N, credit: 0 }, { lineNo: 2, accountId: bank.id, cashAccountId: rekeningDiBaris ? pt.id : null, debit: 0, credit: N }] } });
  return { pt, kem, owner };
}
const jalankan = (apply, env = {}) => {
  try { return { kode: 0, out: execFileSync(process.execPath, ["scripts/koreksiFeeFarhanRekening.js", ...(apply ? ["--apply"] : [])], { cwd: akar, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { kode: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
async function foto() {
  const s = async (id) => { const a = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)).toFixed(2); };
  const ak = async (code) => { const x = await testPrisma.finAccount.findFirst({ where: { code } }); const a = await testPrisma.finJournalLine.aggregate({ where: { accountId: x.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)).toFixed(2); };
  const pt = await testPrisma.finCashAccount.findFirst({ where: { name: "PT Sano" } }), kem = await testPrisma.finCashAccount.findFirst({ where: { name: "KEM - Sano Bank" } });
  return { pt: await s(pt.id), kem: await s(kem.id), bank: await ak("1-1200"), ekuitas: await ak("3-4200"), n: await testPrisma.finJournalEntry.count(), exp: await testPrisma.finExpense.findFirst({ where: { expenseNumber: "EXP-25092026-328" } }) };
}

test("PRATINJAU tidak menulis apa pun; APPLY tanpa KOREKSI_BACKUP_OK ditolak", async () => {
  await dunia();
  const sebelum = await foto();
  const p = jalankan(false);
  assert.equal(p.kode, 0, p.out);
  assert.match(p.out, /PRATINJAU/);
  assert.match(p.out, /PT Sano\s+Rp100\.000\.000,00 → Rp93\.284\.830,00/, p.out);
  assert.deepEqual(await foto(), sebelum, "pratinjau tidak mengubah data");
  const tolak = jalankan(true, { KOREKSI_BACKUP_OK: "" });
  assert.notEqual(tolak.kode, 0);
  assert.match(tolak.out, /KOREKSI_BACKUP_OK/);
  assert.deepEqual(await foto(), sebelum, "apply ditolak tanpa backup: tidak ada perubahan");
});

test("APPLY: saldo PT Sano turun TEPAT Rp6.715.170; akun Bank & ekuitas, KEM, dokumen EXP tidak berubah; +2 jurnal; seimbang; JV-731 REVERSED; pengganti ber-rekening; audit & referensi silang", async () => {
  const w = await dunia();
  const sebelum = await foto();
  assert.equal(sebelum.pt, "100000000.00");
  const r = jalankan(true, { KOREKSI_BACKUP_OK: "1" });
  assert.equal(r.kode, 0, r.out);
  const sesudah = await foto();
  assert.equal(sesudah.pt, "93284830.00", "PT Sano −6.715.170");
  assert.equal(sesudah.kem, sebelum.kem, "KEM tidak berubah");
  assert.equal(sesudah.bank, sebelum.bank, "akun 1-1200 tidak berubah");
  assert.equal(sesudah.ekuitas, sebelum.ekuitas, "akun 3-4200 tidak berubah");
  assert.equal(sesudah.n, sebelum.n + 2);
  assert.equal(JSON.stringify(sesudah.exp), JSON.stringify(sebelum.exp), "dokumen EXP tidak berubah");

  const e731 = await testPrisma.finJournalEntry.findUnique({ where: { entryNumber: "JV-25092026-731" }, include: { lines: true } });
  assert.equal(e731.status, "REVERSED");
  assert.equal(e731.lines.length, 2, "baris lama utuh (tidak di-overwrite)");
  assert.ok(e731.lines.every((l) => l.cashAccountId === null), "baris lama tetap tanpa rekening");
  const pembalik = await testPrisma.finJournalEntry.findFirst({ where: { reversalOfId: e731.id }, include: { lines: true } });
  assert.ok(pembalik && pembalik.source === "REVERSAL" && pembalik.status === "POSTED");
  assert.equal(pembalik.date.toISOString().slice(0, 10), "2026-09-25");
  const pengganti = await testPrisma.finJournalEntry.findUnique({ where: { idempotencyKey: `KOREKSI_REKENING_FEE_FARHAN:${e731.id}` }, include: { lines: { include: { account: true } } } });
  assert.ok(pengganti && pengganti.status === "POSTED");
  const bankLine = pengganti.lines.find((l) => l.account.code === "1-1200");
  assert.equal(bankLine.cashAccountId, w.pt.id, "kredit Bank tertaut PT Sano");
  assert.equal(Number(bankLine.credit), N);
  assert.equal(Number(pengganti.lines.find((l) => l.account.code === "3-4200").debit), N);
  assert.match(pengganti.description, /JV-25092026-731/);
  assert.ok(pengganti.description.includes(pembalik.entryNumber), "pengganti menyebut nomor pembalik");
  assert.match(pembalik.description, /EXP-25092026-328/);
  assert.equal(pengganti.createdById, w.owner.id);

  const ev = await testPrisma.activityEvent.findMany({ where: { entityType: "fin_journal", entityId: { in: [e731.id, pengganti.id] } } });
  assert.equal(ev.length, 2);
  const meta = ev.find((x) => x.entityId === e731.id).metadata;
  assert.equal(meta.jurnalPengganti, pengganti.entryNumber);
  assert.equal(meta.jurnalPembalik, pembalik.entryNumber);
  assert.equal(meta.dokumenAsal, "EXP-25092026-328");
  assert.match(meta.dijalankanOleh, /Claude Code/);
});

test("REPLAY idempoten: dijalankan lagi → berhenti tanpa menambah jurnal (exit 0); pratinjau juga melapor sudah dikoreksi", async () => {
  await dunia();
  assert.equal(jalankan(true, { KOREKSI_BACKUP_OK: "1" }).kode, 0);
  const setelahPertama = await foto();
  for (const apply of [true, true, false]) {
    const r = jalankan(apply, { KOREKSI_BACKUP_OK: "1" });
    assert.equal(r.kode, 0, r.out);
    assert.match(r.out, /SUDAH DIKOREKSI/);
  }
  assert.deepEqual(await foto(), setelahPertama, "replay tidak menggandakan koreksi");
});

test("Pengaman: jurnal 731 yang SUDAH ber-rekening, dokumen dari rekening lain, atau dokumen tidak DIBAYAR → berhenti (exit 2) tanpa menulis apa pun", async () => {
  for (const opsi of [{ rekeningDiBaris: true }, { rekeningExp: "KEM" }, { statusExp: "DIBATALKAN" }]) {
    await dunia(opsi);
    const sebelum = await foto();
    const r = jalankan(true, { KOREKSI_BACKUP_OK: "1" });
    assert.equal(r.kode, 2, `${JSON.stringify(opsi)}: ${r.out}`);
    assert.match(r.out, /BERHENTI/);
    assert.deepEqual(await foto(), sebelum);
    await truncateAll();
  }
});
