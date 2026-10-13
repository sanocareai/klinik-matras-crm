// Potongan Nota Kredit MANDIRI yang ikut mengkredit akun Piutang Usaha per order, menurut POSISI tanggal (Okt 2026).
//
// Nota mandiri menjurnal Dr Retur & Potongan / Cr Piutang Usaha. Di laporan Piutang, sisi kredit piutang berarti "sudah dilunasi" — padahal ini BUKAN uang diterima.
// Helper ini mengembalikan jumlah potongan itu supaya laporan memisahkannya dari pembayaran (sisa piutang tidak berubah). Nota tertaut-refund tidak menjurnal → tidak masuk.
// Posisi tanggal: nota dihitung bila tanggal nota <= posisi DAN (masih aktif ATAU baru dibatalkan SESUDAH posisi — jurnal pembaliknya bertanggal > posisi).
import { toMoney, sumMoney, ZERO } from "./money.js";

export async function potonganNotaKreditPiutang(db, orderIds, posisi) {
  const hasil = new Map();
  const ids = [...new Set((orderIds ?? []).filter(Boolean))];
  if (ids.length === 0) return hasil;
  const rows = await db.finOrderCredit.findMany({
    where: { orderId: { in: ids }, journalId: { not: null }, creditDate: { lte: posisi } },
    select: { orderId: true, amount: true, status: true, reversalJournal: { select: { date: true } } },
  });
  const per = new Map();
  for (const r of rows) {
    const dibalikSebelumPosisi = r.status === "DIBATALKAN" && (!r.reversalJournal?.date || r.reversalJournal.date <= posisi);
    if (dibalikSebelumPosisi) continue;
    (per.get(r.orderId) ?? per.set(r.orderId, []).get(r.orderId)).push(toMoney(r.amount));
  }
  for (const [orderId, arr] of per) hasil.set(orderId, arr.length ? sumMoney(arr) : ZERO);
  return hasil;
}
