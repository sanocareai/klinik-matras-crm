import React from "react";
import { Search } from "lucide-react";
import Avatar from "./Avatar.jsx";
import { formatTanggalWaktu, formatPhoneDisplay } from "../utils/format.js";

const STATUS_LABEL = { OPEN: "Buka", PENDING: "Pending", RESOLVED: "Selesai" };
const STATUS_CLASS = { OPEN: "badge-open", PENDING: "badge-pending", RESOLVED: "badge-resolved" };

const TABS = [
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
  search,
  onSearch,
}) {
  return (
    <div className="conversation-list">
      {/* Tab filter */}
      <div style={{ display: "flex", borderBottom: "1px solid var(--border)", flexShrink: 0 }}>
        {TABS.map((t) => (
          <button
            key={t.key}
            onClick={() => onFilterStatus(t.key)}
            style={{
              flex: 1,
              padding: "10px 4px",
              fontSize: 12,
              fontWeight: filterStatus === t.key ? 700 : 500,
              background: "none",
              border: "none",
              borderBottom: filterStatus === t.key ? "2px solid var(--color-primary)" : "2px solid transparent",
              color: filterStatus === t.key ? "var(--color-primary)" : "var(--text-muted)",
              cursor: "pointer",
              transition: "all 0.12s",
            }}
          >
            {t.label}
          </button>
        ))}
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
          const rawPhone = c.customer?.phone;
          const name = c.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || c.customer?.instagramHandle || "Pelanggan";
          const lastMsg = c.messages?.[0];
          const channelClass = c.channel?.toLowerCase();
          const channelLabel = c.channel === "WHATSAPP" ? "WA" : "IG";

          return (
            <button
              key={c.id}
              className={`conversation-item${c.id === activeId ? " active" : ""}`}
              onClick={() => onSelect(c)}
            >
              <Avatar name={name} size="sm" />
              <div className="conversation-item-body">
                <div className="conversation-top">
                  <span className="customer-name">{name}</span>
                  <div className="conv-meta">
                    <span className="conv-time">{formatTanggalWaktu(c.lastMessageAt)}</span>
                  </div>
                </div>
                <div className="conv-badges">
                  <span className={`channel-badge ${channelClass}`}>{channelLabel}</span>
                  <span className={`badge ${STATUS_CLASS[c.status] || "badge-open"}`}>
                    {STATUS_LABEL[c.status] || c.status}
                  </span>
                </div>
                <p className="last-message">{lastMsg?.content || "Belum ada pesan"}</p>
              </div>
            </button>
          );
        })}
      </div>
    </div>
  );
}
