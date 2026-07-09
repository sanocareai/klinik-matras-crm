import React, { useEffect, useMemo, useState } from "react";
import { Search, X, ChevronUp, ChevronDown } from "lucide-react";
import { useMessagesForConv } from "../../stores/messageStore.js";

// Search lokal atas pesan yang SUDAH ter-load di messageStore — backend
// tidak punya endpoint search pesan khusus (lihat useMessages.js), jadi ini
// filter client-side, sama seperti pola search-in-conversation yang sudah
// ada sebelumnya di ChatWindow lama.
export default function InChatSearch({ conversationId, onJumpTo, onClose }) {
  const messages = useMessagesForConv(conversationId);
  const [query, setQuery] = useState("");
  const [index, setIndex] = useState(0);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return messages.filter((m) => (m.content || "").toLowerCase().includes(q));
  }, [messages, query]);

  useEffect(() => { setIndex(0); }, [query]);

  useEffect(() => {
    if (matches.length) onJumpTo?.(matches[index]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index, matches.length, query]);

  function go(dir) {
    if (!matches.length) return;
    setIndex((i) => (i + dir + matches.length) % matches.length);
  }

  return (
    <div className="chat-search-bar in-chat-search-slide">
      <Search size={14} className="chat-search-icon" />
      <input
        autoFocus
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Cari pesan dalam percakapan..."
        className="chat-search-input"
      />
      {query.trim() && (
        <span className="chat-search-count">{matches.length ? `${index + 1}/${matches.length}` : "0/0"}</span>
      )}
      <button type="button" className="chat-action-btn" onClick={() => go(-1)} disabled={!matches.length} title="Sebelumnya">
        <ChevronUp size={16} />
      </button>
      <button type="button" className="chat-action-btn" onClick={() => go(1)} disabled={!matches.length} title="Berikutnya">
        <ChevronDown size={16} />
      </button>
      <button type="button" className="chat-action-btn" onClick={onClose} title="Tutup pencarian">
        <X size={16} />
      </button>
    </div>
  );
}
