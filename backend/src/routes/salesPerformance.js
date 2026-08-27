// ═══ SALES PERFORMANCE INTELLIGENCE — route laporan (read-only) ═══════════
// Admin-only, murni agregasi live dari Quality Scorer + Sales Risk Engine +
// SLA/response-time yang SUDAH ADA — TIDAK ADA panggilan LLM/scoring baru
// di sini. Nama route SENGAJA "sales-intelligence" (bukan "sales-
// performance") supaya tidak bentrok dgn /api/analytics/sales-performance
// yang sudah ada (endpoint tipis lama: totalOrderValue/target saja).
import express from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getIndividualProfiles, buildTeamDashboard } from "../services/salesPerformance/index.js";

export const salesPerformanceRouter = express.Router();
salesPerformanceRouter.use(requireAuth);

salesPerformanceRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(90, parseInt(req.query.days, 10) || 30));
    const individual = await getIndividualProfiles({ days });
    const team = buildTeamDashboard(individual);
    res.json({ days, individual, team });
  } catch (err) {
    console.error("sales-intelligence error:", err);
    res.status(500).json({ error: "Gagal memuat Sales Performance Intelligence" });
  }
});
