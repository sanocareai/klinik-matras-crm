import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import * as FileSystem from "expo-file-system/legacy";
import { useAuth } from "./AuthContext";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import { createExecutionQueue } from "../lib/executionQueue";
import { pendingForJob, retryDelay } from "../lib/executionCore";
import { queryClient } from "../lib/queryClient";
import { api } from "../api";

// SATU-SATUNYA titik instansiasi antrean eksekusi produksi (audit Slice 2,
// 23 September 2026) — createExecutionQueue() sendiri (lib/executionQueue.js)
// SENGAJA tidak mengimpor AsyncStorage/expo-file-system/api asli supaya
// bisa diuji `node --test` biasa; wiring runtime RN sungguhan hidup DI
// SINI, satu-satunya pemanggil di luar file test.
const {
  subscribeExecutionQueue,
  readExecutionQueue,
  enqueueExecution,
  flushExecutionQueue,
  removeExecution,
  reconcileOne,
  clearBlocked: clearBlockedQueue,
} = createExecutionQueue({ storage: AsyncStorage, fs: FileSystem, api });

const ExecutionSyncContext = createContext(null);

export function ExecutionSyncProvider({ children }) {
  const { user } = useAuth();
  const connected = useNetworkStatus();
  const [queue, setQueue] = useState([]);
  const userId = user?.id || null;

  const reload = useCallback(async () => {
    if (!userId) return setQueue([]);
    setQueue(await readExecutionQueue(userId));
  }, [userId]);

  const flush = useCallback(async () => {
    if (!userId || !connected) return;
    const before = await readExecutionQueue(userId);
    const result = await flushExecutionQueue(userId);
    const after = await readExecutionQueue(userId);
    setQueue(after);
    if (result.synced > 0) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs", userId] });
  }, [userId, connected]);

  useEffect(() => {
    reload();
    return subscribeExecutionQueue((changedUserId, next) => {
      if (changedUserId === userId) setQueue([...next]);
    });
  }, [userId, reload]);

  useEffect(() => {
    if (!connected || !userId) return undefined;
    api.setPendingSync(queue.length).catch(() => {});
    if (queue.length === 0) return undefined;

    const attempts = Math.max(0, ...queue.map((item) => Number(item.attempts || 0)));
    const timer = setTimeout(flush, attempts > 0 ? retryDelay(attempts) : 0);
    const sub = AppState.addEventListener("change", (state) => { if (state === "active") flush(); });
    return () => { clearTimeout(timer); sub.remove(); };
  }, [connected, userId, queue, flush]);

  const submit = useCallback(async (input) => {
    if (!userId) throw new Error("Sesi driver tidak tersedia");
    const item = await enqueueExecution({ ...input, userId });
    if (connected) await flushExecutionQueue(userId);
    const latest = await readExecutionQueue(userId);
    setQueue(latest);
    const pending = latest.find((entry) => entry.idempotencyKey === item.idempotencyKey);
    if (pending?.blocked) throw new Error(pending.lastError || "Aksi ditolak server");
    if (!pending) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs", userId] });
    return { pending: !!pending };
  }, [userId, connected]);

  const discard = useCallback(async (idempotencyKey) => {
    if (!userId) return;
    await removeExecution(userId, idempotencyKey);
    const latest = await readExecutionQueue(userId);
    setQueue(latest);
  }, [userId]);

  // "Periksa status terbaru" (audit Slice 2, item blocked) — verifikasi
  // SATU item ke server tanpa mengirim ulang mutasinya. Kalau ternyata
  // sudah tercapai, item hilang dari antrean dan my-jobs di-invalidate
  // supaya kartu job langsung menampilkan status terbaru.
  const checkStatus = useCallback(async (idempotencyKey) => {
    if (!userId) return { resolved: false, verified: false };
    const outcome = await reconcileOne(userId, idempotencyKey);
    const latest = await readExecutionQueue(userId);
    setQueue(latest);
    if (outcome.resolved) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs", userId] });
    return outcome;
  }, [userId]);

  // "Bersihkan antrean bermasalah" (Akun) — buang HANYA item blocked, item
  // pending yang masih sah tidak disentuh.
  const clearBlocked = useCallback(async () => {
    if (!userId) return { removed: 0 };
    const result = await clearBlockedQueue(userId);
    const latest = await readExecutionQueue(userId);
    setQueue(latest);
    return result;
  }, [userId]);

  const value = useMemo(() => ({
    queue,
    pendingCount: queue.length,
    blockedCount: queue.filter((item) => item.blocked).length,
    pendingForJob: (jobId) => pendingForJob(queue, jobId),
    submit,
    retry: flush,
    discard,
    checkStatus,
    clearBlocked,
    connected,
  }), [queue, submit, flush, discard, checkStatus, clearBlocked, connected]);

  return <ExecutionSyncContext.Provider value={value}>{children}</ExecutionSyncContext.Provider>;
}

export function useExecutionSync() {
  const value = useContext(ExecutionSyncContext);
  if (!value) throw new Error("useExecutionSync wajib di dalam ExecutionSyncProvider");
  return value;
}
