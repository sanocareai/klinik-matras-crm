import { create } from "zustand";

export const useComposerStore = create((set) => ({
  draftByConvId: {},   // { [convId]: string } — draft teks per percakapan, tidak hilang saat pindah chat
  replyTarget: null,   // Message yang sedang dibalas (quote), atau null
  attachments: [],      // file yang sudah dipilih tapi belum dikirim

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
}));

// ── Selectors granular ───────────────────────────────────────────────────────
export const useDraft = (convId) =>
  useComposerStore((s) => (convId ? s.draftByConvId[convId] || "" : ""));
export const useReplyTarget = () => useComposerStore((s) => s.replyTarget);
export const useAttachments = () => useComposerStore((s) => s.attachments);
