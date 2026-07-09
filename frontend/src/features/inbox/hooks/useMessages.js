import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { useSSE } from "../../../hooks/useSSE.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useConversationStore } from "../stores/conversationStore.js";

// ⚠️ CATATAN PENTING (lihat juga useConversations.js untuk pola serupa):
// GET /conversations/:id/messages di backend TIDAK mendukung pagination
// apapun (tanpa limit/cursor/skip — lihat backend/src/routes/conversations.js)
// dan SELALU balikin SELURUH riwayat pesan percakapan itu sekaligus, tidak
// ada hard cap. Jadi hook ini fetch semua sekali per percakapan; "muat
// pesan lebih lama saat scroll ke atas" di MessageList.jsx murni WINDOWING
// di sisi client (reveal makin banyak dari array yang sudah lengkap di
// store), BUKAN pemanggilan API baru — tidak ada "page 2" sungguhan untuk
// diminta ke server.
//
// Endpoint ini JUGA otomatis menandai conversation "sudah dibuka" di
// backend sebagai side effect bawaan (tidak ada endpoint mark-read
// terpisah — lihat CLAUDE.md/hasil investigasi Fase C). Jadi setiap kali
// hook ini fetch (termasuk saat SSE memicu refetch), backend akan
// menandai isRead=true. Ini SAMA PERSIS dengan perilaku ChatWindow lama.
export function useMessages(conversationId) {
  const query = useQuery({
    queryKey: ["messages", conversationId],
    queryFn: () => api.getMessages(conversationId),
    enabled: !!conversationId,
  });

  // Realtime: SSE lama (proven) — payload cuma { conversationId, customerId },
  // tidak bawa isi pesan, jadi kita refetch daftar pesan penuh saat match.
  useSSE("new_message", (data) => {
    if (data?.conversationId === conversationId) query.refetch();
  });

  useEffect(() => {
    if (!conversationId || !query.data) return;
    useMessageStore.getState().setMessages(conversationId, query.data, false);
    // Cerminkan efek samping backend (isRead=true, unread=false) di store
    // secara optimistik supaya badge unread di ConversationItem hilang
    // seketika, tidak perlu nunggu refetch daftar percakapan.
    useConversationStore.getState().upsertConversation({ id: conversationId, unread: false, isRead: true });
  }, [conversationId, query.data]);

  return query;
}
