import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { BAND2_IS_MOCK, MOCK_HOT_LEADS, MOCK_FOLLOW_UPS } from "../data/contracts.js";

// Assembler data dashboard. Hanya mengambil apa yang BENAR-BENAR dipakai
// pages/Dashboard.jsx: overview (KPI + Sales Overview lama), follow-ups,
// hot-leads.
//
// DS v2.2: `funnel`, `performance`, `salesPerf`, `recommendations` DIHAPUS
// dari sini — Deal Pipeline & Top Performing Reps sekarang SELF-FETCH dengan
// periode masing-masing (lihat PipelineFunnelCard.jsx / TopRepsCard.jsx), dan
// AIRecommendations sudah tidak dirender Dashboard sejak redesign DS v2.1.
// Mempertahankan query yang tidak dipakai berarti request percuma tiap buka
// Dashboard — dihapus, bukan dibiarkan "mungkin dipakai nanti".
//
// TIDAK menyentuh WAHA/SSE/inbox — hanya baca /analytics/* yang sudah ada.
export function useDashboardData(range) {
  const params = { from: range.from, to: range.to };

  const overview = useQuery({
    queryKey: ["dash", "overview", params],
    queryFn: () => api.getAnalyticsOverview(params),
    staleTime: 60_000,
  });

  // Band 2. Wave 2B: endpoint NYATA (role-scoped di server). Bila
  // BAND2_IS_MOCK=true → fallback ke kontrak mock (ROLLBACK 1 baris, tanpa
  // ubah query). Endpoint global (bukan per-range); staleTime 45s.
  const band2 = (key, real, mock) => useQuery({
    queryKey: ["dash", key, BAND2_IS_MOCK ? "mock" : "live"],
    queryFn: () => (BAND2_IS_MOCK ? Promise.resolve(mock) : real()),
    staleTime: BAND2_IS_MOCK ? Infinity : 45_000,
  });
  const hotLeads  = band2("hot-leads",  api.getHotLeads,  MOCK_HOT_LEADS);
  const followUps = band2("follow-ups", api.getFollowUps, MOCK_FOLLOW_UPS);

  return { overview, hotLeads, followUps };
}
