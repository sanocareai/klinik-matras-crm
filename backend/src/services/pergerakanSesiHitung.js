// PERGERAKAN SELAMA SESI HITUNG (Stock Count) — Okt 2026.
//
// Saat Start Count, sistem merekam snapshot saldo (systemQty per baris) dan waktu mulai (startedAt). Pergerakan ledger yang terjadi SESUDAH itu
// pada material yang sedang dihitung (penerimaan, pemakaian, transfer, retur dari dokumen resmi) bisa sudah ATAU belum ikut terhitung di fisik.
// Sistem TIDAK menebaknya: penghitung menandai tiap pergerakan ("sudah masuk hitungan fisik" / "belum"), dan Complete ditolak selama ada yang belum ditandai.
//
// Selisih per baris = countedQty − (systemQty + Σ qty pergerakan yang DITANDAI sudah masuk hitungan fisik).
//   • ditandai sudah masuk → fisik sudah memuat efeknya, jadi pembanding ikut bergeser (tidak ada selisih semu);
//   • ditandai belum masuk → fisik belum memuatnya; ADJUSTMENT = fisik − snapshot, pergerakan itu tetap utuh di ledger.
// Tanda disimpan di activity_events (tanpa migrasi). Tanda terakhir per pergerakan yang berlaku; pelaku tercatat.
import { ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const AKSI_TANDA_PERGERAKAN = "PERGERAKAN_SESI_DITANDAI";
// Tanda menjadi BASI bila hasil hitung material itu diubah/dihitung ulang sesudahnya (fisik yang baru bisa sudah memuat pergerakan yang tadinya "belum"): reset menghapus tanda.
export const AKSI_TANDA_DIRESET = "TANDA_DIRESET";
const EPS = 1e-6;
const r4 = (x) => Math.round(x * 10000) / 10000;

/** Pergerakan ledger pada material baris count setelah startedAt (sampai completedAt/sekarang), di luar ADJUSTMENT milik count ini. */
export async function muatPergerakanSesi(db, count, { sampai = null } = {}) {
  if (!count.startedAt) return { pergerakan: [], tandaPerId: new Map() };
  const materialIds = [...new Set(count.lines.map((l) => l.materialId))];
  if (!materialIds.length) return { pergerakan: [], tandaPerId: new Map() };
  const batas = sampai || count.completedAt || new Date();
  const rows = await db.stockMovement.findMany({
    where: { materialId: { in: materialIds }, createdAt: { gt: count.startedAt, lte: batas }, OR: [{ stockCountId: null }, { stockCountId: { not: count.id } }] },
    select: {
      id: true, materialId: true, type: true, qty: true, createdAt: true, note: true, reason: true, createdById: true,
      goodsReceipt: { select: { receiptNumber: true } }, materialIssue: { select: { issueNumber: true } }, stockTransfer: { select: { transferNumber: true } },
      damagedStockRecord: { select: { recordNumber: true } }, returnRecord: { select: { returnNumber: true } }, stockAdjustmentRequest: { select: { adjustmentNumber: true } },
    },
    orderBy: { createdAt: "asc" },
  });
  const events = await db.activityEvent.findMany({
    where: { entityType: ENTITY_TYPES.STOCK_COUNT, entityId: count.id, eventType: EVENT_TYPES.DOCUMENT_EDITED },
    select: { actorId: true, metadata: true, createdAt: true }, orderBy: { createdAt: "asc" },
  });
  const materialPerMov = new Map(rows.map((m) => [m.id, m.materialId]));
  const tandaPerId = new Map();
  for (const e of events) {
    if (e.metadata?.aksi === AKSI_TANDA_DIRESET) {
      // reset (semua material, atau satu material): tanda yang dibuat SEBELUM reset tidak berlaku lagi
      for (const [mid] of [...tandaPerId]) if (!e.metadata.materialId || materialPerMov.get(mid) === e.metadata.materialId) tandaPerId.delete(mid);
      continue;
    }
    if (e.metadata?.aksi !== AKSI_TANDA_PERGERAKAN || typeof e.metadata.movementId !== "string" || typeof e.metadata.tercermin !== "boolean") continue;
    tandaPerId.set(e.metadata.movementId, { tercermin: e.metadata.tercermin, oleh: e.actorId, pada: e.createdAt });
  }
  const pergerakan = rows.map((m) => ({
    id: m.id, materialId: m.materialId, type: m.type, qty: Number(m.qty), at: m.createdAt, note: m.note, reason: m.reason, createdById: m.createdById,
    dokumen: m.goodsReceipt?.receiptNumber || m.materialIssue?.issueNumber || m.stockTransfer?.transferNumber || m.damagedStockRecord?.recordNumber
      || m.returnRecord?.returnNumber || m.stockAdjustmentRequest?.adjustmentNumber || null,
    tanda: tandaPerId.has(m.id) ? (tandaPerId.get(m.id).tercermin ? "SUDAH_TERHITUNG" : "BELUM_TERHITUNG") : null,
  }));
  return { pergerakan, tandaPerId };
}

/** Selisih per baris setelah memperhitungkan tanda; `belumDitandai` = daftar yang menghalangi Complete. Murni. */
export function selisihTersesuaikan(lines, pergerakan) {
  const belumDitandai = pergerakan.filter((p) => p.tanda === null);
  const geser = new Map();
  for (const p of pergerakan) if (p.tanda === "SUDAH_TERHITUNG") geser.set(p.materialId, r4((geser.get(p.materialId) || 0) + p.qty));
  const baris = lines.map((l) => {
    const pembanding = r4(Number(l.systemQty) + (geser.get(l.materialId) || 0));
    const selisih = r4(Number(l.countedQty) - pembanding);
    return { lineId: l.id, materialId: l.materialId, pembanding, selisih, berselisih: Math.abs(selisih) > EPS };
  });
  return { baris, belumDitandai };
}
