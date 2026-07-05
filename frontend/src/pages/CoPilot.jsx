import React, { useState, useRef, useEffect, useCallback } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api } from "../api.js";
import { Plus, MessageSquare, Copy, Check, Menu, X, Trash2 } from "lucide-react";

// ─── Thread management via localStorage ──────────────────────────────────────

const STORAGE_KEY = "copilot_threads";

function loadThreads() {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY)) || []; } catch { return []; }
}

function saveThreads(threads) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(threads.slice(0, 20))); } catch {}
}

function newThreadId() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
}

// ─── Markdown components (gaya lebih lebar dari widget lama) ─────────────────

const MD_COMPONENTS = {
  p:     ({ children }) => <p style={{ margin: "0 0 10px" }}>{children}</p>,
  ul:    ({ children }) => <ul style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ul>,
  ol:    ({ children }) => <ol style={{ margin: "0 0 10px", paddingLeft: 20 }}>{children}</ol>,
  li:    ({ children }) => <li style={{ marginBottom: 4 }}>{children}</li>,
  table: ({ children }) => (
    <div style={{ overflowX: "auto", margin: "8px 0" }}>
      <table style={{ borderCollapse: "collapse", width: "100%", fontSize: 14 }}>{children}</table>
    </div>
  ),
  th:    ({ children }) => <th style={{ border: "1px solid var(--border)", padding: "5px 10px", background: "var(--bg)", textAlign: "left" }}>{children}</th>,
  td:    ({ children }) => <td style={{ border: "1px solid var(--border)", padding: "5px 10px" }}>{children}</td>,
  pre:   ({ children }) => <pre style={{ background: "#1e1e2e", color: "#cdd6f4", borderRadius: 8, padding: "10px 14px", overflowX: "auto", fontSize: 13, margin: "8px 0", whiteSpace: "pre-wrap" }}>{children}</pre>,
  code:  ({ children, className }) => className
    ? <code>{children}</code>
    : <code style={{ background: "rgba(99,102,241,0.1)", borderRadius: 4, padding: "2px 5px", fontSize: 13, fontFamily: "monospace", color: "#6366f1" }}>{children}</code>,
  h1: ({ children }) => <h1 style={{ fontSize: 18, fontWeight: 700, margin: "12px 0 6px" }}>{children}</h1>,
  h2: ({ children }) => <h2 style={{ fontSize: 16, fontWeight: 700, margin: "10px 0 5px" }}>{children}</h2>,
  h3: ({ children }) => <h3 style={{ fontSize: 15, fontWeight: 600, margin: "8px 0 4px" }}>{children}</h3>,
  blockquote: ({ children }) => <blockquote style={{ borderLeft: "3px solid var(--primary)", paddingLeft: 12, color: "var(--text-secondary)", margin: "8px 0" }}>{children}</blockquote>,
  hr: () => <hr style={{ border: "none", borderTop: "1px solid var(--border)", margin: "12px 0" }} />,
};

// ─── Tool meta badge ─────────────────────────────────────────────────────────

function ToolMetaBadge({ toolMeta }) {
  if (!toolMeta) return null;
  const LABEL_MAP = {
    "konsep-istilah-teknis": "Konsep & Istilah",
    "dunia-kasur-umum": "Dunia Kasur",
    "faq-tambahan": "FAQ",
    "insight-lapangan": "Insight Lapangan",
  };
  const catLabel = LABEL_MAP[toolMeta.category] || toolMeta.category;
  let text = "";
  if (toolMeta.action === "saved")   text = `✓ Ditambahkan ke KB — ${toolMeta.label || catLabel}${toolMeta.title ? `: ${toolMeta.title}` : ""}`;
  if (toolMeta.action === "updated") text = `✓ Entri diperbarui di ${catLabel}`;
  if (toolMeta.action === "deleted") text = `✓ Entri dihapus dari ${catLabel}`;
  if (!text) return null;
  return (
    <div style={{
      display: "inline-flex", alignItems: "center", gap: 5,
      marginTop: 8, padding: "3px 12px", borderRadius: 20,
      background: toolMeta.action === "deleted" ? "#fee2e2" : "#dcfce7",
      color: toolMeta.action === "deleted" ? "#991b1b" : "#166534",
      fontSize: 12, fontWeight: 500,
    }}>
      {text}
    </div>
  );
}

// ─── Copy button ─────────────────────────────────────────────────────────────

function CopyButton({ text }) {
  const [copied, setCopied] = useState(false);
  function handleCopy() {
    navigator.clipboard.writeText(text).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }).catch(() => {});
  }
  return (
    <button
      onClick={handleCopy}
      title={copied ? "Tersalin!" : "Salin"}
      style={{
        position: "absolute", top: 8, right: 8,
        background: "none", border: "none", cursor: "pointer",
        color: copied ? "var(--success)" : "var(--text-muted)",
        padding: 4, borderRadius: 4, display: "flex", alignItems: "center",
        opacity: 0, transition: "opacity 0.15s",
      }}
      className="copy-btn"
    >
      {copied ? <Check size={14} /> : <Copy size={14} />}
    </button>
  );
}

// ─── Loading dots ─────────────────────────────────────────────────────────────

function TypingDots() {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 5, padding: "4px 0" }}>
      {[0, 1, 2].map((i) => (
        <span key={i} style={{
          width: 7, height: 7, borderRadius: "50%",
          background: "var(--text-muted)",
          display: "inline-block",
          animation: `copilot-bounce 1.2s ease-in-out ${i * 0.2}s infinite`,
        }} />
      ))}
    </div>
  );
}

// ─── Main component ──────────────────────────────────────────────────────────

export default function CoPilot() {
  const [threads, setThreads]         = useState(() => loadThreads());
  const [activeId, setActiveId]       = useState(null);
  const [messages, setMessages]       = useState([]);
  const [input, setInput]             = useState("");
  const [loading, setLoading]         = useState(false);
  const [error, setError]             = useState("");
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const messagesRef = useRef(null);
  const inputRef    = useRef(null);
  const isAtBottom  = useRef(true);

  // Deteksi posisi scroll untuk smart auto-scroll
  function handleScroll() {
    const el = messagesRef.current;
    if (!el) return;
    isAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < 120;
  }

  // Scroll ke bawah (hanya kalau user sudah di bawah atau sedang loading)
  const scrollToBottom = useCallback((force = false) => {
    const el = messagesRef.current;
    if (!el) return;
    if (force || isAtBottom.current) {
      el.scrollTop = el.scrollHeight;
    }
  }, []);

  // Scroll ke bawah saat pesan baru masuk
  useEffect(() => {
    scrollToBottom();
  }, [messages, loading, scrollToBottom]);

  // Muat thread dari localStorage saat pertama kali
  useEffect(() => {
    const saved = loadThreads();
    setThreads(saved);
    if (saved.length > 0) {
      setActiveId(saved[0].id);
      setMessages(saved[0].messages || []);
    }
  }, []);

  function createNewThread() {
    const id = newThreadId();
    const thread = { id, title: "Percakapan baru", messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    const updated = [thread, ...threads];
    setThreads(updated);
    saveThreads(updated);
    setActiveId(id);
    setMessages([]);
    setInput("");
    setError("");
    setSidebarOpen(false);
    setTimeout(() => inputRef.current?.focus(), 100);
  }

  function selectThread(t) {
    setActiveId(t.id);
    setMessages(t.messages || []);
    setError("");
    setSidebarOpen(false);
    setTimeout(() => scrollToBottom(true), 50);
  }

  function deleteThread(id, e) {
    e.stopPropagation();
    const updated = threads.filter((t) => t.id !== id);
    setThreads(updated);
    saveThreads(updated);
    if (activeId === id) {
      if (updated.length > 0) {
        setActiveId(updated[0].id);
        setMessages(updated[0].messages || []);
      } else {
        setActiveId(null);
        setMessages([]);
      }
    }
  }

  function persistMessages(id, msgs) {
    setThreads((prev) => {
      const updated = prev.map((t) => {
        if (t.id !== id) return t;
        const title = msgs.find((m) => m.role === "user")?.content?.slice(0, 42) || t.title;
        return { ...t, title, messages: msgs, updatedAt: new Date().toISOString() };
      });
      saveThreads(updated);
      return updated;
    });
  }

  async function handleSend() {
    const msg = input.trim();
    if (!msg || loading) return;

    // Buat thread baru otomatis kalau belum ada
    let currentId = activeId;
    if (!currentId) {
      const id = newThreadId();
      const thread = { id, title: msg.slice(0, 42), messages: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      currentId = id;
      setActiveId(id);
      setThreads((prev) => {
        const updated = [thread, ...prev];
        saveThreads(updated);
        return updated;
      });
    }

    const userMsg    = { role: "user", content: msg };
    const newMsgs    = [...messages, userMsg];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);
    setError("");
    isAtBottom.current = true; // paksa scroll ke bawah saat kirim

    try {
      const { reply, toolMeta } = await api.coPilotChat(msg, messages);
      const finalMsgs = [...newMsgs, { role: "assistant", content: reply, toolMeta: toolMeta || null }];
      setMessages(finalMsgs);
      persistMessages(currentId, finalMsgs);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    const isMobile = window.innerWidth < 768;
    if (e.key === "Enter" && !e.shiftKey && !isMobile) {
      e.preventDefault();
      handleSend();
    }
  }

  const activeThread = threads.find((t) => t.id === activeId);

  return (
    <div className="copilot-page">
      {/* Sidebar backdrop (mobile) */}
      {sidebarOpen && (
        <div
          style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.4)", zIndex: 199 }}
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* Sidebar thread list */}
      <div className={`copilot-sidebar ${sidebarOpen ? "open" : ""}`}>
        <div style={{ padding: "14px 12px 10px", borderBottom: "1px solid var(--border)", display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 13, flex: 1, color: "var(--text-primary)" }}>Riwayat Chat</span>
          <button
            onClick={createNewThread}
            title="Percakapan baru"
            style={{ background: "var(--primary)", color: "#fff", border: "none", borderRadius: 7, padding: "4px 10px", fontSize: 12, cursor: "pointer", display: "flex", alignItems: "center", gap: 4 }}
          >
            <Plus size={13} /> Baru
          </button>
        </div>

        <div style={{ padding: "6px 0", overflowY: "auto", flex: 1 }}>
          {threads.length === 0 && (
            <p style={{ color: "var(--text-muted)", fontSize: 12, padding: "12px 14px" }}>Belum ada percakapan.</p>
          )}
          {threads.map((t) => (
            <div
              key={t.id}
              onClick={() => selectThread(t)}
              style={{
                padding: "9px 14px", cursor: "pointer", display: "flex", alignItems: "center", gap: 6,
                background: t.id === activeId ? "var(--sidebar-active-bg, rgba(37,99,235,0.08))" : "none",
                borderLeft: t.id === activeId ? "3px solid var(--primary)" : "3px solid transparent",
                transition: "background 0.1s",
              }}
              className="copilot-thread-item"
            >
              <MessageSquare size={13} style={{ color: "var(--text-muted)", flexShrink: 0 }} />
              <span style={{
                flex: 1, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                color: t.id === activeId ? "var(--text-primary)" : "var(--text-secondary)",
                fontWeight: t.id === activeId ? 600 : 400,
              }}>
                {t.title || "Percakapan baru"}
              </span>
              <button
                onClick={(e) => deleteThread(t.id, e)}
                style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 2, flexShrink: 0, opacity: 0 }}
                className="thread-delete-btn"
                title="Hapus thread"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
        </div>
      </div>

      {/* Area chat utama */}
      <div className="copilot-chat-area">
        <div className="copilot-chat-inner">

          {/* Header */}
          <div style={{
            padding: "12px 0", borderBottom: "1px solid var(--border)",
            display: "flex", alignItems: "center", gap: 10, flexShrink: 0,
          }}>
            <button
              onClick={() => setSidebarOpen((v) => !v)}
              className="copilot-sidebar-toggle"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted)", padding: 4, display: "flex", alignItems: "center" }}
            >
              <Menu size={18} />
            </button>
            <div style={{ flex: 1, minWidth: 0 }}>
              <h2 style={{ margin: 0, fontSize: 15, fontWeight: 700, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                ✨ {activeThread?.title || "Sano Co-pilot"}
              </h2>
              <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Asisten internal tim — bukan untuk customer</p>
            </div>
            {messages.length > 0 && (
              <button
                onClick={() => {
                  if (!activeId) return;
                  const cleared = messages.filter(() => false);
                  setMessages(cleared);
                  setError("");
                  persistMessages(activeId, cleared);
                }}
                style={{ fontSize: 12, padding: "3px 10px", border: "1px solid var(--border)", borderRadius: 6, background: "none", cursor: "pointer", color: "var(--text-muted)", flexShrink: 0 }}
              >
                Bersihkan
              </button>
            )}
          </div>

          {/* Messages */}
          <div
            className="copilot-messages"
            ref={messagesRef}
            onScroll={handleScroll}
          >
            {messages.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: "48px 16px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 44, marginBottom: 12 }}>🛏️</div>
                <p style={{ margin: "0 0 8px", fontSize: 17, fontWeight: 700, color: "var(--text-primary)" }}>Halo! Saya Sano Co-pilot</p>
                <p style={{ margin: "0 0 4px", fontSize: 14, maxWidth: 360, marginInline: "auto" }}>
                  Tanya apa saja soal produk, harga, spek kasur, atau minta bantu draft pesan untuk customer.
                </p>
                <p style={{ margin: "0 0 4px", fontSize: 12 }}>Khusus tim internal — percakapan ini tidak dilihat customer.</p>
                <p style={{ margin: 0, fontSize: 11, color: "var(--text-muted)" }}>Fitur tambah/edit Knowledge Base hanya tersedia dengan model Claude (Anthropic).</p>
              </div>
            )}

            {messages.map((msg, i) => (
              <div key={i} className={`copilot-msg copilot-msg-${msg.role}`}>
                <div className="copilot-msg-label">
                  {msg.role === "user" ? "Kamu" : "✨ Sano"}
                </div>
                <div className="copilot-msg-bubble" style={{ position: "relative" }}>
                  {msg.role === "user" ? (
                    <span className="copilot-msg-content" style={{ whiteSpace: "pre-wrap" }}>{msg.content}</span>
                  ) : (
                    <>
                      <div className="copilot-msg-content">
                        <ReactMarkdown remarkPlugins={[remarkGfm]} components={MD_COMPONENTS}>
                          {msg.content}
                        </ReactMarkdown>
                      </div>
                      <CopyButton text={msg.content} />
                      <ToolMetaBadge toolMeta={msg.toolMeta} />
                    </>
                  )}
                </div>
              </div>
            ))}

            {loading && (
              <div className="copilot-msg copilot-msg-assistant">
                <div className="copilot-msg-label">✨ Sano</div>
                <div className="copilot-msg-bubble">
                  <TypingDots />
                </div>
              </div>
            )}

            {error && (
              <div style={{ padding: "10px 14px", background: "#fee2e2", color: "#991b1b", borderRadius: 8, fontSize: 13, lineHeight: 1.5 }}>
                {error}
              </div>
            )}
          </div>

          {/* Input area */}
          <div className="copilot-input-area">
            <div style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
              <textarea
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                onInput={(e) => {
                  e.target.style.height = "auto";
                  e.target.style.height = Math.min(e.target.scrollHeight, 120) + "px";
                }}
                placeholder="Tanya soal produk, harga, konsep kasur... (Enter kirim, Shift+Enter baris baru)"
                disabled={loading}
                rows={1}
                style={{
                  flex: 1, padding: "10px 14px",
                  borderRadius: 12, border: "1px solid var(--border)",
                  fontSize: 14, outline: "none",
                  background: "var(--bg)",
                  resize: "none", maxHeight: 120, overflowY: "auto",
                  lineHeight: 1.5, fontFamily: "inherit",
                  transition: "border-color 0.15s",
                }}
                onFocus={(e) => { e.target.style.borderColor = "var(--primary)"; }}
                onBlur={(e) => { e.target.style.borderColor = "var(--border)"; }}
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim()}
                style={{
                  width: 42, height: 42, borderRadius: "50%", flexShrink: 0,
                  background: "#2563eb", border: "none", cursor: "pointer",
                  color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                  transition: "opacity 0.15s",
                  opacity: (loading || !input.trim()) ? 0.4 : 1,
                  fontSize: 16,
                }}
              >
                ➤
              </button>
            </div>
            <p style={{ margin: "6px 0 0", fontSize: 11, color: "var(--text-muted)", textAlign: "center" }}>
              Enter kirim · Shift+Enter baris baru · hanya untuk tim internal
            </p>
          </div>

        </div>
      </div>
    </div>
  );
}
