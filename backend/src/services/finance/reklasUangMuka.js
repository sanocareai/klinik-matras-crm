// PENYESUAIAN REKLASIFIKASI UANG MUKA → PIUTANG SETELAH PEMBAYARAN DITOLAK/DIBATALKAN.
//
// Akar masalah (kasus RES-28092026-179, 6–7 Okt 2026): Payment yang dicatat SEBELUM pendapatan order diakui dijurnal Dr Kas / Cr Uang Muka. Saat order diserahkan, pengakuan
// pendapatan MEMINDAHKAN uang muka itu jadi pelunasan piutang (Dr Uang Muka / Cr Piutang, sebesar uang muka yang saat itu ada). Bila Payment tadi kemudian DITOLAK/DIBATALKAN,
// jurnal pembayarannya dibalik (Dr Uang Muka / Cr Kas) — tetapi pemindahan di jurnal pengakuan TIDAK ikut menyesuaikan. Hasilnya: Uang Muka order itu bersaldo DEBIT dan Piutang
// kurang sebesar kontribusi Payment tersebut (Rp1 pada kasus nyata; pada nominal besar jadi piutang yang "hilang" dan uang muka negatif).
//
// Perbaikan: setelah jurnal pembayaran dibalik, per order yang dikredit ke Uang Muka oleh jurnal ASLI Payment itu —
//   jumlah = MIN( saldo DEBIT Uang Muka order sekarang , kontribusi Payment ini ke Uang Muka order itu )
//   jurnal koreksi: Dr Piutang Usaha / Cr Uang Muka Pelanggan sebesar jumlah itu (dimensi order & pelanggan dibawa).
// Hanya bila pendapatan order SUDAH diakui (pengakuan POSTED). Dibatasi kontribusi Payment ini, sehingga Payment lain yang sah (yang uang mukanya ikut dipindahkan) tidak tersentuh;
// dibatasi saldo debit, sehingga tidak pernah menciptakan saldo Uang Muka kredit baru. Jurnal koreksi (bukan overwrite), idempoten per (Payment, order).
//
// Kunci `PEMBAYARAN_ORDER:<paymentId>:RECLAS:<orderId>` = konvensi RECLAS yang SUDAH dipakai Koreksi Pembayaran (B3.7); deteksi "Pembayaran dibatalkan, jurnal masih aktif"
// (rekonSnapshot) dan blokir koreksi (koreksiPembayaran) sudah mengecualikan pola ini.
import { postJournal, todayBookDateWIB, STATUS_DIHITUNG } from "./journal.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { toMoney, sumMoney, minMoney, ZERO, moneyToNumber } from "./money.js";
import { pendapatanSudahDiakui, KEY } from "./posting/orderRevenue.js";

export const kunciReklas = (paymentId, orderId) => `${KEY.payment(paymentId)}:RECLAS:${orderId}`;

/** Kontribusi jurnal ASLI sebuah Payment ke Uang Muka, per order: Σ(kredit − debit) baris Uang Muka berdimensi order. */
function kontribusiPerOrder(entryAsli, akunUangMukaId) {
  const per = new Map();
  for (const l of entryAsli?.lines ?? []) {
    if (l.accountId !== akunUangMukaId || !l.orderId) continue;
    per.set(l.orderId, (per.get(l.orderId) ?? ZERO).plus(toMoney(l.credit ?? 0)).minus(toMoney(l.debit ?? 0)));
  }
  return [...per.entries()].filter(([, v]) => v.greaterThan(0)).sort(([a], [b]) => (a < b ? -1 : 1));
}

/**
 * Hitung (dan, kecuali `hanyaHitung`, posting) penyesuaian untuk satu Payment yang jurnalnya SUDAH dibalik.
 * `entryAsli` = jurnal pembayaran asli beserta `lines` (status apa pun: POSTED sesaat sebelum dibalik, atau REVERSED).
 * Mengembalikan [{ orderId, jumlah, dibuat, entryNumber? }] — hanya order yang memerlukan penyesuaian.
 */
export async function sesuaikanReklasUangMuka(tx, { paymentId, entryAsli, userId = null, date = null, hanyaHitung = false }) {
  const um = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN);
  const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
  const hasil = [];
  for (const [orderId, kontribusi] of kontribusiPerOrder(entryAsli, um.id)) {
    if (!(await pendapatanSudahDiakui(tx, orderId))) continue; // belum diakui → tidak ada pemindahan yang perlu disesuaikan

    const baris = await tx.finJournalLine.findMany({
      where: { accountId: um.id, orderId, entry: { status: { in: STATUS_DIHITUNG } } },
      select: { debit: true, credit: true },
    });
    const saldoDebit = sumMoney(baris.map((b) => b.debit)).minus(sumMoney(baris.map((b) => b.credit)));
    if (!saldoDebit.greaterThan(0)) continue; // Uang Muka tidak bersaldo debit → tidak ada kelebihan pemindahan
    const jumlah = minMoney(saldoDebit, kontribusi);
    if (!jumlah.greaterThan(0)) continue;

    const kunci = kunciReklas(paymentId, orderId);
    const sudah = await tx.finJournalEntry.findUnique({ where: { idempotencyKey: kunci }, select: { entryNumber: true } });
    if (sudah) continue; // sudah pernah disesuaikan untuk Payment & order ini (replay)
    if (hanyaHitung) { hasil.push({ orderId, jumlah: moneyToNumber(jumlah), dibuat: false }); continue; }

    const ord = await tx.order.findUnique({ where: { id: orderId }, select: { orderNumber: true, customerId: true } });
    const { entry, created } = await postJournal(tx, {
      date: date ?? todayBookDateWIB(),
      description: `Penyesuaian Uang Muka → Piutang setelah pembayaran dibatalkan — ${ord?.orderNumber ?? orderId}: pemindahan uang muka saat pengakuan pendapatan tidak lagi didukung Payment yang dibatalkan`,
      source: "PEMBAYARAN_ORDER",
      sourceId: paymentId,
      idempotencyKey: kunci,
      userId,
      lines: [
        { accountId: piutang.id, debit: jumlah, orderId, customerId: ord?.customerId ?? null, description: "Piutang dipulihkan — pembayaran dibatalkan" },
        { accountId: um.id, credit: jumlah, orderId, customerId: ord?.customerId ?? null, description: "Uang muka disesuaikan — pembayaran dibatalkan" },
      ],
    });
    hasil.push({ orderId, jumlah: moneyToNumber(jumlah), dibuat: created, entryNumber: entry.entryNumber });
  }
  return hasil;
}
