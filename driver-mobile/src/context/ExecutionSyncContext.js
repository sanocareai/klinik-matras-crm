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
  retryBlockedExecution,
  clearBlocked: clearBlockedQueue,
} = createExecutionQueue({ storage: AsyncStorage, fs: FileSystem, api });

const ExecutionSyncContext = createContext(null);

export function ExecutionSyncProvider({ children }) {
  const { user, deviceId } = useAuth();
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
    if (result.synced > 0) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs"] });
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
    const item = await enqueueExecution({ ...input, userId, deviceId, readerMode: input.readerMode || "V1" });
    if (connected) await flushExecutionQueue(userId);
    const latest = await readExecutionQueue(userId);
    setQueue(latest);
    const pending = latest.find((entry) => entry.idempotencyKey === item.idempotencyKey);
    if (pending?.blocked) throw Object.assign(new Error(pending.lastError || "Aksi ditolak server"), { code: pending.lastErrorCode || null });
    if (!pending) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs"] });
    return { pending: !!pending };
  }, [userId, deviceId, connected]);

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
    if (outcome.resolved) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs"] });
    return outcome;
  }, [userId]);

  // "Kirim Ulang" EKSPLISIT per-item (audit 29 Okt 2026, poin 3) — BEDA
  // dari checkStatus di atas: kalau verifikasi belum resolved, BENAR-BENAR
  // mengirim ulang mutasi aslinya (lihat retryBlockedExecution di
  // lib/executionQueue.js), bukan cuma mengecek. Dipakai tombol "Kirim
  // Ulang" per-item saat item sudah blocked — checkStatus ("Periksa Status
  // Terbaru") tetap tersedia terpisah untuk driver yang cuma mau tahu tanpa
  // memicu percobaan baru.
  const retryItem = useCallback(async (idempotencyKey) => {
    if (!userId) return { resolved: false, verified: false, resent: false };
    const outcome = await retryBlockedExecution(userId, idempotencyKey);
    const latest = await readExecutionQueue(userId);
    setQueue(latest);
    if (outcome.resolved) queryClient.invalidateQueries({ queryKey: ["armada", "my-jobs"] });
    return outcome;
  }, [userId]);

  // "Kirim Ulang" GLOBAL (strip pendingCount, JobListScreen) — SEBELUM ini
  // sama persis dengan `flush` (flushExecutionQueue), yang untuk item
  // SUDAH blocked cuma reconcile baca-saja (tidak mungkin menyelesaikan
  // item checklist/konflik yang preconditionnya sudah berubah tanpa
  // dikirim ulang). Audit 29 Okt 2026, poin 3: "Tombol Kirim Ulang harus
  // benar-benar melakukan aksi sesuai tipe queue." Sekarang: resend EKSPLISIT
  // tiap item yang sudah blocked dulu (driver menekan tombol bernama "Kirim
  // Ulang" — niatnya jelas), baru lanjut flush biasa untuk sisa item pending.
  const retryAll = useCallback(async () => {
    if (!userId) return;
    const current = await readExecutionQueue(userId);
    for (const item of current.filter((it) => it.blocked)) {
      await retryBlockedExecution(userId, item.idempotencyKey);
    }
    await flush();
  }, [userId, flush]);

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
    // "Kirim Ulang" GLOBAL (strip pendingCount) — retryAll, BUKAN flush
    // polos (lihat catatan di retryAll: untuk item yang sudah blocked,
    // flush saja cuma reconcile baca-saja, retryAll benar-benar mengirim
    // ulang).
    retry: retryAll,
    discard,
    checkStatus,
    retryItem,
    clearBlocked,
    connected,
  }), [queue, submit, retryAll, discard, checkStatus, retryItem, clearBlocked, connected]);

  return <ExecutionSyncContext.Provider value={value}>{children}</ExecutionSyncContext.Provider>;
}

export function useExecutionSync() {
  const value = useContext(ExecutionSyncContext);
  if (!value) throw new Error("useExecutionSync wajib di dalam ExecutionSyncProvider");
  return value;
}
