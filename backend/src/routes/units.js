// Endpoint produksi Sano Hub Phase 1 — kiosk scan & QC.
//
// STATUS: dibangun dan diuji, TAPI belum dipasang di app.use() index.js —
// lihat catatan Phase 1 di docs/sano-hub/. Memasangnya adalah langkah
// terpisah setelah kiosk UI siap, supaya tidak ada endpoint hidup tanpa UI
// yang memakainya dengan benar.

import express from "express";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  startStage, completeStage, failStage, skipStage, recordQcFitTest,
  StageTransitionError,
} from "../services/unitStageEngine.js";
import { prisma } from "../db.js";

export const unitRouter = express.Router();
unitRouter.use(requireAuth);

function handleEngineError(err, res) {
  if (err instanceof StageTransitionError) {
    return res.status(err.statusCode).json({ error: err.message });
  }
  console.error("Unit stage engine error:", err);
  return res.status(500).json({ error: "Server error: " + err.message });
}

// POST /api/units/:id/stages/start — mulai tahap berikutnya yang sah
// (atau retry tahap yang sedang blocked).
unitRouter.post("/:id/stages/start", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const result = await startStage(req.params.id, { actorId: req.user.id });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/complete
unitRouter.post("/:id/stages/:stageId/complete", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { photoUrls, note } = req.body;
    const log = await completeStage(req.params.id, req.params.stageId, {
      actorId: req.user.id, photoUrls, note,
    });
    res.json(log);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/fail — wajib blockReason (PRD §6.2).
unitRouter.post("/:id/stages/:stageId/fail", requirePermission(P.UNIT_STAGE_WRITE), async (req, res) => {
  try {
    const { blockReason, note } = req.body;
    const log = await failStage(req.params.id, req.params.stageId, {
      actorId: req.user.id, blockReason, note,
    });
    res.json(log);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/skip — hanya tahap opsional.
unitRouter.post("/:id/stages/skip", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const { note } = req.body;
    const log = await skipStage(req.params.id, { actorId: req.user.id, note });
    res.json(log);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/stages/:stageId/qc — putusan Uji Berat Badan (D-005).
// Permission QC_WRITE, TERPISAH dari UNIT_STAGE_WRITE biasa — hanya QC Leader
// (atau role yang diberi QC_WRITE) yang boleh memutuskan verdict.
unitRouter.post("/:id/stages/:stageId/qc", requirePermission(P.QC_WRITE), async (req, res) => {
  try {
    const { verdict, referenceWeightKg, customerPreferenceOverride, educationGiven, note, photoUrls } = req.body;
    const result = await recordQcFitTest(req.params.id, req.params.stageId, {
      actorId: req.user.id, verdict, referenceWeightKg,
      customerPreferenceOverride, educationGiven, note, photoUrls,
    });
    res.json(result);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// PATCH /api/units/:id/service — tetapkan/revisi layanan unit.
//
// CATATAN LINGKUP: ini BUKAN alur ScopeRevision lengkap (D-008) — belum ada
// pencatatan delta harga, belum ada status BLOCKED:awaiting_customer_approval,
// belum ada notifikasi WhatsApp ke customer. Endpoint minimal ini HANYA
// menetapkan service_id supaya jalur produksi unit bisa dihitung — Production
// Lead memutuskan lini/layanan di Uji Fondasi (D-008), tapi alur persetujuan
// customer untuk PERUBAHAN harga masih pekerjaan terpisah, belum dibangun.
unitRouter.patch("/:id/service", requirePermission(P.UNIT_ROUTING_WRITE), async (req, res) => {
  try {
    const { serviceId } = req.body;
    if (!serviceId) return res.status(400).json({ error: "serviceId wajib diisi" });

    const service = await prisma.serviceCatalog.findUnique({ where: { id: serviceId } });
    if (!service) return res.status(404).json({ error: "Layanan tidak ditemukan di katalog" });

    const unit = await prisma.unit.update({
      where: { id: req.params.id },
      data: { serviceId, serviceLine: service.serviceLine },
    });
    res.json(unit);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// GET /api/units/:id — detail unit + riwayat tahap, untuk layar kiosk.
unitRouter.get("/:id", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        currentStage: true,
        service: true,
        stageLogs: { orderBy: { createdAt: "desc" }, take: 20, include: { stage: true } },
        qcFitTests: { orderBy: { createdAt: "desc" }, take: 5 },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });
    res.json(unit);
  } catch (err) {
    handleEngineError(err, res);
  }
});
