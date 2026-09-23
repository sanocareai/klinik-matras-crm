// POSTING PEMBAYARAN INSENTIF DRIVER — IncentivePayout -> ledger Finance.
//
//   Bayar:  Dr Beban Insentif Driver (6-1180)   Cr Kas/Bank (akun COA rekening yang dipilih)
//   Void:   jurnal BALIK lewat reverseJournal() — jurnal asli tidak diedit/dihapus
//
// Dipanggil DI DALAM prisma.$transaction milik route payout, jadi baris
// payout + jurnalnya atomik: posting gagal = seluruh pembayaran batal.
// Sengaja TIDAK lewat FinExpense/ExpenseSubmission: snapshot insentif
// sudah APPROVED (approval-nya sendiri), membuat pengeluaran otomatis
// disetujui hanya untuk numpang posting akan MELEWATI approval Pengajuan
// Biaya. Yang dipakai murni ledger yang sama: postJournal/reverseJournal.

import { postJournal, reverseJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS, AccountError } from "../accounts.js";
import { toMoney } from "../money.js";

export const KEY = {
  payout: (payoutId) => `INSENTIF_PAYOUT:${payoutId}`,
};

/** Rekening kas/bank sumber dana wajib ada & aktif (dan akun COA-nya bisa diposting). */
export async function resolveCashAccountForPayout(tx, cashAccountId) {
  if (!cashAccountId) throw new AccountError("Akun sumber dana (Kas/Bank) wajib dipilih", 400);
  const cash = await tx.finCashAccount.findUnique({
    where: { id: cashAccountId },
    include: { account: { select: { id: true, code: true, name: true, isPostable: true, active: true } } },
  });
  if (!cash) throw new AccountError("Akun sumber dana tidak ditemukan", 400);
  if (!cash.active) throw new AccountError(`Akun sumber dana "${cash.name}" nonaktif — pilih rekening lain`, 409);
  if (!cash.account.active || !cash.account.isPostable) {
    throw new AccountError(`Akun COA ${cash.account.code} milik "${cash.name}" nonaktif atau bukan akun detail`, 409);
  }
  return cash;
}

/**
 * Jurnal pengakuan pembayaran insentif. Idempoten lewat idempotencyKey
 * jurnal (satu payout = satu jurnal); @unique journalEntryId di payout
 * menjaga sisi sebaliknya.
 */
export async function postIncentivePayout(tx, { payout, cashAccount, personName, userId = null }) {
  const amount = toMoney(payout.amount, { field: "Nominal insentif" });
  const beban = await resolveAccount(tx, SYSTEM_KEYS.BEBAN_INSENTIF_DRIVER);

  const existing = await findEntryByKey(tx, KEY.payout(payout.id));
  if (existing) return { entry: existing, created: false };

  return postJournal(tx, {
    date: payout.paidAt,
    description: `Pembayaran insentif driver — ${personName || payout.userId}`,
    source: "INSENTIF_DRIVER",
    sourceId: payout.id,
    idempotencyKey: KEY.payout(payout.id),
    userId,
    lines: [
      { accountId: beban.id, debit: amount, description: `Insentif ${personName || payout.userId}` },
      {
        accountId: cashAccount.accountId,
        credit: amount,
        description: `Uang keluar — ${cashAccount.name}`,
        cashAccountId: cashAccount.id,
      },
    ],
  });
}

/** Jurnal balik saat payout di-void. Jurnal asli tidak disentuh selain status REVERSED (oleh reverseJournal). */
export async function reverseIncentivePayout(tx, { journalEntryId, reason, userId = null }) {
  return reverseJournal(tx, { entryId: journalEntryId, reason: `Void pembayaran insentif — ${reason}`, userId });
}
