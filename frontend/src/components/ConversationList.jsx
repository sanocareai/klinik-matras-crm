import React from "react";

export default function ConversationList({ conversations, activeId, onSelect }) {
  return (
    <div className="conversation-list">
      {conversations.length === 0 && <p className="empty">Belum ada percakapan</p>}
      {conversations.map((c) => {
        const lastMessage = c.messages?.[0];
        return (
          <button
            key={c.id}
            className={`conversation-item ${c.id === activeId ? "active" : ""}`}
            onClick={() => onSelect(c)}
          >
            <div className="conversation-top">
              <span className="customer-name">{c.customer.name || c.customer.phone}</span>
              <span className={`channel-badge ${c.channel.toLowerCase()}`}>{c.channel}</span>
            </div>
            <p className="last-message">{lastMessage?.content || "Belum ada pesan"}</p>
          </button>
        );
      })}
    </div>
  );
}
