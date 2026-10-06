// Uji skrip koreksi 4 butir rekonsiliasi PT Sano (scripts/koreksiBankPtSanoPoin3sd6.js) pada DB terisolasi.
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

async function dunia({ tanpaJurnal837 = false } = {}) {
  await testPrisma.$transaction((tx) => ensureDefaultChartOfAccounts(tx));
  const A = (code) => testPrisma.finAccount.findFirst({ where: { code } });
  const [bank, beban, piutang, utang, pend] = [await A("1-1200"), await A("6-1700"), await A("1-1300"), await A("2-1100"), await A("4-9100")];
  const pt = await testPrisma.finCashAccount.create({ data: { name: "PT Sano", kind: "BANK", accountId: bank.id } });
  const kem = await testPrisma.finCashAccount.create({ data: { name: "KEM - Sano Bank", kind: "BANK", accountId: bank.id } });
  await testPrisma.user.create({ data: { name: "OWNER (Admin)", email: `owner-${Date.now()}@example.test`, passwordHash: "x", role: "ADMIN" } });
  const e = (no, tgl, source, baris) => testPrisma.finJournalEntry.create({ data: { entryNumber: no, date: new Date(tgl), description: no, source, status: "POSTED", postedAt: new Date(), lines: { create: baris.map((b, i) => ({ lineNo: i + 1, debit: 0, credit: 0, ...b })) } } });
  await e("JV-18092026-001", "2026-09-18", "SALDO_AWAL", [{ accountId: bank.id, cashAccountId: pt.id, debit: 100_000_000 }, { accountId: bank.id, cashAccountId: kem.id, debit: 5_000_000 }, { accountId: pend.id, credit: 105_000_000 }]);
  await e("JV-23092026-573", "2026-09-23", "PEMBAYARAN_SUPPLIER", [{ accountId: utang.id, debit: 6_368_924 }, { accountId: beban.id, debit: 2500 }, { accountId: bank.id, cashAccountId: pt.id, credit: 6_371_424 }]);
  await e("JV-23092026-610", "2026-09-23", "PENGELUARAN", [{ accountId: beban.id, debit: 7500 }, { accountId: bank.id, cashAccountId: pt.id, credit: 7500 }]);
  await e("JV-25092026-635", "2026-09-25", "PEMBAYARAN_SUPPLIER", [{ accountId: utang.id, debit: 16_810_750 }, { accountId: beban.id, debit: 2500 }, { accountId: bank.id, cashAccountId: pt.id, credit: 16_813_250 }]);
  await e("JV-25092026-667", "2026-09-25", "PENGELUARAN", [{ accountId: beban.id, debit: 5000 }, { accountId: bank.id, cashAccountId: pt.id, credit: 5000 }]);
  if (!tanpaJurnal837) await e("JV-29092026-837", "2026-09-29", "PEMBAYARAN_ORDER", [{ accountId: bank.id, cashAccountId: pt.id, debit: 11970 }, { accountId: piutang.id, credit: 11970 }]);
  return { pt, kem };
}
const jalankan = (apply, env = {}) => {
  try { return { kode: 0, out: execFileSync(process.execPath, ["scripts/koreksiBankPtSanoPoin3sd6.js", ...(apply ? ["--apply"] : [])], { cwd: akar, env: { ...process.env, ...env }, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }) }; }
  catch (e) { return { kode: e.status, out: String(e.stdout) + String(e.stderr) }; }
};
async function foto() {
  const rek = async (nama) => { const r = await testPrisma.finCashAccount.findFirst({ where: { name: nama } }); const a = await testPrisma.finJournalLine.aggregate({ where: { cashAccountId: r.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)).toFixed(2); };
  const akun = async (code) => { const x = await testPrisma.finAccount.findFirst({ where: { code } }); const a = await testPrisma.finJournalLine.aggregate({ where: { accountId: x.id, entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } }); return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)).toFixed(2); };
  return { pt: await rek("PT Sano"), kem: await rek("KEM - Sano Bank"), bank: await akun("1-1200"), beban: await akun("6-1700"), pend: await akun("4-9100"), n: await testPrisma.finJournalEntry.count() };
}

test("PRATINJAU tidak menulis; APPLY tanpa KOREKSI_BACKUP_OK ditolak", async () => {
  await dunia();
  const sebelum = await foto();
  const p = jalankan(false);
  assert.equal(p.kode, 0, p.out);
  assert.match(p.out, /PRATINJAU/);
  assert.deepEqual(await foto(), sebelum);
  const t = jalankan(true);
  assert.notEqual(t.kode, 0);
  assert.match(t.out, /KOREKSI_BACKUP_OK/);
  assert.deepEqual(await foto(), sebelum);
});

test("APPLY: 5 jurnal; PT Sano berubah tepat −3.519,64; KEM tetap; beban +17.470; pendapatan lain +13.950,36; seimbang; replay idempoten", async () => {
  await dunia();
  const sebelum = await foto();
  const r = jalankan(true, { KOREKSI_BACKUP_OK: "1" });
  assert.equal(r.kode, 0, r.out);
  const sesudah = await foto();
  assert.equal(toMoney(sesudah.pt).minus(sebelum.pt).toFixed(2), "-3519.64", "13.950,36 − 10.500 − 11.970 + 2.500 + 2.500");
  assert.equal(sesudah.kem, sebelum.kem);
  assert.equal(toMoney(sesudah.bank).minus(sebelum.bank).toFixed(2), "-3519.64");
  assert.equal(toMoney(sesudah.beban).minus(sebelum.beban).toFixed(2), "17470.00", "10.500 + 11.970 − 2.500 − 2.500");
  assert.equal(toMoney(sesudah.pend).minus(sebelum.pend).toFixed(2), "-13950.36", "pendapatan bersaldo kredit");
  assert.equal(sesudah.n, sebelum.n + 5);
  const seimbang = await testPrisma.finJournalLine.aggregate({ where: { entry: { status: { in: ["POSTED", "REVERSED"] } } }, _sum: { debit: true, credit: true } });
  assert.equal(toMoney(seimbang._sum.debit).toFixed(2), toMoney(seimbang._sum.credit).toFixed(2));
  const jurnal = await testPrisma.finJournalEntry.findMany({ where: { idempotencyKey: { startsWith: "KOREKSI_BANK_PTSANO_6OKT:" } }, include: { lines: true } });
  assert.equal(jurnal.length, 5);
  assert.ok(jurnal.every((j) => j.lines.some((l) => l.cashAccountId)), "setiap jurnal bertaut rekening PT Sano");
  assert.equal(await testPrisma.activityEvent.count({ where: { entityType: "fin_journal" } }), 5, "audit per jurnal");
  // jurnal lama tidak disentuh
  assert.equal((await testPrisma.finJournalEntry.findUnique({ where: { entryNumber: "JV-29092026-837" } })).status, "POSTED");
  const setelah1 = await foto();
  for (const apply of [true, false]) { const x = jalankan(apply, { KOREKSI_BACKUP_OK: "1" }); assert.equal(x.kode, 0, x.out); assert.match(x.out, /SUDAH DIKOREKSI/); }
  assert.deepEqual(await foto(), setelah1, "replay tidak menggandakan");
});

test("Pengaman: jurnal rujukan hilang (JV-837) → BERHENTI (exit 2) tanpa menulis apa pun", async () => {
  await dunia({ tanpaJurnal837: true });
  const sebelum = await foto();
  const r = jalankan(true, { KOREKSI_BACKUP_OK: "1" });
  assert.equal(r.kode, 2, r.out);
  assert.match(r.out, /BERHENTI/);
  assert.deepEqual(await foto(), sebelum);
});
