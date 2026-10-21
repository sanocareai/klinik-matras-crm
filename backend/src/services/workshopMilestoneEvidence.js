// Bukti milestone "Diterima di Workshop" — pemuat BATCH (tanpa N+1) dan fragmen `where` untuk filter/hitungan di SERVER. Aturan status ada di lib/domain/workshopMilestone.js.
// BACA-SAJA: tidak menulis, tidak membuat bukti, tidak mengubah status tersimpan. Bukti = command resmi (custody INBOUND ACCEPTED, konfirmasi petugas tanpa custody, penerimaan workshop petugas,
// lahir di workshop) + fakta "dimulai" (operasi V2 non-lewati atau log tahap V1). Pickup selesai TIDAK pernah dihitung sebagai bukti terima.
import { ARRIVAL_NO_CUSTODY_REASON } from "../lib/domain/productionDisplay.js";
import { GLOBAL_STATUS_FLOW, globalStatusOf, receivedBasisOf } from "../lib/domain/workshopMilestone.js";

const TERMINAL_RUN = ["COMPLETED", "CANCELLED"];

// ---- Fragmen where (Unit) -----------------------------------------------------------------------------------------------------------------
/** Unit sudah DIMULAI produksinya: IN_PRODUCTION (diset engine tahap saat tahap pertama mulai), log tahap V1, atau operasi V2 non-SKIPPED pada Run non-terminal. */
export const WHERE_STARTED = Object.freeze({
  OR: [
    { status: "IN_PRODUCTION" },
    { stageLogs: { some: {} } },
    { productionRunsV2: { some: { status: { notIn: TERMINAL_RUN }, operations: { some: { status: { not: "SKIPPED" } } } } } },
  ],
});
/** Unit punya BUKTI terima di workshop (salah satu dari tiga command resmi). */
export const WHERE_RECEIVED = Object.freeze({
  OR: [
    { custodyHandoffs: { some: { direction: "INBOUND", status: "ACCEPTED" } } },
    { workshopReceipt: { isNot: null } },
    { productionRunsV2: { some: { status: { notIn: TERMINAL_RUN }, OR: [{ origin: "WORKSHOP_BORN" }, { phases: { some: { phase: "INTAKE", reason: ARRIVAL_NO_CUSTODY_REASON } } }] } } },
  ],
});
const NOT_STARTED = Object.freeze({ NOT: WHERE_STARTED });
const NOT_RECEIVED = Object.freeze({ NOT: WHERE_RECEIVED });
/** Job pickup SEDANG berlangsung (driver berangkat / tiba di lokasi). UnitStatus tetap AWAITING_PICKUP sepanjang itu. */
export const WHERE_PICKUP_JOB_RUNNING = Object.freeze({ jobUnits: { some: { job: { type: "PICKUP", status: { in: ["EN_ROUTE", "ARRIVED"] } } } } });
/** Menunggu Dijemput: belum ada pickup yang berlangsung (belum dijadwalkan, terjadwal, atau driver belum berangkat). */
export const WHERE_WAITING_PICKUP = Object.freeze({ AND: [{ status: "AWAITING_PICKUP" }, { NOT: WHERE_PICKUP_JOB_RUNNING }] });
/** Cabang 1 Pengambilan: pickup sedang berlangsung (job EN_ROUTE/ARRIVED, atau status IN_TRANSIT_IN). */
export const WHERE_PICKUP_IN_PROGRESS = Object.freeze({ OR: [{ status: "IN_TRANSIT_IN" }, { AND: [{ status: "AWAITING_PICKUP" }, WHERE_PICKUP_JOB_RUNNING] }] });
/** Cabang 2 Pengambilan: pickup selesai (RECEIVED tersimpan) tetapi BELUM ada bukti terima di workshop dan belum dimulai — TIDAK dianggap tiba. */
export const WHERE_PICKUP_DONE_NOT_RECEIVED = Object.freeze({ AND: [{ status: "RECEIVED" }, NOT_STARTED, NOT_RECEIVED] });

/**
 * Fragmen where untuk satu status global (level UNIT). Untuk PENGAMBILAN ada dua cabang: pickup sedang berlangsung, dan pickup selesai tetapi belum ada bukti terima.
 * Kondisi tingkat ORDER (status order, spam/internal) ditambahkan pemanggil.
 */
export function unitWhereForGlobalStatus(key) {
  switch (key) {
    case "MENUNGGU_DIJEMPUT": return WHERE_WAITING_PICKUP;
    case "PENGAMBILAN": return { OR: [WHERE_PICKUP_IN_PROGRESS, WHERE_PICKUP_DONE_NOT_RECEIVED] };
    case "DITERIMA_WORKSHOP": return { AND: [{ status: "RECEIVED" }, WHERE_RECEIVED, NOT_STARTED] };
    case "DIPROSES": return { AND: [{ status: { in: ["RECEIVED", "IN_PRODUCTION"] } }, WHERE_STARTED] };
    case "SIAP_KIRIM": return { status: { in: ["READY_FOR_DELIVERY", "READY_ON_CUSTOMER_HOLD"] } };
    case "DALAM_PENGIRIMAN": return { status: "IN_TRANSIT_OUT" };
    case "TERKIRIM": return { status: "DELIVERED" };
    case "DIBATALKAN": return { status: "CANCELLED" };
    default: return null;
  }
}
/** Gabungan beberapa status global (OR). Kunci tak dikenal diabaikan; kosong -> null. */
export function unitWhereForGlobalStatuses(keys = []) {
  const parts = [...new Set(keys)].map(unitWhereForGlobalStatus).filter(Boolean);
  if (!parts.length) return null;
  return parts.length === 1 ? parts[0] : { OR: parts };
}

// ---- Pemuat bukti (batch) ----------------------------------------------------------------------------------------------------------------
/**
 * @returns {Promise<Map<string, { receivedBasis: string|null, started: boolean, pickupCompleted: boolean }>>}
 * Untuk setiap unitId yang diminta ADA entri (default tanpa bukti).
 */
export async function loadMilestoneEvidence(client, unitIds) {
  const ids = [...new Set((unitIds || []).filter(Boolean))];
  const out = new Map(ids.map((id) => [id, { inboundAccepted: false, staffConfirmed: false, workshopReceipt: false, bornInWorkshop: false, started: false, pickupCompleted: false, pickupInProgress: false }]));
  if (!ids.length) return finalize(out);
  const [handoffs, receipts, runs, logs, pickups] = await Promise.all([
    client.unitCustodyHandoff.findMany({ where: { unitId: { in: ids }, direction: "INBOUND", status: "ACCEPTED" }, select: { unitId: true } }),
    client.unitWorkshopReceipt.findMany({ where: { unitId: { in: ids } }, select: { unitId: true } }),
    client.productionRun.findMany({
      where: { unitId: { in: ids }, status: { notIn: TERMINAL_RUN } },
      select: {
        unitId: true, origin: true,
        phases: { where: { phase: "INTAKE", reason: ARRIVAL_NO_CUSTODY_REASON }, select: { id: true }, take: 1 },
        operations: { where: { status: { not: "SKIPPED" } }, select: { id: true }, take: 1 },
      },
    }),
    client.unitStageLog.groupBy({ by: ["unitId"], where: { unitId: { in: ids } }, _count: { _all: true } }),
    client.jobUnit.findMany({ where: { unitId: { in: ids }, job: { type: "PICKUP", status: { in: ["COMPLETED", "EN_ROUTE", "ARRIVED"] } } }, select: { unitId: true, job: { select: { status: true } } } }),
  ]);
  for (const h of handoffs) out.get(h.unitId).inboundAccepted = true;
  for (const r of receipts) out.get(r.unitId).workshopReceipt = true;
  for (const r of runs) {
    const e = out.get(r.unitId); if (!e) continue;
    if (r.origin === "WORKSHOP_BORN") e.bornInWorkshop = true;
    if (r.phases.length) e.staffConfirmed = true;
    if (r.operations.length) e.started = true;
  }
  for (const l of logs) if (l._count._all > 0) out.get(l.unitId).started = true;
  for (const p of pickups) { if (p.job.status === "COMPLETED") out.get(p.unitId).pickupCompleted = true; else out.get(p.unitId).pickupInProgress = true; }
  return finalize(out);
}
function finalize(raw) {
  const m = new Map();
  for (const [id, e] of raw) m.set(id, { receivedBasis: receivedBasisOf(e), started: e.started, pickupCompleted: e.pickupCompleted, pickupInProgress: e.pickupInProgress });
  return m;
}

/** Status global untuk daftar unit (baris dengan `id` dan `status`). Mengembalikan Map unitId -> objek globalStatusOf. */
export async function globalStatusMapFor(client, units) {
  const evidence = await loadMilestoneEvidence(client, units.map((u) => u.id));
  const map = new Map();
  for (const u of units) {
    const e = evidence.get(u.id) || { receivedBasis: null, started: false, pickupCompleted: false, pickupInProgress: false };
    map.set(u.id, globalStatusOf({ unitStatus: u.status, ...e }));
  }
  return map;
}

/** Hitungan unit per status global (mengikuti `baseWhere` unit, mis. filter pelanggan nyata). Satu count per status — tanpa memuat baris. */
export async function countByGlobalStatus(client, baseWhere = {}) {
  const entries = await Promise.all(GLOBAL_STATUS_FLOW.map(async (k) => [k, await client.unit.count({ where: { AND: [baseWhere, unitWhereForGlobalStatus(k)] } })]));
  return Object.fromEntries(entries);
}
