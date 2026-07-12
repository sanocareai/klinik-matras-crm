import { create } from "zustand";

export const useComposerStore = create((set) => ({
  draftByConvId: {},   // { [convId]: string } — draft teks per percakapan, tidak hilang saat pindah chat
  replyTarget: null,   // Message yang sedang dibalas (quote), atau null
  attachments: [],      // file yang sudah dipilih tapi belum dikirim
  editingMessage: null,      // Message yang sedang diedit, atau null
  preEditDraftByConvId: {},  // draft yang lagi diketik SEBELUM masuk mode edit — dikembalikan saat Batal

  setDraft: (convId, text) => set((state) => ({
    draftByConvId: { ...state.draftByConvId, [convId]: text },
  })),

  setReplyTarget: (msg) => set({ replyTarget: msg }),
  clearReply: () => set({ replyTarget: null }),

  // Masuk mode edit — simpan draft yang lagi diketik (dikembalikan kalau
  // Batal), ganti draft jadi isi pesan yang mau diedit, batalkan reply aktif
  // (tidak masuk akal reply+edit bersamaan di composer yang sama).
  startEditingMessage: (convId, msg) => set((state) => ({
    editingMessage: msg,
    replyTarget: null,
    preEditDraftByConvId: { ...state.preEditDraftByConvId, [convId]: state.draftByConvId[convId] || "" },
    draftByConvId: { ...state.draftByConvId, [convId]: msg.content || "" },
  })),
  cancelEditingMessage: (convId) => set((state) => ({
    editingMessage: null,
    draftByConvId: { ...state.draftByConvId, [convId]: state.preEditDraftByConvId[convId] || "" },
  })),
  finishEditingMessage: (convId) => set((state) => {
    const draftByConvId = { ...state.draftByConvId };
    delete draftByConvId[convId];
    return { editingMessage: null, draftByConvId };
  }),

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
    return { draftByConvId, replyTarget: null, attachments: [], editingMessage: null };
  }),
}));

// ── Selectors granular ───────────────────────────────────────────────────────
export const useDraft = (convId) =>
  useComposerStore((s) => (convId ? s.draftByConvId[convId] || "" : ""));
export const useReplyTarget = () => useComposerStore((s) => s.replyTarget);
export const useAttachments = () => useComposerStore((s) => s.attachments);
export const useEditingMessage = () => useComposerStore((s) => s.editingMessage);
