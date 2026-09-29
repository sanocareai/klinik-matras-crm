// BACA REFUND PELANGGAN — SATU sumber query untuk layar Piutang & Refund (GET /api/finance/refunds) dan Export Excel
// (services/finance/export/piutang-refund.js). Murni baca.

export const refundInclude = {
  order: { select: { id: true, orderNumber: true, value: true, customer: { select: { id: true, name: true } } } },
  cashAccount: { select: { id: true, name: true } },
  approvedBy: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  replaces: { select: { id: true, refundNumber: true } },
  replacedBy: { select: { id: true, refundNumber: true } },
};

/**
 * Daftar refund menurut filter layar (`status` opsional; terbaru dulu). `take` membatasi jumlah baris (layar 200, export lebih besar).
 * `ids` (opsional) = hanya baris itu, dikembalikan menurut URUTAN `ids` — dipakai export untuk mereproduksi baris yang tampil
 * di layar setelah filter/pencarian sisi-klien.
 */
export async function ambilDaftarRefund(db, { status, ids = null } = {}, { take = 200 } = {}) {
  const rows = await db.finRefund.findMany({
    where: { ...(status ? { status } : {}), ...(ids ? { id: { in: ids } } : {}) },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }], // id = pemecah seri supaya urutan layar & export selalu sama
    take,
    include: refundInclude,
  });
  if (!ids) return rows;
  const urutan = new Map(ids.map((id, i) => [id, i]));
  return rows.sort((a, b) => urutan.get(a.id) - urutan.get(b.id));
}
