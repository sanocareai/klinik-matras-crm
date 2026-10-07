// P12C.1 — antrean pekerjaan V1 per PIC untuk Aplikasi Meja/Corner. BACA-SAJA: tidak menulis apa pun, tidak membuat Run/rencana/antrean baru.
// Kandidat unit = unit yang punya StageAssignment ke operator ini (penugasan sah, termasuk yang BELUM dimulai); keadaan diturunkan dari engine V1
// (resolveCurrentTarget) + penugasan tahap hilir/sebelumnya (lib/domain/v1WorkerQueue.js). Unit di cohort reader V2 TIDAK dimuat di sini (antrean V2 yang memuatnya).
import { buildTrackUnits, pathForUnit, resolveCurrentTarget } from "./unitStageEngine.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState } from "./v2FeatureFlags.js";
import { deriveV1WorkItem, lastPicOperatorId, laneOfStage, rankV1Items } from "../lib/domain/v1WorkerQueue.js";
import { displayStatusOfOrder, displayStatusOfUnit, priorityDisplay } from "../lib/domain/productionDisplay.js";
import { loadOpenComplaintsByUnit } from "./productionComplaints.js";

const WORK_STATUSES = ["RECEIVED", "IN_PRODUCTION"];
const stageView = (s) => (s ? { id: s.id, code: s.code, labelId: s.labelId, phase: s.phase, requiresPhoto: !!s.requiresPhoto, requiresQc: !!s.requiresQc, lane: laneOfStage(s) } : null);

export async function listV1WorkerQueue(prisma, { userId, lane }) {
  const wantLane = lane === "CORNER" ? "CORNER" : "TABLE";
  const operator = userId ? await prisma.productionOperator.findUnique({ where: { userId }, select: { id: true, active: true } }) : null;
  if (!operator || !operator.active) return { operator: null, lane: wantLane, items: [] };

  const mine = await prisma.stageAssignment.findMany({ where: { operatorId: operator.id }, select: { unitId: true } });
  const candidateIds = [...new Set(mine.map((m) => m.unitId))];
  if (!candidateIds.length) return { operator: { id: operator.id }, lane: wantLane, items: [] };

  const readerState = resolveProductionReaderState(await loadV2Flags(prisma));
  const v2Units = readerState.mode === PRODUCTION_READER_MODE.OFF ? new Set() : new Set(readerState.unitIds);
  const units = await prisma.unit.findMany({
    where: { id: { in: candidateIds.filter((id) => !v2Units.has(id)) }, status: { in: WORK_STATUSES } },
    select: {
      id: true, orderId: true, unitCode: true, merk: true, ukuran: true, status: true, priority: true, productionDueAt: true, createdAt: true, serviceId: true, currentStageId: true,
      service: { select: { id: true, code: true, labelId: true } },
      order: { select: { orderNumber: true, status: true, customer: { select: { name: true } } } },
    },
  });
  if (!units.length) return { operator: { id: operator.id }, lane: wantLane, items: [] };
  const unitIds = units.map((u) => u.id);

  const [assignRows, doneLogs] = await Promise.all([
    prisma.stageAssignment.findMany({ where: { unitId: { in: unitIds } }, select: { unitId: true, stageId: true, operatorId: true, operator: { select: { user: { select: { name: true } } } } } }),
    prisma.unitStageLog.findMany({ where: { unitId: { in: unitIds }, action: { in: ["COMPLETE", "SKIP"] } }, orderBy: { createdAt: "desc" }, select: { unitId: true, stageId: true, actorId: true } }),
  ]);
  const operators = await prisma.productionOperator.findMany({ where: { userId: { in: [...new Set(doneLogs.map((l) => l.actorId).filter(Boolean))] } }, select: { id: true, userId: true } });
  const operatorByUser = new Map(operators.map((o) => [o.userId, o.id]));
  const assignByUnit = new Map(); const actorByUnitStage = new Map();
  for (const a of assignRows) { if (!assignByUnit.has(a.unitId)) assignByUnit.set(a.unitId, new Map()); assignByUnit.get(a.unitId).set(a.stageId, { operatorId: a.operatorId, operatorName: a.operator?.user?.name ?? null }); }
  for (const l of doneLogs) { const k = `${l.unitId}:${l.stageId}`; if (!actorByUnitStage.has(k)) actorByUnitStage.set(k, l.actorId); } // log terbaru menang (urut desc)

  const complaintsByUnit = await loadOpenComplaintsByUnit(prisma, units.map((u) => ({ id: u.id, orderId: u.orderId })));
  const pathCache = new Map();
  const buildUnits = await buildTrackUnits(prisma, unitIds);
  const items = [];
  for (const unit of units) {
    const info = buildUnits.get(unit.id); const build = !!info; const noCorner = info?.cornerRequired === false; // jalur pengerjaan tidak bergantung layanan: kunci cache memuat jalurnya
    const cacheKey = build ? (noCorner ? "build-nocorner" : "build") : (unit.serviceId ?? "none");
    if (!pathCache.has(cacheKey)) pathCache.set(cacheKey, await pathForUnit(prisma, unit, { build, noCorner }));
    const path = pathCache.get(cacheKey);
    const target = await resolveCurrentTarget(prisma, unit, path);
    const assignments = assignByUnit.get(unit.id) || new Map();
    const completedActorByStage = new Map(path.map((s) => [s.id, actorByUnitStage.get(`${unit.id}:${s.id}`) ?? null]));
    const derived = deriveV1WorkItem({
      path, target, assignments, operatorId: operator.id,
      lastPicOperatorId: lastPicOperatorId({ path, target, assignments, completedActorByStage, operatorByUser }),
    });
    if (!derived || derived.lane !== wantLane) continue; // QC bukan lantai Meja/Corner; lini lain tidak ikut
    items.push({
      unit: { priorityDisplay: (() => { const p = priorityDisplay({ stored: unit.priority, complaintCases: complaintsByUnit.get(unit.id) || [] }); return { key: p.key, label: p.label, rank: p.rank, complaintCases: p.complaintCases }; })(), orderStatusDisplay: displayStatusOfOrder(unit.order?.status), unitStatusDisplay: displayStatusOfUnit(unit.status), id: unit.id, unitCode: unit.unitCode, merk: unit.merk, ukuran: unit.ukuran, status: unit.status, priority: unit.priority, productionDueAt: unit.productionDueAt, createdAt: unit.createdAt, serviceLabel: unit.service?.labelId ?? null, order: { orderNumber: unit.order?.orderNumber ?? null, customer: { name: unit.order?.customer?.name ?? null } } },
      state: derived.state, lane: derived.lane, stage: stageView(derived.stage),
      prerequisite: derived.prerequisite ? { stage: stageView(derived.prerequisite.stage), state: derived.prerequisite.state, assignee: derived.prerequisite.assignee, assigned: derived.prerequisite.assigned } : null,
      waitingFor: derived.waitingFor ? stageView(derived.waitingFor) : null,
    });
  }
  return { operator: { id: operator.id }, lane: wantLane, items: rankV1Items(items) };
}
