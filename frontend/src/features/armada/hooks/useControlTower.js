import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";

// Delivery Control Tower (22 September 2026) — SATU sumber data: GET
// /armada/routes (routeInclude backend), endpoint YANG SAMA sudah dipakai
// Route Planner (useArmadaRoutesBoard.js). TIDAK ADA panggilan API kedua,
// TIDAK ADA polling agresif — SENGAJA tanpa `refetchInterval` (beda dari
// useMyJobs.js/useArmadaRoutesBoard.js yang polling 30 detik untuk papan
// kerja LANGSUNG dipakai dispatcher men-drag job) — Control Tower adalah
// layar PANTAU, react-query default (refetch saat tab kembali fokus +
// tombol Refresh manual di UI) sudah cukup, dan menghindari beban server
// tambahan untuk halaman yang biasanya dibuka lama (dashboard, bukan alat
// kerja aktif per detik).
export function useControlTower(range, toApiParams) {
  return useQuery({
    queryKey: ["armada", "control-tower", toApiParams(range)],
    queryFn: async () => {
      const res = await api.getRoutes(toApiParams(range));
      return res.routes || [];
    },
  });
}
