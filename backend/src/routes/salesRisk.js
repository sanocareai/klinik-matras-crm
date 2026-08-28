// ═══ SALES RISK ENGINE — route laporan (read-only) ═════════════════════════
// Admin-only: agregat lintas SEMUA sales, setara sensitivitasnya dgn Laporan
// Sales/Quality Scorer. TIDAK ADA endpoint tulis — engine ini murni baca &
// hitung on-the-fly (belum wired ke alert/notifikasi apa pun, itu scope
// masa depan per proposal desain).
import express from "express";
import { requireAuth, requireAdmin } from "../middleware/auth.js";
import { computeAllSalesRisks, aggregateBySalesOwner, aggregateBySeverity } from "../services/salesRisk/index.js";

export const salesRiskRouter = express.Router();
salesRiskRouter.use(requireAuth);

// GET /api/sales-risk — daftar lengkap + 3 bentuk agregasi (poin 8: per
// customer/per sales owner/per severity). ?minTier= membatasi daftar MENTAH
// yang dikirim ke frontend (default "MEDIUM" — LOW-tier tetap ikut dihitung
// di agregasi severity, cuma tidak dikirim satu-satu supaya payload tidak
// membengkak dgn ribuan baris "aman").
const TIER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };

salesRiskRouter.get("/", requireAdmin, async (req, res) => {
  try {
    const minTier = String(req.query.minTier || "MEDIUM").toUpperCase();
    const minRank = TIER_RANK[minTier] ?? TIER_RANK.MEDIUM;
    // ?salesId= (29 Agustus 2026) — deep-link dari drill-down Sales
    // Performance Intelligence hub.
    const salesId = req.query.salesId || null;

    const allRisks = await computeAllSalesRisks();
    // salesScoped = lingkup yang RELEVAN utk halaman ini saat ini (kalau
    // salesId ada, cuma customer sales itu). severityCounts (dipakai jadi
    // count pill Semua/Kritis/Tinggi/Sedang, 29 Agustus 2026 — revisi dari
    // versi sebelumnya yang sengaja dihitung dari allRisks/SELURUH tim)
    // SEKARANG scoped ke sini juga, supaya pill count match dgn filter
    // salesId yang aktif — sebelumnya pill akan tetap nampilin angka
    // seluruh tim walau user sedang lihat 1 sales, membingungkan.
    // totalScanned TETAP global (statistik cakupan mesin, bukan punya 1 sales).
    const salesScoped = salesId ? allRisks.filter((r) => r.salesOwnerId === salesId) : allRisks;
    const severityCounts = aggregateBySeverity(salesScoped); // termasuk LOW, sebelum disaring minTier

    const filtered = salesScoped
      .filter((r) => (TIER_RANK[r.tier] ?? 0) >= minRank)
      .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.score - a.score); // tier dulu, skor cuma pengurut DALAM tier

    const bySalesOwner = aggregateBySalesOwner(filtered);

    res.json({
      totalScanned: allRisks.length,
      totalAtRisk: filtered.length,
      severityCounts,
      risks: filtered,
      bySalesOwner,
      filteredSalesId: salesId,
    });
  } catch (err) {
    console.error("sales-risk error:", err);
    res.status(500).json({ error: "Gagal menghitung Sales Risk" });
  }
});
