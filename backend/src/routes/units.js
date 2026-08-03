// Endpoint produksi Sano Hub Phase 1 — kiosk scan & QC.
//
// Dipasang di index.js di balik requirePermission — aman walau belum ada
// user yang punya role produksi (lihat docs/sano-hub/PHASE-0.md).

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, PERMISSIONS as P } from "../middleware/authorize.js";
import {
  startStage, completeStage, failStage, skipStage, recordQcFitTest, getUnitStatus,
  StageTransitionError,
} from "../services/unitStageEngine.js";
import { buildUnitPath } from "../lib/domain/routing.js";
import { prisma } from "../db.js";

export const unitRouter = express.Router();
unitRouter.use(requireAuth);

// Upload foto tahap produksi — pola SAMA dengan routes/products.js (multer
// disk storage + kompresi sudah dilakukan di klien sebelum upload, lihat
// frontend/src/utils/compressImage.js).
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const unitPhotosDir = path.join(__dirname, "../../data/unit-photos");
if (!fs.existsSync(unitPhotosDir)) fs.mkdirSync(unitPhotosDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: unitPhotosDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${req.params.id}-${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 }, // 8 MB — foto sudah dikompres di klien, ini jaring pengaman
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) return cb(new Error("Hanya file gambar yang diperbolehkan"));
    cb(null, true);
  },
});

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

// GET /api/units/by-code/:code — cari unit dari hasil scan QR / input kiosk.
// HARUS didaftarkan SEBELUM "/:id" — kalau tidak, Express akan mencocokkan
// "by-code" sebagai path param :id dan endpoint ini tidak pernah kena.
//
// Sekaligus mengembalikan status produksi (getUnitStatus) supaya kiosk bisa
// langsung tahu tombol apa yang harus ditampilkan TANPA menghitung sendiri
// jalur routing di frontend — satu-satunya sumber kebenaran tetap di server.
unitRouter.get("/by-code/:code", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({ where: { unitCode: req.params.code } });
    if (!unit) return res.status(404).json({ error: `Unit dengan kode "${req.params.code}" tidak ditemukan` });
    const status = await getUnitStatus(unit.id);
    res.json(status);
  } catch (err) {
    handleEngineError(err, res);
  }
});

// POST /api/units/:id/photos — upload foto tahap (multipart, field "photos").
// Mengembalikan array URL, dipakai kiosk sebagai photoUrls saat memanggil
// complete/qc. Foto TIDAK langsung menempel ke ledger di sini — upload dan
// penulisan log adalah dua langkah terpisah supaya foto yang gagal diproses
// tidak membuat baris ledger korup.
unitRouter.post("/:id/photos", requirePermission(P.UNIT_STAGE_WRITE), upload.array("photos", 6), async (req, res) => {
  try {
    const urls = (req.files || []).map((f) => `/media/unit-photos/${f.filename}`);
    res.json({ urls });
  } catch (err) {
    handleEngineError(err, res);
  }
});

// GET /api/units/:id — status produksi lengkap, untuk layar kiosk.
unitRouter.get("/:id", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const status = await getUnitStatus(req.params.id);
    res.json(status);
  } catch (err) {
    if (err.code === "P2025") return res.status(404).json({ error: "Unit tidak ditemukan" });
    handleEngineError(err, res);
  }
});

// GET /api/units/:id/timeline — jalur PENUH + riwayat ledger, untuk halaman
// detail unit (Production Tahap 2). BEDA dari GET /:id (getUnitStatus, dipakai
// kiosk): itu cuma tahu tahap yang harus ditindak SEKARANG, ini menyusun
// SELURUH tahap jalur beserta status masing-masing — untuk manusia yang
// ingin melihat progres dari awal, bukan cuma "apa selanjutnya".
//
// Status per tahap DIHITUNG dari log yang sama (unit_stage_logs), TIDAK ada
// sumber kebenaran kedua — kalau log kosong untuk suatu tahap, tahap itu
// NOT_STARTED, apa adanya (bukan ditebak "mestinya sudah lewat").
unitRouter.get("/:id/timeline", requirePermission(P.UNIT_READ), async (req, res) => {
  try {
    const unit = await prisma.unit.findUnique({
      where: { id: req.params.id },
      include: {
        service: true,
        currentStage: true,
        order: { select: { id: true, orderNumber: true, status: true, customer: { select: { id: true, name: true, phone: true } } } },
        qcFitTests: { include: { stage: { select: { id: true, labelId: true } }, testedBy: { select: { id: true, name: true } } }, orderBy: { createdAt: "desc" } },
      },
    });
    if (!unit) return res.status(404).json({ error: "Unit tidak ditemukan" });

    const [intakeStages, finishStages, moduleMappings, logs] = await Promise.all([
      prisma.routingStage.findMany({ where: { phase: "INTAKE", active: true } }),
      prisma.routingStage.findMany({ where: { phase: "FINISH", active: true } }),
      unit.serviceId
        ? prisma.serviceCatalogModule.findMany({ where: { serviceId: unit.serviceId }, orderBy: { sequence: "asc" }, include: { stage: true } })
        : Promise.resolve([]),
      prisma.unitStageLog.findMany({
        where: { unitId: unit.id },
        include: { actor: { select: { id: true, name: true } } },
        orderBy: { createdAt: "asc" },
      }),
    ]);

    const path = buildUnitPath(intakeStages, moduleMappings.map((m) => m.stage), finishStages);
    const logsByStage = {};
    for (const log of logs) (logsByStage[log.stageId] ??= []).push(log);

    const timeline = path.map((stage) => {
      const stageLogs = logsByStage[stage.id] || [];
      const last = stageLogs[stageLogs.length - 1] || null;
      let status = "NOT_STARTED";
      if (last) {
        if (last.action === "START") status = "IN_PROGRESS";
        else if (last.action === "FAIL") status = "BLOCKED";
        else if (last.action === "COMPLETE") status = "DONE";
        else if (last.action === "SKIP") status = "SKIPPED";
      }
      return { stage, status, logs: stageLogs, isCurrent: unit.currentStageId === stage.id };
    });

    res.json({
      unit, path: timeline, qcFitTests: unit.qcFitTests,
      needsService: !unit.serviceId,
    });
  } catch (err) {
    handleEngineError(err, res);
  }
});
