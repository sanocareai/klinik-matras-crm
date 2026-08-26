// ═══ AI CONVERSATION QUALITY SCORER — route laporan (read-only + trigger manual) ═══
// Admin-only: ini alat coaching/audit yang membaca ringkasan percakapan
// SEMUA sales, setara sensitivitasnya dengan Laporan Sales.
import express from "express";
import { prisma } from "../db.js";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { getWeeklyRollup } from "../services/qualityScorer/rollup.js";
import { runQualityScorerJob } from "../services/qualityScorer/job.js";
import { runWeeklyNarrativeJob } from "../services/qualityScorer/weeklyNarrative.js";
import { CORE_DIMENSIONS, PATTERN_DIMENSIONS, SAMPLE_SIZE_PER_SALES, MAX_DAILY_LLM_CALLS } from "../config/qualityScorerRubric.js";

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
      dimensions: CORE_DIMENSIONS.map(({ key, label, description }) => ({ key, label, description })),
      // Rubrik SANO Sales Framework (27 Agustus 2026) tidak punya dimensi
      // ber-flag — PATTERN_DIMENSIONS selalu [] sekarang, jadi ini selalu
      // array kosong. Dipertahankan (bukan dihapus) supaya frontend lama
      // yang membaca field ini tidak perlu null-check tambahan.
      patternDimensionsMeta: PATTERN_DIMENSIONS.map(({ key, label, description, flag }) => ({
        key, label, description, flagKey: flag.key,
      })),
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

// Ringkasan naratif mingguan (1 LLM call/sales/minggu, dihasilkan job Senin
// 04:00 WIB) — route ini HANYA baca yang sudah tersimpan, TIDAK memanggil
// LLM. Ambil baris TERBARU per sales (bisa ada riwayat kalau job pernah
// di-run manual berkali-kali utk jendela minggu berbeda).
qualityScorerRouter.get("/weekly-narrative", requireAdmin, async (req, res) => {
  try {
    const rows = await prisma.salesQualityWeeklyNarrative.findMany({ orderBy: { createdAt: "desc" } });
    const latestBySales = new Map();
    for (const r of rows) {
      if (!latestBySales.has(r.salesUserId)) latestBySales.set(r.salesUserId, r);
    }
    res.json({ narratives: [...latestBySales.values()] });
  } catch (err) {
    console.error("quality-scorer weekly-narrative error:", err);
    res.status(500).json({ error: "Gagal memuat ringkasan pola mingguan" });
  }
});

// Trigger manual job narasi mingguan — utk verifikasi/testing tanpa
// menunggu jadwal cron (Senin 04:00 WIB).
qualityScorerRouter.post("/weekly-narrative/run", requireAdmin, async (req, res) => {
  try {
    const summary = await runWeeklyNarrativeJob();
    res.json(summary);
  } catch (err) {
    console.error("quality-scorer weekly-narrative run error:", err);
    res.status(500).json({ error: err.message || "Gagal menjalankan ringkasan pola mingguan" });
  }
});
