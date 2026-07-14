import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { MOCK_RECOMMENDATIONS, MOCK_HOT_LEADS, MOCK_FOLLOW_UPS } from "../data/contracts.js";

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

  // — Data Band 2 (MOCK — kontrak untuk Wave 2B). Delay kecil supaya skeleton
  //   sempat terlihat, meniru latensi jaringan. —
  const recommendations = useQuery({
    queryKey: ["dash", "recommendations-mock"],
    queryFn: () => new Promise((r) => setTimeout(() => r(MOCK_RECOMMENDATIONS), 350)),
    staleTime: Infinity,
  });
  const hotLeads = useQuery({
    queryKey: ["dash", "hot-leads-mock"],
    queryFn: () => new Promise((r) => setTimeout(() => r(MOCK_HOT_LEADS), 350)),
    staleTime: Infinity,
  });
  const followUps = useQuery({
    queryKey: ["dash", "follow-ups-mock"],
    queryFn: () => new Promise((r) => setTimeout(() => r(MOCK_FOLLOW_UPS), 350)),
    staleTime: Infinity,
  });

  return { overview, funnel, performance, salesPerf, recommendations, hotLeads, followUps };
}
