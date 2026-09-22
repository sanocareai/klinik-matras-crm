export const CONTROL_TOWER_POLL_MS = 90_000;

export function controlTowerRetryDelay(failureCount) {
  return Math.min(1_000 * (2 ** failureCount), 30_000);
}

export function controlTowerRefreshOptions(isVisible) {
  return {
    refetchOnMount: "always",
    refetchOnWindowFocus: isVisible ? "always" : false,
    refetchInterval: isVisible ? CONTROL_TOWER_POLL_MS : false,
    refetchIntervalInBackground: false,
    retry: 3,
    retryDelay: controlTowerRetryDelay,
  };
}
