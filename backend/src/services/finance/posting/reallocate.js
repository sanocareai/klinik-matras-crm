// POSTING ULANG setelah ALOKASI sebuah pembayaran diubah.
//
// KENAPA FILE TERPISAH, bukan memanggil postPaymentReceived() lagi.
// Idempotensi jurnal dikunci `idempotencyKey` = "PEMBAYARAN_ORDER:<id>",
// dan kunci itu SUDAH TERPAKAI oleh jurnal pertama (yang baru saja dibalik).
// Memanggil postPaymentReceived() lagi akan menemukan kunci itu dan
// mengembalikan jurnal lama apa adanya — hasilnya: jurnal penerimaan sudah
// dibalik, tapi penggantinya tidak pernah lahir, dan uang yang benar-benar
// diterima hilang dari buku besar.
//
// Jadi jurnal pengganti dibuat dengan kunci BERSERI
// ("PEMBAYARAN_ORDER:<id>:REALOKASI:<n>") — tetap idempoten per percobaan
// realokasi, tetap bisa ditelusuri ke pembayaran yang sama lewat
// source/sourceId, dan tidak pernah menimpa jurnal mana pun.

import { postJournal, findEntryByKey, STATUS_DIHITUNG } from "../journal.js";
import { resolveAccount, SYSTEM_KEYS } from "../accounts.js";
import { resolveCashAccountForPayment } from "../settings.js";
import { toMoney } from "../money.js";

export async function bukukanUlangAlokasi(tx, { paymentId, userId = null }) {
  const payment = await tx.payment.findUnique({
    where: { id: paymentId },
    select: {
      id: true, amount: true, method: true, cashAccountId: true, createdAt: true, cancelledAt: true, orderId: true,
      finAllocations: { select: { orderId: true, amount: true } },
      order: {
        select: {
          id: true, orderNumber: true, customerId: true,
          customer: { select: { name: true } },
        },
      },
    },
  });
  if (!payment || payment.cancelledAt) return { posted: false, reason: "tidak_relevan" };

  // Nomor urut realokasi = berapa kali jurnal untuk pembayaran ini sudah
  // pernah dibuat. Dihitung dari jurnal yang ADA, bukan dari kolom counter
  // baru yang harus dirawat.
  const jumlahSebelumnya = await tx.finJournalEntry.count({
    where: { source: "PEMBAYARAN_ORDER", sourceId: paymentId },
  });
  const key = `PEMBAYARAN_ORDER:${paymentId}:REALOKASI:${jumlahSebelumnya}`;

  const sudahAda = await findEntryByKey(tx, key);
  if (sudahAda) return { posted: true, entry: sudahAda, created: false };

  const cashAccount = await resolveCashAccountForPayment(tx, payment);
  if (!cashAccount) return { posted: false, reason: "rekening_belum_dipetakan" };

  const piutang = await resolveAccount(tx, SYSTEM_KEYS.PIUTANG_USAHA);
  const uangMuka = await resolveAccount(tx, SYSTEM_KEYS.UANG_MUKA_PELANGGAN);

  const alokasi = payment.finAllocations.length > 0
    ? payment.finAllocations.map((a) => ({ orderId: a.orderId, amount: toMoney(a.amount) }))
    : [{ orderId: payment.orderId, amount: toMoney(payment.amount) }];

  const lines = [{
    accountId: cashAccount.accountId,
    debit: toMoney(payment.amount),
    description: `Penerimaan ${payment.method} — ${cashAccount.name} (alokasi diperbarui)`,
    cashAccountId: cashAccount.id,
    orderId: payment.orderId,
    customerId: payment.order?.customerId || null,
  }];

  for (const a of alokasi) {
    // Sama seperti posting pertama: order yang pendapatannya SUDAH diakui
    // menerima pelunasan piutang, yang belum menerima uang muka.
    const pengakuan = await findEntryByKey(tx, `PENGAKUAN_PENDAPATAN:${a.orderId}`);
    const diakui = Boolean(pengakuan && pengakuan.status === "POSTED");
    const order = a.orderId === payment.orderId
      ? payment.order
      : await tx.order.findUnique({ where: { id: a.orderId }, select: { orderNumber: true, customerId: true } });

    lines.push({
      accountId: diakui ? piutang.id : uangMuka.id,
      credit: a.amount,
      description: diakui
        ? `Pelunasan piutang order ${order?.orderNumber || a.orderId}`
        : `Uang muka pelanggan — order ${order?.orderNumber || a.orderId}`,
      orderId: a.orderId,
      customerId: order?.customerId || null,
    });
  }

  const { entry, created } = await postJournal(tx, {
    date: new Date(Date.UTC(
      payment.createdAt.getUTCFullYear(), payment.createdAt.getUTCMonth(), payment.createdAt.getUTCDate()
    )),
    description:
      `Penerimaan pembayaran order ${payment.order?.orderNumber || payment.orderId} (alokasi diperbarui)` +
      (payment.order?.customer?.name ? ` — ${payment.order.customer.name}` : ""),
    source: "PEMBAYARAN_ORDER",
    sourceId: paymentId,
    idempotencyKey: key,
    lines,
    userId,
  });
  return { posted: true, entry, created };
}

export { STATUS_DIHITUNG };
