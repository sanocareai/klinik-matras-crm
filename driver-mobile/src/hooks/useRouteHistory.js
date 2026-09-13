// Riwayat Rute — tab "Rute" > "Riwayat" di AdminHomeScreen (13 Sep 2026,
// D-163, permintaan owner: "gue juga ingin ada history rute yang selesai
// beserta datanya, jadi sebagai admin bisa cek rute tersebut tanpa harus
// buka web"). GET /armada/routes?status=COMPLETED, take bertambah tiap
// "Muat Lebih Banyak" ditekan (pola state-driven sederhana, sama semangat
// dengan `periode` di Performa — bukan useInfiniteQuery, cukup untuk
// kebutuhan "scroll ke belakang sesekali", bukan feed tak terbatas).
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

// `enabled` (13 Sep 2026) — route.jobs bawa jobInclude PENUH per stop
// (payments/units/issueLogs/dst, lihat catatan di GET /armada/routes),
// jauh lebih berat dari endpoint lain di AdminHomeScreen — SENGAJA tidak
// dipanggil sampai admin benar-benar buka sub-tab Riwayat (beda dari
// useIncentiveSummary yang murni angka teragregasi, aman selalu aktif).
export function useRouteHistory(take, enabled = true) {
  return useQuery({
    queryKey: ["admin", "route-history", take],
    queryFn: () => api.getArmadaRoutes({ status: "COMPLETED", take }),
    enabled,
  });
}
