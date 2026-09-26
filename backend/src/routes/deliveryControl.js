// Gerbang aplikasi Sano Delivery Control. Ini SATU-SATUNYA endpoint khusus Control:
// bootstrap sesi yang dijaga izin eksplisit delivery:control:access. Fungsi-fungsi
// aplikasi lainnya memakai endpoint yang sudah ada dengan izinnya masing-masing
// (mis. /api/finance/expense-submissions/*), TIDAK ada endpoint biaya paralel di sini.
//
// Klien hanya mencerminkan `capabilities` dari respons ini; penolakan terjadi di
// server (403), bukan di UI.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { requirePermission, rolesOf } from "../middleware/authorize.js";
import { capabilitiesFor } from "../services/capabilities.js";
import { PERMISSIONS as P } from "../constants/permissions.js";

export const deliveryControlRouter = express.Router();
deliveryControlRouter.use(requireAuth);

deliveryControlRouter.get("/session", requirePermission(P.DELIVERY_CONTROL_ACCESS), async (req, res) => {
  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { id: true, name: true, role: true, avatarUrl: true, active: true },
    });
    if (!user || user.active === false) return res.status(401).json({ error: "User tidak ditemukan atau nonaktif" });
    const { active, ...aman } = user;
    res.json({ ...aman, roles: rolesOf(req.user), capabilities: capabilitiesFor(req.user) });
  } catch (err) {
    console.error("[delivery-control/session]", err.message);
    res.status(500).json({ error: "Server error" });
  }
});
