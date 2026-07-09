import { useEffect } from "react";
import { getSocket } from "../../../lib/socket.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useConversationStore } from "../stores/conversationStore.js";

// Dipasang SEKALI di level Inbox page (Fase B). Menyambungkan event
// Socket.IO ke Zustand store — tidak ada komponen lain yang perlu tahu
// soal socket sama sekali, mereka cukup subscribe ke store seperti biasa.
//
// ⚠️ Belum dipakai di Fase A (backend belum punya server Socket.IO —
// lihat catatan di lib/socket.js). Hook ini aman dipasang kapan pun karena
// getSocket() baru benar-benar connect saat dipanggil.
export function useSocketEvents() {
  useEffect(() => {
    const socket = getSocket();

    function handleNewMessage(payload) {
      // payload diharapkan: { conversationId, message }
      const { conversationId, message } = payload || {};
      if (!conversationId || !message) return;
      useMessageStore.getState().appendMessage(conversationId, message);
      useConversationStore.getState().bumpConversation(
        conversationId,
        message.content || (message.mediaType ? `[${message.mediaType}]` : undefined),
        message.createdAt,
        message.direction === "INBOUND" ? 1 : 0,
      );
    }

    function handleAck(payload) {
      // payload diharapkan: { externalId, ackLevel }
      const { externalId, ackLevel } = payload || {};
      if (!externalId) return;
      useMessageStore.getState().updateAck(externalId, ackLevel);
    }

    function handleConversationUpdate(payload) {
      // payload diharapkan: object Conversation (partial atau penuh)
      if (!payload?.id) return;
      useConversationStore.getState().upsertConversation(payload);
    }

    socket.on("message:new", handleNewMessage);
    socket.on("message:ack", handleAck);
    socket.on("conversation:update", handleConversationUpdate);

    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("message:ack", handleAck);
      socket.off("conversation:update", handleConversationUpdate);
    };
  }, []);
}
