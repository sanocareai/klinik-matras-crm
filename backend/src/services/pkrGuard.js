// PENJAGA ORDER PENJUALAN KARYAWAN — modul KECIL tanpa impor berat supaya bisa dipakai dari jalur uang/invoice (invoice.js, hooks, routes) tanpa membuat impor melingkar.
// Order yang lahir dari Penjualan Karyawan (Order.penjualanKaryawanId terisi) HANYA dokumen operasional: nominal, pembayaran, piutang, invoice, dan jurnal dikelola PKR di Finance.
// Trigger DB (migrasi 20261031090000) menjadi pengaman terakhir; penjaga di sini memberi pesan Bahasa Indonesia yang jelas lebih dulu.

export class PkrOrderError extends Error {
  constructor(message, statusCode = 400, code = null, extra = null) { super(message); this.name = "PkrOrderError"; this.statusCode = statusCode; if (code) this.code = code; if (extra) this.extra = extra; }
}

/** Lempar 409 bila order adalah order Penjualan Karyawan. `db` = prisma atau tx. */
export async function tolakJikaOrderPkr(db, orderId, aksi = "Aksi ini") {
  if (!orderId) return;
  const o = await db.order.findUnique({ where: { id: orderId }, select: { penjualanKaryawanId: true, penjualanKaryawan: { select: { nomor: true } } } });
  if (o?.penjualanKaryawanId) {
    throw new PkrOrderError(
      `${aksi} tidak tersedia untuk order Penjualan Karyawan (${o.penjualanKaryawan?.nomor ?? "PKR"}). Nominal, pembayaran, dan piutang dikelola di Finance › Penjualan Karyawan.`,
      409, "ORDER_PENJUALAN_KARYAWAN",
    );
  }
}

/** Untuk handler Express: balas 409 dan kembalikan true bila order PKR (handler harus `return`). */
export async function blokirBilaOrderPkr(db, res, orderId, aksi) {
  try { await tolakJikaOrderPkr(db, orderId, aksi); return false; }
  catch (e) { if (e instanceof PkrOrderError) { res.status(e.statusCode).json({ error: e.message, code: e.code }); return true; } throw e; }
}
