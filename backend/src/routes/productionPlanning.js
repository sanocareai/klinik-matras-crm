// Planning Produksi H-1 V2 (P3): antrean unit eligible, rencana (assignment workshop/operator/target waktu),
// Planned BOM, reservasi bahan Gudang. Semua pesan berbahasa Indonesia.
// Penulisan HANYA lewat productionPlanningCommandService (command owner). Visibilitas (GET) memakai flag
// production_v2_reader — fail-closed dan berdiri sendiri dari writer (production_v2_writer), sama pola dengan
// unit-custody P1-P2: UI ini bisa diperlihatkan tanpa ikut mengaktifkan mutasi.
import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requireAnyPermission, requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  assignProductionPlan, cancelProductionPlan, createProductionPlan, getProductionPlan,
  listEligibleUnitsForPlanning, listProductionPlans, releaseMaterialReservations,
  reserveMaterialForPlan, setPlannedBOM,
} from "../services/productionPlanningCommandService.js";
import {
  cancelMaterialIssueBeforePick, getMaterialRequest, listMaterialRequests, pickMaterialIssue, requestMaterialPickup,
} from "../services/productionMaterialIssueCommandService.js";
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
  const unitIds = readerState.mode === PRODUCTION_READER_MODE.COHORT ? [...readerState.unitIds] : null;
  if (unitIds && unitIds.length === 0) {
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
