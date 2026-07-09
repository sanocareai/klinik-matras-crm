import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import ConversationList from "../features/inbox/components/ConversationList/index.jsx";
import ChatWindow from "../features/inbox/components/ChatWindow/index.jsx";
import CustomerPanel from "../features/inbox/components/CustomerPanel/index.jsx";
import { useSocketEvents } from "../features/inbox/hooks/useSocketEvents.js";
import { useActiveId, useConversation, useConversationStore } from "../features/inbox/stores/conversationStore.js";

// FASE B: daftar percakapan (kolom kiri) virtualized + di-drive oleh
// conversationStore (Zustand).
// FASE C+D: ChatWindow (kolom tengah) versi baru — virtualized message list,
// optimistic send, composer modern (emoji-mart, media uploader, voice
// recorder) lewat messageStore/composerStore.
// FASE E: CustomerPanel (kolom kanan) versi baru — GroupPanel vs profil
// customer lengkap, collapsible dengan state persist localStorage (kunci
// "inbox-panel-collapsed", mengikuti konvensi "sidebar-collapsed" yang
// sudah dipakai Layout.jsx).
const PANEL_COLLAPSED_KEY = "inbox-panel-collapsed";

export default function Inbox({ user }) {
  const [mobileView, setMobileView] = useState("list"); // 'list' | 'chat' (mobile)
  const [panelCollapsed, setPanelCollapsedState] = useState(
    () => localStorage.getItem(PANEL_COLLAPSED_KEY) === "true",
  );
  const [searchParams, setSearchParams] = useSearchParams();

  const activeId = useActiveId();
  const active   = useConversation(activeId);

  function setPanelCollapsed(value) {
    setPanelCollapsedState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      localStorage.setItem(PANEL_COLLAPSED_KEY, String(next));
      return next;
    });
  }

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

  return (
    <div className={`inbox-body${mobileView === "chat" ? " mobile-chat-active" : ""}${panelCollapsed ? " panel-collapsed" : ""}`}>
      <ConversationList userId={user?.id} />
      <ChatWindow
        conversation={active}
        user={user}
        onBack={() => setMobileView("list")}
        panelCollapsed={panelCollapsed}
        onTogglePanel={() => setPanelCollapsed((v) => !v)}
      />
      {!panelCollapsed && (
        <CustomerPanel conversation={active} onClose={() => setPanelCollapsed(true)} />
      )}
    </div>
  );
}
