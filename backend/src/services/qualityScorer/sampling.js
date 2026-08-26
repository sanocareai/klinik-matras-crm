// ═══ SAMPLING — AI Conversation Quality Scorer ═══════════════════════════
import { prisma } from "../../db.js";
import { nowPartsWIB, startOfDayWIB } from "../../utils/wib.js";
import { SAMPLE_SIZE_PER_SALES, STAGE_PRIORITY, EXCLUDED_STAGE } from "../../config/qualityScorerRubric.js";

// Rentang "kemarin" (WIB) — dihitung dari instant awal hari INI dikurangi
// 24 jam, BUKAN parsing string tanggal kemarin, supaya aman dari isu batas
// bulan/tahun (mis. hari ini tanggal 1 → kemarin otomatis bulan sebelumnya
// tanpa perlu logic kalender manual).
export function yesterdayRangeWIB(referenceNow = new Date()) {
  const { year, month, day } = nowPartsWIB(referenceNow);
  const todayStr = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
  const todayStart = startOfDayWIB(todayStr);
  return {
    mulai: new Date(todayStart.getTime() - 86_400_000),
    selesai: todayStart,
  };
}

// SALES aktif — filter EKSPLISIT role==="SALES" && active===true, SAMA
// PERSIS dengan konvensi /sales-report (routes/analytics.js) & keputusan
// bisnis terdokumentasi di CLAUDE.md §20: JANGAN longgarkan ke "siapa pun
// punya izin SALES" — preseden nyata (Natasha, multi-role) pernah salah
// masuk hitungan performer sales gara-gara pelonggaran semacam ini.
export async function getActiveSalesUsers() {
  return prisma.user.findMany({
    where: { role: "SALES", active: true },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}

// Sample N percakapan INDIVIDUAL milik satu sales yang punya AKTIVITAS
// (balasan OUTBOUND dari sales itu sendiri) di rentang waktu yang diberikan
// — BUKAN percakapan yang dibuat di rentang itu. Alasan: sales bisa saja
// menangani lead LAMA kemarin (follow-up berbulan-bulan), dan itu tetap
// representasi kerja mereka KEMARIN yang layak dinilai — kalau dibatasi ke
// "conversation dibuat kemarin", follow-up ke lead lama tidak akan pernah
// tersample sama sekali.
//
// Prioritas: PipelineStage yang lebih "matang" (STAGE_PRIORITY) didahulukan
// — lebih mungkin ada substansi (bahasan produk/keberatan) utk dinilai.
// SPAM dikecualikan TOTAL (bukan prioritas terendah).
export async function sampleConversationsForSales(salesUserId, { mulai, selesai, sampleSize = SAMPLE_SIZE_PER_SALES }) {
  const stageCaseWhen = STAGE_PRIORITY
    .map((stage, i) => `WHEN '${stage}' THEN ${i}`)
    .join(" ");

  return prisma.$queryRawUnsafe(
    `
    SELECT DISTINCT c.id AS "conversationId", c."customerId", cust."pipelineStage", cust.name AS "customerName"
    FROM "Conversation" c
    JOIN "Customer" cust ON cust.id = c."customerId"
    WHERE c.type = 'INDIVIDUAL'
      AND cust."pipelineStage" != $1
      AND EXISTS (
        SELECT 1 FROM "Message" m
        WHERE m."conversationId" = c.id AND m.direction = 'OUTBOUND' AND m."sentById" = $2
          AND m."createdAt" >= $3 AND m."createdAt" < $4
      )
    ORDER BY
      CASE cust."pipelineStage" ${stageCaseWhen} ELSE ${STAGE_PRIORITY.length} END,
      RANDOM()
    LIMIT $5
    `,
    EXCLUDED_STAGE, salesUserId, mulai, selesai, sampleSize
  );
}
