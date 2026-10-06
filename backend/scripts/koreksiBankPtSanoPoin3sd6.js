// KOREKSI 4 BUTIR REKONSILIASI PT Sano (izin Owner 6 Okt 2026, "setuju poin 3 sampai 6") — bukti: rekening koran Mandiri 1230013546272 (Excel 1 Sep–5 Okt) + saldo bank Kopra 5 Okt 23.40.
//   K3  Bunga bank 30 Sep Rp13.950,36 belum dibukukan                       → Dr 1-1200 [PT Sano] / Cr 4-9100 Pendapatan Lain-lain          (tgl 2026-09-30)
//   K4  MONTHLY CARD CHARGE 3 Okt Rp10.500 belum dibukukan                  → Dr 6-1700 Beban Administrasi Bank / Cr 1-1200 [PT Sano]       (tgl 2026-10-03)
//   K5  JV-29092026-837 Rp11.970 (order RES-11092026-059, Aldho G) = POTONGAN QRIS 0,3% (3.990.000 − 3.978.030), BUKAN uang masuk ke PT Sano
//                                                                           → Dr 6-1700 / Cr 1-1200 [PT Sano]                                (tgl 2026-09-29)
//   K6a/b Biaya BI-FAST Rp2.500 tercatat ganda: sudah di dalam PAYOUT (JV-23092026-573 / JV-25092026-635) DAN di EXP-23092026-320 / EXP-25092026-339
//                                                                           → Dr 1-1200 [PT Sano] / Cr 6-1700 (masing-masing 2.500; tgl 2026-09-23 dan 2026-09-25)
// Tidak menyentuh jurnal/dokumen lama (hanya menambah jurnal), Payment, order, KEM, Uang Kas. Satu transaksi; kunci idempoten per butir; invarian diperiksa SEBELUM commit.
//   node scripts/koreksiBankPtSanoPoin3sd6.js                              # PRATINJAU
//   KOREKSI_BACKUP_OK=1 node scripts/koreksiBankPtSanoPoin3sd6.js --apply  # setelah backup database

import { prisma } from "../src/db.js";
import { postJournal } from "../src/services/finance/journal.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney, ZERO } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const REK = "PT Sano";
const AKTOR = "OWNER (Admin)";
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const STATUS = ["POSTED", "REVERSED"];
const kunci = (k) => `KOREKSI_BANK_PTSANO_6OKT:${k}`;
class Berhenti extends Error {}

// arah "masuk": Dr Bank[PT Sano] / Cr lawan;  "keluar": Dr lawan / Cr Bank[PT Sano]
const BUTIR = [
  { k: "K3_BUNGA", tgl: "2026-09-30", arah: "masuk", lawan: "4-9100", nilai: "13950.36", ket: "Bunga bank PT Sano Sep 2026 — rekening koran Mandiri 1230013546272, 30 Sep 2026 (kode 0160 'Bunga', kredit 13.950,36); belum dibukukan", syarat: [] },
  { k: "K4_KARTU", tgl: "2026-10-03", arah: "keluar", lawan: "6-1700", nilai: "10500", ket: "Biaya administrasi kartu debit (MONTHLY CARD CHARGE 02-10-26) — rekening koran Mandiri 3 Okt 2026 (ref 2-10-26, 26100399101350132941); belum dibukukan", syarat: [] },
  { k: "K5_QRIS_ALDHO", tgl: "2026-09-29", arah: "keluar", lawan: "6-1700", nilai: "11970", ket: "Koreksi JV-29092026-837: Rp11.970 order RES-11092026-059 (Aldho G) adalah potongan QRIS 0,3% (3.990.000 − 3.978.030 diterima di KEM 18 Sep), bukan uang masuk ke PT Sano", syarat: [{ jurnal: "JV-29092026-837", sumber: "PEMBAYARAN_ORDER", bankMasuk: "11970" }] },
  { k: "K6A_FEE_GANDA_23SEP", tgl: "2026-09-23", arah: "masuk", lawan: "6-1700", nilai: "2500", ket: "Koreksi biaya BI-FAST ganda (Sinar Utama): sudah di dalam JV-23092026-573 (PAYOUT-23092026-001) dan tercatat lagi di EXP-23092026-320 (JV-23092026-610); bank hanya 3 baris biaya Rp2.500 pada 23 Sep", syarat: [{ jurnal: "JV-23092026-573", akun6_1700: "2500" }, { jurnal: "JV-23092026-610", akun6_1700: "7500" }] },
  { k: "K6B_FEE_GANDA_25SEP", tgl: "2026-09-25", arah: "masuk", lawan: "6-1700", nilai: "2500", ket: "Koreksi biaya BI-FAST ganda (PT MBB): sudah di dalam JV-25092026-635 (PAYOUT-25092026-003) dan tercatat lagi di EXP-25092026-339 (JV-25092026-667); bank hanya 2 baris biaya Rp2.500 pada 25 Sep", syarat: [{ jurnal: "JV-25092026-635", akun6_1700: "2500" }, { jurnal: "JV-25092026-667", akun6_1700: "5000" }] },
];

async function saldoRek(db) {
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true, accountId: true } });
  const out = {};
  for (const r of rek) { const a = await db.finJournalLine.aggregate({ where: { cashAccountId: r.id, accountId: r.accountId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } }); out[r.name] = toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0)); }
  return out;
}
async function saldoAkun(db, kode) {
  const akun = await db.finAccount.findFirst({ where: { code: kode }, select: { id: true } });
  const a = await db.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
}
async function neraca(db) { const a = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } }); return { d: toMoney(a._sum.debit ?? 0), k: toMoney(a._sum.credit ?? 0) }; }

async function periksa(db) {
  const rek = await db.finCashAccount.findFirst({ where: { name: REK }, select: { id: true, accountId: true } });
  if (!rek) throw new Berhenti(`rekening ${REK} tidak ada`);
  const akun = {}; for (const kd of ["4-9100", "6-1700"]) { akun[kd] = await db.finAccount.findFirst({ where: { code: kd, active: true }, select: { id: true } }); if (!akun[kd]) throw new Berhenti(`akun ${kd} tidak aktif/ada`); }
  const siap = [], sudah = [];
  for (const b of BUTIR) {
    const ada = await db.finJournalEntry.findUnique({ where: { idempotencyKey: kunci(b.k) }, select: { entryNumber: true } });
    if (ada) { sudah.push(`${b.k}=${ada.entryNumber}`); continue; }
    for (const s of b.syarat) {
      const e = await db.finJournalEntry.findUnique({ where: { entryNumber: s.jurnal }, include: { lines: { include: { account: { select: { code: true } } } } } });
      if (!e || e.status !== "POSTED") throw new Berhenti(`${b.k}: ${s.jurnal} tidak POSTED`);
      if (s.sumber && e.source !== s.sumber) throw new Berhenti(`${b.k}: ${s.jurnal} bersumber ${e.source}`);
      if (s.bankMasuk && !e.lines.some((l) => l.cashAccountId === rek.id && toMoney(l.debit).equals(toMoney(s.bankMasuk)))) throw new Berhenti(`${b.k}: ${s.jurnal} tidak punya Dr Bank [${REK}] ${s.bankMasuk}`);
      if (s.akun6_1700 && !e.lines.some((l) => l.account.code === "6-1700" && toMoney(l.debit).equals(toMoney(s.akun6_1700)))) throw new Berhenti(`${b.k}: ${s.jurnal} tidak punya beban 6-1700 ${s.akun6_1700}`);
    }
    siap.push(b);
  }
  if (sudah.length && siap.length) throw new Berhenti(`sebagian butir sudah dikoreksi (${sudah.join(", ")}) sedangkan lainnya belum — periksa manual`);
  return { rek, akun, siap, sudah };
}

function barisJurnal(b, rek, akun) {
  const nilai = toMoney(b.nilai); const lawan = akun[b.lawan].id;
  return b.arah === "masuk"
    ? [{ accountId: rek.accountId, cashAccountId: rek.id, debit: nilai, description: `${REK}: ${b.k}` }, { accountId: lawan, credit: nilai, description: b.k }]
    : [{ accountId: lawan, debit: nilai, description: b.k }, { accountId: rek.accountId, cashAccountId: rek.id, credit: nilai, description: `${REK}: ${b.k}` }];
}
const efekBank = (b) => (b.arah === "masuk" ? toMoney(b.nilai) : toMoney(b.nilai).negated());

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "PRATINJAU (tidak menulis apa pun)"}`);
  const p = await periksa(prisma);
  if (!p.siap.length) { console.log(`SUDAH DIKOREKSI (${p.sudah.join(", ")}) — berhenti tanpa menambah jurnal.`); return; }
  const sbl = { rek: await saldoRek(prisma), bank: await saldoAkun(prisma, "1-1200"), pend: await saldoAkun(prisma, "4-9100"), beban: await saldoAkun(prisma, "6-1700"), ner: await neraca(prisma), n: await prisma.finJournalEntry.count() };
  const netBank = p.siap.reduce((s, b) => s.plus(efekBank(b)), ZERO);
  const netBeban = p.siap.reduce((s, b) => (b.lawan === "6-1700" ? s.plus(b.arah === "keluar" ? toMoney(b.nilai) : toMoney(b.nilai).negated()) : s), ZERO);
  const netPend = p.siap.reduce((s, b) => (b.lawan === "4-9100" ? s.minus(toMoney(b.nilai)) : s), ZERO); // pendapatan bersaldo kredit (negatif)
  console.log("\nButir yang akan dijurnal:");
  for (const b of p.siap) console.log(`  ${b.k.padEnd(20)} ${b.tgl}  ${b.arah === "masuk" ? "Dr Bank[PT Sano] / Cr " : "Dr "}${b.lawan}${b.arah === "masuk" ? "" : " / Cr Bank[PT Sano]"}  ${rp(b.nilai)}`);
  console.log("\nDampak yang DIHARAPKAN:");
  for (const [n, v] of Object.entries(sbl.rek)) console.log(`  ${n.padEnd(16)} ${rp(v)} → ${rp(n === REK ? v.plus(netBank) : v)}${n === REK ? `  (${netBank.isNegative() ? "−" : "+"}${rp(netBank.abs())})` : "  (tetap)"}`);
  console.log(`  akun 1-1200      ${rp(sbl.bank)} → ${rp(sbl.bank.plus(netBank))}`);
  console.log(`  akun 6-1700      ${rp(sbl.beban)} → ${rp(sbl.beban.plus(netBeban))}`);
  console.log(`  akun 4-9100      ${rp(sbl.pend)} → ${rp(sbl.pend.plus(netPend))}`);
  console.log(`  jurnal           ${sbl.n} → ${sbl.n + p.siap.length} (+${p.siap.length}); neraca ${rp(sbl.ner.d)} = ${rp(sbl.ner.k)}`);
  if (!APPLY) { console.log("\nIni PRATINJAU. Backup dulu, lalu: KOREKSI_BACKUP_OK=1 node scripts/koreksiBankPtSanoPoin3sd6.js --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 SETELAH backup database dibuat dan divalidasi.");
  const aktor = await prisma.user.findFirst({ where: { name: AKTOR, role: "ADMIN", active: true }, select: { id: true, name: true } });
  if (!aktor) throw new Error(`Akun atribusi "${AKTOR}" tidak ditemukan`);

  const dibuat = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "KOREKSI_BANK_PTSANO_6OKT");
    const q = await periksa(tx);
    if (!q.siap.length || q.sudah.length) throw new Berhenti("status koreksi berubah di bawah kunci");
    const a = { rek: await saldoRek(tx), bank: await saldoAkun(tx, "1-1200"), beban: await saldoAkun(tx, "6-1700"), pend: await saldoAkun(tx, "4-9100"), ner: await neraca(tx), n: await tx.finJournalEntry.count() };
    const out = [];
    for (const b of q.siap) {
      const { entry, created } = await postJournal(tx, { date: b.tgl, description: `${b.k.split("_")[0]} — ${b.ket}`, source: "MANUAL", idempotencyKey: kunci(b.k), userId: aktor.id, lines: barisJurnal(b, q.rek, q.akun) });
      if (!created) throw new Error(`jurnal ${b.k} ternyata sudah ada — dibatalkan`);
      await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: entry.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { aksi: "koreksi_bank_pt_sano_poin3sd6", butir: b.k, nominal: toMoney(b.nilai).toFixed(2), tanggalBuku: b.tgl, keterangan: b.ket, rujukan: b.syarat.map((s) => s.jurnal), izin: "Owner, 6 Okt 2026 (setuju poin 3 sampai 6)", dijalankanOleh: "Claude Code (skrip koreksiBankPtSanoPoin3sd6.js) atas instruksi tertulis Owner", diatribusikanKe: aktor.name } });
      out.push({ k: b.k, no: entry.entryNumber });
    }
    const z = { rek: await saldoRek(tx), bank: await saldoAkun(tx, "1-1200"), beban: await saldoAkun(tx, "6-1700"), pend: await saldoAkun(tx, "4-9100"), ner: await neraca(tx), n: await tx.finJournalEntry.count() };
    for (const [n, v] of Object.entries(a.rek)) { const harap = n === REK ? v.plus(netBank) : v; if (!z.rek[n].equals(harap)) throw new Error(`INVARIAN GAGAL: saldo ${n} ${rp(z.rek[n])} ≠ ${rp(harap)} — rollback`); }
    if (!z.bank.equals(a.bank.plus(netBank))) throw new Error("INVARIAN GAGAL: akun 1-1200 — rollback");
    if (!z.beban.equals(a.beban.plus(netBeban))) throw new Error("INVARIAN GAGAL: akun 6-1700 — rollback");
    if (!z.pend.equals(a.pend.plus(netPend))) throw new Error("INVARIAN GAGAL: akun 4-9100 — rollback");
    if (!z.ner.d.equals(z.ner.k)) throw new Error("INVARIAN GAGAL: neraca tidak seimbang — rollback");
    if (z.n !== a.n + q.siap.length) throw new Error("INVARIAN GAGAL: jumlah jurnal — rollback");
    return out;
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDITERAPKAN (${dibuat.length} jurnal, atribusi ${aktor.name}):`); for (const d of dibuat) console.log(`  ${d.k.padEnd(20)} ${d.no}`);
  const ssd = { rek: await saldoRek(prisma), bank: await saldoAkun(prisma, "1-1200"), beban: await saldoAkun(prisma, "6-1700"), pend: await saldoAkun(prisma, "4-9100"), ner: await neraca(prisma), n: await prisma.finJournalEntry.count() };
  console.log("VERIFIKASI:"); for (const [n, v] of Object.entries(ssd.rek)) console.log(`  ${n.padEnd(16)} ${rp(sbl.rek[n])} → ${rp(v)}`);
  console.log(`  akun 1-1200      ${rp(sbl.bank)} → ${rp(ssd.bank)}\n  akun 6-1700      ${rp(sbl.beban)} → ${rp(ssd.beban)}\n  akun 4-9100      ${rp(sbl.pend)} → ${rp(ssd.pend)}\n  jurnal           ${sbl.n} → ${ssd.n}; neraca ${ssd.ner.d.equals(ssd.ner.k) ? "SEIMBANG" : "TIDAK SEIMBANG!"}`);
  const ulang = await periksa(prisma); console.log(`  replay           ${ulang.siap.length === 0 ? `tidak menggandakan koreksi (${ulang.sudah.length} butir sudah ada)` : "PERIKSA: replay masih menemukan butir!"}`);
}
main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
