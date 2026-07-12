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

    // Pesan yang SUDAH ada berubah kontennya (diedit/dihapus lewat WAHA
    // message.edited/message.revoked) — payload penuh, lihat
    // backend/src/socket.js#emitMessageUpdate. updateMessage sudah ada di
    // store (dipakai MediaPlaceholderCard "Muat Media"), tinggal disambungkan.
    function handleMessageUpdate(message) {
      if (!message?.id) return;
      useMessageStore.getState().updateMessage(message.id, message);
    }

    // "Hapus untuk Saya" dari sesi CRM LAIN (sales/admin lain yang buka
    // percakapan sama) — hard remove dari store lokal juga, lihat
    // messageStore.js#removeMessage & backend/src/socket.js#emitMessageDeleted.
    function handleMessageDeleted(payload) {
      if (!payload?.messageId) return;
      useMessageStore.getState().removeMessage(payload.messageId);
    }

    socket.on("message:new", handleNewMessage);
    socket.on("message:ack", handleAck);
    socket.on("conversation:update", handleConversationUpdate);
    socket.on("message:update", handleMessageUpdate);
    socket.on("message:deleted", handleMessageDeleted);

    return () => {
      socket.off("message:new", handleNewMessage);
      socket.off("message:ack", handleAck);
      socket.off("conversation:update", handleConversationUpdate);
      socket.off("message:update", handleMessageUpdate);
      socket.off("message:deleted", handleMessageDeleted);
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
