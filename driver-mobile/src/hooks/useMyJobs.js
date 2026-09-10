// Port dari frontend/src/features/armada/hooks/useMyJobs.js (pola
// TanStack Query yang sudah jadi standar rumah, staleTime 30s konsisten
// dengan queryClient.js). GET /armada/my-jobs SUDAH ADA di backend, nol
// endpoint baru.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useMyJobs() {
  return useQuery({
    queryKey: ["armada", "my-jobs"],
    // Backend GET /armada/my-jobs balikin { jobs: [...] } (objek), BUKAN
    // array langsung — unwrap .jobs, sama dengan hook web
    // (frontend/src/features/armada/hooks/useMyJobs.js).
    queryFn: async () => (await api.getMyJobs()).jobs,
  });
}
