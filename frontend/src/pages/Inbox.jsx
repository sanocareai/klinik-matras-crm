import React, { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams, useLocation, useNavigate } from "react-router-dom";
import { api } from "../api.js";
import { useSSE } from "../hooks/useSSE.js";
import ConversationList from "../features/inbox/components/ConversationList/index.jsx";
import ChatWindow from "../features/inbox/components/ChatWindow/index.jsx";
import CustomerPanel from "../features/inbox/components/CustomerPanel/index.jsx";
import ColumnErrorBoundary from "../features/inbox/components/ColumnErrorBoundary.jsx";
import ResizeHandle from "../features/inbox/components/ResizeHandle.jsx";
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
//
// FASE G (30 Agustus 2026) — ketiga kolom sekarang bisa DIGESER lebarnya
// (drag handle di antara kolom) dan kolom KIRI (daftar percakapan) ikut
// jadi collapsible seperti kolom kanan sudah lebih dulu bisa. Semua state
// lebar/collapse persist ke localStorage per-kolom, konsisten dengan pola
// "sidebar-collapsed" & "inbox-panel-collapsed" yang sudah ada.
const PANEL_COLLAPSED_KEY = "inbox-panel-collapsed";
const LIST_COLLAPSED_KEY  = "inbox-list-collapsed";
const LIST_WIDTH_KEY      = "inbox-list-width";
const PANEL_WIDTH_KEY     = "inbox-panel-width";
const LIST_WIDTH_DEFAULT  = 320;
const PANEL_WIDTH_DEFAULT = 340;
const LIST_WIDTH_MIN  = 260; const LIST_WIDTH_MAX  = 480;
const PANEL_WIDTH_MIN = 280; const PANEL_WIDTH_MAX = 460;

function clamp(n, min, max) { return Math.min(max, Math.max(min, n)); }

function readStoredWidth(key, fallback, min, max) {
  const raw = Number(localStorage.getItem(key));
  return Number.isFinite(raw) && raw > 0 ? clamp(raw, min, max) : fallback;
}

export default function Inbox({ user }) {
  const [panelCollapsed, setPanelCollapsedState] = useState(
    () => localStorage.getItem(PANEL_COLLAPSED_KEY) === "true",
  );
  const [listCollapsed, setListCollapsedState] = useState(
    () => localStorage.getItem(LIST_COLLAPSED_KEY) === "true",
  );
  const [listWidth, setListWidthState]   = useState(
    () => readStoredWidth(LIST_WIDTH_KEY, LIST_WIDTH_DEFAULT, LIST_WIDTH_MIN, LIST_WIDTH_MAX),
  );
  const [panelWidth, setPanelWidthState] = useState(
    () => readStoredWidth(PANEL_WIDTH_KEY, PANEL_WIDTH_DEFAULT, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX),
  );
  // Dimatikan HANYA selama drag aktif — supaya geser terasa langsung
  // mengikuti kursor, bukan "mengejar" transisi CSS 0.2s yang dipakai utk
  // toggle collapse via tombol (lihat .inbox-body di index.css).
  const [isResizing, setIsResizing] = useState(false);
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

  function setListCollapsed(value) {
    setListCollapsedState((prev) => {
      const next = typeof value === "function" ? value(prev) : value;
      localStorage.setItem(LIST_COLLAPSED_KEY, String(next));
      return next;
    });
  }

  // deltaX positif = geser ke kanan. Kolom kiri (daftar) melebar begitu
  // handle-nya diseret ke kanan; kolom kanan (panel) melebar begitu
  // handle-nya diseret ke KIRI (deltaX negatif) — makanya tanda deltaX
  // dibalik di resizePanel, tidak di resizeList.
  const resizeList = useCallback((deltaX) => {
    setListWidthState((prev) => {
      const next = clamp(prev + deltaX, LIST_WIDTH_MIN, LIST_WIDTH_MAX);
      localStorage.setItem(LIST_WIDTH_KEY, String(next));
      return next;
    });
  }, []);
  const resizePanel = useCallback((deltaX) => {
    setPanelWidthState((prev) => {
      const next = clamp(prev - deltaX, PANEL_WIDTH_MIN, PANEL_WIDTH_MAX);
      localStorage.setItem(PANEL_WIDTH_KEY, String(next));
      return next;
    });
  }, []);
  const handleResizeStart = useCallback(() => setIsResizing(true), []);
  const handleResizeEnd   = useCallback(() => setIsResizing(false), []);

  // grid-template-columns dihitung di sini (bukan CSS statis) supaya lebar
  // per-kolom bisa diatur bebas oleh user, tetap 1 baris kode yang jelas
  // artinya. Kolom collapsed = 0px, bukan di-unmount dari grid — biar
  // transisi lebarnya mulus (unmount = lompat seketika, tanpa animasi).
  const gridTemplateColumns = useMemo(() => {
    const left  = listCollapsed  ? 0 : listWidth;
    const right = panelCollapsed ? 0 : panelWidth;
    return `${left}px 1fr ${right}px`;
  }, [listCollapsed, listWidth, panelCollapsed, panelWidth]);

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

  // Fetch awal + buka otomatis dari ?conv=ID (deep link dari toast notifikasi,
  // Hot Leads, Needs Action). List awal cuma 100 percakapan teraktif — kalau
  // convId targetnya sudah lama tidak ada aktivitas (stale, di luar jendela
  // itu), fallback fetch langsung by-id supaya klik tetap membuka chat-nya,
  // bukan diam saja karena `data.some(...)` gagal cocok.
  useEffect(() => {
    api.getConversations().then(({ data }) => {
      useConversationStore.getState().upsertConversations(data);
      const convId = searchParams.get("conv");
      if (!convId) return;
      if (data.some((c) => c.id === convId)) {
        useConversationStore.getState().setActive(convId);
        setSearchParams({}, { replace: true });
      } else {
        api.getConversation(convId).then((conv) => {
          useConversationStore.getState().upsertConversation(conv);
          useConversationStore.getState().setActive(convId);
          setSearchParams({}, { replace: true });
        }).catch(() => {});
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
    <div
      className={`inbox-body${panelCollapsed ? " panel-collapsed" : ""}${listCollapsed ? " list-collapsed" : ""}${isResizing ? " is-resizing" : ""}`}
      style={{ gridTemplateColumns }}
    >
      {!socketConnected && (
        <div className="offline-banner">
          <span className="offline-banner-dot" /> Menyambung ulang...
        </div>
      )}
      {!listCollapsed && (
        <ColumnErrorBoundary label="Daftar Percakapan">
          <ConversationList userId={user?.id} onCollapse={() => setListCollapsed(true)} />
        </ColumnErrorBoundary>
      )}
      <ColumnErrorBoundary label="Chat">
        <ChatWindow
          conversation={active}
          user={user}
          onBack={backToMobileList}
          panelCollapsed={panelCollapsed}
          onTogglePanel={() => setPanelCollapsed((v) => !v)}
          listCollapsed={listCollapsed}
          onToggleList={() => setListCollapsed((v) => !v)}
        />
      </ColumnErrorBoundary>
      {!panelCollapsed && (
        <ColumnErrorBoundary label="Panel Pelanggan">
          <CustomerPanel conversation={active} onClose={() => setPanelCollapsed(true)} />
        </ColumnErrorBoundary>
      )}

      {/* Handle geser — diposisikan absolut tepat di garis batas kolom
          (bukan grid track tersendiri, supaya template kolom tetap simpel
          3-nilai). Disembunyikan sekalian dengan kolomnya saat collapsed —
          tidak ada gunanya menyeret lebar kolom yang sedang disembunyikan. */}
      {!listCollapsed && (
        <ResizeHandle
          ariaLabel="Ubah lebar daftar percakapan"
          onResize={resizeList}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
          style={{ left: listWidth - 4 }}
        />
      )}
      {!panelCollapsed && (
        <ResizeHandle
          ariaLabel="Ubah lebar panel pelanggan"
          onResize={resizePanel}
          onResizeStart={handleResizeStart}
          onResizeEnd={handleResizeEnd}
          style={{ right: panelWidth - 4 }}
        />
      )}
    </div>
  );
}
