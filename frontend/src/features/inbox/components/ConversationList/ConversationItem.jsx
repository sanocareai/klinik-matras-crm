import React, { memo, useRef, useState } from "react";
import { Pin, Users, Eye, CheckCheck } from "lucide-react";
import Avatar from "../../../../components/Avatar.jsx";
import { formatPhoneDisplay } from "../../../../utils/format.js";
import { smartTimestamp } from "../../utils/formatTime.js";
import { useConversation, useActiveId, useConversationStore } from "../../stores/conversationStore.js";
import { api } from "../../../../api.js";

const STATUS_LABEL = { OPEN: "Buka", PENDING: "Pending", RESOLVED: "Selesai" };
const STATUS_CLASS = { OPEN: "badge-open", PENDING: "badge-pending", RESOLVED: "badge-resolved" };

function ConversationItemBase({ id }) {
  // Subscribe GRANULAR — hanya re-render item ini kalau conversation dengan
  // id ini berubah, bukan seluruh list (itu poin utama pola "pass id saja").
  const c = useConversation(id);
  const activeId = useActiveId();
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const longPressTimerRef = useRef(null);
  const longPressAt = useRef(0);

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
  // Backend belum expose jumlah unread real (cuma boolean `unread`) —
  // tampilkan count kalau field ada (siap dipakai begitu backend nambah),
  // fallback ke 1 titik saat cuma tahu unread=true.
  const unreadCount = c.unreadCount ?? (isUnread ? 1 : 0);
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  // Badge CS-1/CS-2 — field sessionId belum ada di schema Conversation saat
  // ini (lihat CLAUDE.md §"Multi-session WAHA"), jadi badge ini otomatis
  // tidak muncul sampai backend menambahkannya. Kode sudah siap pakai.
  const sessionLabel = c.sessionId === "CS-1" || c.sessionId === "CS-2" ? c.sessionId : null;

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
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  }

  function handleTouchStart(e) {
    const touch = e.touches[0];
    longPressTimerRef.current = setTimeout(() => openContextMenu(touch.clientX, touch.clientY), 600);
  }
  function handleTouchEnd() { clearTimeout(longPressTimerRef.current); }
  function handleTouchMove() { clearTimeout(longPressTimerRef.current); }

  function handleClick() {
    if (Date.now() - longPressAt.current < 800) return;
    selectConversation();
  }

  return (
    <button
      className={`conversation-item${isActive ? " active" : ""}${isUnread ? " unread" : ""}${isRead && !isUnread ? " conv-item-read" : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
    >
      <div className="conv-avatar-wrap">
        {isGroup ? (
          <div className="conv-group-avatar"><Users size={18} /></div>
        ) : (
          <Avatar name={name} src={c.customer?.profilePictureUrl} size="md" />
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
          <p className="last-message">
            {lastMsg?.content || (lastMsg?.mediaType ? `[${lastMsg.mediaType}]` : "Belum ada pesan")}
          </p>
          {unreadCount > 0 && <span className="unread-count-badge">{unreadLabel}</span>}
        </div>

        <div className="conv-badges">
          <span className={`badge ${STATUS_CLASS[c.status] || "badge-open"}`}>
            {STATUS_LABEL[c.status] || c.status}
          </span>
          {sessionLabel && <span className="session-badge">{sessionLabel}</span>}
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
    </button>
  );
}

export default memo(ConversationItemBase);
