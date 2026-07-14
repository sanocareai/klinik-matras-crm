import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { BAND2_IS_MOCK, MOCK_RECOMMENDATIONS, MOCK_HOT_LEADS, MOCK_FOLLOW_UPS } from "../data/contracts.js";

// Assembler data dashboard (Wave 2A). Band 1 & 3 = endpoint NYATA (api.js),
// Band 2 = kontrak MOCK (contracts.js) sampai Wave 2B. Tiap dataset punya
// status sendiri (isLoading/isError) → error per-widget, satu gagal tidak
// memblokir dashboard (pola lama dipertahankan, kini via React Query + cache).
//
// TIDAK menyentuh WAHA/SSE/inbox — hanya baca /analytics/* yang sudah ada.
export function useDashboardData(range) {
  const params = { from: range.from, to: range.to };
  const now = new Date();
  const targetParams = { year: now.getFullYear(), month: now.getMonth() + 1 };

  // — Data nyata (existing adapters) —
  const overview = useQuery({
    queryKey: ["dash", "overview", params],
    queryFn: () => api.getAnalyticsOverview(params),
    staleTime: 60_000,
  });
  const funnel = useQuery({
    queryKey: ["dash", "funnel"],
    queryFn: () => api.getAnalyticsPipelineFunnel(),
    staleTime: 60_000,
  });
  const performance = useQuery({
    queryKey: ["dash", "performance", params],
    queryFn: () => api.getAnalyticsPerformance(params),
    staleTime: 60_000,
  });
  const salesPerf = useQuery({
    queryKey: ["dash", "sales-performance", targetParams],
    queryFn: () => api.getSalesPerformance(targetParams).catch(() => []),
    staleTime: 60_000,
  });

  // — Data Band 2. Wave 2B: endpoint NYATA (role-scoped di server). Bila
  //   BAND2_IS_MOCK=true → fallback ke kontrak mock (ROLLBACK 1 baris, tanpa
  //   ubah query). Endpoint global (bukan per-range); staleTime 45s. —
  const band2 = (key, real, mock) => useQuery({
    queryKey: ["dash", key, BAND2_IS_MOCK ? "mock" : "live"],
    queryFn: () => (BAND2_IS_MOCK ? Promise.resolve(mock) : real()),
    staleTime: BAND2_IS_MOCK ? Infinity : 45_000,
  });
  const recommendations = band2("recommendations", api.getRecommendations, MOCK_RECOMMENDATIONS);
  const hotLeads        = band2("hot-leads",        api.getHotLeads,        MOCK_HOT_LEADS);
  const followUps       = band2("follow-ups",       api.getFollowUps,       MOCK_FOLLOW_UPS);

  return { overview, funnel, performance, salesPerf, recommendations, hotLeads, followUps };
}
