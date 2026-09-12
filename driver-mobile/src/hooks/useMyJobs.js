// Port dari frontend/src/features/armada/hooks/useMyJobs.js (pola
// TanStack Query yang sudah jadi standar rumah, staleTime 30s konsisten
// dengan queryClient.js). GET /armada/my-jobs SUDAH ADA di backend, nol
// endpoint baru.
//
// refetchInterval 30s (12 September 2026, BUG laporan owner: "gue buka
// akun alwan... di web job sudah selesai, tapi di apps akun alwan masih
// ada job yang udah selesai") — AKAR MASALAH: hook ini SEBELUMNYA tidak
// polling sama sekali, jadi begitu JobListScreen mount sekali, data
// TIDAK PERNAH refresh lagi kecuali driver sendiri melakukan aksi
// (onChanged→refetch()) atau tarik-turun manual. Kalau job diselesaikan
// dari SISI LAIN (admin input manual proof of delivery lewat web —
// dipakai selama driver belum trial app, lihat JobDetailDrawer.jsx
// simpanBuktiManual) TIDAK ADA yang memicu refetch di app, jadi kartu
// job "menempel" seolah masih aktif walau backend sudah COMPLETED.
// Interval 30s SAMA dengan pola polling lain yang sudah ada di app ini
// (useAdminToday.js) — bukan angka baru yang dikarang.
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";

export function useMyJobs() {
  return useQuery({
    queryKey: ["armada", "my-jobs"],
    // Backend GET /armada/my-jobs balikin { jobs: [...] } (objek), BUKAN
    // array langsung — unwrap .jobs, sama dengan hook web
    // (frontend/src/features/armada/hooks/useMyJobs.js).
    queryFn: async () => (await api.getMyJobs()).jobs,
    refetchInterval: 30_000,
  });
}
