import React, { useEffect, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import ConversationList from "../features/inbox/components/ConversationList/index.jsx";
import ChatWindow from "../features/inbox/components/ChatWindow/index.jsx";
import CustomerPanel from "../features/inbox/components/CustomerPanel/index.jsx";
import ColumnErrorBoundary from "../features/inbox/components/ColumnErrorBoundary.jsx";
import { useSocketEvents } from "../features/inbox/hooks/useSocketEvents.js";
import { useSocketStatus } from "../features/inbox/hooks/useSocketStatus.js";
import { useIsMobile } from "../features/inbox/hooks/useIsMobile.js";
import { useActiveId, useActiveSelectionSeq, useConversation, useConversationStore, useTotalUnreadCount } from "../features/inbox/stores/conversationStore.js";

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
  const [panelCollapsed, setPanelCollapsedState] = useState(
    () => localStorage.getItem(PANEL_COLLAPSED_KEY) === "true",
  );
  const [searchParams, setSearchParams] = useSearchParams();
  const location = useLocation();
  const navigate = useNavigate();

  const activeId = useActiveId();
  const activeSelectionSeq = useActiveSelectionSeq();
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

  // BUG FIX (swipe-back di PWA/Android salah navigasi ke Dashboard) —
  // mobileView dulu local state polos, sama sekali tidak terhubung ke
  // browser history. Buka chat TIDAK pernah push history entry baru, jadi
  // gesture "swipe back" (native history.back() dari browser/PWA, beda dari
  // tombol back manual yang cuma panggil callback) malah pop keluar dari
  // /inbox sepenuhnya (balik ke Dashboard) alih-alih balik ke daftar
  // percakapan. Tombol back di header ChatWindow "kelihatan benar" karena
  // dulu cuma set state langsung tanpa sentuh history — makanya bug ini
  // gampang lolos manual testing lewat tombol, cuma kelihatan lewat gesture
  // asli/tombol back OS.
  // Fix: derive mobileView dari location.state, bukan local state lagi.
  // Buka chat = push 1 history entry baru bertanda chatOpen:true. Baik
  // swipe-back (popstate asli, ditangkap otomatis oleh react-router lewat
  // useLocation) MAUPUN tombol back (navigate(-1)) sama-sama cuma pop 1
  // level (balik ke daftar) — history /inbox itu sendiri tetap utuh,
  // Dashboard baru ke-pop kalau user tekan back SEKALI LAGI dari daftar.
  const mobileView = location.state?.chatOpen ? "chat" : "list";

  // Percakapan dipilih (dari ConversationItem, self-contained via store,
  // atau dari deep link ?conv=ID) → di mobile pindah ke tampilan chat.
  // Depend ke activeSelectionSeq (bukan activeId) — tap ulang percakapan
  // yang SAMA setelah balik ke daftar tetap harus buka lagi tampilan chat,
  // padahal activeId-nya tidak berubah nilai (lihat conversationStore.js).
  useEffect(() => {
    if (activeId && isMobile && !location.state?.chatOpen) {
      navigate(`${location.pathname}${location.search}`, { state: { chatOpen: true } });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSelectionSeq, isMobile]);

  function backToMobileList() {
    if (location.state?.chatOpen) navigate(-1);
  }

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
              onBack={backToMobileList}
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
          onBack={backToMobileList}
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
