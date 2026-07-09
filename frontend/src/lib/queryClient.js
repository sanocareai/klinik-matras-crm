import { QueryClient } from "@tanstack/react-query";

// Client TanStack Query dipakai di seluruh app (dipasang di main.jsx).
// Default dipilih untuk data CRM: cukup fresh (30 detik) tapi tidak spam
// request, dan tetap di cache 5 menit setelah komponen unmount supaya
// balik ke halaman yang sama terasa instan.
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,       // 30 detik — anggap data masih segar
      gcTime: 5 * 60_000,      // 5 menit — buang dari cache setelah tidak dipakai
      refetchOnWindowFocus: true,
      retry: 2,
    },
  },
});
