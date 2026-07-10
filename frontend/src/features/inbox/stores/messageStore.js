import { create } from "zustand";
import { useConversationStore } from "./conversationStore.js";

const EMPTY_ARR = [];

export const useMessageStore = create((set) => ({
  messagesByConvId: {},   // { [convId]: Message[] }
  hasMoreByConvId: {},    // { [convId]: boolean } — masih ada pesan lama untuk di-load

  setMessages: (convId, msgs, hasMore = false) => set((state) => ({
    messagesByConvId: { ...state.messagesByConvId, [convId]: msgs },
    hasMoreByConvId: { ...state.hasMoreByConvId, [convId]: hasMore },
  })),

  appendMessage: (convId, msg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    // Hindari duplikat — bisa terjadi kalau event socket & optimistic update tumpang tindih
    if (list.some((m) => m.id === msg.id)) return {};
    return { messagesByConvId: { ...state.messagesByConvId, [convId]: [...list, msg] } };
  }),

  // Load pesan lebih lama (infinite scroll ke atas) — ditaruh di depan array.
  prependMessages: (convId, olderMsgs, hasMore) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    const existingIds = new Set(list.map((m) => m.id));
    const fresh = olderMsgs.filter((m) => !existingIds.has(m.id));
    return {
      messagesByConvId: { ...state.messagesByConvId, [convId]: [...fresh, ...list] },
      hasMoreByConvId: hasMore !== undefined
        ? { ...state.hasMoreByConvId, [convId]: hasMore }
        : state.hasMoreByConvId,
    };
  }),

  // Ganti pesan sementara (optimistic, id = tempId) dengan pesan asli dari server.
  replaceTempMessage: (convId, tempId, realMsg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    return {
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: list.map((m) => (m.id === tempId ? realMsg : m)),
      },
    };
  }),

  // Tandai pesan optimistic gagal terkirim — UI menampilkan tombol retry.
  markMessageFailed: (convId, tempId) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    return {
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: list.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
      },
    };
  }),

  // Update status centang kirim (ack) untuk 1 pesan spesifik via externalId.
  // Dicari di conversation AKTIF dulu (paling umum — user sedang lihat chat itu),
  // baru fallback cari di semua conversation yang sudah dimuat di cache.
  updateAck: (externalId, ack) => set((state) => {
    const activeId = useConversationStore.getState().activeConversationId;
    const searchOrder = activeId
      ? [activeId, ...Object.keys(state.messagesByConvId).filter((id) => id !== activeId)]
      : Object.keys(state.messagesByConvId);

    for (const convId of searchOrder) {
      const list = state.messagesByConvId[convId];
      if (!list) continue;
      const idx = list.findIndex((m) => m.externalId === externalId);
      if (idx === -1) continue;
      const updatedList = [...list];
      updatedList[idx] = { ...updatedList[idx], ack };
      return { messagesByConvId: { ...state.messagesByConvId, [convId]: updatedList } };
    }
    return {};
  }),

  // Update field arbitrer (mis. mediaUrl setelah "Muat Media" berhasil) —
  // dicari lintas conversation sama seperti updateAck (id pesan unik global,
  // tidak perlu tahu convId dari caller).
  updateMessage: (messageId, patch) => set((state) => {
    const activeId = useConversationStore.getState().activeConversationId;
    const searchOrder = activeId
      ? [activeId, ...Object.keys(state.messagesByConvId).filter((id) => id !== activeId)]
      : Object.keys(state.messagesByConvId);

    for (const convId of searchOrder) {
      const list = state.messagesByConvId[convId];
      if (!list) continue;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) continue;
      const updatedList = [...list];
      updatedList[idx] = { ...updatedList[idx], ...patch };
      return { messagesByConvId: { ...state.messagesByConvId, [convId]: updatedList } };
    }
    return {};
  }),

  clearConversation: (convId) => set((state) => {
    const messagesByConvId = { ...state.messagesByConvId };
    delete messagesByConvId[convId];
    const hasMoreByConvId = { ...state.hasMoreByConvId };
    delete hasMoreByConvId[convId];
    return { messagesByConvId, hasMoreByConvId };
  }),
}));

// ── Selectors granular ───────────────────────────────────────────────────────
export const useMessagesForConv = (convId) =>
  useMessageStore((s) => (convId ? s.messagesByConvId[convId] || EMPTY_ARR : EMPTY_ARR));
export const useHasMoreForConv = (convId) =>
  useMessageStore((s) => (convId ? !!s.hasMoreByConvId[convId] : false));
