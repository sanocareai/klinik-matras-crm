import { useEffect } from "react";
import { getSocket } from "../../../lib/socket.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useConversationStore } from "../stores/conversationStore.js";

// Dipasang SEKALI di level Inbox page (Fase B, aktif sungguhan sejak Fase F
// — backend sekarang punya server Socket.IO beneran, lihat backend/src/socket.js).
// Menyambungkan event Socket.IO ke Zustand store — tidak ada komponen lain
// yang perlu tahu soal socket sama sekali, mereka cukup subscribe ke store
// seperti biasa.
export function useSocketEvents() {
  useEffect(() => {
    const socket = getSocket();

    function handleNewMessage(message) {
      // payload = objek Message PENUH langsung (bukan wrapper), sudah bawa
      // conversationId sebagai field native-nya sendiri — lihat
      // backend/src/socket.js#emitNewMessage.
      if (!message?.conversationId) return;
      useMessageStore.getState().appendMessage(message.conversationId, message);
      useConversationStore.getState().bumpConversation(
        message.conversationId,
        message.content || (message.mediaType ? `[${message.mediaType}]` : undefined),
        message.createdAt,
        message.direction === "INBOUND" ? 1 : 0,
      );
    }

    function handleAck(payload) {
      // payload: { externalId, ack } — lihat backend/src/socket.js#emitMessageAck
      const { externalId, ack } = payload || {};
      if (!externalId) return;
      useMessageStore.getState().updateAck(externalId, ack);
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

  // Join/leave room per percakapan aktif — server scope event message:new/
  // message:ack ke room `conv:{id}` (lihat backend/src/socket.js), jadi
  // client harus join room itu setiap kali activeConversationId berubah.
  useEffect(() => {
    const socket = getSocket();
    let currentRoom = useConversationStore.getState().activeConversationId;
    if (currentRoom) socket.emit("join", currentRoom);

    const unsubscribe = useConversationStore.subscribe((state) => {
      const newId = state.activeConversationId;
      if (newId === currentRoom) return;
      if (currentRoom) socket.emit("leave", currentRoom);
      if (newId) socket.emit("join", newId);
      currentRoom = newId;
    });

    return () => {
      unsubscribe();
      if (currentRoom) socket.emit("leave", currentRoom);
    };
  }, []);
}
