// TanStack Query client — dipakai bertahap menggantikan pola fetch+useState
// manual di layar-layar berikutnya (Fase M-B+). Fase M-A cukup sediakan
// provider-nya di App.js supaya siap dipakai.
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000, // 30 detik — konsisten dengan CRM web
      retry: 1,
    },
  },
});
