import React, { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, CheckCircle } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import { formatWaktu } from "../utils/format.js";

const QUICK_REPLIES = [
  "Halo! Ada yang bisa kami bantu untuk kebutuhan kasur Anda?",
  "Terima kasih sudah menghubungi Klinik Matras. Kami akan segera membantu Anda.",
  "Silakan hubungi kami kembali jika ada pertanyaan lain. Terima kasih! 😊",
];

const STATUS_OPTIONS = [
  { value: "OPEN",     label: "Terbuka" },
  { value: "PENDING",  label: "Pending" },
  { value: "RESOLVED", label: "Selesai" },
];

export default function ChatWindow({ conversation, onConversationUpdated }) {
  const [messages, setMessages]       = useState([]);
  const [draft, setDraft]             = useState("");
  const [sending, setSending]         = useState(false);
  const [convStatus, setConvStatus]   = useState(conversation?.status || "OPEN");
  const [resolving, setResolving]     = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!conversation) return;
    setConvStatus(conversation.status || "OPEN");
    let interval;
    async function load() {
      const data = await api.getMessages(conversation.id);
      setMessages(data);
    }
    load();
    interval = setInterval(load, 5000);
    return () => clearInterval(interval);
  }, [conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  async function handleSend(e) {
    e.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      const msg = await api.sendMessage(conversation.id, draft);
      setMessages((prev) => [...prev, msg]);
      setDraft("");
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  async function handleStatusChange(newStatus) {
    try {
      const updated = await api.updateConversation(conversation.id, { status: newStatus });
      setConvStatus(updated.status);
      onConversationUpdated?.(updated);
    } catch (err) {
      alert(err.message);
    }
  }

  async function handleResolve() {
    if (convStatus === "RESOLVED") return;
    setResolving(true);
    try {
      const updated = await api.updateConversation(conversation.id, { status: "RESOLVED" });
      setConvStatus("RESOLVED");
      onConversationUpdated?.(updated);
    } catch (err) {
      alert(err.message);
    } finally {
      setResolving(false);
    }
  }

  if (!conversation) {
    return (
      <div className="chat-window empty-state">
        <MessageSquare size={40} className="chat-empty-icon" />
        <span>Pilih percakapan di sebelah kiri</span>
      </div>
    );
  }

  const name = conversation.customer?.name || conversation.customer?.phone || "Pelanggan";
  const channelClass = conversation.channel?.toLowerCase();
  const channelLabel = conversation.channel === "WHATSAPP" ? "WhatsApp" : "Instagram";

  return (
    <div className="chat-window">
      {/* Header */}
      <div className="chat-header">
        <Avatar name={name} size="sm" />
        <div className="chat-header-info" style={{ flex: 1 }}>
          <p className="chat-header-name">{name}</p>
          <div className="chat-header-meta">
            <span className={`channel-badge ${channelClass}`}>{channelLabel}</span>
          </div>
        </div>
        {/* Status dropdown */}
        <select
          value={convStatus}
          onChange={(e) => handleStatusChange(e.target.value)}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", marginRight: 8 }}
        >
          {STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        {/* Selesaikan button */}
        {convStatus !== "RESOLVED" && (
          <button
            className="btn btn-primary btn-sm"
            onClick={handleResolve}
            disabled={resolving}
            style={{ gap: 4, display: "flex", alignItems: "center" }}
          >
            <CheckCircle size={13} />
            {resolving ? "..." : "Selesaikan"}
          </button>
        )}
      </div>

      {/* Messages */}
      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction === "OUTBOUND" ? "out" : "in"}`}>
            {m.content}
            <span className="bubble-time">{formatWaktu(m.createdAt)}</span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      {/* Quick replies */}
      <div style={{ padding: "6px 12px", borderTop: "1px solid var(--border)", display: "flex", gap: 6, flexWrap: "wrap" }}>
        {QUICK_REPLIES.map((r, i) => (
          <button
            key={i}
            className="btn btn-ghost btn-sm"
            style={{ fontSize: 11.5 }}
            onClick={() => setDraft(r)}
          >
            Balas {i + 1}
          </button>
        ))}
      </div>

      {/* Input */}
      <form className="chat-input" onSubmit={handleSend}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tulis balasan..."
        />
        <button type="submit" className="chat-send-btn" disabled={sending}>
          <Send size={16} />
        </button>
      </form>
    </div>
  );
}
