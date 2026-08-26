// ═══ AI CONVERSATION QUALITY SCORER — route laporan (read-only + trigger manual) ═══
// Admin-only: ini alat coaching/audit yang membaca ringkasan percakapan
// SEMUA sales, setara sensitivitasnya dengan Laporan Sales.
import express from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getWeeklyRollup } from "../services/qualityScorer/rollup.js";
import { runQualityScorerJob } from "../services/qualityScorer/job.js";
import { RUBRIC_DIMENSIONS, SAMPLE_SIZE_PER_SALES, MAX_DAILY_LLM_CALLS } from "../config/qualityScorerRubric.js";

export const qualityScorerRouter = express.Router();
qualityScorerRouter.use(requireAuth);

// Rolling N hari (default 7) — BUKAN kalender Senin-Minggu, supaya bebas
// dari ambiguitas "minggu mulai hari apa" dan konsisten dengan preset
// "7 hari" yang sudah dipakai date range picker di frontend.
qualityScorerRouter.get("/weekly", requireAdmin, async (req, res) => {
  try {
    const days = Math.max(1, Math.min(31, parseInt(req.query.days, 10) || 7));
    const now = new Date();
    const weekEnd = now;
    const weekStart = new Date(now.getTime() - days * 86_400_000);
    const prevWeekEnd = weekStart;
    const prevWeekStart = new Date(weekStart.getTime() - days * 86_400_000);

    const rollup = await getWeeklyRollup({ weekStart, weekEnd, prevWeekStart, prevWeekEnd });
    res.json({
      ...rollup,
      dimensions: RUBRIC_DIMENSIONS.map(({ key, label, description }) => ({ key, label, description })),
      config: { sampleSizePerSales: SAMPLE_SIZE_PER_SALES, maxDailyLlmCalls: MAX_DAILY_LLM_CALLS },
    });
  } catch (err) {
    console.error("quality-scorer weekly error:", err);
    res.status(500).json({ error: "Gagal memuat rollup Quality Scorer" });
  }
});

// Trigger manual — utk verifikasi/testing tanpa menunggu jadwal cron
// (03:00 WIB). SENGAJA tidak ada rate-limit tambahan di sini selain
// MAX_DAILY_LLM_CALLS yang sudah ditegakkan di dalam job itu sendiri.
qualityScorerRouter.post("/run", requireAdmin, async (req, res) => {
  try {
    const summary = await runQualityScorerJob();
    res.json(summary);
  } catch (err) {
    console.error("quality-scorer manual run error:", err);
    res.status(500).json({ error: err.message || "Gagal menjalankan Quality Scorer" });
  }
});
