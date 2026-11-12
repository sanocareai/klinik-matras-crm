// PRODUKSI MENERIMA UNIT YANG PICKUP-NYA BELUM DITUTUP DRIVER (keputusan Owner, 12 Nov 2026): Produksi tidak perlu menunggu Armada. Bila petugas workshop menyatakan unit
// SUDAH ada fisik di workshop sementara status unit masih Menunggu dijemput / Dalam perjalanan, pickup dianggap selesai di sini:
//   • status unit → RECEIVED (sama dengan efek pickup selesai di Armada), order disinkronkan (weakest-link, kunci manual Sales tetap dihormati);
//   • job PICKUP aktif yang SEMUA unitnya sudah tidak menunggu jemput → COMPLETED dengan catatan jelas (siapa, alasan). Job yang masih memuat unit lain yang
//     belum tiba TIDAK ditutup — driver tetap menyelesaikannya; saat itu Armada hanya mengubah unit yang memang masih menunggu (lihat routes/armada.js).
// Tidak menawarkan custody Gudang: bukti tiba adalah catatan penerimaan workshop yang dibuat pemanggil sesudah ini (satu sumber bukti, tanpa catatan ganda).
import { recordActivity, EVENT_TYPES } from "../lib/activityLog.js";
import { lockRowForUpdate } from "./inventoryLedger.js";
import { ACTIVE_JOB_STATUSES } from "./jobStatus.js";
import { syncOrderStatusForUnits, syncRouteCompletionStatus } from "./orderStatusSync.js";
import { executeDeliveryCrossBoundaryCommand } from "./deliveryCrossBoundaryCommandService.js";
import { V2_FLAGS } from "./v2FeatureFlags.js";

export const STATUS_MENUNGGU_JEMPUT = Object.freeze(["AWAITING_PICKUP", "IN_TRANSIT_IN"]);
export const CATATAN_PICKUP_DITUTUP = "Ditutup otomatis: unit sudah diterima di workshop oleh Produksi.";

/** @returns {{ ditutup: boolean, statusSebelum?: string, jobDitutup: string[], jobTetapBuka: string[] }} */
export async function tutupPickupKarenaDiterimaInTx(tx, { unitId, actorId }) {
  await lockRowForUpdate(tx, "units", unitId);
  const unit = await tx.unit.findUnique({ where: { id: unitId }, select: { id: true, unitCode: true, status: true, orderId: true } });
  if (!unit || !STATUS_MENUNGGU_JEMPUT.includes(unit.status)) return { ditutup: false, jobDitutup: [], jobTetapBuka: [] };

  await tx.unit.update({ where: { id: unitId }, data: { status: "RECEIVED" } });

  // Job pickup yang memuat unit ini, ATAU job pickup tingkat order tanpa daftar unit (data lama).
  const jobs = await tx.job.findMany({
    where: { type: "PICKUP", status: { in: ACTIVE_JOB_STATUSES }, OR: [{ units: { some: { unitId } } }, { orderId: unit.orderId, units: { none: {} } }] },
    select: { id: true, routeId: true, units: { select: { unitId: true, unit: { select: { status: true } } } } },
  });
  const selesai = jobs.filter((j) => j.units.every((ju) => ju.unitId === unitId || !STATUS_MENUNGGU_JEMPUT.includes(ju.unit.status)));
  const tetapBuka = jobs.filter((j) => !selesai.includes(j)).map((j) => j.id);
  if (selesai.length) {
    const jobIds = selesai.map((j) => j.id); const routeIds = [...new Set(selesai.map((j) => j.routeId).filter(Boolean))];
    await executeDeliveryCrossBoundaryCommand(tx, {
      flagKey: V2_FLAGS.DELIVERY_EXECUTION_WRITER, actorId: actorId || null, commandType: "WORKSHOP_RECEIPT_COMPLETES_PICKUP", aggregateHint: unit.orderId, request: { unitId, jobIds },
      mutate: async (commandTx) => {
        await commandTx.job.updateMany({ where: { id: { in: jobIds } }, data: { status: "COMPLETED", completedAt: new Date(), completedById: actorId || null, proofNote: CATATAN_PICKUP_DITUTUP } });
        for (const routeId of routeIds) await syncRouteCompletionStatus(commandTx, routeId);
        return { value: undefined, jobIds, routeIds };
      },
    });
  }
  await syncOrderStatusForUnits(tx, [unitId], { forceStagedUnitIds: new Set([unitId]) });
  await recordActivity(tx, {
    entityType: "unit", entityId: unitId, eventType: EVENT_TYPES.PICKUP_CLOSED_BY_WORKSHOP, actorId: actorId || null,
    metadata: { unitCode: unit.unitCode, statusSebelum: unit.status, jobDitutup: selesai.map((j) => j.id), jobTetapBuka: tetapBuka },
  });
  return { ditutup: true, statusSebelum: unit.status, jobDitutup: selesai.map((j) => j.id), jobTetapBuka: tetapBuka };
}
