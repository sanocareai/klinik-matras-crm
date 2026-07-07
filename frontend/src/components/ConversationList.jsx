import React, { useRef, useState } from "react";
import { Search, UserCheck, Eye, CheckCheck, Pin } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { formatTanggalWaktu, formatPhoneDisplay } from "../utils/format.js";

const STATUS_LABEL = { OPEN: "Buka", PENDING: "Pending", RESOLVED: "Selesai" };
const STATUS_CLASS = { OPEN: "badge-open", PENDING: "badge-pending", RESOLVED: "badge-resolved" };

const STATUS_TABS = [
  { key: "",         label: "Semua" },
  { key: "OPEN",     label: "Terbuka" },
  { key: "PENDING",  label: "Pending" },
  { key: "RESOLVED", label: "Selesai" },
];

export default function ConversationList({
  conversations,
  activeId,
  onSelect,
  filterStatus,
  onFilterStatus,
  filterMine,
  onFilterMine,
  search,
  onSearch,
  user,
  onPin,
}) {
  const [contextMenu, setContextMenu] = useState(null); // { convId, x, y, pinned }

  // Ref untuk timer long-press + timestamp kapan long-press terpicu
  // (timestamp dipakai untuk blok onClick yang terpicu tepat setelah long-press)
  const longPressTimerRef = useRef(null);
  const longPressAt      = useRef(0);

  function closeContextMenu() {
    setContextMenu(null);
  }

  function showContextMenu(convId, x, y, pinned) {
    longPressAt.current = Date.now();
    // Pastikan menu tidak keluar dari layar
    const safeX = Math.min(x, window.innerWidth  - 180);
    const safeY = Math.min(y, window.innerHeight - 70);
    setContextMenu({ convId, x: safeX, y: safeY, pinned });
  }

  function handleTouchStart(e, c) {
    const touch = e.touches[0];
    const x = touch.clientX;
    const y = touch.clientY;
    longPressTimerRef.current = setTimeout(() => {
      showContextMenu(c.id, x, y, !!c.pinned);
    }, 600);
  }

  function handleTouchEnd() {
    clearTimeout(longPressTimerRef.current);
  }

  function handleTouchMove() {
    clearTimeout(longPressTimerRef.current);
  }

  // onClick dipanggil setelah touchend (synthetic click di mobile).
  // Kalau long-press baru saja terpicu (dalam 800ms), abaikan agar menu tidak langsung tertutup.
  function handleClick(e, c) {
    if (Date.now() - longPressAt.current < 800) return;
    onSelect(c);
  }

  function handleContextMenu(e, c) {
    e.preventDefault();
    showContextMenu(c.id, e.clientX, e.clientY, !!c.pinned);
  }

  return (
    <div className="conversation-list">
      {/* Tab filter status */}
      <div className="conv-tabs">
        {STATUS_TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onFilterStatus(t.key)}
            className={`conv-tab${filterStatus === t.key && !filterMine ? " active" : ""}`}
          >
            {t.label}
          </button>
        ))}
        <button
          onClick={onFilterMine}
          className={`conv-tab${filterMine ? " active" : ""}`}
          title="Tampilkan hanya percakapan yang jadi lead kamu"
        >
          <UserCheck size={12} style={{ marginRight: 3 }} />
          Milik Saya
        </button>
      </div>

      {/* Search */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        <div className="search-input-wrap" style={{ margin: 0 }}>
          <Search size={14} className="search-icon" />
          <input
            className="search-input"
            placeholder="Cari nama atau nomor..."
            value={search}
            onChange={(e) => onSearch(e.target.value)}
            style={{ fontSize: 13 }}
          />
        </div>
      </div>

      {/* List */}
      <div style={{ flex: 1, overflowY: "auto" }}>
        {conversations.length === 0 && (
          <p className="empty">Belum ada percakapan</p>
        )}

        {conversations.map((c) => {
          const rawPhone     = c.customer?.phone;
          const name         = c.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || c.customer?.instagramHandle || "Pelanggan";
          const lastMsg      = c.messages?.[0];
          const channelClass = c.channel?.toLowerCase();
          const channelLabel = c.channel === "WHATSAPP" ? "WA" : "IG";
          const isUnread     = !!c.unread;
          const isRead       = !!c.isRead;
          const isReplied    = !c.isUnanswered;
          const isMine       = c.assignedToId === user?.id;
          const assignedName = c.assignedTo?.name;
          const isPinned     = !!c.pinned;

          return (
            <button
              key={c.id}
              className={`conversation-item${c.id === activeId ? " active" : ""}${isUnread ? " unread" : ""}`}
              onClick={(e) => handleClick(e, c)}
              onContextMenu={(e) => handleContextMenu(e, c)}
              onTouchStart={(e) => handleTouchStart(e, c)}
              onTouchEnd={handleTouchEnd}
              onTouchMove={handleTouchMove}
              style={{
                // Mencegah text selection saat long-press (penting di iOS)
                WebkitUserSelect: "none",
                userSelect: "none",
                WebkitTouchCallout: "none",
              }}
            >
              <div style={{ position: "relative", flexShrink: 0 }}>
                <Avatar name={name} src={c.customer?.profilePictureUrl} size="sm" />
                {isUnread && <span className="unread-dot" />}
              </div>
              <div className="conversation-item-body">
                <div className="conversation-top">
                  <span className="customer-name" style={isUnread ? { fontWeight: 800, color: "var(--text-main)" } : {}}>
                    {name}
                  </span>
                  <div style={{ display: "flex", alignItems: "center", gap: 4 }}>
                    {isPinned && (
                      <Pin size={11} style={{ color: "#7c3aed", flexShrink: 0 }} title="Disematkan" />
                    )}
                    <span className="conv-time" style={isUnread ? { color: "var(--color-primary)", fontWeight: 700 } : {}}>
                      {formatTanggalWaktu(c.lastMessageAt)}
                    </span>
                  </div>
                </div>

                <div className="conv-badges">
                  <span className={`channel-badge ${channelClass}`}>{channelLabel}</span>
                  <span className={`badge ${STATUS_CLASS[c.status] || "badge-open"}`}>
                    {STATUS_LABEL[c.status] || c.status}
                  </span>
                  {isRead && !isReplied && (
                    <span title="Sudah dibuka tapi belum dibalas" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "#ede9fe", color: "#5b21b6" }}>
                      <Eye size={10} /> Dibuka
                    </span>
                  )}
                  {isReplied && (
                    <span title="Sudah dibalas" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "#dcfce7", color: "#166534" }}>
                      <CheckCheck size={10} /> Dibalas
                    </span>
                  )}
                  {c.isUnanswered && (c.unansweredMinutes ?? 0) >= 60 && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: "#fee2e2", color: "#991b1b" }}>
                      {c.unansweredMinutes >= 120
                        ? `${Math.floor(c.unansweredMinutes / 60)}j+ belum dibalas`
                        : "1j+ belum dibalas"}
                    </span>
                  )}
                  {isMine ? (
                    <span className="badge badge-mine">Milik Saya</span>
                  ) : assignedName ? (
                    <span className="badge badge-assigned" title={`Lead: ${assignedName}`}>
                      {assignedName}
                    </span>
                  ) : null}
                </div>

                <p className="last-message" style={isUnread ? { fontWeight: 600, color: "var(--text-main)" } : {}}>
                  {lastMsg?.content || (lastMsg?.mediaType ? `[${lastMsg.mediaType}]` : "Belum ada pesan")}
                </p>
              </div>
            </button>
          );
        })}
      </div>

      {/* Context menu: Sematkan / Lepas Sematan */}
      {contextMenu && (
        <>
          {/* Backdrop transparan — klik di luar menu = tutup */}
          <div
            style={{ position: "fixed", inset: 0, zIndex: 998 }}
            onClick={closeContextMenu}
            onContextMenu={(e) => { e.preventDefault(); closeContextMenu(); }}
          />
          <div
            style={{
              position: "fixed",
              left: contextMenu.x,
              top: contextMenu.y,
              background: "var(--card-bg, #fff)",
              border: "1px solid var(--border, #e5e7eb)",
              borderRadius: 10,
              boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
              zIndex: 999,
              minWidth: 160,
              overflow: "hidden",
            }}
          >
            {onPin && (
              <button
                onClick={() => {
                  onPin(contextMenu.convId, !contextMenu.pinned);
                  closeContextMenu();
                }}
                style={{
                  display: "flex", alignItems: "center", gap: 10,
                  width: "100%", padding: "12px 16px",
                  background: "none", border: "none",
                  cursor: "pointer", fontSize: 13,
                  textAlign: "left", color: "var(--text-primary, #111827)",
                }}
              >
                <Pin size={14} style={{ color: "#7c3aed" }} />
                {contextMenu.pinned ? "Lepas Sematan" : "Sematkan di Atas"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}
