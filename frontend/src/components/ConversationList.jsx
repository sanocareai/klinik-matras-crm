import React, { useEffect, useRef, useState } from "react";
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
  // Context menu: { convId, x, y, pinned }
  const [contextMenu, setContextMenu] = useState(null);
  const longPressRef = useRef(null);

  // Tutup context menu kalau klik di luar
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener("click", handler);
    return () => document.removeEventListener("click", handler);
  }, [contextMenu]);

  function openContextMenu(e, conv) {
    e.preventDefault();
    e.stopPropagation();
    const x = e.clientX || (e.touches?.[0]?.clientX) || 0;
    const y = e.clientY || (e.touches?.[0]?.clientY) || 0;
    setContextMenu({ convId: conv.id, x, y, pinned: !!conv.pinned });
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
        {/* Tab "Milik Saya" */}
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
              onClick={() => onSelect(c)}
              onContextMenu={(e) => openContextMenu(e, c)}
              onTouchStart={(e) => {
                const touch = e.touches[0];
                longPressRef.current = setTimeout(() => {
                  setContextMenu({ convId: c.id, x: touch.clientX, y: touch.clientY, pinned: isPinned });
                }, 600);
              }}
              onTouchEnd={() => clearTimeout(longPressRef.current)}
              onTouchMove={() => clearTimeout(longPressRef.current)}
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
                  {/* Badge "Sudah Dibuka" */}
                  {isRead && !isReplied && (
                    <span title="Sudah dibuka tapi belum dibalas" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "#ede9fe", color: "#5b21b6" }}>
                      <Eye size={10} /> Dibuka
                    </span>
                  )}
                  {/* Badge "Sudah Dibalas" */}
                  {isReplied && (
                    <span title="Sudah dibalas" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "#dcfce7", color: "#166534" }}>
                      <CheckCheck size={10} /> Dibalas
                    </span>
                  )}
                  {/* Badge belum dibalas ≥ 1 jam */}
                  {c.isUnanswered && (c.unansweredMinutes ?? 0) >= 60 && (
                    <span style={{ fontSize: 10, fontWeight: 700, padding: "2px 6px", borderRadius: 6, background: "#fee2e2", color: "#991b1b" }}>
                      {c.unansweredMinutes >= 120
                        ? `${Math.floor(c.unansweredMinutes / 60)}j+ belum dibalas`
                        : "1j+ belum dibalas"}
                    </span>
                  )}
                  {/* Badge siapa yang handle */}
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
      {contextMenu && onPin && (
        <div
          style={{
            position: "fixed",
            left: Math.min(contextMenu.x, window.innerWidth - 170),
            top: Math.min(contextMenu.y, window.innerHeight - 60),
            background: "var(--card-bg, #fff)",
            border: "1px solid var(--border, #e5e7eb)",
            borderRadius: 10,
            boxShadow: "0 4px 20px rgba(0,0,0,0.18)",
            zIndex: 1000,
            minWidth: 160,
            overflow: "hidden",
          }}
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={() => {
              onPin(contextMenu.convId, !contextMenu.pinned);
              setContextMenu(null);
            }}
            style={{
              display: "flex", alignItems: "center", gap: 10,
              width: "100%", padding: "11px 16px",
              background: "none", border: "none",
              cursor: "pointer", fontSize: 13,
              textAlign: "left", color: "var(--text-primary, #111827)",
            }}
          >
            <Pin size={14} style={{ color: "#7c3aed" }} />
            {contextMenu.pinned ? "Lepas Sematan" : "Sematkan di Atas"}
          </button>
        </div>
      )}
    </div>
  );
}
