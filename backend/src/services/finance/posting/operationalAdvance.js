// POSTING UANG MUKA OPERASIONAL — kas yang DIBERIKAN ke pemegang (driver/PIC)
// untuk biaya operasional. Aset lancar 1-1360, BUKAN beban, sampai dipertanggungjawabkan.
//
//   Berikan       Dr Uang Muka Operasional        Cr Kas/Bank (+ Dr Beban Admin Bank bila transfer)
//   Pertanggung-  Dr Beban                        Cr Uang Muka Operasional      (jurnal pengeluaran,
//   jawaban       (+ selisih > saldo: Cr Utang Reimbursement ke pemegang)      posting/expense.js — TANPA /pay)
//   Pengembalian  Dr Kas/Bank                     Cr Uang Muka Operasional
//
// Kas/bank berkurang SEKALI, saat uang muka diberikan. Pertanggungjawaban TIDAK
// menyentuh kas sama sekali — itulah yang mencegah uang keluar dua kali.

import { postJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";
import { barisBiayaAdmin } from "../transferFee.js";

export const KEY = {
  berikan: (id) => `UANG_MUKA_OP:${id}`,
  kembali: (settlementId) => `UANG_MUKA_OP_KEMBALI:${settlementId}`,
};

export async function postUangMukaDiberikan(tx, { advanceId, userId = null }) {
  const a = await tx.finOperationalAdvance.findUnique({
    where: { id: advanceId },
    include: {
      cashAccount: { select: { id: true, name: true, accountId: true } },
      holder: { select: { name: true } },
    },
  });
  if (!a) throw new Error(`Uang muka ${advanceId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.berikan(advanceId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const um = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_OPERASIONAL);
  const nominal = toMoney(a.amount);
  const biaya = toMoney(a.transferFeeAmount || 0);
  const barisAdmin = await barisBiayaAdmin(tx, { fee: biaya, cashAccount: a.cashAccount });

  const { entry, created } = await postJournal(tx, {
    date: a.date,
    description: `${a.advanceNumber} — uang muka operasional ke ${a.holder?.name || "pemegang"}: ${a.purpose}`,
    source: "UANG_MUKA_OPERASIONAL",
    sourceId: advanceId,
    idempotencyKey: KEY.berikan(advanceId),
    userId,
    lines: [
      { accountId: um.id, debit: nominal, description: `Uang muka operasional — ${a.holder?.name || "pemegang"}` },
      {
        accountId: a.cashAccount.accountId,
        credit: nominal.plus(biaya),
        description: biaya.greaterThan(0)
          ? `Uang keluar — ${a.cashAccount.name} (termasuk biaya admin transfer)`
          : `Uang keluar — ${a.cashAccount.name}`,
        cashAccountId: a.cashAccount.id,
      },
      ...barisAdmin,
    ],
  });
  return { posted: true, entry, created };
}

export async function postUangMukaDikembalikan(tx, { settlementId, userId = null }) {
  const s = await tx.finOperationalAdvanceSettlement.findUnique({
    where: { id: settlementId },
    include: {
      cashAccount: { select: { id: true, name: true, accountId: true } },
      advance: { select: { advanceNumber: true, holder: { select: { name: true } } } },
    },
  });
  if (!s || s.type !== "PENGEMBALIAN") throw new Error(`Pengembalian ${settlementId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.kembali(settlementId));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const um = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_OPERASIONAL);
  const nominal = toMoney(s.amount);

  const { entry, created } = await postJournal(tx, {
    date: s.date,
    description: `Pengembalian sisa ${s.advance.advanceNumber} dari ${s.advance.holder?.name || "pemegang"}`,
    source: "UANG_MUKA_OPERASIONAL",
    sourceId: s.advanceId,
    idempotencyKey: KEY.kembali(settlementId),
    userId,
    lines: [
      {
        accountId: s.cashAccount.accountId,
        debit: nominal,
        description: `Uang masuk — ${s.cashAccount.name}`,
        cashAccountId: s.cashAccount.id,
      },
      { accountId: um.id, credit: nominal, description: "Sisa uang muka dikembalikan" },
    ],
  });
  return { posted: true, entry, created };
}
