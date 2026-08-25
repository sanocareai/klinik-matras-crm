// Infinite scroll daftar percakapan (cursor pagination) — pola SAMA dengan
// frontend/src/features/inbox/hooks/useConversations.js versi web. Backend
// GET /conversations?cursor=&limit= sekarang balikin { data, nextCursor }
// (lihat backend/src/routes/conversations.js), BUKAN array mentah lagi.
import { useEffect } from "react";
import { useInfiniteQuery } from "@tanstack/react-query";
import { api } from "../api";
import { useConversationStore } from "../store/conversationStore";

// Filter store ('ALL'|'OPEN'|'PENDING'|'CLOSED'|'MINE'|'UNREAD') → status
// yang dikenal backend (enum ConversationStatus: OPEN/PENDING/RESOLVED).
// 'MINE' tidak difilter lewat status, tapi lewat assignedToId.
// 'UNREAD' tidak difilter lewat status, tapi lewat ?unread=true (lihat
// backend/src/routes/conversations.js). 'UNANSWERED' ("Belum Dibalas",
// D-031) sama polanya — ?unanswered=true.
function filterToStatus(filter) {
  if (filter === "OPEN") return "OPEN";
  if (filter === "PENDING") return "PENDING";
  if (filter === "CLOSED") return "RESOLVED";
  return undefined; // 'ALL' | 'MINE' | 'UNREAD' | 'UNANSWERED' | 'UNASSIGNED' | 'STALLED' | 'BROADCAST'
}

// Tag universal yang dipasang backend ke SETIAP penerima broadcast — SAMA
// PERSIS dengan frontend/src/features/inbox/hooks/useConversations.js
// (TAG_BROADCAST), lihat backend/src/services/broadcastPolicy.js. Tab
// "Belum Diambil"/"Menggantung"/"Broadcast" ditambahkan 25 Agustus 2026
// supaya paritas dengan web — sebelumnya cuma ada di web.
export const TAG_BROADCAST = "Broadcast";

export function useConversations({ filter = "ALL", search = "", userId, salesFilterId } = {}) {
  const status = filterToStatus(filter);
  // salesFilterId ("Filter per Sales", fitur baru) MENANG atas MINE kalau
  // dua-duanya somehow aktif — lihat conversationStore.js#setSalesFilter,
  // yang sudah memaksa filter balik ke ALL begitu salesFilter dipilih, jadi
  // konflik ini seharusnya tidak pernah terjadi lewat UI normal.
  const assignedToId = salesFilterId || (filter === "MINE" ? userId : undefined);
  const tag = filter === "BROADCAST" ? TAG_BROADCAST : undefined;
  const unread = filter === "UNREAD" ? true : undefined;
  const unanswered = filter === "UNANSWERED" ? true : undefined;
  // "Belum Diambil" — percakapan assignedToId masih kosong. "Menggantung" —
  // assigned TAPI belum dibalas >60 menit. Lihat catatan di backend
  // routes/conversations.js GET / (definisi sama persis dengan web).
  const unassigned = filter === "UNASSIGNED" ? true : undefined;
  const stalled = filter === "STALLED" ? true : undefined;

  const query = useInfiniteQuery({
    queryKey: ["conversations", { status, search, assignedToId, tag, unread, unanswered, unassigned, stalled }],
    queryFn: ({ pageParam }) =>
      api.getConversations({ status, search, assignedToId, tag, unread, unanswered, unassigned, stalled, cursor: pageParam || undefined }),
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
