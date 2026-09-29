// BACA PEMBAYARAN PELANGGAN — SATU sumber query untuk layar "Pembayaran & Verifikasi" (GET /api/finance/customer-payments) dan Export Excel
// (services/finance/export/pembayaran.js), supaya baris & angka di berkas Excel tidak mungkin berbeda dari yang tampil di layar. Murni baca.

import { startOfDayWIB, endOfDayExclusiveWIB } from "../../utils/wib.js";

/** Kolom yang dibaca untuk daftar (layar memakai semuanya; export memilih yang perlu). */
export const paymentSelect = {
  id: true, amount: true, method: true, createdAt: true, proofPhotoUrl: true,
  cancelledAt: true, cancelReason: true, orderId: true,
  referenceNumber: true, notes: true, internalNote: true, replacesPaymentId: true, replacedBy: { select: { id: true } },
  cashAccount: { select: { id: true, name: true } },
  recordedBy: { select: { id: true, name: true } },
  cancelledBy: { select: { id: true, name: true } },
  verifications: { select: { id: true, createdAt: true, verifiedBy: { select: { id: true, name: true } } } },
  finAllocations: { select: { id: true, orderId: true, amount: true, order: { select: { orderNumber: true } } } },
  order: {
    select: {
      id: true, orderNumber: true, value: true, paymentStatus: true,
      customer: { select: { id: true, name: true } },
    },
  },
  // Job TIDAK punya kolom "jobNumber" (lihat model Job di schema.prisma) — field itu dulu membuat seluruh endpoint gagal.
  job: { select: { id: true, type: true } },
};

/**
 * WHERE daftar pembayaran. `fromStr`/`toStr` = tanggal kalender WIB ("YYYY-MM-DD"); createdAt adalah INSTANT UTC, jadi batasnya
 * awal hari WIB (>=) dan awal hari BERIKUTNYA WIB (<, eksklusif) — bukan tengah malam UTC (yang menggeser jendela 7 jam dan
 * membuang pembayaran jam 00:00–07:00 WIB di hari pertama periode, CLAUDE.md §11).
 * `status`: belum_verifikasi | terverifikasi | dibatalkan | (kosong/semua = tanpa filter status).
 */
export function whereDaftarPembayaran({ fromStr, toStr, status } = {}) {
  return {
    createdAt: { gte: startOfDayWIB(fromStr), lt: endOfDayExclusiveWIB(toStr) },
    ...(status === "belum_verifikasi" && { cancelledAt: null, verifications: { none: {} } }),
    ...(status === "terverifikasi" && { cancelledAt: null, verifications: { some: {} } }),
    ...(status === "dibatalkan" && { cancelledAt: { not: null } }),
  };
}

/**
 * Daftar pembayaran menurut filter layar (periode + status; urutan terbaru dulu).
 * `take` membatasi jumlah baris (layar 300, export lebih besar). `ids` (opsional) = hanya baris itu — dan TETAP dalam periode/status
 * yang sama — dikembalikan menurut URUTAN `ids` (dipakai export untuk mereproduksi baris yang tampil setelah filter sisi-klien).
 */
export async function ambilDaftarPembayaran(db, { fromStr, toStr, status, ids = null } = {}, { take = 300 } = {}) {
  const where = whereDaftarPembayaran({ fromStr, toStr, status });
  const rows = await db.payment.findMany({
    where: ids ? { ...where, id: { in: ids } } : where,
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id = pemecah seri supaya urutan layar & export selalu sama
    take,
    select: paymentSelect,
  });
  if (!ids) return rows;
  const urutan = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => urutan.get(a.id) - urutan.get(b.id));
}
