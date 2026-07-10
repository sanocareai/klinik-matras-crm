// Draft pesan per percakapan — dipersist ke MMKV supaya draft tidak hilang
// kalau app ditutup paksa/sinyal jelek pas sales lagi ngetik di lapangan.
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { zustandMMKVStorage } from "../lib/storage";

export const useComposerStore = create(
  persist(
    (set) => ({
      draftByConvId: {},   // { [convId]: string }
      replyTarget: null,   // Message yang sedang dibalas (quote), atau null
      attachments: [],     // file yang sudah dipilih tapi belum dikirim

      setDraft: (convId, text) => set((state) => ({
        draftByConvId: { ...state.draftByConvId, [convId]: text },
      })),

      setReplyTarget: (msg) => set({ replyTarget: msg }),
      clearReply: () => set({ replyTarget: null }),

      addAttachment: (attachment) => set((state) => ({
        attachments: [...state.attachments, attachment],
      })),
      removeAttachment: (index) => set((state) => ({
        attachments: state.attachments.filter((_, i) => i !== index),
      })),

      // Reset composer setelah kirim / pindah percakapan.
      clearComposer: (convId) => set((state) => {
        const draftByConvId = { ...state.draftByConvId };
        if (convId) delete draftByConvId[convId];
        return { draftByConvId, replyTarget: null, attachments: [] };
      }),
    }),
    {
      name: "composer-store",
      storage: createJSONStorage(() => zustandMMKVStorage),
      // replyTarget & attachments sengaja TIDAK dipersist — cuma draft teks
      // yang perlu selamat lintas sesi.
      partialize: (state) => ({ draftByConvId: state.draftByConvId }),
    }
  )
);

// ── Selectors granular ───────────────────────────────────────────────────────
export const useDraft = (convId) =>
  useComposerStore((s) => (convId ? s.draftByConvId[convId] || "" : ""));
export const useReplyTarget = () => useComposerStore((s) => s.replyTarget);
export const useAttachments = () => useComposerStore((s) => s.attachments);
