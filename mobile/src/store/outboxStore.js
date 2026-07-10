// Antrean pesan gagal kirim/offline — dipersist ke MMKV supaya kalau app
// ditutup sebelum sempat online lagi, pesan tetap ada dan otomatis dicoba
// kirim ulang begitu app dibuka & koneksi kembali (lihat src/lib/outboxFlush.js).
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandMMKVStorage } from "../lib/storage";

export const useOutboxStore = create(
  persist(
    (set) => ({
      queue: [], // { convId, tempId, payload: { content }, retryCount, createdAt }

      enqueue: (item) => set((state) => ({
        queue: [...state.queue, { ...item, retryCount: 0, createdAt: Date.now() }],
      })),

      dequeue: (tempId) => set((state) => ({
        queue: state.queue.filter((q) => q.tempId !== tempId),
      })),

      incrementRetry: (tempId) => set((state) => ({
        queue: state.queue.map((q) =>
          q.tempId === tempId ? { ...q, retryCount: q.retryCount + 1 } : q
        ),
      })),
    }),
    {
      name: "outbox-store",
      storage: createJSONStorage(() => zustandMMKVStorage),
    }
  )
);
