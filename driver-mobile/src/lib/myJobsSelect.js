// Seleksi state my-jobs sebagai fungsi murni (audit 29 Okt 2026, poin 2:
// blank/spinner tab Aktif). Diekstrak dari useMyJobs.js supaya bisa diuji
// `node --test` biasa tanpa react-query/React — pola yang sama dipakai
// executionCore.js, deliveryManifest.js, jobListDerive.js di repo ini.
//
// DUA bug lama yang diperbaiki di sini:
// 1. `data: error ? undefined : selected.data` membuang data cache yang
//    masih valid HANYA karena ADA error (config ATAU job query) — padahal
//    error itu bisa transien (refetch gagal sebentar) sementara data lama
//    masih sepenuhnya valid untuk ditampilkan. lastGoodData di bawah hanya
//    direset saat readerMode/userId benar-benar berubah, bukan tiap error.
// 2. `configPending = principalReady && (configQuery.isLoading || !readerMode)`
//    bisa macet true SELAMANYA kalau config query gagal permanen (settled
//    ke error, isLoading sudah false, tapi readerMode tidak pernah terisi)
//    — isLoading di bawah berhenti total begitu hasEverLoaded true, dan
//    configInFlight hanya true selama config BENAR-BENAR masih fetching.
export const INITIAL_MY_JOBS_STATE = { readerMode: null, dataKey: null, lastGoodData: undefined };

export function selectMyJobsState(prevState, input) {
  const {
    principalReady,
    userId,
    configData,
    configError,
    configLoading,
    configFetching,
    configRefetching,
    v1,
    v2,
  } = input;

  // readerMode persisten lintas render sekali diperoleh — TIDAK reset ke
  // null hanya karena config query berikutnya error (itu akar mekanisme
  // spinner permanen #2 di atas).
  const readerMode = configData?.readerMode || prevState.readerMode || null;
  const selected = readerMode === "V2" ? v2 : v1;

  const dataKey = `${readerMode || ""}:${userId || ""}`;
  const keyChanged = dataKey !== prevState.dataKey;
  let lastGoodData = keyChanged ? undefined : prevState.lastGoodData;
  if (selected.data !== undefined) lastGoodData = selected.data;

  const hasEverLoaded = lastGoodData !== undefined;
  const error = configError || selected.error || null;

  const configInFlight = principalReady && !readerMode && (configLoading || configFetching);
  const jobInFlight = principalReady && !!readerMode && selected.isLoading;
  // Fullscreen spinner HANYA sebelum data pernah ada sama sekali — begitu
  // hasEverLoaded true, tidak pernah balik true lagi (akar mekanisme
  // spinner permanen #1: refetch yang gagal tidak lagi memicu fullscreen).
  const isLoading = !hasEverLoaded && (configInFlight || jobInFlight);

  const result = {
    data: lastGoodData,
    error,
    hasEverLoaded,
    isLoading,
    isFetching: !!configFetching || !!selected.isFetching,
    isRefetching: !!configRefetching || !!selected.isRefetching,
    dataUpdatedAt: selected.dataUpdatedAt,
    readerMode,
    recoveryState: readerMode === "V2" && error ? "V2_RECOVERY_REQUIRED" : null,
  };

  return { state: { readerMode, dataKey, lastGoodData }, result };
}
