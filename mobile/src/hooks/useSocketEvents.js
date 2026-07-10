// Menyambungkan event Socket.IO ke Zustand store — pola SAMA dengan
// frontend/src/features/inbox/hooks/useSocketEvents.js versi web. Dipasang
// SEKALI di App.js (bukan per layar) supaya tetap aktif walau user pindah
// dari Inbox ke Chat ke Customer.
import { useEffect } from "react";
import { getSocket } from "../lib/socket";
import { useMessageStore } from "../store/messageStore";
import { useConversationStore } from "../store/conversationStore";

export function useSocketEvents() {
  useEffect(() => {
    const socket = getSocket();

    function handleNewMessage(message) {
      // payload = objek Message PENUH langsung, bawa conversationId sendiri
      // — lihat backend/src/socket.js#emitNewMessage.
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

  // Join/leave room per percakapan aktif — server scope message:new/
  // message:ack ke room `conv:{id}` (lihat backend/src/socket.js).
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
