// Tool MCP untuk SANO Hub Analytics — 5 tool READ-ONLY membaca data yang
// dihasilkan Claude Code selama development (quality scoring, risk engine,
// stale lead tracking, gold standard). TERPISAH dari SANSS CRM (src/mcp/) —
// tidak menduplikasi data mentah pelanggan/order/percakapan yang sudah bisa
// diakses lewat connector itu.
//
// ⚠️ ATURAN MUTLAK FILE INI:
//   1. HANYA `prismaReadOnly` dari ./db.js — JANGAN PERNAH import `prisma`
//      dari ../db.js (itu role writable, dipakai seluruh app). Kalaupun ada
//      kode di sini yang keliru mencoba `.create()/.update()/.delete()`,
//      Postgres SENDIRI menolaknya (permission denied, kode 42501) karena
//      role mcp_hub_readonly cuma GRANT SELECT — lihat db.js & bukti di
//      docs/MCP-HUB-SERVER.md. Ini pengaman DUA LAPIS: kode + database.
//   2. Fungsi bisnis (skor risiko, rollup kualitas) DIPAKAI ULANG dari
//      services/salesRisk & services/qualityScorer — TIDAK ditulis ulang di
//      sini. Untuk fungsi yang query lewat singleton `prisma` writable
//      (mis. getWeeklyRollup di rollup.js), file ini menyusun ULANG query-nya
//      pakai prismaReadOnly, TAPI memanggil helper transform PURE yang SAMA
//      persis (diekspor dari rollup.js) — supaya angkanya tidak pernah
//      berbeda dari dashboard SANSS, sekaligus tetap DB-level read-only.
//   3. TIDAK ADA pengiriman WhatsApp — jangan pernah import wahaClient.js.
// tests/mcpHub.test.js memindai file ini dan GAGAL kalau aturan dilanggar.

import { z } from "zod";
import { prismaReadOnly } from "./db.js";
import { hasil, ANOTASI_BACA, TANGGAL } from "../mcp/toolsShared.js";
import { startOfDayWIB, endOfDayExclusiveWIB, nowPartsWIB } from "../utils/wib.js";

// ── Quality Scorer — reuse pure transform, query ulang lewat prismaReadOnly ─
import { CORE_DIMENSIONS, PATTERN_DIMENSIONS } from "../config/qualityScorerRubric.js";
import { overallScore, avgByDim, formatExample, patternMetricsForRows, DIM_TO_COLUMN } from "../services/qualityScorer/rollup.js";

// ── Sales Risk Engine — loadSalesRiskCandidates SUDAH menerima prisma
// sebagai parameter (lihat services/salesRisk/index.js), jadi bisa langsung
// dikasih prismaReadOnly TANPA modifikasi apa pun di source aslinya.
import { loadSalesRiskCandidates, buildSalesRiskForCustomer, aggregateBySalesOwner, aggregateBySeverity } from "../services/salesRisk/index.js";

// ── Stale Lead — config (escalationDays) dipakai ulang dari job aslinya
// supaya ambang di sini TIDAK PERNAH beda dari yang benar-benar dipakai job
// (readConfig baca data/settings.json, admin-editable).
import { readConfig as readStaleLeadConfig } from "../services/staleLeadAlertJob.js";

const SEVERITY_TIERS = ["CRITICAL", "HIGH", "MEDIUM", "LOW"];
const SEVERITY_LABEL_ID = { CRITICAL: "Kritis", HIGH: "Tinggi", MEDIUM: "Sedang", LOW: "Rendah" };

// Batas WIB (UTC di dalam, WIB di tepi — CLAUDE.md §11).
function whereTanggalWIB(from, to, field = "createdAt") {
  if (!from && !to) return {};
  const w = {};
  if (from) w.gte = startOfDayWIB(from);
  if (to) w.lt = endOfDayExclusiveWIB(to);
  return { [field]: w };
}

export function registerMcpHubTools(server) {
  // 1 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_quality_scores",
    {
      title: "AI Conversation Quality Scores",
      description:
        "Skor kualitas percakapan sales (AI Conversation Quality Scorer) dalam satu rentang tanggal: " +
        "rata-rata per dimensi rubrik SANO Sales Framework (Communication Skill, Authority Selling, " +
        "Objection Handling, Evidence-Based Selling), tren vs periode sebelumnya, dan contoh percakapan " +
        "terbaik/terlemah beserta kutipan bukti. Angkanya SAMA dengan yang tampil di dashboard Quality " +
        "Scorer CRM (rollup logic dipakai ulang persis, cuma sumber koneksi DB-nya read-only).",
      inputSchema: {
        salesId: z.string().optional().describe("Batasi ke satu sales (salesUserId)."),
        dari: TANGGAL.optional().describe("Percakapan disample sejak tanggal ini (WIB). Default: 7 hari terakhir."),
        sampai: TANGGAL.optional().describe("Sampai tanggal ini (WIB, inklusif). Default: hari ini."),
        dimension: z.enum(CORE_DIMENSIONS.map((d) => d.key)).optional()
          .describe("Fokus ke satu dimensi rubrik saja (nilai avgScore-nya tetap dihitung dari semua dimensi, ini cuma filter tampilan)."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const { year, month, day } = nowPartsWIB();
      const hariIni = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
      const sampai = args.sampai ?? hariIni;
      const dari = args.dari ?? new Date(new Date(`${sampai}T00:00:00Z`).getTime() - 6 * 86_400_000).toISOString().slice(0, 10);

      const weekEnd = endOfDayExclusiveWIB(sampai);
      const weekStart = startOfDayWIB(dari);
      const panjangMs = weekEnd - weekStart;
      const prevWeekEnd = weekStart;
      const prevWeekStart = new Date(weekStart.getTime() - panjangMs);

      // Susun ulang query getWeeklyRollup() TAPI lewat prismaReadOnly — lihat
      // catatan aturan #2 di header file. Transform (avgByDim/overallScore/
      // formatExample/patternMetricsForRows) SAMA PERSIS, hanya di-import.
      const [rows, prevRows] = await Promise.all([
        prismaReadOnly.conversationQualityScore.findMany({
          where: {
            sampledFor: { gte: weekStart, lt: weekEnd },
            ...(args.salesId ? { salesUserId: args.salesId } : {}),
          },
        }),
        prismaReadOnly.conversationQualityScore.findMany({
          where: {
            sampledFor: { gte: prevWeekStart, lt: prevWeekEnd },
            ...(args.salesId ? { salesUserId: args.salesId } : {}),
          },
        }),
      ]);

      const bySales = new Map();
      for (const r of rows) {
        if (!bySales.has(r.salesUserId)) bySales.set(r.salesUserId, { salesUserId: r.salesUserId, salesName: r.salesName, rows: [] });
        bySales.get(r.salesUserId).rows.push(r);
      }
      const prevBySales = new Map();
      for (const r of prevRows) {
        if (!prevBySales.has(r.salesUserId)) prevBySales.set(r.salesUserId, []);
        prevBySales.get(r.salesUserId).push(r);
      }

      const perSales = [...bySales.values()].map(({ salesUserId, salesName, rows: salesRows }) => {
        const dims = avgByDim(salesRows);
        const scored = salesRows.map((r) => ({ ...r, _overall: overallScore(r) })).filter((r) => r._overall != null);
        const overallAvg = scored.length ? Math.round((scored.reduce((a, r) => a + r._overall, 0) / scored.length) * 10) / 10 : null;

        const prevRowsForSales = prevBySales.get(salesUserId) || [];
        const prevScored = prevRowsForSales.map((r) => overallScore(r)).filter((v) => v != null);
        const prevOverallAvg = prevScored.length ? Math.round((prevScored.reduce((a, b) => a + b, 0) / prevScored.length) * 10) / 10 : null;
        const trend = overallAvg != null && prevOverallAvg != null ? Math.round((overallAvg - prevOverallAvg) * 10) / 10 : null;

        const sortedByOverall = [...scored].sort((a, b) => b._overall - a._overall);

        return {
          salesUserId, salesName,
          sampleCount: salesRows.length,
          dimensions: dims,
          overallAvg, prevOverallAvg, trend,
          bestExamples: sortedByOverall.slice(0, 3).map(formatExample),
          worstExamples: sortedByOverall.slice(-3).reverse().map(formatExample),
          patternDimensions: patternMetricsForRows(salesRows, prevRowsForSales),
        };
      });
      perSales.sort((a, b) => (b.overallAvg ?? -1) - (a.overallAvg ?? -1));

      return hasil({
        periode: { dari, sampai, zonaWaktu: "WIB (Asia/Jakarta)" },
        totalSampled: rows.length,
        dimensiRubrik: CORE_DIMENSIONS.map(({ key, label, description }) => ({ key, label, description })),
        dimensiPola: PATTERN_DIMENSIONS.map(({ key, label, description, flag }) => ({ key, label, description, flagKey: flag.key })),
        perSales,
        catatan: "overallAvg = rata-rata dimensi yang TERISI saja (skor null/topik tidak muncul di percakapan itu dikecualikan, bukan dihitung 0).",
      });
    },
  );

  // 2 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_risk_profiles",
    {
      title: "Sales Risk Engine — profil risiko pelanggan",
      description:
        "Pelanggan yang berisiko HILANG karena eksekusi sales gagal (bukan skor kualitas kasur/produk) — " +
        "dihitung rule-based dari sinyal mentah (lama menunggu balasan, minat beli terdeteksi, prospek " +
        "macet, dst). 4 tingkat: CRITICAL/HIGH/MEDIUM/LOW. Tiap baris punya penjelasan bahasa awam " +
        "(problem, bukti kutipan, rekomendasi aksi) — SAMA dengan yang tampil di halaman Pelanggan " +
        "Berisiko CRM.",
      inputSchema: {
        salesId: z.string().optional().describe("Batasi ke pelanggan milik sales ini (salesOwnerId)."),
        severityTier: z.enum(SEVERITY_TIERS).optional().describe("Tampilkan HANYA tingkat ini (bukan minimum, persis tingkat ini)."),
        minSeverityTier: z.enum(SEVERITY_TIERS).optional().describe("Tampilkan tingkat ini ke ATAS (mis. HIGH = HIGH & CRITICAL). Default MEDIUM, sama seperti default dashboard."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const TIER_RANK = { LOW: 0, MEDIUM: 1, HIGH: 2, CRITICAL: 3 };
      const minRank = args.severityTier ? TIER_RANK[args.severityTier] : TIER_RANK[args.minSeverityTier ?? "MEDIUM"];

      const [candidates, intentRows] = await Promise.all([
        loadSalesRiskCandidates(prismaReadOnly, {}),
        prismaReadOnly.salesRiskIntentClassification.findMany(),
      ]);
      const intentByCustomer = new Map(intentRows.map((r) => [r.customerId, r]));
      let allRisks = candidates.map((c) => buildSalesRiskForCustomer(c, intentByCustomer.get(c.id) || null));

      if (args.salesId) allRisks = allRisks.filter((r) => r.salesOwnerId === args.salesId);
      const severityCounts = aggregateBySeverity(allRisks);

      const filtered = allRisks
        .filter((r) => (args.severityTier ? r.tier === args.severityTier : (TIER_RANK[r.tier] ?? 0) >= minRank))
        .sort((a, b) => TIER_RANK[b.tier] - TIER_RANK[a.tier] || b.score - a.score);

      return hasil({
        totalScanned: candidates.length,
        totalDitampilkan: filtered.length,
        distribusiSeverity: Object.fromEntries(
          SEVERITY_TIERS.map((t) => [t, { jumlah: severityCounts[t] ?? 0, label: SEVERITY_LABEL_ID[t] }]),
        ),
        perSalesOwner: aggregateBySalesOwner(filtered).map((g) => ({
          salesOwnerId: g.salesOwnerId,
          salesOwnerName: g.salesOwnerName,
          jumlahRisiko: g.risks.length,
          counts: g.counts,
        })),
        risiko: filtered.map((r) => ({
          customerId: r.customerId,
          customerName: r.customerName,
          salesOwnerId: r.salesOwnerId,
          salesOwnerName: r.salesOwnerName,
          tier: r.tier,
          tierLabel: SEVERITY_LABEL_ID[r.tier],
          score: r.score,
          problem: r.problem,
          problemTags: r.problemTags,
          evidence: r.evidence,
          waitingHours: r.evidence?.waitingDuration ?? null,
          recommendedAction: r.recommendedAction,
          trainingModuleHint: r.trainingModuleHint,
        })),
        catatan: "score HANYA pengurut DI DALAM satu tier (bukan penentu tier) — tier ditentukan rule-based dari sinyal mentah, lihat services/salesRisk/riskScore.js#classifyRiskTier.",
      });
    },
  );

  // 3 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_stale_lead_status",
    {
      title: "Status alert lead yang mengendap (stale lead)",
      description:
        "Lead yang PERNAH kena alert WA stale-lead (dicatat di StaleLeadAlertLog): kapan pertama kali " +
        "kena alert, apakah sudah dinotif hari ini, dan apakah SEKARANG tereskalasi (>= N hari sejak " +
        "alert pertama TANPA balasan sales — N dari pengaturan Stale Lead Alert yang sama dipakai job-nya). " +
        "TIDAK mencakup lead yang seharusnya stale tapi BELUM PERNAH kena alert sama sekali (candidate " +
        "selection job itu besar & berubah-ubah — di luar cakupan tool ini, lihat catatan di hasil).",
      inputSchema: {
        salesId: z.string().optional().describe("Batasi ke lead milik sales ini."),
        status: z.enum(["belum_dinotif_hari_ini", "sudah_dinotif_hari_ini", "tereskalasi"]).optional()
          .describe("Filter status. Kosong = semua."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const config = readStaleLeadConfig();
      const { year, month, day } = nowPartsWIB();
      const todayKey = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;

      const rows = await prismaReadOnly.staleLeadAlertLog.findMany({
        include: {
          customer: {
            select: { id: true, name: true, phone: true, assignedSalesId: true, assignedSales: { select: { name: true } } },
          },
        },
        orderBy: { firstAlertedAt: "asc" },
      });

      const filteredBySales = args.salesId ? rows.filter((r) => r.customer?.assignedSalesId === args.salesId) : rows;

      // Eskalasi = >= escalationDays sejak alert pertama TANPA outbound baru
      // (mirror LOGIKA BACA staleLeadAlertJob.js — bukan reimplementasi
      // candidate-selection-nya, lihat batasan di description tool ini).
      const withStatus = await Promise.all(filteredBySales.map(async (r) => {
        const daysSinceFirstAlert = Math.floor((Date.now() - r.firstAlertedAt.getTime()) / 86_400_000);
        const outboundSince = await prismaReadOnly.message.findFirst({
          where: {
            direction: "OUTBOUND",
            createdAt: { gt: r.firstAlertedAt },
            conversation: { customerId: r.customerId, type: "INDIVIDUAL" },
          },
          select: { id: true },
        });
        const escalated = !outboundSince && daysSinceFirstAlert >= config.escalationDays;
        const notifiedToday = r.lastNotifiedDay === todayKey;

        let statusKey;
        if (escalated) statusKey = "tereskalasi";
        else if (notifiedToday) statusKey = "sudah_dinotif_hari_ini";
        else statusKey = "belum_dinotif_hari_ini";

        return {
          customerId: r.customerId,
          customerName: r.customer?.name ?? null,
          salesOwnerId: r.customer?.assignedSalesId ?? null,
          salesOwnerName: r.customer?.assignedSales?.name ?? null,
          firstAlertedAt: r.firstAlertedAt,
          lastNotifiedDay: r.lastNotifiedDay,
          daysSinceFirstAlert,
          adaBalasanSalesSetelahAlert: Boolean(outboundSince),
          status: statusKey,
        };
      }));

      const hasil_ = args.status ? withStatus.filter((r) => r.status === args.status) : withStatus;
      const distribusi = { belum_dinotif_hari_ini: 0, sudah_dinotif_hari_ini: 0, tereskalasi: 0 };
      for (const r of withStatus) distribusi[r.status]++;

      return hasil({
        totalDialertPernah: filteredBySales.length,
        ambangEskalasiHari: config.escalationDays,
        distribusiStatus: distribusi,
        totalDitampilkan: hasil_.length,
        leads: hasil_,
        catatan: "Daftar ini HANYA lead yang sudah pernah tercatat kena alert (StaleLeadAlertLog). Lead yang baru mulai stale dan belum sempat dialert TIDAK muncul di sini — itu keputusan populasi job stale-lead sendiri (noise exclusion, sales aktif, dst), lihat services/staleLeadAlertJob.js.",
      });
    },
  );

  // 4 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_gold_standard_examples",
    {
      title: "Gold Standard Examples — kutipan balasan sales terbaik",
      description:
        "Kutipan balasan sales yang jadi contoh acuan (gold standard) per kategori, diekstrak otomatis " +
        "dari percakapan bernilai skor tinggi. Berguna untuk materi coaching/training atau referensi " +
        "chatbot. Kategori terbatas 8 label tetap (lihat CATEGORIES di extractGoldStandard.js) — " +
        "jangan berharap kategori bebas.",
      inputSchema: {
        category: z.string().optional().describe("Filter satu kategori persis (lihat daftar kategori di hasil kalau tidak yakin ejaannya)."),
        salesName: z.string().optional().describe("Filter nama sales (cocok sebagian, tidak case-sensitive)."),
        limit: z.number().int().min(1).max(100).optional().describe("Jumlah baris (1-100, default 30)."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const where = {
        ...(args.category ? { category: args.category } : {}),
        ...(args.salesName ? { salesName: { contains: args.salesName, mode: "insensitive" } } : {}),
      };
      const [total, rows, kategoriTersedia] = await Promise.all([
        prismaReadOnly.goldStandardExample.count({ where }),
        prismaReadOnly.goldStandardExample.findMany({
          where, orderBy: { createdAt: "desc" }, take: args.limit ?? 30,
        }),
        prismaReadOnly.goldStandardExample.groupBy({ by: ["category"], _count: true }),
      ]);

      return hasil({
        total,
        ditampilkan: rows.length,
        kategoriTersedia: kategoriTersedia.map((k) => ({ category: k.category, jumlah: k._count })),
        contoh: rows.map((r) => ({
          id: r.id,
          category: r.category,
          quote: r.quote,
          salesName: r.salesName,
          relatedScore: r.relatedScore,
          conversationId: r.conversationId,
          sampledFor: r.sampledFor,
        })),
      });
    },
  );

  // 5 ────────────────────────────────────────────────────────────────────────
  server.registerTool(
    "get_weekly_narratives",
    {
      title: "Ringkasan naratif pola perilaku mingguan per sales",
      description:
        "Narasi 2-4 kalimat per sales per minggu (dihasilkan 1x panggilan LLM/sales/minggu, job Senin " +
        "04:00 WIB) merangkum pola perilaku dari data ConversationQualityScore minggu itu — bukan " +
        "dihasilkan ulang saat tool ini dipanggil, murni baca yang sudah tersimpan.",
      inputSchema: {
        salesId: z.string().optional().describe("Batasi ke satu sales (salesUserId)."),
        minggu: TANGGAL.optional().describe("Ambil narasi yang jendela mingguannya MENCAKUP tanggal ini (WIB). Kosong = narasi TERBARU per sales."),
      },
      annotations: ANOTASI_BACA,
    },
    async (args) => {
      const where = args.salesId ? { salesUserId: args.salesId } : {};
      const rows = await prismaReadOnly.salesQualityWeeklyNarrative.findMany({ where, orderBy: { createdAt: "desc" } });

      let dipilih;
      if (args.minggu) {
        const t = startOfDayWIB(args.minggu);
        dipilih = rows.filter((r) => r.weekStart <= t && t < r.weekEnd);
      } else {
        const latestBySales = new Map();
        for (const r of rows) if (!latestBySales.has(r.salesUserId)) latestBySales.set(r.salesUserId, r);
        dipilih = [...latestBySales.values()];
      }

      return hasil({
        totalNarasi: dipilih.length,
        narasi: dipilih.map((r) => ({
          salesUserId: r.salesUserId,
          salesName: r.salesName,
          periode: { mulai: r.weekStart, sampai: r.weekEnd },
          jumlahSampel: r.sampleCount,
          narasi: r.narrative,
          dibuatPada: r.createdAt,
        })),
      });
    },
  );
}
