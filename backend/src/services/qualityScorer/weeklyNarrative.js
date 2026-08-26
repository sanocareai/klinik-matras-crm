// ═══ RINGKASAN NARATIF MINGGUAN — AI Conversation Quality Scorer ═════════
// Job TERPISAH dari job.js (grading harian per-percakapan). Job ini jalan
// SEKALI/MINGGU dan cuma 1 panggilan LLM per sales — sesuai cap biaya di
// spesifikasi ("maksimal 1 LLM call/sales/minggu"). Input LLM di sini HANYA
// angka agregat (dari rollup.js, murni query DB) + kutipan yang SUDAH
// tersimpan ter-mask di ConversationQualityScore (diambil dari pesan SALES
// yang sudah di-mask sebelum grading harian, lihat masking.js) — TIDAK ada
// transcript mentah/data pelanggan baru yang dikirim ke LLM di job ini.
import cron from "node-cron";
import { prisma } from "../../db.js";
import { chat } from "../providers/anthropicProvider.js";
import { QUALITY_SCORER_MODEL, CORE_DIMENSIONS } from "../../config/qualityScorerRubric.js";
import { getWeeklyRollup } from "./rollup.js";
import { resolveApiKey } from "./grading.js";
import { estimateCostUsd } from "./pricing.js";

const NARRATIVE_WINDOW_DAYS = 7; // rolling 7 hari, konsisten dgn default /weekly

// Direvisi 27 Agustus 2026 — rubrik SANO Sales Framework TIDAK punya
// dimensi ber-flag (beda dari rubrik lama), jadi digest sekarang dibangun
// dari rata-rata skor per dimensi (CORE_DIMENSIONS, sudah dihitung
// rollup.js) + skor keseluruhan, bukan lagi frekuensi flag negatif.
function buildDigestText(row) {
  const lines = [
    `Sales: ${row.salesName}`,
    `Jumlah percakapan dinilai minggu ini: ${row.sampleCount}`,
    `Skor keseluruhan: ${row.overallAvg ?? "-"} (minggu lalu ${row.prevOverallAvg ?? "-"}, tren ${row.trend ?? "-"})`,
  ];
  for (const dim of CORE_DIMENSIONS) {
    lines.push(`- ${dim.label}: rata-rata skor ${row.dimensions[dim.key] ?? "-"}/5`);
  }
  return lines.join("\n");
}

// Dimensi dgn rata-rata TERENDAH minggu ini — dasar utk "modul SANO Class"
// yang paling relevan dibahas, sama prinsip dgn recommendedModule per
// percakapan (job.js), cuma di level MINGGUAN/PER-SALES.
function findWeakestDimension(row) {
  let weakest = null;
  for (const dim of CORE_DIMENSIONS) {
    const avg = row.dimensions[dim.key];
    if (avg == null) continue;
    if (!weakest || avg < weakest.avg) weakest = { key: dim.key, label: dim.label, avg };
  }
  return weakest;
}

// Ambil beberapa kutipan sales dgn skor RENDAH (<=3) di dimensi TERLEMAH
// minggu ini, LANGSUNG dari kolom quote/weakness yang sudah tersimpan
// (SUDAH di-mask sejak proses grading harian) — tidak fetch transcript ulang.
async function fetchWeakExamples(salesUserId, weekStart, weekEnd, weakest) {
  if (!weakest) return [];
  const scoreCol = `${weakest.key}Score`;
  const quoteCol = `${weakest.key}Quote`;
  const weaknessCol = `${weakest.key}Weakness`;
  const rows = await prisma.conversationQualityScore.findMany({
    where: { salesUserId, sampledFor: { gte: weekStart, lt: weekEnd }, [scoreCol]: { lte: 3 } },
    select: { [quoteCol]: true, [weaknessCol]: true, [scoreCol]: true },
    take: 2,
    orderBy: { [scoreCol]: "asc" },
  });
  return rows
    .filter((r) => r[quoteCol])
    .map((r) => `[${weakest.label}, skor ${r[scoreCol]}] "${r[quoteCol]}" — ${r[weaknessCol] || "-"}`);
}

function buildNarrativePrompt(row, examples) {
  return `Kamu adalah coach sales internal Klinik Matras (Sano Care). Berdasarkan data agregat MINGGUAN berikut untuk SATU sales (angka dari sistem penilaian AI, BUKAN dikarang), tulis ringkasan pola perilaku berulang dalam 2-4 kalimat Bahasa Indonesia, actionable, untuk bahan sesi coaching tim (SANO Class).

ATURAN:
- Fokus ke POLA (bukan 1 kejadian tunggal) — sebut tren kalau ada perubahan dibanding minggu lalu.
- Kalau ada dimensi dengan rata-rata rendah (di bawah 3), beri 1 saran konkret & spesifik merujuk ke modul SANO Class yang relevan (Communication Skill/Authority Selling/Objection Handling).
- Kalau datanya terlalu sedikit (sampleCount kecil) atau semua metrik bagus, katakan itu apa adanya — JANGAN mengarang masalah yang tidak didukung angka.
- Jawab HANYA teks ringkasan polos (tanpa markdown, tanpa JSON, maksimal 4 kalimat).

DATA MINGGU INI:
${buildDigestText(row)}

${examples.length ? `Contoh kutipan pendukung (data pelanggan sudah dimasking sejak awal):\n${examples.map((e) => `- ${e}`).join("\n")}` : "(Tidak ada contoh kutipan negatif spesifik minggu ini.)"}`;
}

/**
 * Jalankan satu batch ringkasan mingguan — 1 panggilan LLM per sales yang
 * punya data minggu ini (sales tanpa sample apa pun DILEWATI, tidak
 * dipanggil sama sekali — bagian dari kontrol biaya).
 */
export async function runWeeklyNarrativeJob({ referenceNow = new Date() } = {}) {
  const weekEnd = referenceNow;
  const weekStart = new Date(weekEnd.getTime() - NARRATIVE_WINDOW_DAYS * 86_400_000);
  const prevWeekEnd = weekStart;
  const prevWeekStart = new Date(weekStart.getTime() - NARRATIVE_WINDOW_DAYS * 86_400_000);

  const summary = { weekStart, weekEnd, salesProcessed: 0, narrativesGenerated: 0, totalCostUsd: 0, errors: [] };

  let apiKey;
  try {
    apiKey = resolveApiKey();
  } catch (err) {
    console.error("[qualityScorerNarrative]", err.message);
    summary.errors.push(err.message);
    return summary;
  }

  const rollup = await getWeeklyRollup({ weekStart, weekEnd, prevWeekStart, prevWeekEnd });

  for (const row of rollup.perSales) {
    if (row.sampleCount === 0) continue; // tidak ada data minggu ini — hemat biaya, tidak ada yg dinarasikan
    summary.salesProcessed++;
    try {
      const weakest = findWeakestDimension(row);
      const examples = await fetchWeakExamples(row.salesUserId, weekStart, weekEnd, weakest);
      const prompt = buildNarrativePrompt(row, examples);
      const { reply, usage } = await chat({
        apiKey,
        model: QUALITY_SCORER_MODEL,
        messages: [{ role: "user", content: prompt }],
        maxTokens: 400,
      });
      const costUsd = estimateCostUsd(usage);
      summary.totalCostUsd += costUsd;

      await prisma.salesQualityWeeklyNarrative.upsert({
        where: { salesUserId_weekStart_weekEnd: { salesUserId: row.salesUserId, weekStart, weekEnd } },
        create: {
          salesUserId: row.salesUserId,
          salesName: row.salesName,
          weekStart, weekEnd,
          sampleCount: row.sampleCount,
          narrative: reply.trim(),
          model: QUALITY_SCORER_MODEL,
          inputTokens: usage.inputTokens || 0,
          outputTokens: usage.outputTokens || 0,
          costUsd,
        },
        update: {}, // idempotent kalau dijalankan ulang manual utk jendela minggu yang sama
      });
      summary.narrativesGenerated++;
    } catch (err) {
      console.error(`[qualityScorerNarrative] Gagal buat narasi ${row.salesName}:`, err.message);
      summary.errors.push(`${row.salesName}: ${err.message}`);
    }
  }

  console.log(
    `[qualityScorerNarrative] Selesai. Sales diproses: ${summary.salesProcessed}, narasi dibuat: ${summary.narrativesGenerated}, estimasi biaya: $${summary.totalCostUsd.toFixed(4)}`
  );
  return summary;
}

// Senin 04:00 WIB — setelah grading harian (03:00) supaya narasi minggu ini
// sudah mencakup hasil grading dini hari yang sama, tanpa berebut I/O.
export function startWeeklyNarrativeJob() {
  cron.schedule("0 4 * * 1", async () => {
    console.log("[qualityScorerNarrative] Cron fired — Senin 04:00 WIB");
    await runWeeklyNarrativeJob();
  }, { timezone: "Asia/Jakarta" });
  console.log("[qualityScorerNarrative] Job terdaftar — jalan tiap Senin jam 04:00 WIB");
}
