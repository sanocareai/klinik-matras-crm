// POSTING "TERAPKAN UANG MUKA" — FinPurchaseAdvanceApplication.
//
// Mengotomasi langkah yang SEBELUMNYA manual lewat Jurnal Umum (lihat
// komentar lama di model FinPurchase, schema.prisma): saat DP (FinPurchase
// kategori UANG_MUKA_PEMBELIAN, sudah DIBAYAR) diterapkan mengurangi Utang
// Usaha pembelian TARGET (FinPurchase mode UTANG, status DISETUJUI, supplier
// yang sama), jurnalnya adalah:
//
//   Dr Utang Usaha (2-1100)              — mengurangi utang TARGET
//       Cr Uang Muka Pembelian (1-1500)  — mengurangi saldo DP SUMBER
//
// Validasi bisnis (eligibilitas DP, saldo tersedia, sisa utang, supplier
// sama, row lock) dilakukan di route (financeTransactions.js) SEBELUM
// memanggil fungsi ini — file ini murni menulis jurnalnya, pola yang sama
// dengan posting/purchase.js & posting/supplier.js.

import { postJournal, findEntryByKey, todayBookDateWIB } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";

export const KEY = {
  // idemKey = header Idempotency-Key request (WAJIB, divalidasi di route) —
  // BUKAN id baris FinPurchaseAdvanceApplication. Ini penting: id baris itu
  // baru diketahui SETELAH baris dibuat, sedangkan jurnal harus diposting
  // dengan kunci yang SUDAH stabil SEBELUM baris dibuat, supaya dua request
  // paralel dengan Idempotency-Key yang SAMA dijamin menghasilkan SATU
  // jurnal (postJournal menyelesaikan race lewat SAVEPOINT+unique constraint
  // pada idempotencyKey, lihat journal.js) — memakai id baris yang baru akan
  // membuat tiap percobaan punya kunci beda dan lolos dari deteksi race ini.
  applyAdvance: (idemKey) => `PEMBELIAN_TERAPKAN_DP:${idemKey}`,
};

/**
 * @param {object} tx
 * @param {object} opts
 * @param {string} opts.idemKey            header Idempotency-Key request (dasar kunci jurnal)
 * @param {string} opts.sourceId           id baris FinPurchaseAdvanceApplication (dimensi sourceId jurnal, bukan kunci)
 * @param {object} opts.advancePurchase    { id, purchaseNumber, supplierId }
 * @param {object} opts.targetPurchase     { id, purchaseNumber, supplierId }
 * @param {Decimal|number|string} opts.amount
 * @param {string} [opts.userId]
 * @param {Date} [opts.date]               default hari ini (WIB) — kejadian penerapan terjadi SEKARANG, bukan tanggal dokumen aslinya
 */
export async function postAdvanceApplied(tx, {
  idemKey, sourceId, advancePurchase, targetPurchase, amount, userId = null, date = null,
}) {
  const journalKey = KEY.applyAdvance(idemKey);
  const sudahAda = await findEntryByKey(tx, journalKey);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const akunUtangUsaha = await resolveAccount(tx, SYSTEM_KEYS.UTANG_USAHA);
  const akunUangMuka = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PEMBELIAN);
  const nominal = toMoney(amount);

  const { entry, created } = await postJournal(tx, {
    date: date || todayBookDateWIB(),
    description: `Terapkan uang muka ${advancePurchase.purchaseNumber} ke ${targetPurchase.purchaseNumber}`,
    source: "TERAPKAN_UANG_MUKA",
    sourceId,
    idempotencyKey: journalKey,
    userId,
    lines: [
      {
        accountId: akunUtangUsaha.id,
        debit: nominal,
        description: `Utang ${targetPurchase.purchaseNumber} dikurangi DP ${advancePurchase.purchaseNumber}`,
        supplierId: targetPurchase.supplierId,
      },
      {
        accountId: akunUangMuka.id,
        credit: nominal,
        description: `DP ${advancePurchase.purchaseNumber} diterapkan ke ${targetPurchase.purchaseNumber}`,
        supplierId: advancePurchase.supplierId,
      },
    ],
  });
  return { posted: true, entry, created };
}
