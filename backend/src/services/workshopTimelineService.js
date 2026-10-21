// Timeline KPI waktu per unit (batch, BACA-SAJA) — mengumpulkan timestamp sumber dari fakta yang sudah tercatat. Tidak membuat timestamp, tidak mengubah histori.
// Sumber:
//   pickupCompletedAt   Job PICKUP COMPLETED.completedAt (terbaru)
//   receivedAt          custody INBOUND ACCEPTED.acceptedAt; atau fase INTAKE (konfirmasi petugas, alasan baku).completedAt/startedAt; BORN_IN_WORKSHOP -> run.createdAt TIDAK dipakai
//                       (unit lahir di workshop tidak punya "pickup"; durasi 1–2 tidak berlaku -> "Data waktu belum tersedia")
//   productionStartedAt operasi V2 non-SKIPPED pertama (startedAt); histori V1: log tahap START pertama
//   productionFinishedAt custody FINISHED_GOODS.offeredAt (produksi menyerahkan ke Gudang); fallback fase HANDOFF.startedAt
//   warehouseAcceptedAt custody FINISHED_GOODS ACCEPTED.acceptedAt
//   deliveryStartedAt   DeliveryExecutionEvent JOB_STARTED job DELIVERY (occurredAt, fallback createdAt = waktu server)
//   deliveredAt         Job DELIVERY COMPLETED.completedAt (terbaru)
import { ARRIVAL_NO_CUSTODY_REASON } from "../lib/domain/productionDisplay.js";
import { aggregateDurations, timelineOf } from "../lib/domain/workshopKpi.js";

const maxDate = (a, b) => (!a ? b : !b ? a : new Date(a) > new Date(b) ? a : b);
const minDate = (a, b) => (!a ? b : !b ? a : new Date(a) < new Date(b) ? a : b);

/** @returns {Promise<Map<string, ReturnType<typeof timelineOf>>>} unitId -> timeline (setiap unitId yang diminta ada). */
export async function loadWorkshopTimelines(client, unitIds) {
  const ids = [...new Set((unitIds || []).filter(Boolean))];
  const out = new Map();
  if (!ids.length) return out;
  const raw = new Map(ids.map((id) => [id, {}]));
  const [pickupJobs, deliveryJobs, handoffs, receipts, runs, startLogs] = await Promise.all([
    client.jobUnit.findMany({ where: { unitId: { in: ids }, job: { type: "PICKUP", status: "COMPLETED" } }, select: { unitId: true, job: { select: { completedAt: true } } } }),
    client.jobUnit.findMany({ where: { unitId: { in: ids }, job: { type: "DELIVERY" } }, select: { unitId: true, job: { select: { id: true, status: true, completedAt: true } } } }),
    client.unitCustodyHandoff.findMany({ where: { unitId: { in: ids }, direction: { in: ["INBOUND", "FINISHED_GOODS"] } }, select: { unitId: true, direction: true, status: true, offeredAt: true, acceptedAt: true } }),
    client.unitWorkshopReceipt.findMany({ where: { unitId: { in: ids } }, select: { unitId: true, receivedAt: true } }),
    client.productionRun.findMany({
      where: { unitId: { in: ids }, status: { not: "CANCELLED" } },
      select: {
        unitId: true,
        phases: { where: { phase: { in: ["INTAKE", "HANDOFF"] } }, select: { phase: true, reason: true, startedAt: true, completedAt: true } },
        operations: { where: { status: { not: "SKIPPED" }, startedAt: { not: null } }, select: { startedAt: true } },
      },
    }),
    client.unitStageLog.groupBy({ by: ["unitId"], where: { unitId: { in: ids }, action: "START" }, _min: { createdAt: true } }),
  ]);
  for (const p of pickupJobs) { const r = raw.get(p.unitId); r.pickupCompletedAt = maxDate(r.pickupCompletedAt, p.job.completedAt); }
  const deliveryJobIds = new Set();
  for (const d of deliveryJobs) { deliveryJobIds.add(d.job.id); if (d.job.status === "COMPLETED") { const r = raw.get(d.unitId); r.deliveredAt = maxDate(r.deliveredAt, d.job.completedAt); } }
  for (const h of handoffs) {
    const r = raw.get(h.unitId);
    if (h.direction === "INBOUND" && h.status === "ACCEPTED") r.receivedAt = minDate(r.receivedAt, h.acceptedAt);
    if (h.direction === "FINISHED_GOODS") {
      if (h.status !== "CANCELLED" && h.status !== "SUPERSEDED") r.productionFinishedAt = maxDate(r.productionFinishedAt, h.offeredAt);
      if (h.status === "ACCEPTED") r.warehouseAcceptedAt = maxDate(r.warehouseAcceptedAt, h.acceptedAt);
    }
  }
  for (const rc of receipts) { const r = raw.get(rc.unitId); r.receivedAt = minDate(r.receivedAt, rc.receivedAt); } // penerimaan workshop petugas
  for (const run of runs) {
    const r = raw.get(run.unitId);
    for (const op of run.operations) r.productionStartedAt = minDate(r.productionStartedAt, op.startedAt);
    for (const ph of run.phases) {
      if (ph.phase === "INTAKE" && ph.reason === ARRIVAL_NO_CUSTODY_REASON) r.receivedAt = minDate(r.receivedAt, ph.completedAt || ph.startedAt);
      if (ph.phase === "HANDOFF" && ph.startedAt) r._handoffStartedAt = minDate(r._handoffStartedAt, ph.startedAt);
    }
  }
  for (const l of startLogs) { const r = raw.get(l.unitId); r.productionStartedAt = minDate(r.productionStartedAt, l._min.createdAt); }
  if (deliveryJobIds.size) {
    const events = await client.deliveryExecutionEvent.findMany({ where: { jobId: { in: [...deliveryJobIds] }, action: "JOB_STARTED" }, select: { jobId: true, occurredAt: true, createdAt: true } });
    const startedByJob = new Map();
    for (const e of events) startedByJob.set(e.jobId, minDate(startedByJob.get(e.jobId), e.occurredAt || e.createdAt));
    for (const d of deliveryJobs) { const s = startedByJob.get(d.job.id); if (s) { const r = raw.get(d.unitId); r.deliveryStartedAt = minDate(r.deliveryStartedAt, s); } }
  }
  for (const [id, r] of raw) {
    if (!r.productionFinishedAt && r._handoffStartedAt) r.productionFinishedAt = r._handoffStartedAt;
    out.set(id, timelineOf(r));
  }
  return out;
}

export { aggregateDurations };
