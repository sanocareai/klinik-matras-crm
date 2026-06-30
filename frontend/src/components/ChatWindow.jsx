import React, { useEffect, useRef, useState } from "react";
import { Send, MessageSquare, CheckCircle, ChevronDown, X } from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import { formatWaktu } from "../utils/format.js";

const STATUS_OPTIONS = [
  { value: "OPEN",     label: "Terbuka" },
  { value: "PENDING",  label: "Pending" },
  { value: "RESOLVED", label: "Selesai" },
];

const KATEGORI_COLORS = {
  pembukaan: { bg: "#dbeafe", color: "#1e40af" },
  follow_up: { bg: "#ede9fe", color: "#5b21b6" },
  penawaran: { bg: "#dcfce7", color: "#166534" },
  konfirmasi: { bg: "#fef9c3", color: "#854d0e" },
  penutupan: { bg: "#fee2e2", color: "#991b1b" },
  lainnya:   { bg: "#f3f4f6", color: "#374151" },
};

const KATEGORI_LABELS = {
  pembukaan: "Pembukaan",
  follow_up: "Follow Up",
  penawaran: "Penawaran",
  konfirmasi: "Konfirmasi",
  penutupan: "Penutupan",
  lainnya: "Lainnya",
};

// Ganti variabel template dengan data nyata
function applyVariables(text, customer) {
  return text
    .replace(/\{nama_customer\}/g, customer?.name || customer?.phone || "Kak")
    .replace(/\{nomor_wa\}/g, customer?.phone || "")
    .replace(/\{kota\}/g, customer?.city || "");
}

// Dropdown picker template
function TemplatePicker({ customer, onSelect, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const pickerRef = useRef(null);

  useEffect(() => {
    api.getTemplates()
      .then(setTemplates)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Tutup jika klik di luar
  useEffect(() => {
    function handleClick(e) {
      if (pickerRef.current && !pickerRef.current.contains(e.target)) onClose();
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [onClose]);

  const filtered = templates.filter((t) =>
    !search || t.nama.toLowerCase().includes(search.toLowerCase()) ||
    t.isi.toLowerCase().includes(search.toLowerCase())
  );

  const grouped = Object.keys(KATEGORI_LABELS).reduce((acc, k) => {
    const items = filtered.filter((t) => t.kategori === k);
    if (items.length > 0) acc[k] = items;
    return acc;
  }, {});

  return (
    <div ref={pickerRef} style={{
      position: "absolute", bottom: "100%", left: 0, right: 0, marginBottom: 4,
      background: "var(--bg-primary)", border: "1px solid var(--border)",
      borderRadius: 10, boxShadow: "0 4px 20px rgba(0,0,0,0.12)",
      zIndex: 100, maxHeight: 360, display: "flex", flexDirection: "column",
    }}>
      {/* Header */}
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "10px 12px", borderBottom: "1px solid var(--border)" }}>
        <span style={{ fontWeight: 700, fontSize: 13 }}>Pilih Template</span>
        <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)" }}>
          <X size={14} />
        </button>
      </div>
      {/* Search */}
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <input
          autoFocus
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari template..."
          style={{ width: "100%", fontSize: 12, padding: "5px 8px", borderRadius: 6, border: "1px solid var(--border)", background: "var(--bg-secondary)", color: "var(--text-primary)" }}
        />
      </div>
      {/* List */}
      <div style={{ overflowY: "auto", flex: 1 }}>
        {loading && <p style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>Memuat...</p>}
        {!loading && filtered.length === 0 && (
          <p style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>Tidak ada template ditemukan.</p>
        )}
        {Object.entries(grouped).map(([kategori, items]) => (
          <div key={kategori}>
            <div style={{ padding: "6px 12px 3px", fontSize: 10, fontWeight: 700, textTransform: "uppercase", letterSpacing: "0.05em", color: "var(--text-muted)" }}>
              {KATEGORI_LABELS[kategori]}
            </div>
            {items.map((tpl) => {
              const colors = KATEGORI_COLORS[tpl.kategori] || KATEGORI_COLORS.lainnya;
              const preview = applyVariables(tpl.isi, customer);
              return (
                <button
                  key={tpl.id}
                  onClick={() => { onSelect(preview); onClose(); }}
                  style={{
                    display: "block", width: "100%", textAlign: "left", padding: "8px 12px",
                    background: "none", border: "none", cursor: "pointer",
                    borderBottom: "1px solid var(--border)",
                  }}
                  onMouseEnter={(e) => e.currentTarget.style.background = "var(--bg-secondary)"}
                  onMouseLeave={(e) => e.currentTarget.style.background = "none"}
                >
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span style={{ fontSize: 10, fontWeight: 600, padding: "1px 6px", borderRadius: 10, background: colors.bg, color: colors.color }}>
                      {KATEGORI_LABELS[tpl.kategori]}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "var(--text-primary)" }}>{tpl.nama}</span>
                  </div>
                  <p style={{ margin: 0, fontSize: 11.5, color: "var(--text-muted)", lineHeight: 1.4, display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {preview}
                  </p>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export default function ChatWindow({ conversation, onConversationUpdated }) {
  const [messages, setMessages]       = useState([]);
  const [draft, setDraft]             = useState("");
  const [sending, setSending]         = useState(false);
  const [convStatus, setConvStatus]   = useState(conversation?.status || "OPEN");
  const [resolving, setResolving]     = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!conversation) return;
    setConvStatus(conversation.status || "OPEN");
    setShowTemplates(false);
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

      {/* Input + Template picker */}
      <div style={{ position: "relative" }}>
        {showTemplates && (
          <TemplatePicker
            customer={conversation.customer}
            onSelect={(text) => setDraft(text)}
            onClose={() => setShowTemplates(false)}
          />
        )}
        <form className="chat-input" onSubmit={handleSend} style={{ borderTop: "1px solid var(--border)" }}>
          <button
            type="button"
            onClick={() => setShowTemplates((v) => !v)}
            title="Pilih template pesan"
            style={{
              padding: "6px 10px", borderRadius: 6,
              border: `1px solid ${showTemplates ? "var(--color-primary)" : "var(--border)"}`,
              background: showTemplates ? "var(--color-primary-light, #ede9fe)" : "var(--bg-secondary)",
              color: showTemplates ? "var(--color-primary)" : "var(--text-muted)",
              cursor: "pointer", display: "flex", alignItems: "center", gap: 3, fontSize: 11, fontWeight: 600,
            }}
          >
            <MessageSquare size={13} /> Template <ChevronDown size={11} />
          </button>
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
    </div>
  );
}
