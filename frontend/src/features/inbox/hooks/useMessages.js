import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { getSocket } from "../../../lib/socket.js";
import { useSSE } from "../../../hooks/useSSE.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useConversationStore } from "../stores/conversationStore.js";

// Pagination pesan (cursor): hanya INITIAL_LIMIT pesan TERBARU yang dimuat saat
// percakapan dibuka (percakapan terbesar di produksi 2,29 MB per respons kalau
// dimuat penuh); pesan lebih lama diminta per OLDER_LIMIT lewat loadOlderMessages
// (?before=<id pesan tertua yang sudah dimuat>) saat user scroll ke atas.
export const INITIAL_LIMIT = 100;
export const OLDER_LIMIT = 100;

const loadingOlder = new Set(); // convId yang sedang fetch halaman lama (cegah request ganda)

// Muat satu halaman pesan lebih lama. Return jumlah pesan yang benar-benar ditambahkan.
export async function loadOlderMessages(conversationId) {
  const st = useMessageStore.getState();
  if (!conversationId || loadingOlder.has(conversationId) || !st.hasMoreByConvId[conversationId]) return 0;
  const list = st.messagesByConvId[conversationId] || [];
  // Pesan tertua yang SUDAH punya id server (bukan temp optimistic).
  const oldest = list.find((m) => m.id && !String(m.id).startsWith("temp-"));
  if (!oldest) return 0;
  loadingOlder.add(conversationId);
  try {
    const older = await api.getMessages(conversationId, { limit: OLDER_LIMIT, before: oldest.id });
    const before = (useMessageStore.getState().messagesByConvId[conversationId] || []).length;
    useMessageStore.getState().prependMessages(conversationId, older, older.length >= OLDER_LIMIT);
    return (useMessageStore.getState().messagesByConvId[conversationId] || []).length - before;
  } catch {
    return 0;
  } finally {
    loadingOlder.delete(conversationId);
  }
}

// GET /conversations/:id/messages?limit= juga menandai percakapan "sudah dibuka" di
// backend (isRead=true, unread=false, read receipt WA). Halaman `before` tidak.
export function useMessages(conversationId) {
  const query = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api.getMessages(conversationId, { limit: INITIAL_LIMIT }),
    enabled: !!conversationId,
  });

  // Pesan baru di percakapan aktif sudah diantar Socket.IO (message:new →
  // upsertMessage), jadi TIDAK perlu refetch. Yang dulu ditumpangkan pada
  // refetch adalah efek samping mark-as-read: sekarang dipanggil eksplisit
  // (endpoint ringan, tanpa muat riwayat). Refetch halaman terbaru hanya bila
  // socket sedang putus (jalur fallback SSE) supaya tidak ada pesan terlewat.
  useSSE("new_message", (data) => {
    if (!conversationId || data?.conversationId !== conversationId) return;
    if (getSocket().connected) {
      api.markConversationRead(conversationId).catch(() => {});
      useConversationStore.getState().upsertConversation({ id: conversationId, unread: false, isRead: true, unreadCount: 0 });
    } else {
      query.refetch();
    }
  });

  useEffect(() => {
    if (!conversationId || !query.data) return;
    useMessageStore.getState().mergeLatest(conversationId, query.data, query.data.length >= INITIAL_LIMIT);
    // Cerminkan efek samping backend (isRead=true, unread=false) di store
    // secara optimistik supaya badge unread di ConversationItem hilang
    // seketika, tidak perlu nunggu refetch daftar percakapan.
    useConversationStore.getState().upsertConversation({ id: conversationId, unread: false, isRead: true });
  }, [conversationId, query.data]);

  return query;
}
