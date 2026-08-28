// ═══ SALES RISK ENGINE — orchestrator + agregasi ══════════════════════════
// "Siapa berisiko karena eksekusi sales gagal?" — TERPISAH dari Priority
// Engine (services/intelligence/). TIDAK mengimpor apa pun dari intelligence/
// index.js LAGI (revisi — awalnya reuse loadAllPriorityCandidates() di sana,
// tapi select-nya cuma {direction,content,createdAt} utk messages, TIDAK ADA
// rawType/mediaType, jadi sinyal "location shared" SELALU false walau
// datanya ada di DB — ketahuan lewat live test thd Ivan). Loader kandidat di
// bawah ini MILIK SENDIRI, select sendiri — engine benar-benar independen,
// bukan cuma "logic-nya" terpisah tapi data-loading-nya juga.
//
// THRESHOLDS.stalledProspectDays dari intelligence/weights.js TETAP
// di-import di signals.js (angka konfigurasi, bukan logic scoring) — itu
// satu-satunya sisa ketergantungan, disengaja supaya "berapa hari PROSPECT
// dianggap macet" tidak py 2 definisi berbeda di 2 engine.
import { prisma } from "../../db.js";
import { detectSalesRiskSignals } from "./signals.js";
import { buildSalesRisk } from "./riskScore.js";
import { THRESHOLDS as INTEL_THRESHOLDS } from "../intelligence/weights.js";

export const DEFAULT_CANDIDATE_LIMIT = 3000; // sama jaring pengaman dgn staleLeadAlertJob.js

// Select MILIK Sales Risk Engine — pre-filter kandidat SAMA persis dgn
// Priority Engine (recent activity/komplain terbuka/PROSPECT, SPAM
// dikecualikan, supaya bounded bukan scan seluruh tabel Customer), TAPI
// select messages-nya sendiri, MENCAKUP rawType/mediaType yang Priority
// Engine tidak butuh dan tidak pernah muat.
// Diekspor (29 Agustus 2026) — dipakai juga intentClassificationJob.js supaya
// populasi customer yang di-klasifikasi SAMA PERSIS dgn yang dinilai
// risknya, tidak ada drift antara 2 job.
export async function loadSalesRiskCandidates(prisma, { limit } = {}) {
  const recentCut = new Date(Date.now() - INTEL_THRESHOLDS.candidateRecentDays * 86_400_000);
  const notSpam = { pipelineStage: { not: "SPAM" } };
  const where = { AND: [notSpam, { OR: [
    { conversations: { some: { type: "INDIVIDUAL", lastMessageAt: { gt: recentCut } } } },
    { orders: { some: { hasComplaint: true } } },
    { pipelineStage: "PROSPECT" },
  ] }] };
  return prisma.customer.findMany({
    where,
    select: {
      id: true, name: true, phone: true, pipelineStage: true, assignedSalesId: true,
      assignedSales: { select: { name: true } },
      orders: { select: { value: true, status: true } },
      conversations: {
        where: { type: "INDIVIDUAL" }, orderBy: { lastMessageAt: "desc" }, take: 3,
        select: {
          messages: {
            orderBy: { createdAt: "desc" }, take: 20,
            select: { direction: true, content: true, createdAt: true, rawType: true, mediaType: true },
          },
        },
      },
    },
    ...(limit ? { take: limit } : {}),
  });
}

// PURE — TIDAK async (tidak ada I/O di dalamnya). Sebelumnya sempat ditulis
// `async` tanpa alasan, yang MEMBUAT `.map()` di computeAllSalesRisks
// mengembalikan array of unresolved Promise (bukan objek risk) — ketahuan
// dari live test: severityCounts punya bucket "undefined" dan totalAtRisk=0
// padahal 2879 kandidat discan. Diperbaiki dengan menghapus `async` di sini,
// bukan menambah await di caller — fungsi ini memang tidak butuh Promise.
// `cachedRow` (29 Agustus 2026) — baris SalesRiskIntentClassification utk
// customer ini, atau null (belum pernah diklasifikasi). Diteruskan ke
// detectSalesRiskSignals, TIDAK di-query di sini (lihat computeAllSalesRisks
// — 1x findMany utk SEMUA customer, bukan N+1 di fungsi PURE ini).
export function buildSalesRiskForCustomer(customer, cachedRow = null) {
  const signals = detectSalesRiskSignals(customer, cachedRow);
  const risk = buildSalesRisk(signals, customer);
  return {
    customerId: customer.id,
    customerName: customer.name || customer.phone || "(tanpa nama)",
    salesOwnerId: customer.assignedSalesId,
    salesOwnerName: customer.assignedSales?.name || null,
    ...risk,
  };
}

// Hitung risiko utk SEMUA kandidat (pre-filter sama dgn Priority Engine —
// recent activity/komplain terbuka/PROSPECT, SPAM dikecualikan). LOW-tier
// TIDAK dibuang dari hasil mentah (masih dihitung agregasinya), tapi caller
// (route) boleh menyaring sebelum dikirim ke frontend kalau daftarnya
// kepanjangan.
//
// Cache intent (29 Agustus 2026) dimuat SEKALI di sini (1 findMany, bukan
// per-customer) — buildSalesRiskForCustomer/detectSalesRiskSignals TETAP
// sync/pure, cuma baca Map yang sudah di-lookup.
export async function computeAllSalesRisks({ limit = DEFAULT_CANDIDATE_LIMIT } = {}) {
  const [candidates, intentRows] = await Promise.all([
    loadSalesRiskCandidates(prisma, { limit }),
    prisma.salesRiskIntentClassification.findMany(),
  ]);
  const intentByCustomer = new Map(intentRows.map((r) => [r.customerId, r]));
  return candidates.map((c) => buildSalesRiskForCustomer(c, intentByCustomer.get(c.id) || null));
}

// ── Agregasi (poin 8): per customer (daftar mentah di atas), per sales
// owner, per tingkat keparahan. Murni transformasi array, tidak ada query
// tambahan.
export function aggregateBySalesOwner(risks) {
  const bySales = new Map(); // key: salesOwnerId | "UNASSIGNED"
  for (const r of risks) {
    const key = r.salesOwnerId || "UNASSIGNED";
    if (!bySales.has(key)) {
      bySales.set(key, { salesOwnerId: r.salesOwnerId, salesOwnerName: r.salesOwnerName || "Belum di-assign", risks: [], counts: { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 } });
    }
    const group = bySales.get(key);
    group.risks.push(r);
    group.counts[r.tier]++;
  }
  return [...bySales.values()].sort((a, b) => b.counts.CRITICAL - a.counts.CRITICAL || b.counts.HIGH - a.counts.HIGH);
}

export function aggregateBySeverity(risks) {
  const counts = { CRITICAL: 0, HIGH: 0, MEDIUM: 0, LOW: 0 };
  for (const r of risks) counts[r.tier]++;
  return counts;
}

export { detectSalesRiskSignals } from "./signals.js";
export { computeSalesRiskScore, classifyRiskTier, explainRisk } from "./riskScore.js";
