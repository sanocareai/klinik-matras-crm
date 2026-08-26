// ═══ SALES RISK ENGINE — orchestrator + agregasi ══════════════════════════
// "Siapa berisiko karena eksekusi sales gagal?" — TERPISAH dari Priority
// Engine (services/intelligence/, "siapa layak diprioritaskan"). TIDAK ADA
// baris yang mengubah/mengimpor priorityScore.js atau nextBestAction.js —
// hanya loadAllPriorityCandidates() (data loader murni, sudah dipakai juga
// oleh staleLeadAlertJob.js) yang di-reuse utk sumber kandidat.
import { prisma } from "../../db.js";
import { loadAllPriorityCandidates } from "../intelligence/index.js";
import { detectSalesRiskSignals } from "./signals.js";
import { buildSalesRisk } from "./riskScore.js";

const DEFAULT_CANDIDATE_LIMIT = 3000; // sama jaring pengaman dgn staleLeadAlertJob.js

export async function buildSalesRiskForCustomer(customer) {
  const signals = detectSalesRiskSignals(customer);
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
export async function computeAllSalesRisks({ limit = DEFAULT_CANDIDATE_LIMIT } = {}) {
  const candidates = await loadAllPriorityCandidates(prisma, { limit });
  return candidates.map((c) => buildSalesRiskForCustomer(c));
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
