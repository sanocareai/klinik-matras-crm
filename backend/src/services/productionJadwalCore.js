// Inti Rencana Admin yang DIPAKAI BERSAMA jalur V2: kapasitas slot (rencana V2 + jadwal Admin dihitung bersama), kunci slot, riwayat append-only, dan pengambilalihan jadwal Admin
// saat unit dijadwalkan lewat rencana V2. Modul kecil TANPA impor berat agar aman dipakai productionPlanningCommandService (tidak ada siklus impor).
import { formatProductionDate, stationLabel } from "../lib/domain/productionRencanaAdmin.js";
import { JADWAL_EVENT, JADWAL_STATUS } from "../lib/domain/productionRencanaAdmin.js";
import { recordActivity, ENTITY_TYPES, EVENT_TYPES } from "../lib/activityLog.js";

export const INACTIVE_UNIT = ["CANCELLED", "READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD", "IN_TRANSIT_OUT", "DELIVERED"];
const dkey = (d) => formatProductionDate(d);

export const stateOf = (s) => (s ? { scheduleId: s.id, revision: s.revision, status: s.status, productionDate: dkey(s.productionDate), stationCode: s.stationCode ?? null } : { scheduleId: null, revision: 0, status: null, productionDate: null, stationCode: null });

/** Jumlah unit yang menempati slot (tanggal, meja): rencana V2 aktif + jadwal Admin ACTIVE (unit lain, unit masih aktif). Dipakai kedua jalur agar kapasitas JUJUR. */
export async function slotOccupied(tx, { productionDate, stationCode, excludeUnitId = null, excludePlanId = null }) {
  const [v2, admin] = await Promise.all([
    tx.productionRunPlan.count({ where: { productionDate, stationCode, status: { not: "CANCELLED" }, ...(excludePlanId ? { id: { not: excludePlanId } } : {}), ...(excludeUnitId ? { run: { unitId: { not: excludeUnitId } } } : {}) } }),
    tx.productionUnitSchedule.count({ where: { productionDate, stationCode, status: JADWAL_STATUS.ACTIVE, ...(excludeUnitId ? { unitId: { not: excludeUnitId } } : {}), unit: { status: { notIn: INACTIVE_UNIT }, order: { status: { not: "CANCELLED" } } } } }),
  ]);
  return v2 + admin;
}

export const lockSlot = (tx, dateKey, station) => tx.$queryRawUnsafe("SELECT pg_advisory_xact_lock(hashtext($1))::text AS k", `production-station:${dateKey}:${station}`);

export async function writeEvent(tx, { schedule, unitId, kind, from = {}, to = {}, note = null, undoOf = null, revision, idempotencyKey = null, actorId }) {
  return tx.productionUnitScheduleEvent.create({
    data: {
      scheduleId: schedule.id, unitId, kind,
      fromDate: from.date ?? null, fromStation: from.station ?? null, fromPriority: from.priority ?? null, fromTargetAt: from.targetAt ?? null,
      toDate: to.date ?? null, toStation: to.station ?? null, toPriority: to.priority ?? null, toTargetAt: to.targetAt ?? null,
      note, undoOfEventId: undoOf, resultingRevision: revision, idempotencyKey, actorId,
    },
  });
}

/** Dipanggil di DALAM transaksi penjadwalan V2 (scheduleProductionPlanInTx): jadwal Admin ACTIVE unit itu diambil alih (sumber kebenaran pindah ke rencana V2). */
export async function adoptJadwalAdminInTx(tx, { unitId, planId, actorId, unitCode = null }) {
  const cur = await tx.productionUnitSchedule.findUnique({ where: { unitId } });
  if (!cur || cur.status !== JADWAL_STATUS.ACTIVE) return null;
  const revision = cur.revision + 1;
  const schedule = await tx.productionUnitSchedule.update({ where: { id: cur.id }, data: { status: JADWAL_STATUS.ADOPTED, adoptedPlanId: planId, revision, updatedById: actorId || null } });
  await writeEvent(tx, { schedule, unitId, kind: JADWAL_EVENT.ADOPTED, revision, actorId: actorId || "SYSTEM", from: { date: cur.productionDate, station: cur.stationCode }, note: `Diambil alih rencana V2 ${planId}` });
  await recordActivity(tx, { entityType: ENTITY_TYPES.UNIT, entityId: unitId, eventType: EVENT_TYPES.PRODUCTION_ADMIN_SCHEDULE_SET, actorId: actorId || null, metadata: { unitCode, kind: "ADOPTED", planId, scheduleId: schedule.id } });
  return stateOf(schedule);
}
export { stationLabel };
