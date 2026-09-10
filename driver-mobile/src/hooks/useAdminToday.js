// Data gabungan AdminHomeScreen (10 Sep 2026) — 3 fetch paralel, endpoint
// SAMA yang dipakai dispatcher web (ArmadaDashboard/ArmadaTracking/Route
// Planner Masalah), satu queryFn gabungan (pola sama dengan
// useArmadaDashboardBoard.js web) karena tab Hari Ini & Driver sama-sama
// menurunkan datanya dari `jobs`. Poll 30 detik — cukup segar utk "status
// driver sekarang" tanpa mahal.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { todayWIB } from "../lib/roles";

export function useAdminToday() {
  return useQuery({
    queryKey: ["admin", "today"],
    queryFn: async () => {
      const [jobsRes, issuesRes, tracking] = await Promise.all([
        api.getArmadaJobs({ date: todayWIB(), take: 500 }),
        api.getArmadaIssues({ status: "OPEN" }),
        api.getArmadaTracking(),
      ]);
      return { jobs: jobsRes.jobs || [], issues: issuesRes.jobs || [], tracking: tracking || [] };
    },
    refetchInterval: 30_000,
  });
}
