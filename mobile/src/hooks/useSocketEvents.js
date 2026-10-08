// Menyambungkan event Socket.IO ke Zustand store — pola SAMA dengan
// frontend/src/features/inbox/hooks/useSocketEvents.js versi web. Dipasang
// SEKALI di App.js (bukan per layar) supaya tetap aktif walau user pindah
// dari Inbox ke Chat ke Customer.
import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket";
import { useMessageStore } from "../store/messageStore";
import { useConversationStore } from "../store/conversationStore";
import { useSocketStatusStore } from "../store/socketStatusStore";
import { AppState } from "react-native";
import { queryClient } from "../lib/queryClient";
import { buatPemulih, pesanTerakhirBasi } from "../lib/pemulihanDaftar";

export function useSocketEvents() {
  // Satu pemulih untuk seluruh hook: AppState aktif, socket tersambung ulang, dan update percakapan dengan pesan terakhir yang belum kita punya.
  const pemulihRef = useRef(null);
  if (!pemulihRef.current) pemulihRef.current = buatPemulih({ muatUlang: () => queryClient.invalidateQueries({ queryKey: ["conversations"] }) });
  useEffect(() => {
    const pemulih = pemulihRef.current;
    const socket = getSocket();
    let pernahPutus = false;
    const onDisconnect = () => { pernahPutus = true; };
    const onConnect = () => { if (pernahPutus) { pernahPutus = false; pemulih.minta(); } };
    socket.on("disconnect", onDisconnect);
    socket.on("connect", onConnect);
    const sub = AppState.addEventListener("change", (s) => { if (s === "active") pemulih.minta(); });
    return () => { socket.off("disconnect", onDisconnect); socket.off("connect", onConnect); sub.remove(); pemulih.batal(); };
  }, []);

  // Status koneksi → banner "Menyambung ulang..." (SocketStatusBanner.js).
  // Socket.IO client sudah reconnect otomatis (reconnection:true di
  // lib/socket.js) — di sini cuma mencerminkan status itu ke UI.
  useEffect(() => {
    const socket = getSocket();
    function handleConnect() { useSocketStatusStore.getState().setConnected(true); }
    function handleDisconnect() { useSocketStatusStore.getState().setConnected(false); }
    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    // Sinkronkan status awal (socket bisa saja sudah connect sebelum listener ini terpasang)
    useSocketStatusStore.getState().setConnected(socket.connected);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

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
        message.direction,
        message,
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
      // Payload slim tidak membawa pesan terakhir (isi/arah/centang). Balasan yang diketik dari WhatsApp di HP atau oleh sales lain tidak
      // ikut message:new (hanya ke room chat yang dibuka) → muat ulang daftar supaya preview tidak basi.
      if (pesanTerakhirBasi(useConversationStore.getState().conversationsById[payload.id])) pemulihRef.current.minta();
    }

    // Pesan yang SUDAH ada berubah kontennya (diedit/dihapus lewat WAHA
    // message.edited/message.revoked) — payload penuh, lihat
    // backend/src/socket.js#emitMessageUpdate.
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
