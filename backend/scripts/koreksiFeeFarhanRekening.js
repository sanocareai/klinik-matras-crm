// KOREKSI DIMENSI REKENING "FEE FARHAN AGUSTUS" Rp6.715.170 (izin Owner 6 Okt 2026 — HANYA koreksi ini).
//
// Rantai: EXP-25092026-328 (dibayar dari PT Sano, 25 Sep) → JV-25092026-624 (dibalik 28 Sep, "perubahan kategori") → pembalik JV-28092026-730 → JV-25092026-731 (MANUAL,
// Dr 3-4200 Distribusi Laba / Cr 1-1200 Bank, kedua baris TANPA rekening). Buku besar perusahaan sudah benar (uang keluar sekali); yang kurang hanya DIMENSI REKENING: saldo per rekening
// PT Sano lebih tinggi Rp6.715.170 dari kenyataan. Bukti bank: rekening koran Mandiri 1230013546272, 25 Sep 2026, debit 6.715.170 "KE FARHAN ASAD AFIF" (ref 202609251333642502).
//
// KOREKSI RESMI (tanpa overwrite, tanpa pengeluaran baru, tanpa distribusi laba ganda), SATU transaksi database:
//   1. reverseJournal(JV-25092026-731)                                 → Dr 1-1200 / Cr 3-4200 (menghapus pengaruh jurnal lama)
//   2. postJournal pengganti: Dr 3-4200 6.715.170 / Cr 1-1200 [PT Sano] 6.715.170   (kunci idempoten KOREKSI_REKENING_FEE_FARHAN:<id JV-731>)
//   Akibat: saldo PT Sano −6.715.170; akun 1-1200 dan 3-4200 TIDAK berubah; KEM, Uang Kas, Payment, alokasi, order tidak tersentuh.
//
//   node scripts/koreksiFeeFarhanRekening.js                       # PRATINJAU (tidak menulis apa pun)
//   KOREKSI_BACKUP_OK=1 node scripts/koreksiFeeFarhanRekening.js --apply   # setelah backup database
//
// Pengaman: semua syarat diperiksa ULANG di dalam transaksi (setelah advisory lock); invarian saldo/neraca diperiksa SEBELUM commit — tidak cocok = rollback total.
// Idempoten: bila JV-731 sudah dibalik atau kunci koreksi sudah ada → berhenti TANPA menambah jurnal (exit 0).

import { prisma } from "../src/db.js";
import { postJournal, reverseJournal } from "../src/services/finance/journal.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../src/lib/activityLog.js";
import { toMoney, ZERO } from "../src/services/finance/money.js";

const APPLY = process.argv.includes("--apply");
const NO_JURNAL = "JV-25092026-731";
const NO_ASAL = "JV-25092026-624";
const NO_BALIK_ASAL = "JV-28092026-730";
const NO_EXP = "EXP-25092026-328";
const NOMINAL = toMoney("6715170");
const TANGGAL = "2026-09-25"; // tanggal ekonomi: uang keluar dari bank 25 Sep (sama dengan dokumen & jurnal 731)
const REKENING = "PT Sano";
const AKTOR_NAMA = "OWNER (Admin)";
const BUKTI = "rekening koran Mandiri 1230013546272, 25 Sep 2026, debit 6.715.170 KE FARHAN ASAD AFIF, ref 202609251333642502";
const rp = (v) => `Rp${Number(v).toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
const kunciKoreksi = (id) => `KOREKSI_REKENING_FEE_FARHAN:${id}`;
const STATUS = ["POSTED", "REVERSED"];

class Berhenti extends Error {}

async function saldoRekening(db) {
  const rek = await db.finCashAccount.findMany({ select: { id: true, name: true } });
  const out = {};
  for (const r of rek) {
    const a = await db.finJournalLine.aggregate({ where: { cashAccountId: r.id, accountId: (await db.finCashAccount.findUnique({ where: { id: r.id }, select: { accountId: true } })).accountId, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
    out[r.name] = toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
  }
  return out;
}
async function saldoAkun(db, kode) {
  const akun = await db.finAccount.findFirst({ where: { code: kode }, select: { id: true } });
  const a = await db.finJournalLine.aggregate({ where: { accountId: akun.id, entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  return toMoney(a._sum.debit ?? 0).minus(toMoney(a._sum.credit ?? 0));
}
async function neraca(db) {
  const a = await db.finJournalLine.aggregate({ where: { entry: { status: { in: STATUS } } }, _sum: { debit: true, credit: true } });
  return { debit: toMoney(a._sum.debit ?? 0), kredit: toMoney(a._sum.credit ?? 0) };
}

/** Periksa seluruh syarat. Mengembalikan { sudahDikoreksi, ... } atau melempar Berhenti dengan alasan. */
async function periksa(db) {
  const e731 = await db.finJournalEntry.findUnique({ where: { entryNumber: NO_JURNAL }, include: { lines: { orderBy: { lineNo: "asc" }, include: { account: { select: { code: true } } } } } });
  if (!e731) throw new Berhenti(`${NO_JURNAL} tidak ditemukan`);
  const sudahKunci = await db.finJournalEntry.findUnique({ where: { idempotencyKey: kunciKoreksi(e731.id) }, select: { entryNumber: true } });
  const pembalik = await db.finJournalEntry.findFirst({ where: { reversalOfId: e731.id }, select: { entryNumber: true } });
  if (sudahKunci || pembalik || e731.status === "REVERSED") return { sudahDikoreksi: true, info: `pengganti ${sudahKunci?.entryNumber ?? "-"}, pembalik ${pembalik?.entryNumber ?? "-"}, status ${e731.status}` };
  if (e731.status !== "POSTED") throw new Berhenti(`${NO_JURNAL} berstatus ${e731.status} (harus POSTED)`);
  if (e731.source !== "MANUAL") throw new Berhenti(`${NO_JURNAL} bersumber ${e731.source} (harus MANUAL)`);
  if (e731.date.toISOString().slice(0, 10) !== TANGGAL) throw new Berhenti(`${NO_JURNAL} bertanggal ${e731.date.toISOString().slice(0, 10)} (harus ${TANGGAL})`);
  if (e731.lines.length !== 2) throw new Berhenti(`${NO_JURNAL} memuat ${e731.lines.length} baris (harus 2)`);
  const dr = e731.lines.find((l) => l.account.code === "3-4200"), cr = e731.lines.find((l) => l.account.code === "1-1200");
  if (!dr || !cr) throw new Berhenti("baris 731 bukan pasangan 3-4200 / 1-1200");
  if (!toMoney(dr.debit).equals(NOMINAL) || !toMoney(dr.credit).isZero()) throw new Berhenti(`baris 3-4200 bukan Dr ${rp(NOMINAL)}`);
  if (!toMoney(cr.credit).equals(NOMINAL) || !toMoney(cr.debit).isZero()) throw new Berhenti(`baris 1-1200 bukan Cr ${rp(NOMINAL)}`);
  if (dr.cashAccountId || cr.cashAccountId) throw new Berhenti(`${NO_JURNAL} SUDAH memiliki rekening pada salah satu baris — tidak ada yang perlu dikoreksi`);

  const exp = await db.finExpense.findFirst({ where: { expenseNumber: NO_EXP }, include: { cashAccount: { select: { name: true } } } });
  if (!exp) throw new Berhenti(`${NO_EXP} tidak ditemukan`);
  if (exp.status !== "DIBAYAR" || !toMoney(exp.amount).equals(NOMINAL)) throw new Berhenti(`${NO_EXP}: status/nominal tidak sesuai (${exp.status} ${exp.amount})`);
  if (exp.cashAccount?.name !== REKENING) throw new Berhenti(`${NO_EXP} dibayar dari "${exp.cashAccount?.name}" (harus ${REKENING})`);
  const asal = await db.finJournalEntry.findUnique({ where: { entryNumber: NO_ASAL }, include: { lines: true } });
  const balikAsal = await db.finJournalEntry.findUnique({ where: { entryNumber: NO_BALIK_ASAL }, include: { lines: true } });
  if (!asal || asal.status !== "REVERSED" || !balikAsal || balikAsal.status !== "POSTED" || balikAsal.reversalOfId !== asal.id) throw new Berhenti("rantai asli→pembalik (624→730) tidak sesuai dugaan");

  const rek = await db.finCashAccount.findFirst({ where: { name: REKENING }, select: { id: true, accountId: true } });
  if (!rek || rek.accountId !== cr.accountId) throw new Berhenti(`rekening "${REKENING}" tidak ada atau tidak terhubung ke akun 1-1200`);
  const akunEkuitas = dr.accountId;
  return { sudahDikoreksi: false, e731, rek, akunBank: cr.accountId, akunEkuitas };
}

async function main() {
  console.log(`Mode: ${APPLY ? "APPLY (menulis ke database)" : "PRATINJAU (tidak menulis apa pun)"}`);
  const p = await periksa(prisma);
  if (p.sudahDikoreksi) { console.log(`SUDAH DIKOREKSI (${p.info}) — berhenti tanpa menambah jurnal.`); return; }

  const sebelum = { rek: await saldoRekening(prisma), bank: await saldoAkun(prisma, "1-1200"), ekuitas: await saldoAkun(prisma, "3-4200"), neraca: await neraca(prisma), n: await prisma.finJournalEntry.count() };
  console.log(`\nDokumen asal   : ${NO_EXP} (DIBAYAR dari ${REKENING}, ${rp(NOMINAL)}) — TIDAK diubah`);
  console.log(`Rantai         : ${NO_ASAL} (REVERSED) → ${NO_BALIK_ASAL} (pembalik) → ${NO_JURNAL} (MANUAL, tanpa rekening)`);
  console.log(`Bukti bank     : ${BUKTI}`);
  console.log(`\nLangkah (satu transaksi):`);
  console.log(`  1. Balik ${NO_JURNAL}: Dr 1-1200 ${rp(NOMINAL)} (tanpa rekening) / Cr 3-4200 ${rp(NOMINAL)}   tanggal ${TANGGAL}`);
  console.log(`  2. Pengganti    : Dr 3-4200 ${rp(NOMINAL)} / Cr 1-1200 [${REKENING}] ${rp(NOMINAL)}   tanggal ${TANGGAL}   kunci ${kunciKoreksi(p.e731.id)}`);
  console.log(`\nDampak yang DIHARAPKAN:`);
  for (const [n, v] of Object.entries(sebelum.rek)) console.log(`  ${n.padEnd(16)} ${rp(v)} → ${rp(n === REKENING ? v.minus(NOMINAL) : v)}${n === REKENING ? `  (−${rp(NOMINAL)})` : "  (tetap)"}`);
  console.log(`  akun 1-1200      ${rp(sebelum.bank)} → ${rp(sebelum.bank)} (tetap)`);
  console.log(`  akun 3-4200      ${rp(sebelum.ekuitas)} → ${rp(sebelum.ekuitas)} (tetap)`);
  console.log(`  jurnal           ${sebelum.n} → ${sebelum.n + 2} (+2)   neraca: debit ${rp(sebelum.neraca.debit)} = kredit ${rp(sebelum.neraca.kredit)}`);
  if (!APPLY) { console.log("\nIni PRATINJAU. Backup dulu, lalu: KOREKSI_BACKUP_OK=1 node scripts/koreksiFeeFarhanRekening.js --apply"); return; }
  if (process.env.KOREKSI_BACKUP_OK !== "1") throw new Error("Menolak --apply: set KOREKSI_BACKUP_OK=1 SETELAH backup database dibuat dan divalidasi.");

  const aktor = await prisma.user.findFirst({ where: { name: AKTOR_NAMA, role: "ADMIN", active: true }, select: { id: true, name: true } });
  if (!aktor) throw new Error(`Akun atribusi "${AKTOR_NAMA}" tidak ditemukan`);

  const hasil = await prisma.$transaction(async (tx) => {
    await tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", "KOREKSI_REKENING_FEE_FARHAN");
    const q = await periksa(tx); // periksa ULANG di bawah kunci
    if (q.sudahDikoreksi) throw new Berhenti(`sudah dikoreksi oleh proses lain (${q.info})`);
    const sblm = { rek: await saldoRekening(tx), bank: await saldoAkun(tx, "1-1200"), ekuitas: await saldoAkun(tx, "3-4200"), neraca: await neraca(tx), n: await tx.finJournalEntry.count() };

    const alasan = `Koreksi dimensi rekening Fee Farhan Agustus (${NO_EXP}): pembukuan ulang ${NO_JURNAL} belum menyebut rekening bank. Uang keluar dari ${REKENING} (${BUKTI}); izin Owner 6 Okt 2026. Pengganti ber-rekening dibukukan dalam transaksi yang sama.`;
    const pembalik = await reverseJournal(tx, { entryId: q.e731.id, date: TANGGAL, reason: alasan, userId: aktor.id });
    const { entry: pengganti, created } = await postJournal(tx, {
      date: TANGGAL,
      description: `Fee Farhan Agustus — pengganti ${NO_JURNAL} (koreksi rekening ${REKENING}); pembalik ${pembalik.entryNumber}; dokumen ${NO_EXP}; rantai ${NO_ASAL}→${NO_BALIK_ASAL}`,
      source: "MANUAL",
      idempotencyKey: kunciKoreksi(q.e731.id),
      userId: aktor.id,
      lines: [
        { accountId: q.akunEkuitas, debit: NOMINAL, description: `Fee Farhan Agustus (pengganti ${NO_JURNAL})` },
        { accountId: q.akunBank, cashAccountId: q.rek.id, credit: NOMINAL, description: `Uang keluar dari ${REKENING} — ${NO_EXP}` },
      ],
    });
    if (!created) throw new Error("Jurnal pengganti ternyata sudah ada — dibatalkan");

    const meta = { aksi: "koreksi_rekening_fee_farhan", dokumenAsal: NO_EXP, jurnalAsli: NO_JURNAL, jurnalPembalik: pembalik.entryNumber, jurnalPengganti: pengganti.entryNumber, rantaiSebelumnya: [NO_ASAL, NO_BALIK_ASAL], rekening: REKENING, nominal: NOMINAL.toFixed(2), tanggalBuku: TANGGAL, bukti: BUKTI, izin: "Owner, 6 Okt 2026 (koreksi Fee Farhan saja)", dijalankanOleh: "Claude Code (skrip koreksiFeeFarhanRekening.js) atas instruksi tertulis Owner", diatribusikanKe: aktor.name };
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: q.e731.id, eventType: EVENT_TYPES.JOURNAL_REVERSED, actorId: aktor.id, metadata: { ...meta, entryNumber: NO_JURNAL, reason: alasan, reversalNumber: pembalik.entryNumber } });
    await recordActivity(tx, { entityType: ENTITY_TYPES.FIN_JOURNAL, entityId: pengganti.id, eventType: EVENT_TYPES.DOCUMENT_CORRECTED, actorId: aktor.id, metadata: { ...meta, sebelum: { rekeningPadaBaris1_1200: null }, sesudah: { rekeningPadaBaris1_1200: REKENING } } });

    // INVARIAN — diperiksa SEBELUM commit; tidak cocok = rollback total (throw).
    const ssdh = { rek: await saldoRekening(tx), bank: await saldoAkun(tx, "1-1200"), ekuitas: await saldoAkun(tx, "3-4200"), neraca: await neraca(tx), n: await tx.finJournalEntry.count() };
    for (const [n, v] of Object.entries(sblm.rek)) {
      const harap = n === REKENING ? v.minus(NOMINAL) : v;
      if (!ssdh.rek[n].equals(harap)) throw new Error(`INVARIAN GAGAL: saldo ${n} ${rp(ssdh.rek[n])} ≠ harapan ${rp(harap)} — rollback`);
    }
    if (!ssdh.bank.equals(sblm.bank)) throw new Error("INVARIAN GAGAL: saldo akun 1-1200 berubah — rollback");
    if (!ssdh.ekuitas.equals(sblm.ekuitas)) throw new Error("INVARIAN GAGAL: saldo akun 3-4200 berubah — rollback");
    if (!ssdh.neraca.debit.equals(ssdh.neraca.kredit)) throw new Error("INVARIAN GAGAL: neraca tidak seimbang — rollback");
    if (ssdh.n !== sblm.n + 2) throw new Error(`INVARIAN GAGAL: jumlah jurnal ${sblm.n} → ${ssdh.n} (harus +2) — rollback`);
    return { pembalik: pembalik.entryNumber, pengganti: pengganti.entryNumber, aktor: aktor.name };
  }, { timeout: 60_000, maxWait: 20_000 });

  console.log(`\nDITERAPKAN: pembalik ${hasil.pembalik}, pengganti ${hasil.pengganti} (atribusi: ${hasil.aktor})`);
  const sesudah = { rek: await saldoRekening(prisma), bank: await saldoAkun(prisma, "1-1200"), ekuitas: await saldoAkun(prisma, "3-4200"), neraca: await neraca(prisma), n: await prisma.finJournalEntry.count() };
  console.log("VERIFIKASI:");
  for (const [n, v] of Object.entries(sesudah.rek)) console.log(`  ${n.padEnd(16)} ${rp(sebelum.rek[n])} → ${rp(v)}`);
  console.log(`  akun 1-1200      ${rp(sebelum.bank)} → ${rp(sesudah.bank)}`);
  console.log(`  akun 3-4200      ${rp(sebelum.ekuitas)} → ${rp(sesudah.ekuitas)}`);
  console.log(`  jurnal           ${sebelum.n} → ${sesudah.n}; neraca debit ${rp(sesudah.neraca.debit)} ${sesudah.neraca.debit.equals(sesudah.neraca.kredit) ? "= kredit (SEIMBANG)" : "≠ kredit (TIDAK SEIMBANG!)"}`);
  const ulang = await periksa(prisma);
  console.log(`  replay           ${ulang.sudahDikoreksi ? `tidak menggandakan koreksi (${ulang.info})` : "PERIKSA: replay tidak mendeteksi koreksi!"}`);
}

main().catch((e) => { if (e instanceof Berhenti) { console.error("BERHENTI:", e.message); process.exitCode = 2; } else { console.error("SCRIPT ERROR:", e.message); process.exitCode = 1; } }).finally(async () => { await prisma.$disconnect(); });
