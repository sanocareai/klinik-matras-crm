export function createIdempotencyKey(prefix = "driver") {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

export function isRetryableExecutionError(error) {
  if (!error) return true;
  // Token kedaluwarsa ditahan sampai user login ulang; payload tidak boleh
  // dibuang atau ditandai invalid permanen.
  if (error.status === 401) return true;
  if (Number.isInteger(error.status)) return error.status >= 500;
  const text = String(error.message || error).toLowerCase();
  return text.includes("network") || text.includes("koneksi") || text.includes("timeout") || text.includes("fetch");
}

export function retryDelay(attempt) {
  return Math.min(60_000, 2_000 * (2 ** Math.max(0, attempt)));
}

export function queueStorageKey(userId) {
  if (!userId) throw new Error("userId wajib untuk antrean sinkronisasi");
  return `driver-execution-queue:v1:${userId}`;
}

export function pendingForJob(queue, jobId) {
  return (queue || []).find((item) => item.jobId === jobId) || null;
}
