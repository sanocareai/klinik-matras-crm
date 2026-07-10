// Infinite scroll daftar percakapan (cursor pagination) — pola SAMA dengan
// frontend/src/features/inbox/hooks/useConversations.js versi web. Backend
// GET /conversations?cursor=&limit= sekarang balikin { data, nextCursor }
// (lihat backend/src/routes/conversations.js), BUKAN array mentah lagi.
import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useConversationStore } from "../store/conversationStore";

// Filter store ('ALL'|'OPEN'|'PENDING'|'CLOSED'|'MINE') → status yang
// dikenal backend (enum ConversationStatus: OPEN/PENDING/RESOLVED).
// 'MINE' tidak difilter lewat status, tapi lewat assignedToId.
function filterToStatus(filter) {
  if (filter === "OPEN") return "OPEN";
  if (filter === "PENDING") return "PENDING";
  if (filter === "CLOSED") return "RESOLVED";
  return undefined; // 'ALL' | 'MINE'
}

export function useConversations({ filter = "ALL", search = "", userId } = {}) {
  const status = filterToStatus(filter);
  const assignedToId = filter === "MINE" ? userId : undefined;

  const query = useInfiniteQuery({
    queryKey: ["conversations", { status, search, assignedToId }],
    queryFn: ({ pageParam }) =>
      api.getConversations({ status, search, assignedToId, cursor: pageParam || undefined }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
  });

  // Setiap kali data baru datang, tuang ke conversationStore supaya
  // ConversationItem yang subscribe granular (by id) otomatis ikut update.
  useEffect(() => {
    if (!query.data) return;
    const all = query.data.pages.flatMap((page) => page?.data ?? []);
    useConversationStore.getState().upsertConversations(all);
  }, [query.data]);

  return query;
}
