import React, { memo, useRef, useState } from "react";
import { Pin, Users, Eye, CheckCheck, Check, AlertTriangle } from "lucide-react";
import Avatar from "../../../../components/Avatar.jsx";
import { formatPhoneDisplay, STAGE_LABELS } from "../../../../utils/format.js";
import { smartTimestamp } from "../../utils/formatTime.js";
import { useConversation, useActiveId, useConversationStore, useConvSearchQuery } from "../../stores/conversationStore.js";
import { api } from "../../../../api.js";
import TransferPickerPopover from "./TransferPickerPopover.jsx";
import PeekPreview from "./PeekPreview.jsx";
import { isAdminUser } from "@/lib/roles.js";

// Peek Preview (port dari mobile) — hover sebentar di baris ini, popup
// muncul dekat kursor. Delay mencegah popup muncul tiap kursor lewat
// sekilas saat scroll (bukan hover sungguhan).
const PEEK_HOVER_DELAY_MS = 450;

const STATUS_LABEL = { OPEN: "Buka", PENDING: "Pending", RESOLVED: "Selesai" };
const STATUS_CLASS = { OPEN: "badge-open", PENDING: "badge-pending", RESOLVED: "badge-resolved" };

// Baca role langsung dari localStorage (pola sama dgn api.js#authHeaders) —
// item ini ada RATUSAN di list, tidak masuk akal prop-drill `user` dari
// App.jsx → Inbox.jsx → ConversationList.jsx cuma utk 1 flag admin-only.
function isCurrentUserAdmin() {
  try {
    return isAdminUser(JSON.parse(localStorage.getItem("user") || "null"));
  } catch {
    return false;
  }
}

function ConversationItemBase({ id, selectionMode, selected, onToggleSelect, onEnterSelection }) {
  // Subscribe GRANULAR — hanya re-render item ini kalau conversation dengan
  // id ini berubah, bukan seluruh list (itu poin utama pola "pass id saja").
  const c = useConversation(id);
  const activeId = useActiveId();
  const searchQuery = useConvSearchQuery();
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const [transferPicker, setTransferPicker] = useState(null); // { x, y }
  const [peek, setPeek] = useState(null); // { x, y }
  const longPressTimerRef = useRef(null);
  const longPressAt = useRef(0);
  const peekTimerRef = useRef(null);
  const peekCloseTimerRef = useRef(null);
  const isAdmin = isCurrentUserAdmin();

  if (!c) return null;

  const isActive   = activeId === id;
  const isGroup    = c.type === "GROUP";
  const rawPhone   = c.customer?.phone;
  const name       = isGroup
    ? (c.groupName || "Grup WhatsApp")
    : (c.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || c.customer?.instagramHandle || "Pelanggan");
  const lastMsg    = c.messages?.[0];
  const isUnread   = !!c.unread;
  const isRead     = !!c.isRead;
  const isReplied  = !c.isUnanswered;
  const isPinned   = !!c.pinned;
  // BUG YANG DIPERBAIKI: `unreadCount ?? (isUnread ? 1 : 0)` tidak fallback
  // saat unreadCount sudah 0 (angka, bukan null/undefined) — percakapan
  // yang di-mark unread manual (unread=true, unreadCount belum ikut naik
  // dari 0) jadi tidak tampil badge angkanya sama sekali walau isUnread
  // true (bug sama ditemukan di mobile/ChatListScreen.js, konfirmasi
  // produksi: badge tab "Belum Dibaca" 34 tapi baris yang lolos filter cuma 4).
  const unreadCount = c.unreadCount > 0 ? c.unreadCount : (isUnread ? 1 : 0);
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  // Badge CS-1/CS-2 — field sessionId belum ada di schema Conversation saat
  // ini (lihat CLAUDE.md §"Multi-session WAHA"), jadi badge ini otomatis
  // tidak muncul sampai backend menambahkannya. Kode sudah siap pakai.
  const sessionLabel = c.sessionId === "CS-1" || c.sessionId === "CS-2" ? c.sessionId : null;
  // Wave 1 (redesign Inbox) — SLA risk, dari data yang SUDAH ADA di payload
  // GET /conversations (isUnanswered/unansweredMinutes), bukan hitungan
  // baru. Ambang 60 menit SAMA PERSIS dengan yang dipakai backend untuk
  // canTakeOver (backend/src/routes/conversations.js) — jangan diubah
  // sepihak di sini, nanti dua tempat beda angka. 45 menit = "mendekati",
  // kasih peringatan dini sebelum benar-benar lewat ambang.
  const unansweredMinutes = c.unansweredMinutes;
  const slaWarn = c.isUnanswered && typeof unansweredMinutes === "number" && unansweredMinutes >= 45 && unansweredMinutes < 60;
  const slaBreach = c.isUnanswered && typeof unansweredMinutes === "number" && unansweredMinutes >= 60;
  const pipelineLabel = c.customer?.pipelineStage ? (STAGE_LABELS[c.customer.pipelineStage] || c.customer.pipelineStage) : null;

  function selectConversation() {
    useConversationStore.getState().setActive(id);
    if (c.unread || c.unreadCount > 0) {
      useConversationStore.getState().upsertConversation({ id, unread: false, unreadCount: 0 });
      // Endpoint khusus (Fase F) — reset unreadCount di server juga, bukan cuma unread lama
      api.markConversationRead(id).catch(() => {});
    }
  }

  function togglePin(nextPinned) {
    const prevPinned = c.pinned;
    const prevPinnedAt = c.pinnedAt;
    useConversationStore.getState().upsertConversation({
      id, pinned: nextPinned, pinnedAt: nextPinned ? new Date().toISOString() : null,
    });
    api.updateConversation(id, { pinned: nextPinned }).catch(() => {
      useConversationStore.getState().upsertConversation({ id, pinned: prevPinned, pinnedAt: prevPinnedAt });
    });
  }

  function openContextMenu(x, y) {
    longPressAt.current = Date.now();
    const safeX = Math.min(x, window.innerWidth - 180);
    const safeY = Math.min(y, window.innerHeight - 70);
    setContextMenu({ x: safeX, y: safeY });
  }

  function handleContextMenu(e) {
    if (selectionMode) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  }

  function handleTouchStart(e) {
    if (selectionMode) return;
    const touch = e.touches[0];
    longPressTimerRef.current = setTimeout(() => openContextMenu(touch.clientX, touch.clientY), 600);
  }
  function handleTouchEnd() { clearTimeout(longPressTimerRef.current); }
  function handleTouchMove() { clearTimeout(longPressTimerRef.current); }

  function handleClick() {
    if (Date.now() - longPressAt.current < 800) return;
    if (peek) return; // popup sedang terbuka — klik row seharusnya tidak ikut buka chat
    if (selectionMode) { onToggleSelect?.(id); return; }
    selectConversation();
  }

  function handleAvatarClick(e) {
    e.stopPropagation();
    if (selectionMode) onToggleSelect?.(id); else onEnterSelection?.(id);
  }

  function handleMouseEnter(e) {
    if (selectionMode) return;
    const x = e.clientX, y = e.clientY;
    clearTimeout(peekTimerRef.current);
    clearTimeout(peekCloseTimerRef.current);
    peekTimerRef.current = setTimeout(() => setPeek({ x, y }), PEEK_HOVER_DELAY_MS);
  }
  // BUG NYATA (dilaporkan owner, 5 September 2026): dulu di sini CUMA
  // `clearTimeout(peekTimerRef.current)` — itu cuma membatalkan timer YANG
  // BELUM SEMPAT jalan (peek yang belum terbuka). Begitu peek SUDAH terbuka
  // (mouse diam >450ms di baris ini), pindah kursor pergi TIDAK menutupnya
  // sama sekali — popup (dan `.conv-context-backdrop` fixed inset:0 z-index
  // 998 miliknya, lihat PeekPreview.jsx) tetap ada TAK TERLIHAT di layar,
  // menelan SETIAP klik berikutnya di baris manapun (klik jatuh ke backdrop
  // yang cuma menutup popup lamanya, bukan ke tombol baris di baliknya).
  // Gejala persis: "gabisa diklik, pas diklik cuma warna row berubah abu"
  // (:hover row memang abu, .conversation-item.unread { background:
  // var(--bg-subtle) } juga abu — user MENGIRA itu efek klik, padahal klik
  // sungguhan tidak pernah sampai ke tombolnya). Ditutup lewat jeda pendek
  // (bukan langsung setPeek(null)) supaya kursor sempat pindah dari baris
  // ke popup-nya sendiri (klik "Buka Chat"/"Ambil Percakapan") tanpa keburu
  // hilang — dibatalkan lagi kalau popup itu sendiri yang di-hover
  // (onMouseEnter di PeekPreview, lihat props di bawah).
  function handleMouseLeave() {
    clearTimeout(peekTimerRef.current);
    clearTimeout(peekCloseTimerRef.current);
    peekCloseTimerRef.current = setTimeout(() => setPeek(null), 250);
  }

  return (
    <button
      className={`conversation-item${isActive ? " active" : ""}${isUnread ? " unread" : ""}${isRead && !isUnread ? " conv-item-read" : ""}${selected ? " conv-item-selected" : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
    >
      {/* Klik avatar = masuk/keluar mode pilih massal — pola sama dengan
          mobile (ConversationItem.js). role="button" murni untuk semantik,
          e.stopPropagation di handleAvatarClick sudah cegah bentrok dengan
          onClick baris. */}
      <div className="conv-avatar-wrap" onClick={handleAvatarClick} role="button" tabIndex={-1}>
        {isGroup ? (
          <div className="conv-group-avatar"><Users size={18} /></div>
        ) : (
          <Avatar name={name} src={c.customer?.profilePictureUrl} size="md" />
        )}
        {selectionMode && (
          <span className={`conv-select-checkbox${selected ? " selected" : ""}`}>
            {selected && <Check size={11} color="#fff" strokeWidth={3} />}
          </span>
        )}
      </div>
      <div className="conversation-item-body">
        <div className="conversation-top">
          <span className="customer-name">
            {isPinned && <Pin size={11} className="conv-pin-icon" title="Disematkan" />}
            {isGroup && <Users size={12} className="conv-name-group-icon" title="Percakapan grup" />}
            {name}
          </span>
          <span className="conv-time">{smartTimestamp(c.lastMessageAt)}</span>
        </div>

        <div className="conversation-bottom">
          {/* BUG YANG DIPERBAIKI (26 Agustus 2026): baris ini SELALU tampilkan
              pesan TERAKHIR, walau kecocokan pencarian ada di pesan yang jauh
              lebih lama — hasil pencarian jadi kelihatan "asal muncul" karena
              baris preview-nya sama sekali tidak menyebut kata yang dicari.
              Kalau lagi ada pencarian aktif DAN server menemukan pesan yang
              cocok (c.searchMatch, lihat routes/conversations.js), tampilkan
              potongan di SEKITAR kata itu — bukan pesan terakhir. */}
          <p className="last-message">
            {searchQuery.trim() && c.searchMatch
              ? c.searchMatch.snippet
              : lastMsg?.content || (lastMsg?.mediaType ? `[${lastMsg.mediaType}]` : "Belum ada pesan")}
          </p>
          {unreadCount > 0 && <span className="unread-count-badge">{unreadLabel}</span>}
        </div>

        <div className="conv-badges">
          {/* "Buka" (status default/paling umum) DISEMBUNYIKAN untuk non-admin
              (Wave 1, redesign Inbox — permintaan "jangan tampilkan chip Buka
              yang tidak perlu": OPEN adalah status default hampir semua
              baris, jadi menampilkannya di semua percakapan cuma bising,
              tidak menyampaikan informasi baru). Pending/Selesai TETAP selalu
              tampil (itu penyimpangan dari default, informatif). Admin TETAP
              melihat chip OPEN juga — badge ini satu-satunya cara admin
              transfer lead dari list (klik → TransferPickerPopover), jadi
              TIDAK BOLEH hilang untuk role itu. */}
          {(c.status !== "OPEN" || isAdmin) && (
            <span
              className={`badge ${STATUS_CLASS[c.status] || "badge-open"}${isAdmin ? " badge-clickable" : ""}`}
              title={isAdmin ? "Klik untuk transfer lead ke sales lain" : undefined}
              onClick={isAdmin ? (e) => { e.stopPropagation(); setTransferPicker({ x: e.clientX, y: e.clientY }); } : undefined}
            >
              {STATUS_LABEL[c.status] || c.status}
            </span>
          )}
          {sessionLabel && <span className="session-badge">{sessionLabel}</span>}
          {/* DUA badge berbeda arti — sebelumnya CUMA firstResponder yang
              tampil, TANPA label, sehingga terbaca sebagai "pemegang lead".
              BUG NYATA (23 Agustus 2026): baris HENDRO menampilkan "Novi"
              (yang pertama membalas) padahal header chat menampilkan "Kiki"
              (yang sekarang memegang) — dua-duanya benar, tapi tidak ada
              cara membedakannya. Sekarang pemegang SEKARANG jadi badge utama
              (itu yang dicari sales saat menyortir inbox), dan "pertama
              balas" cuma tampil kalau memang ORANG YANG BERBEDA, dengan
              awalan "1st:" supaya tidak pernah tertukar lagi. */}
          {c.assignedTo && (
            <span className="lead-badge other" title={`Sedang dipegang ${c.assignedTo.name}`}>
              {c.assignedTo.name}
            </span>
          )}
          {c.firstResponder && c.firstResponder.id !== c.assignedTo?.id && (
            <span className="first-responder-badge" title={`Pertama kali membalas: ${c.firstResponder.name}`}>
              1st: {c.firstResponder.name}
            </span>
          )}
          {isRead && !isReplied && (
            <span title="Sudah dibuka tapi belum dibalas" className="conv-flag-badge conv-flag-opened">
              <Eye size={10} /> Dibuka
            </span>
          )}
          {isReplied && (
            <span title="Sudah dibalas" className="conv-flag-badge conv-flag-replied">
              <CheckCheck size={10} /> Dibalas
            </span>
          )}
          {/* Pipeline (Wave 1) — teks polos, bukan pil berwarna baru (lihat
              .conv-pipeline-label di index.css). */}
          {pipelineLabel && <span className="conv-pipeline-label">{pipelineLabel}</span>}
          {/* SLA risk (Wave 1) — dari data yang sudah ada (isUnanswered/
              unansweredMinutes), 2 tingkat: oranye "mendekati" (45-59 menit),
              merah "lewat ambang" (>=60 menit, match canTakeOver backend).
              Ditaruh PALING TERAKHIR di baris badge supaya jadi hal yang
              paling menarik mata kalau memang ada — tapi tidak pernah tampil
              berbarengan dengan "Dibalas" (isReplied sudah pasti false kalau
              isUnanswered true, dua-duanya saling meniadakan). */}
          {slaBreach && (
            <span title={`Belum dibalas ${unansweredMinutes} menit — sudah bisa diambil alih`} className="conv-flag-badge conv-flag-overdue">
              <AlertTriangle size={10} /> {unansweredMinutes}m
            </span>
          )}
          {slaWarn && (
            <span title={`Belum dibalas ${unansweredMinutes} menit`} className="conv-flag-badge conv-flag-sla-warn">
              <AlertTriangle size={10} /> {unansweredMinutes}m
            </span>
          )}
        </div>
      </div>

      {contextMenu && (
        <>
          <div className="conv-context-backdrop"
            onClick={(e) => { e.stopPropagation(); setContextMenu(null); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu(null); }}
          />
          <div className="conv-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={(e) => { e.stopPropagation(); togglePin(!isPinned); setContextMenu(null); }}>
              <Pin size={14} style={{ color: "#7c3aed" }} />
              {isPinned ? "Lepas Sematan" : "Sematkan di Atas"}
            </button>
          </div>
        </>
      )}

      {peek && (
        <PeekPreview
          conversation={c}
          x={peek.x}
          y={peek.y}
          onClose={() => setPeek(null)}
          onOpenChat={() => { setPeek(null); selectConversation(); }}
          onMouseEnter={() => clearTimeout(peekCloseTimerRef.current)}
          onMouseLeave={() => setPeek(null)}
        />
      )}

      {transferPicker && (
        <TransferPickerPopover
          x={transferPicker.x}
          y={transferPicker.y}
          conversationId={id}
          currentAssignedId={c.assignedToId}
          onClose={() => setTransferPicker(null)}
          onTransferred={(updated) => useConversationStore.getState().upsertConversation(updated)}
        />
      )}
    </button>
  );
}

export default memo(ConversationItemBase);
