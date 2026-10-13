// POSTING NOTA KREDIT / KERINGANAN ORDER MANDIRI (Okt 2026).
//
//   Dr 4-2100 Retur & Potongan Penjualan   (kontra pendapatan — pendapatan bruto periode yang sudah dibaca tidak diubah surut)
//       Cr 1-1300 Piutang Usaha            (mengurangi apa yang masih ditagihkan ke pelanggan)
//
// Hanya untuk nominal ≤ sisa piutang order di buku besar. Pelanggan yang SUDAH membayar penuh lalu mendapat potongan memakai refund (uang dikembalikan, jurnal refund sudah
// Dr Retur & Potongan / Cr Kas-Bank) dan nota kredit TERTAUT refund itu (tanpa jurnal) — jadi Retur & Potongan tidak pernah didebet dua kali untuk potongan yang sama.
import { postJournal, findEntryByKey } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { toMoney, sumMoney, ZERO } from "../money.js";
import { STATUS_DIHITUNG } from "../journal.js";

export const KEY = {
  // Dasar kunci = header Idempotency-Key (bukan id baris) — jurnal harus punya kunci stabil SEBELUM baris dibuat (dua request kembar → satu jurnal).
  notaKredit: (idemKey) => `NOTA_KREDIT_ORDER:${idemKey}`,
};

/** Saldo piutang order menurut BUKU BESAR (debit − kredit akun Piutang Usaha pada baris ber-order ini; jurnal POSTED + REVERSED = yang dihitung). Bisa negatif (kelebihan). */
export async function saldoPiutangOrder(tx, orderId) {
  const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
  const baris = await tx.finJournalLine.findMany({
    where: { accountId: piutang.id, orderId, entry: { status: { in: STATUS_DIHITUNG } } },
    select: { debit: true, credit: true },
  });
  if (baris.length === 0) return ZERO;
  return sumMoney(baris.map((b) => b.debit)).minus(sumMoney(baris.map((b) => b.credit)));
}

export async function postNotaKreditMandiri(tx, { idemKey, sourceId, creditNumber, order, amount, reason, userId = null, date }) {
  const key = KEY.notaKredit(idemKey);
  const sudahAda = await findEntryByKey(tx, key);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };
  const retur = await resolveAccount(tx, SYSTEM_KEYS.RETUR_PENJUALAN);
  const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
  const nominal = toMoney(amount);
  const { entry, created } = await postJournal(tx, {
    date,
    description: `Nota kredit ${creditNumber} — order ${order.orderNumber || order.id}: ${reason}`,
    source: "NOTA_KREDIT_ORDER",
    sourceId,
    idempotencyKey: key,
    userId,
    lines: [
      { accountId: retur.id, debit: nominal, description: "Potongan/keringanan atas tagihan", orderId: order.id, customerId: order.customerId ?? null },
      { accountId: piutang.id, credit: nominal, description: `Piutang order ${order.orderNumber || order.id} dikurangi nota kredit`, orderId: order.id, customerId: order.customerId ?? null },
    ],
  });
  return { posted: true, entry, created };
}
