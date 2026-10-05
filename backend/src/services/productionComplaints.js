// Prioritas "Komplain" Production — SATU-SATUNYA sumber: ComplaintCase resmi yang masih TERBUKA (status bukan SELESAI/DIBATALKAN; definisi sama dengan
// filter komplain aktif di routes/orders.js). BUKAN pencarian teks pada catatan/keluhan order, BUKAN Order.hasComplaint (bendera historis "pernah komplain"),
// BUKAN Order.complaintCategory (keluhan kesehatan customer yang diisi Sales). Baca-saja; satu query batch (tidak N+1).
//
// Cakupan kasus: kasus yang menyebut unit (unitId) berlaku untuk unit itu; kasus tingkat order (unitId null) berlaku untuk SEMUA unit order itu
// (kasus resmi tidak menyebut unit tertentu, jadi tidak ada dasar mempersempitnya — keputusan audit, dicatat di matriks perubahan).
export const OPEN_COMPLAINT_STATUS_EXCLUDED = Object.freeze(["SELESAI", "DIBATALKAN"]);
export const OPEN_COMPLAINT_WHERE = Object.freeze({ status: { notIn: [...OPEN_COMPLAINT_STATUS_EXCLUDED] } });

/**
 * @param {object} client   prisma / tx
 * @param {{id: string, orderId: string|null}[]} units
 * @returns {Promise<Map<string, {id: string, caseNumber: string, status: string, category: string}[]>>}  unitId -> kasus terbuka (kosong = tidak ada entri)
 */
export async function loadOpenComplaintsByUnit(client, units) {
  const rows = (units || []).filter((u) => u?.id);
  const out = new Map();
  if (!rows.length) return out;
  const unitIds = rows.map((u) => u.id);
  const orderIds = [...new Set(rows.map((u) => u.orderId).filter(Boolean))];
  const cases = await client.complaintCase.findMany({
    where: { ...OPEN_COMPLAINT_WHERE, OR: [{ unitId: { in: unitIds } }, ...(orderIds.length ? [{ unitId: null, orderId: { in: orderIds } }] : [])] },
    select: { id: true, caseNumber: true, status: true, category: true, unitId: true, orderId: true },
    orderBy: { createdAt: "asc" },
  });
  if (!cases.length) return out;
  const byOrder = new Map();
  for (const c of cases) if (!c.unitId) byOrder.set(c.orderId, [...(byOrder.get(c.orderId) || []), c]);
  for (const u of rows) {
    const mine = [...cases.filter((c) => c.unitId === u.id), ...(byOrder.get(u.orderId) || [])];
    if (mine.length) out.set(u.id, mine.map((c) => ({ id: c.id, caseNumber: c.caseNumber, status: c.status, category: c.category })));
  }
  return out;
}
