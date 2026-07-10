// Store percakapan (Inbox) — pola SAMA dengan
// frontend/src/features/inbox/stores/conversationStore.js versi web, supaya
// perilaku (urutan list, upsert dari socket) konsisten di kedua platform.
import { create } from "zustand";

// Urutan daftar: pinned dulu (by pinnedAt terbaru), lalu sisanya
// by lastMessageAt terbaru.
function sortOrder(conversationsById, order) {
  return [...order].sort((a, b) => {
    const ca = conversationsById[a];
    const cb = conversationsById[b];
    if (!ca || !cb) return 0;
    if (!!ca.pinned !== !!cb.pinned) return ca.pinned ? -1 : 1;
    if (ca.pinned && cb.pinned) {
      return new Date(cb.pinnedAt || 0) - new Date(ca.pinnedAt || 0);
    }
    return new Date(cb.lastMessageAt || 0) - new Date(ca.lastMessageAt || 0);
  });
}

export const useConversationStore = create((set) => ({
  activeConversationId: null,
  conversationsById: {},
  conversationOrder: [], // array of ids, sudah terurut

  setActive: (id) => set({ activeConversationId: id }),

  // Ganti daftar percakapan yang TAMPIL saat ini (mis. hasil fetch tab
  // "Terbuka") — merge data ke byId (supaya event socket utk percakapan lain
  // yang belum tampil tidak hilang), tapi order mengikuti persis hasil fetch
  // ini (supaya konsisten dengan filter tab/status di server).
  setConversationList: (list) => set((state) => {
    const conversationsById = { ...state.conversationsById };
    for (const conv of list) {
      conversationsById[conv.id] = { ...conversationsById[conv.id], ...conv };
    }
    const order = sortOrder(conversationsById, list.map((c) => c.id));
    return { conversationsById, conversationOrder: order };
  }),

  // Insert/update 1 percakapan (dari event socket conversation:update) + re-sort.
  upsertConversation: (conv) => set((state) => {
    const conversationsById = {
      ...state.conversationsById,
      [conv.id]: { ...state.conversationsById[conv.id], ...conv },
    };
    const order = state.conversationOrder.includes(conv.id)
      ? state.conversationOrder
      : [...state.conversationOrder, conv.id];
    return { conversationsById, conversationOrder: sortOrder(conversationsById, order) };
  }),

  // Update ringan saat ada pesan baru masuk/keluar — dorong preview +
  // timestamp + unread ke atas tanpa refetch. Hanya berlaku untuk percakapan
  // yang SUDAH ada di cache (percakapan baru menunggu fetch/tab berikutnya).
  bumpConversation: (id, preview, ts, unreadDelta = 0) => set((state) => {
    const existing = state.conversationsById[id];
    if (!existing) return {};
    const updated = {
      ...existing,
      lastMessageAt: ts || new Date().toISOString(),
      unread: unreadDelta > 0 ? true : existing.unread,
    };
    const conversationsById = { ...state.conversationsById, [id]: updated };
    return { conversationsById, conversationOrder: sortOrder(conversationsById, state.conversationOrder) };
  }),
}));

// ── Selectors granular — komponen subscribe hanya ke bagian yang dipakai ────
export const useActiveId = () => useConversationStore((s) => s.activeConversationId);
export const useConversation = (id) => useConversationStore((s) => (id ? s.conversationsById[id] : undefined));
export const useOrderedIds = () => useConversationStore((s) => s.conversationOrder);
