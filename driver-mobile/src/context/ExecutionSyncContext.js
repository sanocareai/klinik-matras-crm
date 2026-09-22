import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from "react";
import { AppState } from "react-native";
import { useAuth } from "./AuthContext";
import { useNetworkStatus } from "../hooks/useNetworkStatus";
import {
  enqueueExecution,
  flushExecutionQueue,
  readExecutionQueue,
  removeExecution,
  subscribeExecutionQueue,
} from "../lib/executionQueue";
import { pendingForJob, retryDelay } from "../lib/executionCore";
import { queryClient } from "../lib/queryClient";
import { api } from "../api";

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
  }, [userId]);

  const value = useMemo(() => ({
    queue,
    pendingCount: queue.length,
    pendingForJob: (jobId) => pendingForJob(queue, jobId),
    submit,
    retry: flush,
    discard,
    connected,
  }), [queue, submit, flush, discard, connected]);

  return <ExecutionSyncContext.Provider value={value}>{children}</ExecutionSyncContext.Provider>;
}

export function useExecutionSync() {
  const value = useContext(ExecutionSyncContext);
  if (!value) throw new Error("useExecutionSync wajib di dalam ExecutionSyncProvider");
  return value;
}
