// Revisi scope (PRD §7.4 / FR-R, D-008).
//
// DUA SISI, DUA PERMISSION — dan pemisahan itu inti alurnya:
//   SCOPE_REVISION_PROPOSE (produksi & QC) — yang membongkar kasur dan
//     melihat kondisi aslinya yang mengajukan
//   SCOPE_REVISION_DECIDE  (sales & admin)  — yang bicara ke customer yang
//     merekam hasilnya
// Satu orang tidak boleh mengarang delta harga sekaligus menyetujuinya.
//
// Aturan bisnis ada di services/scopeRevision.js, bukan di sini.

import express from "express";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import multer from "multer";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, requireAnyPermission, PERMISSIONS as P } from "../middleware/authorize.js";
import { prisma } from "../db.js";
import {
  proposeScopeRevision, decideScopeRevision, buildCustomerSummary, ScopeRevisionError,
} from "../services/scopeRevision.js";

export const scopeRevisionRouter = express.Router();
scopeRevisionRouter.use(requireAuth);

// Foto bukti temuan bongkar — dir TERPISAH dari unit-photos (foto proses).
// Bukti negosiasi harga punya kepentingan hukum & umur simpan berbeda dari
// foto tahap produksi biasa.
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const revisionPhotosDir = path.join(__dirname, "../../data/scope-revision-photos");
if (!fs.existsSync(revisionPhotosDir)) fs.mkdirSync(revisionPhotosDir, { recursive: true });

const upload = multer({
  storage: multer.diskStorage({
    destination: revisionPhotosDir,
    filename: (req, file, cb) => {
      const ext = path.extname(file.originalname) || ".jpg";
      cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
    },
  }),
  limits: { fileSize: 8 * 1024 * 1024 },
});

function kirimError(res, err, pesanDefault) {
  if (err instanceof ScopeRevisionError) return res.status(err.statusCode).json({ error: err.message });
  console.error(pesanDefault, err);
  return res.status(500).json({ error: pesanDefault });
}

// GET /api/scope-revisions?status=PENDING — papan "menunggu jawaban customer".
// Boleh dibaca siapa pun yang boleh mengajukan ATAU memutuskan; pembatasannya
// di dua permission itu, bukan daftar role ad-hoc.
scopeRevisionRouter.get("/", requireAnyPermission(P.SCOPE_REVISION_PROPOSE, P.SCOPE_REVISION_DECIDE), async (req, res) => {
  try {
    const { status, unitId, orderId } = req.query;
    const revisions = await prisma.scopeRevision.findMany({
      where: {
        ...(status && { status }),
        ...(unitId && { unitId }),
        ...(orderId && { orderId }),
      },
      orderBy: { createdAt: "desc" },
      take: 200,
      include: {
        unit: { select: { unitCode: true, merk: true, ukuran: true, status: true } },
        order: { select: { orderNumber: true, customerId: true } },
        fromService: { select: { code: true, labelId: true, serviceLine: true } },
        toService: { select: { code: true, labelId: true, serviceLine: true } },
        stage: { select: { code: true, labelId: true } },
        createdBy: { select: { id: true, name: true } },
        decidedBy: { select: { id: true, name: true } },
      },
    });
    res.json(revisions);
  } catch (err) {
    kirimError(res, err, "Gagal memuat daftar revisi");
  }
});

// GET /api/scope-revisions/:id/summary — ringkasan siap kirim ke customer
// (FR-R-03). CS menyalin ini ke WhatsApp; pengirimannya TETAP manual, PRD §7.8
// eksplisit: revisi scope butuh manusia, bukan template otomatis.
scopeRevisionRouter.get("/:id/summary", requireAnyPermission(P.SCOPE_REVISION_PROPOSE, P.SCOPE_REVISION_DECIDE), async (req, res) => {
  try {
    res.json(await buildCustomerSummary(req.params.id));
  } catch (err) {
    kirimError(res, err, "Gagal menyusun ringkasan revisi");
  }
});

// POST /api/units/:unitId/scope-revisions — ajukan (FR-R-01)
scopeRevisionRouter.post(
  "/units/:unitId",
  requirePermission(P.SCOPE_REVISION_PROPOSE),
  upload.array("photos", 8),
  async (req, res) => {
    try {
      const photoUrls = (req.files || []).map((f) => `/media/scope-revision-photos/${f.filename}`);
      const hasil = await proposeScopeRevision(req.params.unitId, {
        actorId: req.user.id,
        reason: req.body.reason,
        deltaAmount: req.body.deltaAmount,
        toServiceId: req.body.toServiceId || null,
        stageId: req.body.stageId || null,
        note: req.body.note,
        photoUrls,
      });
      res.status(201).json(hasil);
    } catch (err) {
      kirimError(res, err, "Gagal mengajukan revisi");
    }
  }
);

// PATCH /api/scope-revisions/:id/decision — rekam hasil dari customer (FR-R-04)
scopeRevisionRouter.patch(
  "/:id/decision",
  requirePermission(P.SCOPE_REVISION_DECIDE),
  upload.single("evidence"),
  async (req, res) => {
    try {
      const hasil = await decideScopeRevision(req.params.id, {
        actorId: req.user.id,
        status: req.body.status,
        decidedVia: req.body.decidedVia,
        evidenceUrl: req.file ? `/media/scope-revision-photos/${req.file.filename}` : req.body.evidenceUrl,
        decisionNote: req.body.decisionNote,
        finalDeltaAmount: req.body.finalDeltaAmount,
      });
      res.json(hasil);
    } catch (err) {
      kirimError(res, err, "Gagal merekam keputusan revisi");
    }
  }
);
