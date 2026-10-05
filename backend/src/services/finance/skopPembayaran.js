// SKOP AKSES DATA PEMBAYARAN. SALES memegang PAYMENT_READ (supaya melihat riwayat pembayaran order-nya di Rincian Pesanan), tetapi PAYMENT_READ bukan "boleh melihat
// pembayaran semua orang". Endpoint baca yang melayani Finance sekaligus Sales memakai satu aturan ini, ditegakkan di SERVER (bukan UI):
//   • ADMIN / OWNER / pemegang FINANCE_READ  → { semua: true }
//   • SALES (tanpa peran Finance)            → { salesId } — hanya order MILIKNYA
//   • peran lain                             → null (pemanggil menjawab 403)
// "Milik" Sales = order yang ia pegang: pemilik eksplisit (Order.salesOwnerId), ATAU pemilik lead pelanggan, ATAU pemegang percakapan INDIVIDUAL pelanggan itu
// (lead yang dipindah/diambil alih tetap bisa dikerjakan Sales barunya walau salesOwnerId masih nama lama). Pengaju Klaim Lunas SENGAJA bukan syarat kepemilikan:
// membuat draft klaim di order orang lain tidak boleh menjadi jalan untuk membaca pembayarannya.

import { rolesOf, hasPermission, PERMISSIONS as P } from "../../middleware/authorize.js";

export function skopPembayaran(user) {
  const roles = rolesOf(user);
  if (roles.includes("ADMIN") || roles.includes("OWNER") || hasPermission(user, P.FINANCE_READ)) return { semua: true };
  if (roles.includes("SALES") && hasPermission(user, P.PAYMENT_READ)) return { salesId: user.id };
  return null;
}

/** Fragmen `where` Prisma untuk Order: order ini milik Sales `userId`. */
export function orderMilikSalesWhere(userId) {
  return {
    OR: [
      { salesOwnerId: userId },
      { customer: { OR: [{ assignedSalesId: userId }, { conversations: { some: { type: "INDIVIDUAL", assignedToId: userId } } }] } },
    ],
  };
}

/** Fragmen `where` Prisma untuk Payment: Payment langsung ke order milik Sales, atau beralokasi (Resi) ke order miliknya. */
export function paymentMilikSalesWhere(userId) {
  const order = orderMilikSalesWhere(userId);
  return { OR: [{ order }, { finAllocations: { some: { order } } }] };
}

/** Fragmen `where` Prisma untuk OrderGroup (Resi): ada order anggota yang milik Sales. */
export function grupMilikSalesWhere(userId) {
  return { orders: { some: orderMilikSalesWhere(userId) } };
}

export function galatTidakDitemukan(label) {
  return Object.assign(new Error(`${label} tidak ditemukan`), { statusCode: 404 });
}
