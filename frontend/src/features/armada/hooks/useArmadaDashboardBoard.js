import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";

// TanStack Query untuk data utama ArmadaDashboard (8 September 2026, lihat
// catatan panjang di useArmadaTracking.js). 5 fetch paralel (job rentang
// terpilih, kendaraan, job belum-terjadwal, driver, helper) — TETAP satu
// queryFn gabungan (bukan 5 useQuery terpisah), pola sama dengan
// useArmadaRoutesBoard.js, alasan sama: widget-widget dashboard butuh
// beberapa di antaranya bersamaan (mis. kartu snapshot menghitung dari
// `jobs` DAN `vehicles` sekaligus).
export function useArmadaDashboardBoard(range, toApiParams) {
  return useQuery({
    queryKey: ["armada", "dashboard-board", toApiParams(range)],
    queryFn: async () => {
      const [jobsRes, vehiclesRes, unscheduledRes, driversRes, helpersRes] = await Promise.all([
        api.getArmadaJobs({ ...toApiParams(range), take: 200 }),
        api.getVehicles(),
        api.getArmadaJobs({ status: "UNSCHEDULED", take: 200 }),
        api.getDrivers(),
        api.getHelpers(),
      ]);
      return {
        jobs: jobsRes.jobs,
        vehicles: vehiclesRes.vehicles,
        unscheduled: unscheduledRes.jobs,
        drivers: driversRes || [],
        helpers: helpersRes || [],
      };
    },
  });
}
