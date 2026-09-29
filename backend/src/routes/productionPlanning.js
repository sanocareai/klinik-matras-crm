// Planning Produksi H-1 V2 (P3): antrean unit eligible, rencana (assignment workshop/operator/target waktu),
// Planned BOM, reservasi bahan Gudang. Semua pesan berbahasa Indonesia.
// Penulisan HANYA lewat productionPlanningCommandService (command owner). Visibilitas (GET) memakai flag
// production_v2_reader — fail-closed dan berdiri sendiri dari writer (production_v2_writer), sama pola dengan
// unit-custody P1-P2: UI ini bisa diperlihatkan tanpa ikut mengaktifkan mutasi.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { hasPermission, requireAnyPermission, requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  assignProductionPlan, cancelProductionPlan, createProductionPlan, getProductionPlan,
  listEligibleUnitsForPlanning, listProductionPlans, releaseMaterialReservations,
  reserveMaterialForPlan, setPlannedBOM,
} from "../services/productionPlanningCommandService.js";
import {
  cancelMaterialIssueBeforePick, getMaterialRequest, listMaterialRequests, pickMaterialIssue, requestMaterialPickup,
} from "../services/productionMaterialIssueCommandService.js";
import {
  completeWorkshopStage, getWorkshopRun, listWorkshopQueue, pauseWorkshopStage, registerWorkshopBornRun, resumeWorkshopStage, startWorkshopStage,
} from "../services/productionWorkshopExecutionCommandService.js";
import {
  cancelProductionRun, getQcRun, listQcQueue, listRunExceptions, openRunException, QC_QUEUE_TABS, recordQualityInspection, requestReworkMaterial,
  resolveHandoffRejection, resolveRunException, sweepRunExceptions,
} from "../services/productionQcHandoffCommandService.js";
import { PRODUCTION_READER_MODE, loadV2Flags, resolveProductionReaderState } from "../services/v2FeatureFlags.js";

export const productionPlanningRouter = express.Router();
productionPlanningRouter.use(requireAuth);

const PLAN_STATUSES = ["DRAFT", "PLANNED", "MATERIAL_RESERVED", "CANCELLED"];
const READ_PERMS = [P.UNIT_READ, P.INVENTORY_READ];
const WRITE_PERMS = [P.UNIT_MATERIAL_WRITE, P.INVENTORY_WRITE];

function handleErr(err, res) {
  if (Number.isInteger(err?.statusCode)) {
    return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.details ? { details: err.details } : {}) });
  }
  if (err?.code === "P2002") return res.status(409).json({ error: "Data rencana sudah ada atau sedang diproses", code: "PLAN_DUPLICATE" });
  console.error("Production planning error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

async function readerGate(res) {
  const readerState = resolveProductionReaderState(await loadV2Flags(prisma));
  if (readerState.mode === PRODUCTION_READER_MODE.OFF) {
    res.json({ items: [], readerMode: "OFF" });
    return null;
  }
  const unitIds = [...readerState.unitIds]; // mode selain OFF hanya COHORT (tidak ada GLOBAL)
  if (unitIds.length === 0) {
    res.json({ items: [], readerMode: "COHORT" });
    return null;
  }
  return { unitIds, readerMode: readerState.mode };
}

// GET /api/production-planning/eligible-units — antrean unit yang bisa direncanakan (belum punya plan aktif).
productionPlanningRouter.get("/eligible-units", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const gate = await readerGate(res);
    if (!gate) return;
    res.json({ items: await listEligibleUnitsForPlanning(prisma, { unitIds: gate.unitIds, limit: req.query.limit }), readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-planning/plans?status=PLANNED — daftar rencana.
productionPlanningRouter.get("/plans", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !PLAN_STATUSES.includes(status)) return res.status(400).json({ error: "Status rencana tidak valid", code: "PLAN_STATUS_INVALID" });
    const gate = await readerGate(res);
    if (!gate) return;
    res.json({ items: await listProductionPlans(prisma, { status, unitIds: gate.unitIds, limit: req.query.limit }), readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

// GET /api/production-planning/plans/:id — detail satu rencana.
productionPlanningRouter.get("/plans/:id", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const gate = await readerGate(res);
    if (!gate) return;
    const plan = await getProductionPlan(prisma, req.params.id);
    if (!plan) return res.status(404).json({ error: "Rencana produksi tidak ditemukan", code: "PLAN_NOT_FOUND" });
    if (gate.unitIds && !gate.unitIds.includes(plan.unit.id)) return res.status(404).json({ error: "Rencana produksi tidak ditemukan", code: "PLAN_NOT_FOUND" });
    res.json({ ...plan, readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans { runId } + header Idempotency-Key
productionPlanningRouter.post("/plans", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await createProductionPlan(prisma, {
      runId: req.body?.runId, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
    });
    res.status(201).json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans/:id/assign { workCenterId, operatorId, targetStartAt, targetCompleteAt, expectedRevision }
productionPlanningRouter.post("/plans/:id/assign", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await assignProductionPlan(prisma, {
      planId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, workCenterId: req.body?.workCenterId, operatorId: req.body?.operatorId,
      targetStartAt: req.body?.targetStartAt, targetCompleteAt: req.body?.targetCompleteAt,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans/:id/bom { lines: [{materialId, qty}], expectedRevision }
productionPlanningRouter.post("/plans/:id/bom", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await setPlannedBOM(prisma, {
      planId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, lines: req.body?.lines,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans/:id/reserve { expectedRevision } — reservasi bahan Gudang.
productionPlanningRouter.post("/plans/:id/reserve", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const result = await reserveMaterialForPlan(prisma, {
      planId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans/:id/release { reason, expectedRevision } — lepas reservasi tanpa mengubah BOM.
productionPlanningRouter.post("/plans/:id/release", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const result = await releaseMaterialReservations(prisma, {
      planId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans/:id/cancel { reason, expectedRevision }
productionPlanningRouter.post("/plans/:id/cancel", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await cancelProductionPlan(prisma, {
      planId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// ── P4: Pengambilan Bahan Produksi (Material Issue dari reservasi P3) ─────────────────────────────────────────
const ISSUE_STATUSES = ["READY_TO_PICK", "ISSUED", "CANCELLED"];

// GET /api/production-planning/material-requests?status=READY_TO_PICK&planId= — antrean Gudang + status untuk Produksi.
productionPlanningRouter.get("/material-requests", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const status = req.query.status ? String(req.query.status) : null;
    if (status && !ISSUE_STATUSES.includes(status)) return res.status(400).json({ error: "Status permintaan tidak valid", code: "MATERIAL_ISSUE_STATUS_INVALID" });
    const gate = await readerGate(res);
    if (!gate) return;
    const planId = req.query.planId ? String(req.query.planId) : null;
    res.json({ items: await listMaterialRequests(prisma, { status, planId, unitIds: gate.unitIds, limit: req.query.limit }), readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.get("/material-requests/:id", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const gate = await readerGate(res);
    if (!gate) return;
    const issue = await getMaterialRequest(prisma, req.params.id);
    if (!issue || (gate.unitIds && !gate.unitIds.includes(issue.unit?.id))) return res.status(404).json({ error: "Permintaan pengambilan bahan tidak ditemukan", code: "MATERIAL_ISSUE_NOT_FOUND" });
    res.json({ ...issue, readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/plans/:id/material-request + Idempotency-Key — Produksi mengajukan (tanpa body baris).
productionPlanningRouter.post("/plans/:id/material-request", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await requestMaterialPickup(prisma, { planId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey });
    res.status(201).json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/material-requests/:id/pick { expectedRevision } — Gudang "Serahkan Bahan".
productionPlanningRouter.post("/material-requests/:id/pick", requirePermission(P.INVENTORY_WRITE), async (req, res) => {
  try {
    const result = await pickMaterialIssue(prisma, {
      issueId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey, expectedRevision: req.body?.expectedRevision,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// POST /api/production-planning/material-requests/:id/cancel { reason, expectedRevision } — hanya sebelum PICKED.
productionPlanningRouter.post("/material-requests/:id/cancel", requireAnyPermission(...WRITE_PERMS), async (req, res) => {
  try {
    const result = await cancelMaterialIssueBeforePick(prisma, {
      issueId: req.params.id, actorId: req.user.id, idempotencyKey: req.get("Idempotency-Key") || req.body?.idempotencyKey,
      expectedRevision: req.body?.expectedRevision, reason: req.body?.reason,
    });
    res.json(result);
  } catch (err) { handleErr(err, res); }
});

// ── P5: Eksekusi Workshop (mulai/jeda/lanjutkan/selesai tahap; unit BARU/SEWA lahir di workshop) ─────────────
// Command HANYA lewat productionWorkshopExecutionCommandService. Operator = pengguna yang ditugaskan di rencana (P3).
const EXEC_PERMS = [P.UNIT_STAGE_WRITE];
const idemKey = (req) => req.get("Idempotency-Key") || req.body?.idempotencyKey;

productionPlanningRouter.get("/workshop/queue", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const gate = await readerGate(res);
    if (!gate) return;
    const scope = req.query.scope === "all" ? "all" : "today";
    const operatorUserId = req.query.mine === "1" || req.query.mine === "true" ? req.user.id : null;
    res.json({ items: await listWorkshopQueue(prisma, { unitIds: gate.unitIds, operatorUserId, scope, limit: req.query.limit }), readerMode: gate.readerMode, scope });
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.get("/workshop/runs/:runId", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const gate = await readerGate(res);
    if (!gate) return;
    const run = await getWorkshopRun(prisma, req.params.runId);
    if (!run || (gate.unitIds && !gate.unitIds.includes(run.unit.id))) return res.status(404).json({ error: "Production Run tidak ditemukan", code: "WORKSHOP_RUN_NOT_FOUND" });
    res.json({ ...run, readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/workshop/runs", requireAnyPermission(P.UNIT_ROUTING_WRITE, P.UNIT_MATERIAL_WRITE), async (req, res) => {
  try {
    res.status(201).json(await registerWorkshopBornRun(prisma, { unitId: req.body?.unitId, actorId: req.user.id, idempotencyKey: idemKey(req) }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/workshop/runs/:runId/start", requireAnyPermission(...EXEC_PERMS), async (req, res) => {
  try {
    res.json(await startWorkshopStage(prisma, { runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision, workCenterId: req.body?.workCenterId }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/workshop/runs/:runId/pause", requireAnyPermission(...EXEC_PERMS), async (req, res) => {
  try {
    res.json(await pauseWorkshopStage(prisma, {
      runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision, workCenterId: req.body?.workCenterId,
      reason: req.body?.reason, note: req.body?.note, photoUrls: Array.isArray(req.body?.photoUrls) ? req.body.photoUrls : [],
    }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/workshop/runs/:runId/resume", requireAnyPermission(...EXEC_PERMS), async (req, res) => {
  try {
    res.json(await resumeWorkshopStage(prisma, { runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision, workCenterId: req.body?.workCenterId }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/workshop/runs/:runId/complete", requireAnyPermission(...EXEC_PERMS), async (req, res) => {
  try {
    res.json(await completeWorkshopStage(prisma, {
      runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision, workCenterId: req.body?.workCenterId,
      note: req.body?.note, photoUrls: Array.isArray(req.body?.photoUrls) ? req.body.photoUrls : [],
    }));
  } catch (err) { handleErr(err, res); }
});

// ── P6: QC V2 (PASS/FAIL/WAIVED), rework, handoff barang jadi, rekonsiliasi override V1 ───────────────────────────
// Command HANYA lewat productionQcHandoffCommandService (keputusan Gudang atas barang jadi lewat /api/inventory/unit-custody, direction=FINISHED_GOODS).
// QC_WAIVED dan penerimaan override V1 memerlukan QC_WAIVE (ADMIN/OWNER); PASS/FAIL memerlukan QC_WRITE.
const QC_DECIDE_PERMS = [P.QC_WRITE, P.QC_WAIVE];
const SUPERVISOR_PERMS = [P.UNIT_ROUTING_WRITE];
const RECONCILE_PERMS = [P.UNIT_ROUTING_WRITE, P.INVENTORY_WRITE, P.QC_WAIVE];

productionPlanningRouter.get("/qc/queue", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const tab = QC_QUEUE_TABS.includes(String(req.query.tab)) ? String(req.query.tab) : "AWAITING_QC";
    const gate = await readerGate(res);
    if (!gate) return;
    res.json({ items: await listQcQueue(prisma, { tab, unitIds: gate.unitIds, limit: req.query.limit }), readerMode: gate.readerMode, tab });
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.get("/qc/runs/:runId", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const gate = await readerGate(res);
    if (!gate) return;
    const run = await getQcRun(prisma, req.params.runId);
    if (!run || (gate.unitIds && !gate.unitIds.includes(run.unit.id))) return res.status(404).json({ error: "Production Run tidak ditemukan", code: "QC_RUN_NOT_FOUND" });
    res.json({ ...run, readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/qc/runs/:runId/inspect", requireAnyPermission(...QC_DECIDE_PERMS), async (req, res) => {
  try {
    const b = req.body || {};
    res.json(await recordQualityInspection(prisma, {
      runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: b.expectedRevision,
      canInspect: hasPermission(req.user, P.QC_WRITE), canWaive: hasPermission(req.user, P.QC_WAIVE),
      result: b.result, note: b.note, reason: b.reason, photoUrls: b.photoUrls, referenceWeightKg: b.referenceWeightKg, fitVerdict: b.fitVerdict,
      customerPreferenceOverride: b.customerPreferenceOverride, educationGiven: b.educationGiven, items: b.items, reworkStageId: b.reworkStageId,
      supplementalMaterials: b.supplementalMaterials,
    }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/qc/runs/:runId/rework-material", requireAnyPermission(P.UNIT_ROUTING_WRITE, P.QC_WRITE), async (req, res) => {
  try {
    res.status(201).json(await requestReworkMaterial(prisma, { runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision, lines: req.body?.lines }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/qc/runs/:runId/handoff-rejection", requireAnyPermission(...SUPERVISOR_PERMS), async (req, res) => {
  try {
    res.json(await resolveHandoffRejection(prisma, {
      runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision,
      action: req.body?.action, note: req.body?.note, reworkStageId: req.body?.reworkStageId,
    }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/qc/runs/:runId/cancel", requireAnyPermission(...SUPERVISOR_PERMS), async (req, res) => {
  try {
    res.json(await cancelProductionRun(prisma, { runId: req.params.runId, actorId: req.user.id, idempotencyKey: idemKey(req), expectedRevision: req.body?.expectedRevision, reason: req.body?.reason }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.get("/exceptions", requireAnyPermission(...READ_PERMS), async (req, res) => {
  try {
    const status = ["OPEN", "RESOLVED"].includes(String(req.query.status)) ? String(req.query.status) : "OPEN";
    const gate = await readerGate(res);
    if (!gate) return;
    res.json({ items: await listRunExceptions(prisma, { status, unitIds: gate.unitIds, limit: req.query.limit }), readerMode: gate.readerMode });
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/exceptions/open", requireAnyPermission(...RECONCILE_PERMS), async (req, res) => {
  try {
    res.status(201).json(await openRunException(prisma, { runId: req.body?.runId, actorId: req.user.id, idempotencyKey: idemKey(req) }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/exceptions/sweep", requireAnyPermission(...RECONCILE_PERMS), async (req, res) => {
  try {
    res.json(await sweepRunExceptions(prisma, { actorId: req.user.id, idempotencyKey: idemKey(req), limit: req.body?.limit }));
  } catch (err) { handleErr(err, res); }
});

productionPlanningRouter.post("/exceptions/:id/resolve", requireAnyPermission(...RECONCILE_PERMS), async (req, res) => {
  try {
    res.json(await resolveRunException(prisma, {
      exceptionId: req.params.id, actorId: req.user.id, canWaive: hasPermission(req.user, P.QC_WAIVE), idempotencyKey: idemKey(req),
      expectedRevision: req.body?.expectedRevision, resolution: req.body?.resolution, note: req.body?.note,
    }));
  } catch (err) { handleErr(err, res); }
});
