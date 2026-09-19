// Store percakapan (Inbox) — pola SAMA dengan
// frontend/src/features/inbox/stores/conversationStore.js versi web: cache
// GLOBAL & akumulatif (semua percakapan yang pernah di-fetch dari filter
// manapun tetap ada di sini), list yang tampil disaring ulang di komponen
// lewat filter/search AKTIF SEKARANG (lihat ChatListScreen.js#matches).
import { create } from "zustand";

// Urutan daftar: pinned dulu (by pinnedAt terbaru), lalu sisanya
// by lastMessageAt terbaru.
// PERF (19 Sep 2026): kunci urut dihitung SEKALI per id (O(n)), lalu sort membandingkan ANGKA.
// Versi lama memanggil `new Date(...)` DI DALAM comparator — dengan ~1.400 percakapan di cache
// itu berarti ±29.000 objek Date dibuat & dibuang tiap satu event socket (sort O(n log n) × 2
// Date per perbandingan). Itu beban CPU + sampah memori yang nyata terasa sebagai panas/tersendat,
// padahal hasil urutannya sama persis: pinned dulu (pinnedAt terbaru), lalu lastMessageAt terbaru.
function sortOrder(conversationsById, order) {
  const key = new Map();
  for (const id of order) {
    const c = conversationsById[id];
    if (!c) { key.set(id, -1); continue; } // entri rusak/hilang → taruh paling belakang
    const t = Date.parse((c.pinned ? c.pinnedAt : c.lastMessageAt) || "") || 0;
    key.set(id, c.pinned ? 1e16 + t : t); // offset 1e16 >> epoch ms, jadi pinned selalu menang
  }
  return [...order].sort((a, b) => key.get(b) - key.get(a));
}

// Apakah perubahan ini menyentuh field yang menentukan URUTAN? Kalau tidak (mis. isRead/unreadCount/
// assignedTo/preview), daftar tidak perlu di-sort ulang sama sekali.
function urutanBerubah(prev, next) {
  return !prev
    || prev.lastMessageAt !== next.lastMessageAt
    || !!prev.pinned !== !!next.pinned
    || prev.pinnedAt !== next.pinnedAt;
}

export const useConversationStore = create((set) => ({
  activeConversationId: null,
  filter: "ALL", // 'ALL' | 'OPEN' | 'PENDING' | 'CLOSED' | 'MINE'
  searchQuery: "",
  // Filter TAMBAHAN "per Sales" (fitur baru) — { id, name } | null. Beda dari
  // tab MINE (yang selalu berarti "punya SAYA"): ini memilih SIAPA PUN
  // (biasanya dipakai admin), independen dari filter status/UNREAD/UNANSWERED
  // di atas — lihat ChatListScreen.js#matches untuk cara keduanya digabung.
  salesFilter: null,
  conversationsById: {},
  conversationOrder: [], // array of ids, sudah terurut

  setActive: (id) => set({ activeConversationId: id }),
  setFilter: (filter) => set({ filter }),
  setSearch: (searchQuery) => set({ searchQuery }),
  // Pilih tab MINE + salesFilter aktif sekaligus itu membingungkan (dua-duanya
  // sama-sama mengklaim arti "assignedTo siapa") — begitu salesFilter dipilih,
  // tab yang lagi MINE otomatis balik ke ALL supaya hasil kelihatan konsisten
  // dengan chip filter yang tampil.
  setSalesFilter: (salesFilter) => set((state) => ({
    salesFilter,
    filter: salesFilter && state.filter === "MINE" ? "ALL" : state.filter,
  })),

  // Insert/update 1 percakapan (dari fetch detail, event socket, dll) + re-sort.
  upsertConversation: (conv) => set((state) => {
    const prev = state.conversationsById[conv.id];
    const next = { ...prev, ...conv };
    const conversationsById = { ...state.conversationsById, [conv.id]: next };
    const sudahAda = state.conversationOrder.includes(conv.id);
    // Tanpa perubahan urutan (mis. tandai sudah dibaca dari ChatScreen, event ack) daftar dibiarkan
    // apa adanya — referensi array yang SAMA juga berarti komponen yang subscribe ke urutan
    // tidak ikut render ulang.
    if (sudahAda && !urutanBerubah(prev, next)) return { conversationsById };
    const order = sudahAda ? state.conversationOrder : [...state.conversationOrder, conv.id];
    return { conversationsById, conversationOrder: sortOrder(conversationsById, order) };
  }),

  // Insert/update banyak percakapan sekaligus (dari hasil fetch halaman
  // useConversations/useInfiniteQuery) — MERGE ke cache global, bukan ganti.
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
      unreadCount: unreadDelta > 0 ? (existing.unreadCount || 0) + unreadDelta : existing.unreadCount,
    };
    const conversationsById = { ...state.conversationsById, [id]: updated };
    // Percakapan yang sudah paling atas (dan tidak ada yang dipin di atasnya) tidak perlu sort ulang.
    if (state.conversationOrder[0] === id && !existing.pinned) return { conversationsById };
    return { conversationsById, conversationOrder: sortOrder(conversationsById, state.conversationOrder) };
  }),
}));

// ── Selectors granular — komponen subscribe hanya ke bagian yang dipakai ────
export const useActiveId = () => useConversationStore((s) => s.activeConversationId);
export const useConversation = (id) => useConversationStore((s) => (id ? s.conversationsById[id] : undefined));
export const useOrderedIds = () => useConversationStore((s) => s.conversationOrder);
export const useFilter = () => useConversationStore((s) => s.filter);
export const useSalesFilter = () => useConversationStore((s) => s.salesFilter);
export const useConvSearchQuery = () => useConversationStore((s) => s.searchQuery);

// Total unread lintas SEMUA percakapan (cache global) — dipakai badge ikon
// app (lihat hooks/useBadgeSync.js). BUG YANG DIPERBAIKI: `unreadCount ??
// (unread?1:0)` tidak fallback saat unreadCount sudah 0 (angka, bukan
// null/undefined) — percakapan yang di-mark unread manual (unread=true,
// unreadCount belum ikut naik) tidak pernah tersumbang ke badge app,
// bikin badge ikon lebih kecil dari kenyataan. Sama seperti fix di
// ChatListScreen.js#matches & ConversationItem.js.
export const useTotalUnreadCount = () => useConversationStore((s) =>
  Object.values(s.conversationsById).reduce(
    (sum, c) => sum + (c.unreadCount > 0 ? c.unreadCount : (c.unread ? 1 : 0)), 0
  )
);
