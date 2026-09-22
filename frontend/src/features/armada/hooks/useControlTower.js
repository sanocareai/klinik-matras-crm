import { useEffect, useRef, useSyncExternalStore } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "@/api.js";
import { useTabVisibility } from "@/lib/TabsContext.jsx";
import { controlTowerRefreshOptions } from "@/features/armada/controlTowerRefresh.js";

function subscribeDocumentVisibility(onChange) {
  if (typeof document === "undefined") return () => {};
  document.addEventListener("visibilitychange", onChange);
  return () => document.removeEventListener("visibilitychange", onChange);
}

function documentIsVisible() {
  return typeof document === "undefined" || document.visibilityState === "visible";
}

// SATU sumber data: GET /armada/routes. Refresh 90 detik hanya berjalan
// ketika tab SANSS dan tab browser terlihat. Mount, aktivasi tab internal,
// dan browser focus memicu refetch; retry memakai exponential backoff.
export function useControlTower(range, toApiParams) {
  const isAppTabVisible = useTabVisibility();
  const isBrowserVisible = useSyncExternalStore(
    subscribeDocumentVisibility,
    documentIsVisible,
    () => true
  );
  const isVisible = isAppTabVisible && isBrowserVisible;
  const wasAppTabVisible = useRef(isAppTabVisible);

  const query = useQuery({
    queryKey: ["armada", "control-tower", toApiParams(range)],
    queryFn: async () => {
      const res = await api.getRoutes(toApiParams(range));
      return res.routes || [];
    },
    ...controlTowerRefreshOptions(isVisible),
  });

  // Tab internal SANSS tetap mounted lewat keep-alive. TanStack menangani
  // browser focus; transisi tab internal background -> aktif perlu refetch
  // eksplisit. Mount awal sudah ditangani refetchOnMount.
  useEffect(() => {
    if (isAppTabVisible && !wasAppTabVisible.current && isBrowserVisible) {
      query.refetch();
    }
    wasAppTabVisible.current = isAppTabVisible;
  }, [isAppTabVisible, isBrowserVisible, query.refetch]);

  return query;
}
