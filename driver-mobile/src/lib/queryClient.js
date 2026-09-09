// Sama dengan mobile/src/lib/queryClient.js dan frontend/src/lib/
// queryClient.js — staleTime 30 detik konsisten di seluruh app (web/RN).
import { QueryClient } from "@tanstack/react-query";

export const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30000,
      retry: 1,
    },
  },
});
