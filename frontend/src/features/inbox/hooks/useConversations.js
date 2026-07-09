import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { useConversationStore } from "../stores/conversationStore.js";

// Filter store ('ALL'|'OPEN'|'PENDING'|'CLOSED'|'MINE') → status yang
// dikenal backend (enum ConversationStatus: OPEN/PENDING/RESOLVED — bukan
// "CLOSED", lihat CLAUDE.md §10). 'MINE' tidak difilter lewat status,
// tapi lewat assignedToId (lihat di bawah).
function filterToStatus(filter) {
  if (filter === "OPEN") return "OPEN";
  if (filter === "PENDING") return "PENDING";
  if (filter === "CLOSED") return "RESOLVED";
  return undefined; // 'ALL' | 'MINE'
}

// ⚠️ CATATAN: GET /api/conversations belum punya pagination sungguhan di
// backend — query di-hardcode `take: 100` tanpa cursor/skip (lihat
// backend/src/routes/conversations.js). Hook ini tetap dibangun dengan
// useInfiniteQuery (struktur siap dipakai begitu backend nambah cursor
// param di Fase berikutnya), tapi untuk sekarang cuma ada SATU page —
// hasNextPage selalu false setelah fetch pertama, onEndReached jadi no-op.
export function useConversations({ filter = "ALL", search = "", userId } = {}) {
  const status = filterToStatus(filter);
  const assignedToId = filter === "MINE" ? userId : undefined;

  const query = useInfiniteQuery({
    queryKey: ["conversations", { status, search, assignedToId }],
    queryFn: () => api.getConversations({ status, search, assignedToId }),
    initialPageParam: null,
    getNextPageParam: () => undefined, // backend belum dukung halaman berikutnya
  });

  // Setiap kali data baru datang, tuang ke conversationStore supaya
  // ConversationItem yang subscribe granular otomatis ikut update.
  useEffect(() => {
    if (!query.data) return;
    const all = query.data.pages.flat();
    useConversationStore.getState().upsertConversations(all);
  }, [query.data]);

  return query;
}
