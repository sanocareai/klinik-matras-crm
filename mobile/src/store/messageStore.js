// Store pesan per percakapan — pola SAMA dengan
// frontend/src/features/inbox/stores/messageStore.js versi web.
import { create } from "zustand";
import { useConversationStore } from "./conversationStore";

const EMPTY_ARR = [];

// BUG (fix): FlashList/React butuh KEY YANG STABIL per cell (keyExtractor di
// ChatScreen.js pakai item.id, yang sebelumnya = m.id langsung) — begitu
// pesan optimistic (id="temp-...") dibalas server dan diganti objek asli
// (id=cuid asli, lihat replaceTempMessage), key cell itu berubah TOTAL di
// posisi yang SAMA. React/FlashList melihat ini sebagai "hapus cell lama +
// pasang cell baru", bukan "update cell yang sudah ada" — dipaksa
// unmount+remount PERSIS di posisi paling bawah (anchor) tempat
// maintainVisibleContentPosition sedang berusaha jaga posisi scroll, itu
// yang menyebabkan list "loncat" tiap kirim pesan. _key dibuat SEKALI saat
// pesan pertama masuk store (baik optimistic maupun dari server/socket) dan
// TIDAK PERNAH berubah lagi — beda dari `id`/`externalId` yang boleh
// berganti (temp→real, atau null→terisi).
function ensureKey(m) {
  return m._key ? m : { ...m, _key: m.id };
}

export const useMessageStore = create((set) => ({
  messagesByConvId: {}, // { [convId]: Message[] }
  hasMoreByConvId: {},  // { [convId]: boolean } — masih ada pesan lama untuk di-load

  setMessages: (convId, msgs, hasMore = false) => set((state) => ({
    messagesByConvId: { ...state.messagesByConvId, [convId]: msgs.map(ensureKey) },
    hasMoreByConvId: { ...state.hasMoreByConvId, [convId]: hasMore },
  })),

  appendMessage: (convId, msg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    // Hindari duplikat — bisa terjadi kalau event socket & optimistic update tumpang tindih
    if (list.some((m) => m.id === msg.id)) return {};
    return { messagesByConvId: { ...state.messagesByConvId, [convId]: [...list, ensureKey(msg)] } };
  }),

  // Load pesan lebih lama (infinite scroll ke atas) — ditaruh di depan array.
  prependMessages: (convId, olderMsgs, hasMore) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    const existingIds = new Set(list.map((m) => m.id));
    const fresh = olderMsgs.filter((m) => !existingIds.has(m.id)).map(ensureKey);
    return {
      messagesByConvId: { ...state.messagesByConvId, [convId]: [...fresh, ...list] },
      hasMoreByConvId: hasMore !== undefined
        ? { ...state.hasMoreByConvId, [convId]: hasMore }
        : state.hasMoreByConvId,
    };
  }),

  // Ganti pesan sementara (optimistic, id = tempId) dengan pesan asli dari
  // server — _key SENGAJA dipertahankan dari entry lama (= tempId) supaya
  // keyExtractor tidak melihat ini sebagai cell baru (lihat catatan
  // ensureKey di atas). id/externalId/semua field lain tetap diganti utuh
  // ke nilai asli dari server seperti sebelumnya.
  replaceTempMessage: (convId, tempId, realMsg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    return {
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: list.map((m) => (m.id === tempId ? { ...realMsg, _key: m._key || tempId } : m)),
      },
    };
  }),

  // Tandai pesan optimistic gagal terkirim (setelah outbox habis retry) —
  // UI menampilkan tombol retry manual.
  markMessageFailed: (convId, tempId) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    return {
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: list.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
      },
    };
  }),

  // Update status centang kirim (ack) untuk 1 pesan via externalId. Dicari
  // di conversation AKTIF dulu, baru fallback ke semua conversation di cache.
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

  // Update sebagian field pesan yang SUDAH ada (by id) — dipakai untuk
  // message:update socket event (edit/revoke dari webhook, lihat
  // useSocketEvents.js), pola SAMA dengan updateAck di atas dan
  // frontend/src/features/inbox/stores/messageStore.js#updateMessage.
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

  // "Hapus untuk Saya" (lokal) — hard remove dari store, dipakai untuk hasil
  // sukses DELETE .../local (dipanggil sendiri) MAUPUN socket event
  // message:deleted (dihapus dari sesi CRM lain, lihat useSocketEvents.js).
  removeMessage: (messageId) => set((state) => {
    const activeId = useConversationStore.getState().activeConversationId;
    const searchOrder = activeId
      ? [activeId, ...Object.keys(state.messagesByConvId).filter((id) => id !== activeId)]
      : Object.keys(state.messagesByConvId);

    for (const convId of searchOrder) {
      const list = state.messagesByConvId[convId];
      if (!list) continue;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) continue;
      return {
        messagesByConvId: { ...state.messagesByConvId, [convId]: list.filter((m) => m.id !== messageId) },
      };
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
