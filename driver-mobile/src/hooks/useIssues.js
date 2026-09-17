// Port dari frontend/src/pages/armada/ArmadaIssues.jsx (versi driver,
// read-only) — lihat catatan panjang di JobListScreen.js soal tab
// "Masalah" (17 September 2026, laporan owner). Pola query SAMA dengan
// useMyJobs.js di folder ini (queryFn unwrap .jobs, refetchInterval 30s).
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useIssues() {
  return useQuery({
    queryKey: ["armada", "issues", "own"],
    queryFn: async () => (await api.getIssues()).jobs,
    refetchInterval: 30_000,
  });
}
