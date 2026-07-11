import React, { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import ConversationList from "../features/inbox/components/ConversationList/index.jsx";
import ChatWindow from "../features/inbox/components/ChatWindow/index.jsx";
import CustomerPanel from "../features/inbox/components/CustomerPanel/index.jsx";
import ColumnErrorBoundary from "../features/inbox/components/ColumnErrorBoundary.jsx";
import { useSocketEvents } from "../features/inbox/hooks/useSocketEvents.js";
import { useSocketStatus } from "../features/inbox/hooks/useSocketStatus.js";
import { useIsMobile } from "../features/inbox/hooks/useIsMobile.js";
import { useActiveId, useConversation, useConversationStore, useTotalUnreadCount } from "../features/inbox/stores/conversationStore.js";

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
  const socketConnected = useSocketStatus();
  const totalUnread = useTotalUnreadCount();
  const isMobile = useIsMobile();

  function setPanelCollapsed(value) {
    setPanelCollapsedState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      localStorage.setItem(PANEL_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  // Fase F: backend sekarang punya server Socket.IO sungguhan (message:new,
  // message:ack, conversation:update) — hook ini join/leave room otomatis
  // mengikuti activeId (lihat useSocketEvents.js).
  useSocketEvents();

  // Realtime SSE tetap dipertahankan berjalan paralel sebagai fallback kalau
  // koneksi Socket.IO putus (keduanya idempotent — appendMessage/upsertConversation
  // aman dipanggil dobel).
  useSSE("new_message", () => {
    api.getConversations().then(({ data }) => {
      useConversationStore.getState().upsertConversations(data);
    }).catch(() => {});
  });

  // Fetch awal + buka otomatis dari ?conv=ID (deep link dari toast notifikasi)
  useEffect(() => {
    api.getConversations().then(({ data }) => {
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

  // Judul tab browser mencerminkan total unread — supaya kelihatan dari
  // tab lain tanpa perlu buka CRM. Dikembalikan ke judul default saat
  // Inbox di-unmount (pindah halaman).
  useEffect(() => {
    const base = "Inbox — Klinik Matras";
    document.title = totalUnread > 0 ? `(${totalUnread > 99 ? "99+" : totalUnread}) ${base}` : base;
    return () => { document.title = base; };
  }, [totalUnread]);

  // BUG FIX — sebelumnya ConversationList & ChatWindow SELALU mount
  // berdua, disembunyikan lewat class CSS ".mobile-chat-active" saja.
  // ChatWindow (termasuk empty-state "Pilih percakapan") tetap ada di DOM
  // dan ikut makan ruang grid row (grid-auto-rows default "auto", bukan
  // stretch ke tinggi penuh) — hasilnya area kosong besar di bawah List,
  // bukan cuma "disembunyikan". Di mobile sekarang betul-betul MOUNT
  // SATU kolom saja lewat conditional return, bukan CSS display:none.
  // CustomerPanel di mobile TIDAK PERNAH mount di sini sama sekali — cuma
  // muncul sebagai bottom-sheet terpisah (lihat ChatWindow/index.jsx,
  // dipicu tombol info, state showCustomerDetail).
  if (isMobile) {
    return (
      <div className="inbox-body mobile-single-column">
        {!socketConnected && (
          <div className="offline-banner">
            <span className="offline-banner-dot" /> Menyambung ulang...
          </div>
        )}
        {mobileView === "chat" ? (
          <ColumnErrorBoundary label="Chat">
            <ChatWindow
              conversation={active}
              user={user}
              onBack={() => setMobileView("list")}
              panelCollapsed={panelCollapsed}
              onTogglePanel={() => setPanelCollapsed((v) => !v)}
            />
          </ColumnErrorBoundary>
        ) : (
          <ColumnErrorBoundary label="Daftar Percakapan">
            <ConversationList userId={user?.id} />
          </ColumnErrorBoundary>
        )}
      </div>
    );
  }

  return (
    <div className={`inbox-body${panelCollapsed ? " panel-collapsed" : ""}`}>
      {!socketConnected && (
        <div className="offline-banner">
          <span className="offline-banner-dot" /> Menyambung ulang...
        </div>
      )}
      <ColumnErrorBoundary label="Daftar Percakapan">
        <ConversationList userId={user?.id} />
      </ColumnErrorBoundary>
      <ColumnErrorBoundary label="Chat">
        <ChatWindow
          conversation={active}
          user={user}
          onBack={() => setMobileView("list")}
          panelCollapsed={panelCollapsed}
          onTogglePanel={() => setPanelCollapsed((v) => !v)}
        />
      </ColumnErrorBoundary>
      {!panelCollapsed && (
        <ColumnErrorBoundary label="Panel Pelanggan">
          <CustomerPanel conversation={active} onClose={() => setPanelCollapsed(true)} />
        </ColumnErrorBoundary>
      )}
    </div>
  );
}
