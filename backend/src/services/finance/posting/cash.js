// POSTING KAS & BANK — transfer antar rekening sendiri + pemasukan
// non-order.
//
// TRANSFER BUKAN PENDAPATAN DAN BUKAN BEBAN. Menyetor uang tunai dari kas
// ke rekening bank tidak menambah kekayaan perusahaan sepeser pun — ia cuma
// berpindah tempat. Karena itu laporan arus kas WAJIB tidak menghitungnya
// sebagai arus masuk maupun keluar; penyaringnya ada di reports.js (jurnal
// bersumber TRANSFER_KAS dilewati), bukan di sini.
//
// Biaya admin transfer DIPISAH jadi baris beban sendiri, TIDAK dikurangkan
// dari nominal transfernya. Kalau dikurangkan, saldo rekening tujuan di buku
// tidak akan pernah cocok dengan mutasi di koran bank — dan rekonsiliasi
// bank jadi mustahil diselesaikan.

import { postJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";

export const KEY = {
  // `suffix` (opsional) — lihat catatan yang sama di posting/expense.js:
  // dipakai jalur Koreksi supaya jurnal PENGGANTI (setelah reversal) tidak
  // bentrok UNIQUE idempotencyKey dengan jurnal lama yang sudah REVERSED.
  transfer: (id, suffix = "") => `TRANSFER_KAS:${id}${suffix}`,
  otherIncome: (id, suffix = "") => `PEMASUKAN_LAIN:${id}${suffix}`,
};

export async function postCashTransfer(tx, { transferId, userId = null, keySuffix = "" }) {
  const t = await tx.finCashTransfer.findUnique({
    where: { id: transferId },
    include: {
      fromAccount: { select: { id: true, name: true, accountId: true } },
      toAccount: { select: { id: true, name: true, accountId: true } },
    },
  });
  if (!t) throw new Error(`Transfer ${transferId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.transfer(transferId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const amount = toMoney(t.amount);
  const fee = toMoney(t.feeAmount || 0);

  const lines = [
    {
      accountId: t.toAccount.accountId,
      debit: amount,
      description: `Masuk ke ${t.toAccount.name}`,
      cashAccountId: t.toAccount.id,
    },
    {
      accountId: t.fromAccount.accountId,
      credit: amount.plus(fee),
      description: `Keluar dari ${t.fromAccount.name}${fee.greaterThan(0) ? " (termasuk biaya admin)" : ""}`,
      cashAccountId: t.fromAccount.id,
    },
  ];

  if (fee.greaterThan(0)) {
    const bebanAdmin = await resolveAccount(tx, SYSTEM_KEYS.BEBAN_ADMIN_BANK);
    lines.push({
      accountId: bebanAdmin.id,
      debit: fee,
      description: "Biaya administrasi transfer",
      cashAccountId: t.fromAccount.id,
    });
  }

  const { entry, created } = await postJournal(tx, {
    date: t.date,
    description: `${t.transferNumber} — ${t.fromAccount.name} → ${t.toAccount.name}${t.notes ? `: ${t.notes}` : ""}`,
    source: "TRANSFER_KAS",
    sourceId: transferId,
    idempotencyKey: KEY.transfer(transferId, keySuffix),
    userId,
    lines,
  });
  return { posted: true, entry, created };
}

export async function postOtherIncome(tx, { incomeId, userId = null, keySuffix = "" }) {
  const inc = await tx.finOtherIncome.findUnique({
    where: { id: incomeId },
    include: { cashAccount: { select: { id: true, name: true, accountId: true } } },
  });
  if (!inc) throw new Error(`Pemasukan ${incomeId} tidak ditemukan`);

  const sudahAda = await findEntryByKey(tx, KEY.otherIncome(incomeId, keySuffix));
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const amount = toMoney(inc.amount);

  const { entry, created } = await postJournal(tx, {
    date: inc.date,
    description: `${inc.incomeNumber} — ${inc.description}`,
    source: "PEMASUKAN_LAIN",
    sourceId: incomeId,
    idempotencyKey: KEY.otherIncome(incomeId, keySuffix),
    userId,
    lines: [
      {
        accountId: inc.cashAccount.accountId,
        debit: amount,
        description: `Masuk ke ${inc.cashAccount.name}`,
        cashAccountId: inc.cashAccount.id,
      },
      { accountId: inc.accountId, credit: amount, description: inc.description },
    ],
  });
  return { posted: true, entry, created };
}
