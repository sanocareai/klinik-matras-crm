import express from "express";
import { prisma } from "../db.js";
import { requireAuth } from "../middleware/auth.js";
import { buildPriorityList, buildOpportunityList } from "../services/intelligence/index.js";

// Wave 4A — API intelligence READ-ONLY. Role-scoped (ADMIN=tim, SALES=miliknya +
// belum diambil). Tidak menyentuh WAHA/SSE/inbox/auth/skema.
export const intelligenceRouter = express.Router();
intelligenceRouter.use(requireAuth);

// GET /api/intelligence/priority — customer paling butuh perhatian sekarang.
intelligenceRouter.get("/priority", async (req, res) => {
  try {
    const { id, role } = req.user;
    const items = await buildPriorityList(prisma, { userId: id, isAdmin: role === "ADMIN" });
    res.json({ items });
  } catch (err) {
    console.error("intelligence/priority error:", err);
    res.status(500).json({ error: "Gagal memuat prioritas" });
  }
});

// GET /api/intelligence/opportunities — peluang beli (buying signals).
intelligenceRouter.get("/opportunities", async (req, res) => {
  try {
    const { id, role } = req.user;
    const items = await buildOpportunityList(prisma, { userId: id, isAdmin: role === "ADMIN" });
    res.json({ items });
  } catch (err) {
    console.error("intelligence/opportunities error:", err);
    res.status(500).json({ error: "Gagal memuat opportunity" });
  }
});
