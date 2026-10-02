// /api/production-v2/targets — riwayat & pengaturan target harian Produksi V2 (P11.1). requireAuth sudah dipasang di productionExperienceRouter.
// GET: izin laporan penuh (PRODUCTION_REPORT_READ). POST: PRODUCTION_TARGET_WRITE (ADMIN/OWNER). Penulisan hanya lewat productionTargetService (create-only).
import express from "express";
import { prisma } from "../db.js";
import { hasPermission } from "../middleware/authorize.js";
import { PERMISSIONS as P } from "../constants/permissions.js";
import { listTargets, setDailyTarget } from "../services/productionTargetService.js";

export const productionTargetsRouter = express.Router();
const handleErr = (err, res) => {
  if (Number.isInteger(err?.statusCode)) return res.status(err.statusCode).json({ error: err.message, ...(err.code ? { code: err.code } : {}) });
  console.error("Production target error:", err);
  return res.status(500).json({ error: "Terjadi kesalahan di server" });
};

productionTargetsRouter.get("/", async (req, res) => {
  try {
    if (!hasPermission(req.user, P.PRODUCTION_REPORT_READ)) return res.status(403).json({ error: "Anda tidak punya akses ke target produksi", code: "TARGET_FORBIDDEN" });
    return res.json({ ...(await listTargets(prisma)), canWrite: hasPermission(req.user, P.PRODUCTION_TARGET_WRITE) });
  } catch (err) { return handleErr(err, res); }
});

productionTargetsRouter.post("/", async (req, res) => {
  try {
    if (!hasPermission(req.user, P.PRODUCTION_TARGET_WRITE)) return res.status(403).json({ error: "Hanya Admin/Owner yang boleh mengatur target harian", code: "TARGET_FORBIDDEN" });
    const body = req.body || {};
    const row = await setDailyTarget(prisma, { effectiveFrom: body.effectiveFrom, targetUnits: body.targetUnits, reason: body.reason, actorId: req.user.id });
    return res.status(201).json({ target: row });
  } catch (err) { return handleErr(err, res); }
});
