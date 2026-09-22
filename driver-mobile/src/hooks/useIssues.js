// Port dari frontend/src/pages/armada/ArmadaIssues.jsx (versi driver,
// read-only) — lihat catatan panjang di JobListScreen.js soal tab
// "Masalah" (17 September 2026, laporan owner). Pola query SAMA dengan
// useMyJobs.js di folder ini (queryFn unwrap .jobs, refetchInterval 30s).
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";

// Query key dibubuhi userId (22 September 2026) — sama alasan dgn
// useMyJobs.js di folder ini, satu pola konsisten untuk SEMUA query
// per-driver supaya tidak ada satu pun yang lolos dari isolasi cache
// per-user.
export function useIssues() {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["armada", "issues", "own", user?.id],
    queryFn: async () => (await api.getIssues()).jobs,
    enabled: !!user?.id,
    refetchInterval: 30_000,
  });
}
