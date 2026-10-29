import { useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useAuth } from "../context/AuthContext";
import { driverV2Sync } from "../lib/driverDataRuntime";
import { selectMyJobsState, INITIAL_MY_JOBS_STATE } from "../lib/myJobsSelect";

// Config server adalah satu-satunya pemilih reader. Kedua query memakai key
// berbeda dan hanya satu yang enabled; error V2 tidak pernah fallback ke V1.
// Logika seleksi hasil (cache mana yang ditampilkan, kapan boleh spinner
// fullscreen) ada di lib/myJobsSelect.js — murni & diuji terpisah, lihat
// komentar di sana untuk kronologi bug blank/spinner 29 Okt 2026.
export function useMyJobs() {
  const { user, deviceId } = useAuth();
  const principalReady = !!user?.id && !!deviceId;
  const stateRef = useRef(INITIAL_MY_JOBS_STATE);

  const configQuery = useQuery({
    queryKey: ["armada", "reader-config", user?.id, deviceId],
    queryFn: () => api.getDriverReaderConfig(),
    enabled: principalReady,
    staleTime: 60_000,
    refetchInterval: 5 * 60_000,
  });

  // readerMode dari render sebelumnya (via stateRef) dipakai di sini HANYA
  // untuk memutuskan query mana yang enabled SEKARANG — selectMyJobsState
  // di bawah yang menghasilkan readerMode final (gabungan config terbaru +
  // fallback persisten), tapi baru tersedia SETELAH v1Query/v2Query ini
  // dibuat, jadi tidak bisa dipakai duluan.
  const readerModeForQueries = configQuery.data?.readerMode || stateRef.current.readerMode || null;

  const v1Query = useQuery({
    queryKey: ["armada", "my-jobs", "V1", user?.id],
    queryFn: () => api.getMyJobs(),
    enabled: principalReady && readerModeForQueries === "V1",
    refetchInterval: 30_000,
  });

  const v2Query = useQuery({
    queryKey: ["armada", "my-jobs", "V2", user?.id, deviceId],
    queryFn: () => driverV2Sync.load(user.id, deviceId, configQuery.data),
    enabled: principalReady && readerModeForQueries === "V2",
    refetchInterval: readerModeForQueries === "V2" ? (configQuery.data?.deltaPollMs || 30_000) : false,
    retry: 1,
  });

  const { state, result } = selectMyJobsState(stateRef.current, {
    principalReady,
    userId: user?.id || null,
    configData: configQuery.data,
    configError: configQuery.error,
    configLoading: configQuery.isLoading,
    configFetching: configQuery.isFetching,
    configRefetching: configQuery.isRefetching,
    v1: v1Query,
    v2: v2Query,
  });
  stateRef.current = state;

  return {
    ...result,
    refetch: async () => {
      if (!result.readerMode) return configQuery.refetch();
      return (result.readerMode === "V2" ? v2Query : v1Query).refetch();
    },
  };
}
