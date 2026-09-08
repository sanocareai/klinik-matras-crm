import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";

// TanStack Query untuk GET /armada/tracking (8 September 2026, laporan
// owner: "optimalkan agar lebih smooth, fast, enteng" — Delivery Hub belum
// ikut migrasi ke pola yang SUDAH jadi standar rumah, lihat
// lib/queryClient.js/useDashboardData.js). MENGGANTIKAN polling manual
// `setInterval` di ArmadaTracking.jsx — `refetchInterval` bawaan react-query
// melakukan hal yang SAMA PERSIS (poll tiap 15 detik) tanpa perlu effect +
// cleanup manual, DAN dapat cache-reuse gratis (balik ke halaman Live
// Tracking dari halaman lain tampil instan dari cache sebelum refresh).
const TRACKING_POLL_MS = 15_000;

export function useArmadaTracking() {
  return useQuery({
    queryKey: ["armada", "tracking"],
    queryFn: () => api.getArmadaTracking(),
    refetchInterval: TRACKING_POLL_MS,
  });
}
