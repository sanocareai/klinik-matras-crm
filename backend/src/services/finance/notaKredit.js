// NOTA KREDIT / KERINGANAN ORDER (Okt 2026) — dokumen yang MENGURANGI TAGIHAN order. Terpisah dari refund.
//
// Definisi (satu tempat; layar & laporan memakai ringkasanStatusBayar di bawah):
//   Tagihan kotor    = Order.value + ongkir yang ditagih
//   Nota kredit      = Σ FinOrderCredit AKTIF (potongan harga / keringanan yang sah)
//   Tagihan bersih   = Tagihan kotor − Nota kredit
//   Diterima         = Σ Payment aktif yang dihitung (gerbang verifikasi + alokasi)
//   Refund           = Σ Refund DISETUJUI (uang yang benar-benar keluar kembali)
//   Pembayaran bersih= Diterima − Refund (tidak negatif)
//   Sisa             = Tagihan bersih − Pembayaran bersih;  LUNAS ⇔ Sisa ≤ 0 (dan Tagihan bersih > 0)
//
// Kapan memakai apa:
//   A. KELEBIHAN BAYAR (tagihan 4,0 jt, Payment 4,2 jt) → refund 200 rb: pembayaran bersih 4,0 jt → tetap LUNAS. Tidak perlu nota.
//   B. POTONGAN/KERINGANAN belum terbayar (tagihan 4,0 jt, Payment 3,8 jt, Owner mengurangi 200 rb) → Nota Kredit MANDIRI 200 rb: Dr Retur & Potongan / Cr Piutang. Tagihan bersih 3,8 jt → LUNAS.
//   C. REFUND BIASA (Payment belum menutup tagihan, 200 rb dikembalikan) → tanpa nota: tetap belum lunas.
//   D. POTONGAN SETELAH LUNAS (tagihan 4,3 jt, Payment 4,3 jt, 200 rb dikembalikan karena item tak jadi) → refund sudah terjurnal (Dr Retur & Potongan / Cr Kas-Bank).
//      Nota Kredit YANG DITAUTKAN ke refund itu mengakui bahwa refund tersebut = potongan atas tagihan: TANPA jurnal baru (jurnal refund sudah mengurangi pendapatan),
//      tagihan bersih 4,1 jt = pembayaran bersih 4,1 jt → LUNAS. Jurnal lama tidak dihapus/diubah.
//
// Aturan keras: tidak pernah mengurangi dua kali — nota tertaut-refund tidak menjurnal; nota mandiri dibatasi sisa piutang order di buku besar (tidak melewati apa yang masih ditagihkan).
// Order yang belum diserahkan (pendapatan belum diakui) ditolak: harga diubah lewat item order. Order Penjualan Karyawan ditolak: PKR punya jurnal & koreksi sendiri.
import { createHash, randomUUID } from "node:crypto";
import { lockRowForUpdate } from "../inventoryLedger.js";
import { toMoney, sumMoney, moneyToNumber, minMoney, ZERO } from "./money.js";
import { generateDocumentNumber, reverseJournal, todayBookDateWIB, toBookDate, STATUS_DIHITUNG } from "./journal.js";
import { postNotaKreditMandiri, saldoPiutangOrder } from "./posting/notaKredit.js";
import { pendapatanSudahDiakui } from "./posting/orderRevenue.js";
import { resolveAccount, SYSTEM_KEYS } from "./accounts.js";
import { paidForOrder } from "./allocation.js";
import { getVerificationGate } from "./settings.js";
import { PILIH_TAGIHAN, tagihanKotorOrder, kreditOrder, tagihanOrder } from "./tagihanOrder.js";
import { recomputeOrderPaymentStatus } from "../paymentLedger.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../../lib/activityLog.js";

export class NotaKreditError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.statusCode = statusCode; if (code) this.code = code; if (extra) this.extra = extra; }
}
const gagal = (m, s = 400, c = null, x = null) => new NotaKreditError(m, s, c, x);

export const JENIS_NOTA = Object.freeze(["POTONGAN_HARGA", "KERINGANAN"]);
const MIN_ALASAN = 5;
const uang = (d) => moneyToNumber(d);

/**
 * Token REVISI order (optimistis): berubah bila nilai/ongkir, pembayaran, refund, nota kredit, atau saldo piutang order berubah.
 * Layar membawa token ini dari pratinjau; server menolak (409 REVISI_BERUBAH) bila data sudah bergeser sejak layar dibuka.
 */
export async function revisiOrder(db, orderId) {
  const [o, pay, batal, ref, kred] = await Promise.all([
    db.order.findUnique({ where: { id: orderId }, select: { updatedAt: true, value: true, ongkir: true, status: true, paymentStatus: true, paidAt: true } }),
    db.payment.aggregate({ where: { orderId, cancelledAt: null }, _count: true, _sum: { amount: true } }),
    db.payment.count({ where: { orderId, cancelledAt: { not: null } } }),
    db.finRefund.aggregate({ where: { orderId, status: "DISETUJUI" }, _count: true, _sum: { amount: true } }),
    db.finOrderCredit.aggregate({ where: { orderId, status: "AKTIF" }, _count: true, _sum: { amount: true } }),
  ]);
  if (!o) return null;
  const piutang = await saldoPiutangOrder(db, orderId);
  const bahan = JSON.stringify([o.updatedAt?.toISOString(), o.value, o.ongkir ?? null, o.status, o.paymentStatus, o.paidAt?.toISOString() ?? null, pay._count, String(pay._sum.amount ?? 0), batal, ref._count, String(ref._sum.amount ?? 0), kred._count, String(kred._sum.amount ?? 0), piutang.toFixed(2)]);
  return createHash("sha256").update(bahan).digest("hex").slice(0, 24);
}

/** Ringkasan status bayar menurut SERVER — dasar layar, audit sebelum/sesudah, dan laporan. Murni baca. */
export async function ringkasanStatusBayar(db, orderId) {
  const order = await db.order.findUnique({ where: { id: orderId }, select: { ...PILIH_TAGIHAN, orderNumber: true, paymentStatus: true, paidAt: true, penjualanKaryawanId: true, customer: { select: { name: true } } } });
  if (!order) return null;
  const gate = await getVerificationGate(db);
  const bersihTerima = await paidForOrder(db, orderId, gate); // Σ Payment dihitung − refund disetujui (tidak negatif)
  const refund = await db.finRefund.aggregate({ where: { orderId, status: "DISETUJUI" }, _sum: { amount: true } });
  const refundDisetujui = toMoney(refund._sum.amount ?? 0);
  const diterima = bersihTerima.plus(refundDisetujui); // bila paidForOrder terpotong di 0, diterima bisa < Σ payment; cukup untuk tampilan
  const kotor = tagihanKotorOrder(order);
  const kredit = kreditOrder(order);
  const bersih = tagihanOrder(order);
  const sisa = Math.max(0, bersih - Math.round(Number(bersihTerima.toFixed(0))));
  const statusServer = bersihTerima.lessThanOrEqualTo(0) ? "BELUM_BAYAR" : (Number(order.value) > 0 && Math.round(Number(bersihTerima.toFixed(0))) >= bersih ? "LUNAS" : "DP");
  return {
    orderId, nomor: order.orderNumber, pelanggan: order.customer?.name ?? null,
    nilaiOrder: Number(order.value) || 0, tagihanKotor: kotor, notaKredit: kredit, tagihanBersih: bersih,
    diterima: uang(diterima), refundDisetujui: uang(refundDisetujui), pembayaranBersih: uang(bersihTerima), sisa,
    statusServer, statusTersimpan: order.paymentStatus, paidAt: order.paidAt,
    cocok: statusServer === order.paymentStatus,
    revisi: await revisiOrder(db, orderId),
  };
}

/** Refund DISETUJUI pada order ini beserta kelayakannya sebagai sumber nota kredit tertaut (refund = potongan atas tagihan yang sudah diakui, belum tertaut nota aktif). */
export async function kandidatRefund(db, orderId) {
  const refunds = await db.finRefund.findMany({
    where: { orderId, status: "DISETUJUI" }, orderBy: { createdAt: "asc" },
    select: { id: true, refundNumber: true, amount: true, date: true, reason: true, transferFeeAmount: true, orderCredits: { where: { status: "AKTIF" }, select: { creditNumber: true } } },
  });
  const hasil = [];
  for (const r of refunds) {
    const retur = await debitReturRefund(db, r.id, orderId);
    const tertaut = r.orderCredits[0]?.creditNumber ?? null;
    const batas = minMoney(toMoney(r.amount), retur);
    hasil.push({
      id: r.id, nomor: r.refundNumber, tanggal: r.date, nominal: uang(r.amount), biayaAdmin: uang(r.transferFeeAmount ?? 0), alasan: r.reason,
      potongan: uang(batas), tertautNota: tertaut,
      layak: !tertaut && batas.greaterThan(0),
      alasanTidakLayak: tertaut ? `Sudah tertaut ke nota ${tertaut}` : batas.greaterThan(0) ? null : "Refund ini mengembalikan kelebihan bayar / uang muka, bukan potongan atas tagihan",
    });
  }
  return hasil;
}

export async function daftarNotaKredit(db, orderId) {
  const rows = await db.finOrderCredit.findMany({
    where: { orderId }, orderBy: { createdAt: "asc" },
    include: { refund: { select: { refundNumber: true } }, journal: { select: { entryNumber: true } }, reversalJournal: { select: { entryNumber: true } }, createdBy: { select: { name: true } }, cancelledBy: { select: { name: true } } },
  });
  return rows.map((c) => ({
    id: c.id, nomor: c.creditNumber, jumlah: uang(c.amount), jenis: c.kind, sumber: c.refundId ? "TERTAUT_REFUND" : "MANDIRI", tanggal: c.creditDate, alasan: c.reason, status: c.status,
    keteranganJurnal: c.journal ? null : "Tanpa jurnal — sudah dicatat oleh refund",
    refund: c.refund?.refundNumber ?? null, jurnal: c.journal?.entryNumber ?? null, jurnalBalik: c.reversalJournal?.entryNumber ?? null,
    dibuatOleh: c.createdBy?.name ?? null, dibuatPada: c.createdAt, dibatalkanOleh: c.cancelledBy?.name ?? null, dibatalkanPada: c.cancelledAt, alasanBatal: c.cancelReason,
  }));
}

/** Debit Retur & Potongan yang sudah dijurnalkan refund ini (jurnal AKTIF) — dasar bahwa refund ini memang potongan atas tagihan. */
async function debitReturRefund(tx, refundId, orderId) {
  const retur = await resolveAccount(tx, SYSTEM_KEYS.RETUR_PENJUALAN);
  const baris = await tx.finJournalLine.findMany({
    where: { accountId: retur.id, orderId, entry: { source: "REFUND", sourceId: refundId, status: "POSTED" } },
    select: { debit: true, credit: true },
  });
  return baris.length === 0 ? ZERO : sumMoney(baris.map((b) => toMoney(b.debit).minus(toMoney(b.credit))));
}

async function snapshot(tx, orderId) {
  const r = await ringkasanStatusBayar(tx, orderId);
  return r && { tagihanBersih: r.tagihanBersih, notaKredit: r.notaKredit, pembayaranBersih: r.pembayaranBersih, sisa: r.sisa, status: r.statusTersimpan, paidAt: r.paidAt };
}

/** Sentinel pembatal transaksi untuk pratinjau: seluruh tulisan dibatalkan, hasilnya dibawa keluar lewat error ini. */
class PratinjauSelesai extends Error { constructor(hasil) { super("pratinjau"); this.hasil = hasil; } }

function tanggalNota(tx0, date) {
  if (date === undefined || date === null || date === "") return todayBookDateWIB();
  let d;
  try { d = toBookDate(date); } catch { throw gagal("Tanggal nota tidak valid (format YYYY-MM-DD)", 400, "TANGGAL_TIDAK_VALID"); }
  if (d.getTime() > todayBookDateWIB().getTime()) throw gagal("Tanggal nota tidak boleh di masa depan", 400, "TANGGAL_MASA_DEPAN");
  return d;
}

/**
 * Buat Nota Kredit. Replay (Idempotency-Key sama + isi sama) = dokumen yang sama; isi beda = 422. Paralel diserialkan oleh kunci baris order.
 * `refundId` null → nota MANDIRI (menjurnal, ≤ sisa piutang order). `refundId` terisi → nota TERTAUT refund (tanpa jurnal).
 */
export async function buatNotaKredit(tx, { orderId, amount, reason, kind = "POTONGAN_HARGA", refundId = null, date = null, expectedRevisi = null, idempotencyKey, userId }) {
  if (!idempotencyKey) throw gagal("Header Idempotency-Key wajib", 428);
  const alasan = String(reason ?? "").trim();
  if (alasan.length < MIN_ALASAN) throw gagal(`Alasan wajib diisi (minimal ${MIN_ALASAN} karakter)`, 400, "ALASAN_WAJIB");
  if (alasan.length > 500) throw gagal("Alasan terlalu panjang (maksimal 500 karakter)", 400);
  if (!JENIS_NOTA.includes(kind)) throw gagal(`Jenis nota tidak dikenal. Pilihan: ${JENIS_NOTA.join(", ")}`, 400, "JENIS_TIDAK_VALID");
  let nominal;
  try { nominal = toMoney(amount, { field: "Nominal nota kredit" }); } catch { throw gagal("Nominal nota kredit bukan angka yang sah"); }
  if (nominal.lessThanOrEqualTo(0)) throw gagal("Nominal nota kredit harus lebih dari 0");

  await lockRowForUpdate(tx, '"Order"', orderId, { cast: null });

  const ada = await tx.finOrderCredit.findUnique({ where: { idempotencyKey: String(idempotencyKey) } });
  if (ada) {
    if (ada.orderId !== orderId || !toMoney(ada.amount).equals(nominal) || (ada.refundId ?? null) !== (refundId ?? null)) {
      throw gagal("Idempotency-Key ini sudah dipakai untuk nota kredit lain (isi berbeda)", 422, "IDEMPOTENCY_BEDA_ISI");
    }
    return { credit: ada, replay: true };
  }

  const order = await tx.order.findUnique({ where: { id: orderId }, select: { ...PILIH_TAGIHAN, orderNumber: true, customerId: true, paymentStatus: true, penjualanKaryawanId: true } });
  if (!order) throw gagal("Order tidak ditemukan", 404);
  // Revisi optimistis: layar yang dibuka sebelum ada pembayaran/refund/nota baru tidak boleh menyimpan berdasarkan angka basi.
  if (!expectedRevisi) throw gagal("Token revisi wajib — muat ulang pratinjau nota kredit", 400, "REVISI_WAJIB");
  if (String(expectedRevisi) !== (await revisiOrder(tx, orderId))) {
    throw gagal("Data order berubah sejak layar dibuka (pembayaran, refund, atau nota kredit lain). Muat ulang pratinjau lalu coba lagi.", 409, "REVISI_BERUBAH");
  }
  if (order.penjualanKaryawanId) throw gagal("Order Penjualan Karyawan punya jurnal & koreksi sendiri — gunakan Koreksi Item pada PKR, bukan nota kredit.", 409, "ORDER_PKR");
  if (order.status === "CANCELLED") throw gagal("Order sudah dibatalkan", 409, "ORDER_BATAL");
  if (!(await pendapatanSudahDiakui(tx, orderId))) {
    throw gagal("Pendapatan order ini belum diakui (order belum diserahkan). Ubah harga lewat item order — nota kredit hanya untuk order yang sudah diakui.", 409, "PENDAPATAN_BELUM_DIAKUI");
  }
  const bersihSebelum = tagihanOrder(order);
  if (nominal.greaterThan(bersihSebelum)) throw gagal(`Nominal (${nominal.toFixed(2)}) melebihi tagihan bersih order (${bersihSebelum.toFixed(2)})`, 400, "MELEBIHI_TAGIHAN");

  const tanggal = tanggalNota(tx, date);
  // Nota tidak boleh bertanggal sebelum pendapatan order diakui (piutang belum ada di tanggal itu).
  const pengakuan = await tx.finJournalEntry.findFirst({ where: { idempotencyKey: { startsWith: `PENGAKUAN_PENDAPATAN:${orderId}` }, status: "POSTED" }, orderBy: { date: "asc" }, select: { date: true } });
  if (pengakuan && tanggal.getTime() < pengakuan.date.getTime()) throw gagal("Tanggal nota tidak boleh sebelum tanggal pengakuan pendapatan order", 400, "TANGGAL_SEBELUM_PENGAKUAN");

  const sebelum = await snapshot(tx, orderId);
  let journalId = null;
  let sumber = "MANDIRI";

  if (refundId) {
    sumber = "TERTAUT_REFUND";
    await lockRowForUpdate(tx, '"fin_refunds"', refundId);
    const refund = await tx.finRefund.findUnique({ where: { id: refundId }, select: { id: true, refundNumber: true, orderId: true, status: true, amount: true } });
    if (!refund || refund.orderId !== orderId) throw gagal("Refund tidak ditemukan pada order ini", 404, "REFUND_TIDAK_ADA");
    if (refund.status !== "DISETUJUI") throw gagal(`Refund ${refund.refundNumber} berstatus ${refund.status} — hanya refund yang sudah disetujui yang bisa ditautkan`, 409, "REFUND_BELUM_DISETUJUI");
    const debitRetur = await debitReturRefund(tx, refundId, orderId);
    if (debitRetur.lessThanOrEqualTo(0)) {
      throw gagal(`Refund ${refund.refundNumber} tidak mendebet Retur & Potongan Penjualan (bukan potongan atas tagihan yang sudah diakui), jadi tidak bisa ditautkan sebagai nota kredit.`, 409, "REFUND_BUKAN_POTONGAN");
    }
    const tertaut = await tx.finOrderCredit.findFirst({ where: { refundId, status: "AKTIF" }, select: { creditNumber: true } });
    if (tertaut) throw gagal(`Refund ${refund.refundNumber} sudah tertaut ke nota kredit aktif ${tertaut.creditNumber}. Batalkan nota itu dulu bila ingin menggantinya.`, 409, "REFUND_SUDAH_TERTAUT");
    const batas = minMoney(toMoney(refund.amount), debitRetur);
    if (nominal.greaterThan(batas)) {
      throw gagal(`Nota yang tertaut ke refund ${refund.refundNumber} tidak boleh melebihi nilai refund yang menjadi potongan (${batas.toFixed(2)}).`, 409, "MELEBIHI_REFUND");
    }
  }

  const noDoc = await generateDocumentNumber(tx, "NK", tanggal);
  const id = randomUUID();
  let jurnal = null;
  if (!refundId) {
    const saldo = await saldoPiutangOrder(tx, orderId);
    if (nominal.greaterThan(saldo)) {
      throw gagal(
        `Nominal (${nominal.toFixed(2)}) melebihi sisa piutang order di buku besar (${saldo.isNegative() ? "0.00" : saldo.toFixed(2)}). ` +
        "Bila pelanggan sudah membayar dan uangnya dikembalikan, buat refund lalu tautkan nota kredit ke refund itu.",
        409, "MELEBIHI_SISA_PIUTANG",
      );
    }
    const { entry } = await postNotaKreditMandiri(tx, { idemKey: String(idempotencyKey), sourceId: id, creditNumber: noDoc, order, amount: nominal, reason: alasan, userId, date: tanggal });
    journalId = entry.id;
    jurnal = { nomor: entry.entryNumber, tanggal, baris: [{ akun: "4-2100 Retur & Potongan Penjualan", debit: nominal.toFixed(2), kredit: "0.00" }, { akun: "1-1300 Piutang Usaha", debit: "0.00", kredit: nominal.toFixed(2) }] };
  }

  const credit = await tx.finOrderCredit.create({
    data: { id, creditNumber: noDoc, orderId, amount: nominal, reason: alasan, kind, refundId, journalId, creditDate: tanggal, status: "AKTIF", idempotencyKey: String(idempotencyKey), createdById: userId },
  });
  // Status & paidAt dihitung ulang DARI LEDGER (paidAt = tanggal pembayaran yang melewati tagihan bersih, bukan waktu nota dibuat).
  await recomputeOrderPaymentStatus(tx, orderId, { paidAtEfektif: true });
  const sesudah = await snapshot(tx, orderId);
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_POSTED, actorId: userId,
    metadata: { aksi: "nota_kredit_dibuat", nomor: noDoc, jumlah: nominal.toFixed(2), jenis: kind, sumber, refundId, tanggal: tanggal.toISOString().slice(0, 10), alasan, sebelum, sesudah, orderNumber: order.orderNumber },
  });
  return { credit, replay: false, sebelum, sesudah, sumber, jurnal };
}

/**
 * PRATINJAU dampak yang dihitung SERVER — menjalankan buatNotaKredit yang SAMA dalam transaksi lalu MEMBATALKANNYA (tidak ada yang tersimpan,
 * nomor dokumen dan audit ikut batal). Dengan begitu pratinjau tidak mungkin berbeda dari hasil nyata: aturan, batas, periode tertutup, paidAt.
 */
export async function pratinjauNotaKredit(prisma, params) {
  try {
    await prisma.$transaction(async (tx) => {
      const r = await buatNotaKredit(tx, { ...params, idempotencyKey: `pratinjau-${randomUUID()}`, userId: params.userId ?? null });
      throw new PratinjauSelesai({ nomor: r.credit.creditNumber, jumlah: uang(r.credit.amount), sumber: r.sumber, sebelum: r.sebelum, sesudah: r.sesudah, jurnal: r.jurnal });
    }, { timeout: 20000 });
  } catch (e) {
    if (e instanceof PratinjauSelesai) return e.hasil;
    throw e;
  }
  throw gagal("Pratinjau gagal dihitung", 500);
}

export async function pratinjauBatalNotaKredit(prisma, params) {
  try {
    await prisma.$transaction(async (tx) => {
      const r = await batalkanNotaKredit(tx, { ...params, reason: params.reason || "pratinjau pembatalan nota kredit", userId: params.userId ?? null });
      throw new PratinjauSelesai({ sebelum: r.sebelum, sesudah: r.sesudah, jurnalDibalik: r.jurnalDibalik });
    }, { timeout: 20000 });
  } catch (e) {
    if (e instanceof PratinjauSelesai) return e.hasil;
    throw e;
  }
  throw gagal("Pratinjau gagal dihitung", 500);
}

/** Batalkan nota (jurnal dibalik bila ada; baris tidak dihapus) lalu hitung ulang status dari ledger. */
export async function batalkanNotaKredit(tx, { id, reason, expectedRevisi = null, userId }) {
  const alasan = String(reason ?? "").trim();
  if (alasan.length < MIN_ALASAN) throw gagal(`Alasan pembatalan wajib diisi (minimal ${MIN_ALASAN} karakter)`, 400, "ALASAN_WAJIB");
  const c0 = await tx.finOrderCredit.findUnique({ where: { id }, select: { orderId: true } });
  if (!c0) throw gagal("Nota kredit tidak ditemukan", 404);
  await lockRowForUpdate(tx, '"Order"', c0.orderId, { cast: null });
  await lockRowForUpdate(tx, '"fin_order_credits"', id);
  const c = await tx.finOrderCredit.findUnique({ where: { id } });
  if (c.status === "DIBATALKAN") throw gagal("Nota kredit ini sudah dibatalkan", 409, "SUDAH_BATAL");
  if (!expectedRevisi) throw gagal("Token revisi wajib — muat ulang pratinjau pembatalan", 400, "REVISI_WAJIB");
  if (String(expectedRevisi) !== (await revisiOrder(tx, c.orderId))) {
    throw gagal("Data order berubah sejak layar dibuka. Muat ulang pratinjau lalu coba lagi.", 409, "REVISI_BERUBAH");
  }
  const sebelum = await snapshot(tx, c.orderId);
  let reversalJournalId = null;
  if (c.journalId) {
    const balik = await reverseJournal(tx, { entryId: c.journalId, reason: `Nota kredit ${c.creditNumber} dibatalkan — ${alasan}`, userId });
    reversalJournalId = balik.id;
  }
  await tx.finOrderCredit.update({ where: { id }, data: { status: "DIBATALKAN", cancelledById: userId, cancelledAt: new Date(), cancelReason: alasan, reversalJournalId } });
  await recomputeOrderPaymentStatus(tx, c.orderId, { paidAtEfektif: true });
  const sesudah = await snapshot(tx, c.orderId);
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: c.orderId, eventType: EVENT_TYPES.DOCUMENT_CANCELLED, actorId: userId,
    metadata: { aksi: "nota_kredit_dibatalkan", nomor: c.creditNumber, jumlah: toMoney(c.amount).toFixed(2), alasan, sebelum, sesudah },
  });
  return { id, orderId: c.orderId, sebelum, sesudah, jurnalDibalik: Boolean(reversalJournalId) };
}

export { STATUS_DIHITUNG };
