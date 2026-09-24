import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { driverV2Sync } from "../lib/driverDataRuntime";

// Config server adalah satu-satunya pemilih reader. Kedua query memakai key
// berbeda dan hanya satu yang enabled; error V2 tidak pernah fallback ke V1.
export function useMyJobs() {
  const { user, deviceId } = useAuth();
  const principalReady = !!user?.id && !!deviceId;
  const configQuery = useQuery({
    queryKey: ["armada", "reader-config", user?.id, deviceId],
    queryFn: () => api.getDriverReaderConfig(),
    enabled: principalReady,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });
  const readerMode = configQuery.data?.readerMode || null;

  const v1Query = useQuery({
    queryKey: ["armada", "my-jobs", "V1", user?.id],
    queryFn: () => api.getMyJobs(),
    enabled: principalReady && readerMode === "V1",
    refetchInterval: 30_000,
  });

  const v2Query = useQuery({
    queryKey: ["armada", "my-jobs", "V2", user?.id, deviceId],
    queryFn: () => driverV2Sync.load(user.id, deviceId, configQuery.data),
    enabled: principalReady && readerMode === "V2",
    refetchInterval: readerMode === "V2" ? (configQuery.data?.deltaPollMs || 30_000) : false,
    retry: 1,
  });

  const selected = readerMode === "V2" ? v2Query : v1Query;
  const configPending = principalReady && (configQuery.isLoading || !readerMode);
  const error = configQuery.error || selected.error || null;

  return {
    ...selected,
    data: error ? undefined : selected.data,
    error,
    isLoading: configPending || selected.isLoading,
    isFetching: configQuery.isFetching || selected.isFetching,
    isRefetching: configQuery.isRefetching || selected.isRefetching,
    dataUpdatedAt: selected.dataUpdatedAt,
    readerMode,
    recoveryState: readerMode === "V2" && error ? "V2_RECOVERY_REQUIRED" : null,
    refetch: async () => {
      if (!readerMode) return configQuery.refetch();
      return selected.refetch();
    },
  };
}
