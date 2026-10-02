// PENGECUALIAN TANGGAL LUNAS (Order.paidAt) — keputusan Owner, ber-riwayat. Model: OrderPaidAtPengecualian (schema.prisma).
//
// Selama ada pengecualian AKTIF pada sebuah order, tanggal hitung lunasnya (Order.paidAt) DIKUNCI: sinkronisasi pembayaran (services/paymentLedger.js) dan perubahan status
// manual di order (routes/orders.js) TIDAK menyentuh paidAt. Status bayar, Payment, jurnal, dan saldo TIDAK terpengaruh sama sekali — hanya tanggal yang menentukan bulan
// order dihitung lunas (target/insentif Sales, rekonsiliasi Sales–Finance). Riwayat tidak pernah dihapus: mencabut hanya mengisi dicabutAt (+ pencabut + alasan).
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export class PengecualianError extends Error {
  constructor(message, statusCode = 400, code = "PENGECUALIAN_PAIDAT") { super(message); this.statusCode = statusCode; this.code = code; }
}

/** Pengecualian AKTIF sebuah order (atau null). Dipanggil jalur penulis paidAt — satu query ringan berindeks. */
export async function pengecualianAktif(db, orderId) {
  return db.orderPaidAtPengecualian.findFirst({ where: { orderId, dicabutAt: null }, select: { id: true, paidAtDikunci: true } });
}

const alasanValid = (a) => {
  const t = String(a ?? "").trim();
  if (t.length < 10) throw new PengecualianError("Alasan wajib diisi (minimal 10 karakter) — ini keputusan Owner yang tercatat permanen");
  return t.slice(0, 1000);
};

/**
 * Buat pengecualian: tanggal hitung lunas order DIKUNCI. `paidAtDikunci` default = paidAt order saat ini; boleh diisi tanggal lain (harus ada). Order wajib bertanggal lunas
 * (paidAt terisi) dan bukan batal. paidAt order diatur ke tanggal yang dikunci bila berbeda (dan itu dicatat). Satu order = satu pengecualian aktif.
 */
export async function buatPengecualian(tx, { orderId, alasan, paidAtDikunci = null, actorId }) {
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, status: true, paymentStatus: true, paidAt: true } });
  if (!order) throw new PengecualianError("Order tidak ditemukan", 404, "ORDER_TIDAK_ADA");
  if (order.status === "CANCELLED") throw new PengecualianError("Order yang dibatalkan tidak bisa diberi pengecualian", 409, "ORDER_BATAL");
  const kunci = paidAtDikunci ? new Date(paidAtDikunci) : order.paidAt;
  if (!kunci || Number.isNaN(kunci.getTime())) throw new PengecualianError("Order ini belum punya tanggal lunas — isi tanggal yang dikunci", 422, "TANPA_TANGGAL");
  if (await pengecualianAktif(tx, orderId)) throw new PengecualianError(`${order.orderNumber} sudah punya pengecualian aktif — cabut dulu bila ingin menggantinya`, 409, "SUDAH_ADA");
  const alasanBersih = alasanValid(alasan);

  const baris = await tx.orderPaidAtPengecualian.create({ data: { orderId, paidAtDikunci: kunci, paidAtAsli: order.paidAt, alasan: alasanBersih, createdById: actorId } });
  const berubah = !order.paidAt || order.paidAt.getTime() !== kunci.getTime();
  if (berubah) await tx.order.update({ where: { id: orderId }, data: { paidAt: kunci } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.PAIDAT_PENGECUALIAN, actorId,
    metadata: { aksi: "dibuat", orderNumber: order.orderNumber, dikunci: kunci, paidAtSebelumnya: order.paidAt, paidAtDiubah: berubah, alasan: alasanBersih, pengecualianId: baris.id },
  });
  return { id: baris.id, orderNumber: order.orderNumber, paidAtDikunci: kunci, paidAtDiubah: berubah };
}

/** Cabut pengecualian aktif: sinkronisasi normal berlaku lagi mulai kejadian pembayaran berikutnya (paidAt TIDAK diubah saat dicabut). Alasan wajib; riwayat tetap. */
export async function cabutPengecualian(tx, { pengecualianId, alasan, actorId }) {
  const p = await tx.orderPaidAtPengecualian.findUnique({ where: { id: pengecualianId }, include: { order: { select: { orderNumber: true } } } });
  if (!p) throw new PengecualianError("Pengecualian tidak ditemukan", 404, "TIDAK_ADA");
  if (p.dicabutAt) throw new PengecualianError("Pengecualian ini sudah dicabut", 409, "SUDAH_DICABUT");
  const alasanBersih = alasanValid(alasan);
  await tx.orderPaidAtPengecualian.update({ where: { id: p.id }, data: { dicabutAt: new Date(), dicabutById: actorId, alasanDicabut: alasanBersih } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: p.orderId, eventType: EVENT_TYPES.PAIDAT_PENGECUALIAN, actorId,
    metadata: { aksi: "dicabut", orderNumber: p.order.orderNumber, dikunci: p.paidAtDikunci, alasan: alasanBersih, pengecualianId: p.id },
  });
  return { id: p.id, orderNumber: p.order.orderNumber };
}

/** Riwayat + yang aktif. `aktif` true = hanya aktif, false = hanya dicabut, undefined = semua. Terbaru dulu. */
export async function daftarPengecualian(db, { aktif, q, take = 500 } = {}) {
  const kata = String(q ?? "").trim();
  const rows = await db.orderPaidAtPengecualian.findMany({
    where: {
      ...(aktif === true && { dicabutAt: null }), ...(aktif === false && { dicabutAt: { not: null } }),
      ...(kata && { OR: [{ order: { orderNumber: { contains: kata, mode: "insensitive" } } }, { order: { customer: { name: { contains: kata, mode: "insensitive" } } } }, { alasan: { contains: kata, mode: "insensitive" } }] }),
    },
    orderBy: { createdAt: "desc" }, take,
    include: {
      order: { select: { id: true, orderNumber: true, value: true, paymentStatus: true, paidAt: true, customer: { select: { name: true } } } },
      createdBy: { select: { id: true, name: true } }, dicabutBy: { select: { id: true, name: true } },
    },
  });
  return rows.map((r) => ({
    id: r.id, order: { id: r.order.id, nomor: r.order.orderNumber, pelanggan: r.order.customer?.name ?? null, nilai: r.order.value, statusBayar: r.order.paymentStatus, paidAtSekarang: r.order.paidAt },
    paidAtDikunci: r.paidAtDikunci, paidAtAsli: r.paidAtAsli, alasan: r.alasan, aktif: !r.dicabutAt,
    dibuatOleh: r.createdBy?.name ?? null, dibuatPada: r.createdAt, dicabutOleh: r.dicabutBy?.name ?? null, dicabutPada: r.dicabutAt, alasanDicabut: r.alasanDicabut,
    // penjaga bekerja bila paidAt order masih sama dengan yang dikunci; berbeda = ada yang mengubah di luar sistem (harus nol)
    konsisten: !r.dicabutAt ? (r.order.paidAt ? r.order.paidAt.getTime() === r.paidAtDikunci.getTime() : false) : null,
  }));
}
