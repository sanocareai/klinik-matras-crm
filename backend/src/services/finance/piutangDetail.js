// DETAIL SATU ORDER PIUTANG untuk drawer layar Piutang (Okt 2026) — hanya MEMBACA. Menggabungkan sumber yang sudah ada tanpa rumus baru:
//   • tagihan & umur  : baris umurPiutang() untuk order yang sama (angka SAMA dengan daftar),
//   • invoice         : tabel Invoice (nomor, jatuh tempo, tahap),
//   • pembayaran      : Payment aktif + yang dibatalkan (ledger append-only), beserta status verifikasi,
//   • jurnal          : baris jurnal akun Piutang Usaha untuk order ini (POSTED/REVERSED), urut tanggal,
//   • riwayat         : ActivityEvent entitas order (kalimat dari formatActivitySentence; metadata mentah TIDAK dikirim).
// Izin: finance:read (sama dengan daftar piutang). Tidak ada nomor rekening/foto bukti mentah di sini.
import { moneyToNumber } from "./money.js";
import { umurPiutang } from "./reports.js";
import { formatActivitySentence } from "../../lib/activityLog.js";

const BATAS_JURNAL = 60;
const BATAS_RIWAYAT = 30;

export async function detailPiutangOrder(db, { orderId, to }) {
  const order = await db.order.findUnique({
    where: { id: orderId },
    select: {
      id: true, orderNumber: true, value: true, status: true, paymentStatus: true, createdAt: true,
      customer: { select: { id: true, name: true, assignedSales: { select: { name: true } } } },
      invoice: { select: { invoiceNumber: true, dueDate: true, lifecycleStatus: true, sentAt: true } },
    },
  });
  if (!order) return null;

  const ar = await umurPiutang(db, { to });
  const baris = ar.baris.find((b) => b.orderId === orderId) ?? null;

  const [payments, akun] = await Promise.all([
    db.payment.findMany({
      where: { orderId }, orderBy: { createdAt: "asc" },
      select: {
        id: true, amount: true, method: true, createdAt: true, cancelledAt: true, cancelReason: true, referenceNumber: true,
        recordedBy: { select: { name: true } }, cashAccount: { select: { name: true } }, verifications: { select: { id: true } },
      },
    }),
    db.finAccount.findUnique({ where: { systemKey: "PIUTANG_USAHA" }, select: { id: true } }),
  ]);

  const jurnal = akun ? await db.finJournalLine.findMany({
    where: { orderId, accountId: akun.id },
    orderBy: [{ entry: { date: "asc" } }, { lineNo: "asc" }],
    take: BATAS_JURNAL,
    select: { debit: true, credit: true, description: true, entry: { select: { entryNumber: true, date: true, source: true, status: true, description: true } } },
  }) : [];

  const events = await db.activityEvent.findMany({
    where: { entityType: "order", entityId: orderId }, orderBy: { createdAt: "desc" }, take: BATAS_RIWAYAT,
    select: { eventType: true, metadata: true, createdAt: true, actorId: true },
  });

  return {
    order: {
      id: order.id, nomor: order.orderNumber, pelanggan: order.customer?.name ?? "—", sales: order.customer?.assignedSales?.name ?? null,
      status: order.status, statusBayarCrm: order.paymentStatus, tanggalOrder: order.createdAt,
    },
    // Angka tagihan = baris daftar (null bila order tidak (lagi) bersaldo piutang positif).
    tagihan: baris && {
      tagihanDiakui: baris.tagihanDiakui, sudahDilunasi: baris.sudahDilunasi, sisaTagihan: baris.sisaTagihan, statusBayar: baris.statusBayar,
      dueDate: baris.dueDate, sumberJatuhTempo: baris.sumberJatuhTempo, hariLewat: baris.hariLewat, ember: baris.ember,
    },
    invoice: order.invoice && { nomor: order.invoice.invoiceNumber, jatuhTempo: order.invoice.dueDate, tahap: order.invoice.lifecycleStatus, terkirimPada: order.invoice.sentAt },
    pembayaran: payments.map((p) => ({
      id: p.id, jumlah: p.amount, metode: p.method, tanggal: p.createdAt, dibatalkan: Boolean(p.cancelledAt), alasanBatal: p.cancelReason ?? null,
      referensi: p.referenceNumber ?? null, dicatatOleh: p.recordedBy?.name ?? null, rekening: p.cashAccount?.name ?? null, terverifikasi: p.verifications.length > 0,
    })),
    jurnal: jurnal.map((l) => ({
      nomor: l.entry.entryNumber, tanggal: l.entry.date, sumber: l.entry.source, status: l.entry.status, keterangan: l.description || l.entry.description || "",
      debit: moneyToNumber(l.debit), kredit: moneyToNumber(l.credit),
    })),
    riwayat: events.map((e) => ({ waktu: e.createdAt, kejadian: e.eventType, kalimat: formatActivitySentence(e) || e.eventType })),
    terpotong: { jurnal: jurnal.length >= BATAS_JURNAL, riwayat: events.length >= BATAS_RIWAYAT },
  };
}
