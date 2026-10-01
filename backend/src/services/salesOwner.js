// PEMILIK SALES ORDER (salesOwnerId) — keputusan Owner 30 Sep 2026 ("Rekonsiliasi Sales–Finance").
//
// Sebelumnya order diatribusikan ke Sales HANYA lewat percakapan WhatsApp yang dipegang (Conversation.assignedToId). Order dari pelanggan tanpa
// percakapan atribusi (order internal/KML/JR) tidak pernah masuk laporan Sales mana pun. Sekarang order menyimpan pemilik SALES yang STABIL:
//
//   • Saat dibuat: pembuat order bila perannya SALES; kalau bukan (Admin/Finance/…), pemilik lead pelanggan (Customer.assignedSalesId) bila
//     dia SALES; selain itu KOSONG ("Tanpa Sales") — TIDAK ditebak dari percakapan.
//   • Berpindah pemilik HANYA lewat penugasan ulang eksplisit (tetapkanPemilikSales) yang wajib beralasan dan diaudit.
//   • Order lama (salesOwnerId kosong) tetap memakai atribusi percakapan seperti dulu (lihat atribusiOrderWhere) — tidak ada backfill tebakan.

import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

const ALASAN_MAKS = 300;

/** Sales AKTIF berperan utama SALES (yang muncul di leaderboard)? Mengembalikan id-nya bila ya, selain itu null. */
async function idBilaSales(db, userId) {
  if (!userId) return null;
  const u = await db.user.findUnique({ where: { id: userId }, select: { id: true, role: true, active: true } });
  return u && u.active && u.role === "SALES" ? u.id : null;
}

/** Pemilik Sales untuk order BARU. Tidak pernah menebak: null bila tidak ada sumber yang pasti. */
export async function tentukanPemilikSalesBaru(db, { customerId, pembuatId }) {
  const dariPembuat = await idBilaSales(db, pembuatId);
  if (dariPembuat) return { salesOwnerId: dariPembuat, sumber: "PEMBUAT_ORDER" };
  const cust = await db.customer.findUnique({ where: { id: customerId }, select: { assignedSalesId: true } });
  const dariLead = await idBilaSales(db, cust?.assignedSalesId);
  if (dariLead) return { salesOwnerId: dariLead, sumber: "PEMILIK_LEAD" };
  return { salesOwnerId: null, sumber: "TANPA_SALES" };
}

/**
 * Fragmen `where` Prisma: order ini milik `userId` untuk laporan Sales. Pemilik eksplisit (salesOwnerId) MENANG; bila kosong, jatuh ke atribusi
 * percakapan lama (`mineAtribusi` = { type: "INDIVIDUAL", assignedToId }). Dipakai di setiap kueri order per-sales di analytics.js.
 */
export function atribusiOrderWhere(userId, mineAtribusi) {
  return {
    OR: [
      { salesOwnerId: userId },
      { salesOwnerId: null, customer: { conversations: { some: mineAtribusi } } },
    ],
  };
}

/** Penugasan ulang eksplisit (Admin): alasan wajib, pemilik baru harus Sales aktif atau null (kembali ke "Tanpa Sales"). Diaudit. */
export async function tetapkanPemilikSales(tx, { orderId, userIdBaru, alasan, aktorId }) {
  const reason = String(alasan ?? "").trim().slice(0, ALASAN_MAKS);
  if (!reason) throw Object.assign(new Error("Alasan penugasan ulang wajib diisi"), { statusCode: 400 });
  const order = await tx.order.findUnique({ where: { id: orderId }, select: { id: true, orderNumber: true, salesOwnerId: true, status: true } });
  if (!order) throw Object.assign(new Error("Order tidak ditemukan"), { statusCode: 404 });
  let baru = null;
  if (userIdBaru) {
    baru = await idBilaSales(tx, userIdBaru);
    if (!baru) throw Object.assign(new Error("Pemilik harus akun Sales yang aktif"), { statusCode: 400 });
  }
  if ((order.salesOwnerId ?? null) === baru) throw Object.assign(new Error("Pemilik order sudah sama"), { statusCode: 409 });
  const nama = async (id) => (id ? (await tx.user.findUnique({ where: { id }, select: { name: true } }))?.name ?? id : "Tanpa Sales");
  await tx.order.update({ where: { id: orderId }, data: { salesOwnerId: baru } });
  await recordActivity(tx, {
    entityType: ENTITY_TYPES.ORDER, entityId: orderId, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: aktorId,
    metadata: { aksi: "ganti_sales_owner", orderNumber: order.orderNumber, reason, before: { salesOwnerId: order.salesOwnerId, nama: await nama(order.salesOwnerId) }, after: { salesOwnerId: baru, nama: await nama(baru) } },
  });
  return { orderNumber: order.orderNumber, salesOwnerId: baru, nama: await nama(baru) };
}
