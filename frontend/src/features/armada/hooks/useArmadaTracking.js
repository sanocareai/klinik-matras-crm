import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";
import { useTabVisibility } from "@/lib/TabsContext.jsx";

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
  // D-145 (9 September 2026) — sistem tab dalam-app (D-144) bikin halaman
  // ini bisa tetap MOUNTED di tab background. Ini murni tampilan BACA posisi
  // (dispatcher melihat peta) — pause refetch saat tab tidak aktif TIDAK
  // memengaruhi pengiriman GPS driver sama sekali (itu jalur TERPISAH,
  // hooks/useDriverTracking.js, sengaja TIDAK disentuh perubahan ini —
  // posisi driver harus tetap terkirim walau app dispatcher sedang di tab
  // lain).
  const isTabVisible = useTabVisibility();
  return useQuery({
    queryKey: ["armada", "tracking"],
    queryFn: () => api.getArmadaTracking(),
    refetchInterval: isTabVisible ? TRACKING_POLL_MS : false,
  });
}
