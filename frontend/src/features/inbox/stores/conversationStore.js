import { create } from "zustand";

// Urutan daftar percakapan: pinned dulu (by pinnedAt terbaru), lalu sisanya
// by lastMessageAt terbaru — sama seperti logika handlePin di Inbox.jsx lama.
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
  filter: "ALL", // 'ALL' | 'OPEN' | 'PENDING' | 'CLOSED' | 'MINE'
  searchQuery: "",
  conversationsById: {},
  conversationOrder: [], // array of ids, sudah terurut

  setActive: (id) => set({ activeConversationId: id }),
  setFilter: (filter) => set({ filter }),
  setSearch: (searchQuery) => set({ searchQuery }),

  // Insert/update 1 percakapan (dari fetch detail, event socket, dll) + re-sort.
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

  // Insert/update banyak percakapan sekaligus (dari initial list fetch).
  upsertConversations: (list) => set((state) => {
    const conversationsById = { ...state.conversationsById };
    const orderSet = new Set(state.conversationOrder);
    for (const conv of list) {
      conversationsById[conv.id] = { ...conversationsById[conv.id], ...conv };
      orderSet.add(conv.id);
    }
    const order = Array.from(orderSet);
    return { conversationsById, conversationOrder: sortOrder(conversationsById, order) };
  }),

  // Update ringan saat ada pesan baru masuk/keluar — dorong preview + timestamp
  // + unread ke atas tanpa perlu refetch seluruh percakapan.
  bumpConversation: (id, preview, ts, unreadDelta = 0) => set((state) => {
    const existing = state.conversationsById[id];
    if (!existing) return {};
    const updated = {
      ...existing,
      lastMessageAt: ts || new Date().toISOString(),
      unread: unreadDelta > 0 ? true : existing.unread,
      messages: preview !== undefined ? [{ content: preview }, ...(existing.messages || []).slice(1)] : existing.messages,
    };
    const conversationsById = { ...state.conversationsById, [id]: updated };
    return { conversationsById, conversationOrder: sortOrder(conversationsById, state.conversationOrder) };
  }),

  removeConversation: (id) => set((state) => {
    const conversationsById = { ...state.conversationsById };
    delete conversationsById[id];
    return { conversationsById, conversationOrder: state.conversationOrder.filter((x) => x !== id) };
  }),
}));

// ── Selectors granular — komponen subscribe hanya ke bagian yang dipakai ────
export const useActiveId     = () => useConversationStore((s) => s.activeConversationId);
export const useConversation = (id) => useConversationStore((s) => (id ? s.conversationsById[id] : undefined));
export const useOrderedIds   = () => useConversationStore((s) => s.conversationOrder);
export const useFilter       = () => useConversationStore((s) => s.filter);
export const useConvSearchQuery = () => useConversationStore((s) => s.searchQuery);

// Total unread lintas semua percakapan — dipakai untuk title tab browser
// "(N) Inbox — Klinik Matras" (Fase G). unreadCount belum selalu diisi
// backend lama, fallback ke 1 kalau cuma tahu unread=true (sama seperti
// pola ConversationItem.jsx).
export const useTotalUnreadCount = () => useConversationStore((s) => {
  let total = 0;
  for (const id of s.conversationOrder) {
    const c = s.conversationsById[id];
    if (!c) continue;
    total += c.unreadCount ?? (c.unread ? 1 : 0);
  }
  return total;
});
