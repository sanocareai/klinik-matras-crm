import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import ConversationList from "../features/inbox/components/ConversationList/index.jsx";
import ChatWindow from "../components/ChatWindow.jsx";
import CustomerPanel from "../components/CustomerPanel.jsx";
import { useSocketEvents } from "../features/inbox/hooks/useSocketEvents.js";
import { useActiveId, useConversation, useConversationStore } from "../features/inbox/stores/conversationStore.js";

// FASE B: daftar percakapan (kolom kiri) sekarang virtualized + di-drive oleh
// conversationStore (Zustand). ChatWindow & CustomerPanel LAMA tetap dipakai
// apa adanya (belum direfactor) — mereka cukup diberi objek `conversation`
// seperti biasa, jadi tidak perlu tahu store itu ada.
export default function Inbox({ user }) {
  const [mobileView, setMobileView]         = useState("list"); // 'list' | 'chat' (mobile)
  const [panelCollapsed, setPanelCollapsed] = useState(false);
  const [searchParams, setSearchParams]     = useSearchParams();

  const activeId = useActiveId();
  const active   = useConversation(activeId);

  // Fase C+ akan mulai emit event ini dari backend Socket.IO — aman dipasang
  // sekarang karena getSocket() lazy (lihat lib/socket.js), dorman sampai
  // server-nya benar-benar ada.
  useSocketEvents();

  // Realtime SEKARANG masih lewat SSE lama (sudah terbukti jalan) — begitu
  // ada pesan baru di percakapan manapun, refresh daftar ke store supaya
  // urutan/preview/badge unread ikut ter-update tanpa reload halaman.
  useSSE("new_message", () => {
    api.getConversations().then((data) => {
      useConversationStore.getState().upsertConversations(data);
    }).catch(() => {});
  });

  // Fetch awal + buka otomatis dari ?conv=ID (deep link dari toast notifikasi)
  useEffect(() => {
    api.getConversations().then((data) => {
      useConversationStore.getState().upsertConversations(data);
      const convId = searchParams.get("conv");
      if (convId && data.some((c) => c.id === convId)) {
        useConversationStore.getState().setActive(convId);
        setSearchParams({}, { replace: true });
      }
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Percakapan dipilih (dari ConversationItem, self-contained via store) →
  // di mobile pindah ke tampilan chat.
  useEffect(() => {
    if (activeId) setMobileView("chat");
  }, [activeId]);

  function handleConversationUpdated(updated) {
    useConversationStore.getState().upsertConversation(updated);
  }

  return (
    <div className={`inbox-body${mobileView === "chat" ? " mobile-chat-active" : ""}${panelCollapsed ? " panel-collapsed" : ""}`}>
      <ConversationList userId={user?.id} />
      <ChatWindow
        conversation={active}
        user={user}
        onConversationUpdated={handleConversationUpdated}
        onBack={() => setMobileView("list")}
        panelCollapsed={panelCollapsed}
        onTogglePanel={() => setPanelCollapsed((v) => !v)}
      />
      {!panelCollapsed && (
        <CustomerPanel customerId={active?.customer?.id} conversation={active} />
      )}
    </div>
  );
}
