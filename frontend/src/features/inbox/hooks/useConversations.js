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
  return undefined; // 'ALL' | 'MINE' | 'BROADCAST'
}

// Tag universal yang dipasang backend ke SETIAP penerima broadcast — lihat
// backend/src/services/broadcastPolicy.js#TAG_BROADCAST. Sengaja bukan tag
// per-kampanye yang bebas diketik admin: kalau filter Inbox bergantung ke
// nama tag bebas, dia rusak begitu admin ganti nama atau lupa mengisinya.
export const TAG_BROADCAST = "Broadcast";

// Fase F: backend sekarang benar-benar dukung cursor pagination
// (GET /conversations?cursor=&limit= → { data, nextCursor }) — lihat
// backend/src/routes/conversations.js. useInfiniteQuery di bawah ini
// sekarang cursor pagination SUNGGUHAN, bukan cuma struktur kosong lagi.
export function useConversations({ filter = "ALL", search = "", userId } = {}) {
  const status = filterToStatus(filter);
  const assignedToId = filter === "MINE" ? userId : undefined;
  // Chip "Broadcast": tampilkan HANYA pelanggan yang sudah dikirimi pesan
  // kampanye, supaya sales bisa menggarapnya sebagai satu antrean sendiri
  // dan tidak tercampur chat masuk biasa.
  const tag = filter === "BROADCAST" ? TAG_BROADCAST : undefined;

  const query = useInfiniteQuery({
    queryKey: ["conversations", { status, search, assignedToId, tag }],
    queryFn: ({ pageParam }) => api.getConversations({ status, search, assignedToId, tag, cursor: pageParam || undefined }),
    initialPageParam: null,
    getNextPageParam: (lastPage) => lastPage?.nextCursor ?? undefined,
  });

  // Setiap kali data baru datang, tuang ke conversationStore supaya
  // ConversationItem yang subscribe granular otomatis ikut update.
  useEffect(() => {
    if (!query.data) return;
    const all = query.data.pages.flatMap((page) => page?.data ?? []);
    useConversationStore.getState().upsertConversations(all);
  }, [query.data]);

  return query;
}
