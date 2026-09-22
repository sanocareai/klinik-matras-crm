// PENYESUAIAN SEMENTARA REKONSILIASI BANK — dipakai saat saldo bank riil
// terkonfirmasi (owner) LEBIH TINGGI dari saldo buku, dan sumber dananya
// BELUM bisa diidentifikasi dari dokumen internal (perlu rekening koran).
//
// Jurnal:
//   Dr <rekening kas/bank yang selisih>     nominal selisih
//       Cr 2-1700 Dana Masuk Belum Teridentifikasi
//
// BUKAN pendapatan, BUKAN akun 3-4100 (itu khusus kalibrasi saldo awal yang
// SUMBERNYA sudah jelas — lihat kalibrasiSaldo.js). Akun 2-1700 adalah
// KEWAJIBAN LANCAR (suspense): uang ini belum tentu milik perusahaan sampai
// sumbernya terbukti lewat rekening koran. SELALU sementara — begitu
// sumbernya terbukti, saldo di 2-1700 direklasifikasi lewat jurnal BARU
// (Dr 2-1700 / Cr akun yang benar), TIDAK PERNAH dengan mengedit/menghapus
// jurnal penyesuaian ini (lihat reverseJournal() di journal.js untuk
// pembatalan resmi bila penyesuaian ini sendiri ternyata keliru).
//
// Idempotensi: SATU penyesuaian per (rekening, tanggal buku) — kunci
// deterministik, bukan per-request seperti Idempotency-Key HTTP biasa,
// supaya menjalankan skrip yang sama dua kali (sengaja atau tidak) TIDAK
// PERNAH menghasilkan jurnal kedua.

import { postJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney } from "../money.js";

export const KEY = {
  rekonsiliasiSementara: (cashAccountId, tanggalBukuISO) =>
    `REKONSILIASI_SEMENTARA:${cashAccountId}:${tanggalBukuISO}`,
};

/**
 * @param {object} tx
 * @param {object} opts
 * @param {string} opts.cashAccountId        FinCashAccount.id yang selisih
 * @param {string} opts.cashAccountLedgerId   FinAccount.id (COA) rekening itu — Dr baris pertama
 * @param {string} opts.cashAccountName       untuk keterangan jurnal
 * @param {Decimal|number|string} opts.amount  nominal selisih (positif — buku < riil)
 * @param {Date|string} opts.tanggalBuku
 * @param {string} opts.keterangan             kalimat lengkap, sudah final (bukan disusun di sini)
 * @param {string} [opts.userId]
 */
export async function postRekonsiliasiSementara(tx, {
  cashAccountId, cashAccountLedgerId, cashAccountName, amount, tanggalBuku, keterangan, userId = null,
}) {
  const tanggalISO = (tanggalBuku instanceof Date ? tanggalBuku : new Date(tanggalBuku)).toISOString().slice(0, 10);
  const key = KEY.rekonsiliasiSementara(cashAccountId, tanggalISO);

  const sudahAda = await findEntryByKey(tx, key);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const akunSuspense = await resolveAccount(tx, SYSTEM_KEYS.DANA_MASUK_BELUM_TERIDENTIFIKASI);
  const nominal = toMoney(amount);
  if (nominal.lessThanOrEqualTo(0)) {
    throw new Error("Nominal penyesuaian sementara harus lebih dari 0");
  }

  const { entry, created } = await postJournal(tx, {
    date: tanggalBuku,
    description: keterangan,
    source: "REKONSILIASI_SEMENTARA",
    sourceId: cashAccountId,
    idempotencyKey: key,
    userId,
    lines: [
      {
        accountId: cashAccountLedgerId,
        debit: nominal,
        description: `Penyesuaian sementara — ${cashAccountName}`,
        cashAccountId,
      },
      {
        accountId: akunSuspense.id,
        credit: nominal,
        description: `Menunggu identifikasi sumber — ${cashAccountName}`,
      },
    ],
  });
  return { posted: true, entry, created };
}
