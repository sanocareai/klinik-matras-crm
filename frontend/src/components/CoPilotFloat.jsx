import React, { useState, useRef, useEffect } from "react";
import { api } from "../api.js";

export default function CoPilotFloat() {
  const [open, setOpen]       = useState(false);
  const [history, setHistory] = useState([]); // [{ role: "user"|"assistant", content }]
  const [input, setInput]     = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState("");
  const bottomRef = useRef(null);
  const inputRef  = useRef(null);

  // Auto-scroll ke pesan terbaru
  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [history, open, loading]);

  // Fokus input saat panel dibuka
  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 100);
  }, [open]);

  async function handleSend() {
    const msg = input.trim();
    if (!msg || loading) return;

    const userMsg    = { role: "user", content: msg };
    const newHistory = [...history, userMsg];
    setHistory(newHistory);
    setInput("");
    setLoading(true);
    setError("");

    try {
      const { reply } = await api.coPilotChat(msg, history);
      setHistory([...newHistory, { role: "assistant", content: reply }]);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }

  function handleKeyDown(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  }

  return (
    <>
      {/* Floating button */}
      <button
        onClick={() => setOpen((o) => !o)}
        title="Tanya Sano Co-pilot (internal)"
        style={{
          position: "fixed", bottom: 24, right: 24, zIndex: 1050,
          width: 52, height: 52, borderRadius: "50%",
          background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
          border: "none", cursor: "pointer",
          boxShadow: "0 4px 18px rgba(124,58,237,0.5)",
          display: "flex", alignItems: "center", justifyContent: "center",
          color: "#fff", fontSize: open ? 18 : 22,
          transition: "all 0.2s",
        }}
      >
        {open ? "✕" : "✨"}
      </button>

      {/* Chat panel */}
      {open && (
        <div style={{
          position: "fixed", bottom: 88, right: 24, zIndex: 1049,
          width: 340, maxWidth: "calc(100vw - 32px)",
          background: "var(--card-bg)",
          borderRadius: 16,
          boxShadow: "0 8px 40px rgba(0,0,0,0.2)",
          border: "1px solid var(--border)",
          display: "flex", flexDirection: "column",
          maxHeight: "min(520px, calc(100vh - 120px))",
          overflow: "hidden",
        }}>

          {/* Header */}
          <div style={{
            padding: "12px 16px",
            background: "linear-gradient(135deg, #7c3aed 0%, #2563eb 100%)",
            color: "#fff", display: "flex", alignItems: "center", justifyContent: "space-between",
          }}>
            <div>
              <p style={{ margin: 0, fontWeight: 700, fontSize: 14 }}>✨ Sano Co-pilot</p>
              <p style={{ margin: "2px 0 0", fontSize: 10, opacity: 0.8 }}>Asisten internal tim — bukan untuk customer</p>
            </div>
            {history.length > 0 && (
              <button
                onClick={() => { setHistory([]); setError(""); }}
                style={{
                  background: "rgba(255,255,255,0.2)", border: "none", borderRadius: 6,
                  color: "#fff", fontSize: 11, padding: "3px 8px", cursor: "pointer",
                }}
              >
                Bersihkan
              </button>
            )}
          </div>

          {/* Messages */}
          <div style={{
            flex: 1, overflowY: "auto", padding: "12px 14px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            {history.length === 0 && !loading && (
              <div style={{ textAlign: "center", padding: "24px 8px", color: "var(--text-muted)" }}>
                <div style={{ fontSize: 28, marginBottom: 8 }}>🛏️</div>
                <p style={{ margin: "0 0 6px", fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                  Halo! Saya Sano Co-pilot
                </p>
                <p style={{ margin: 0, fontSize: 12 }}>
                  Tanya apa saja soal produk, harga, spek kasur, atau minta bantu draft pesan untuk customer.
                </p>
              </div>
            )}

            {history.map((msg, i) => (
              <div key={i} style={{
                alignSelf: msg.role === "user" ? "flex-end" : "flex-start",
                maxWidth: "88%",
                padding: "8px 12px",
                borderRadius: 12,
                fontSize: 13, lineHeight: 1.55,
                background: msg.role === "user" ? "#2563eb" : "var(--bg-secondary, #f3f4f6)",
                color: msg.role === "user" ? "#fff" : "var(--text-primary)",
                borderBottomRightRadius: msg.role === "user" ? 3 : 12,
                borderBottomLeftRadius:  msg.role === "assistant" ? 3 : 12,
                whiteSpace: "pre-wrap", wordBreak: "break-word",
              }}>
                {msg.content}
              </div>
            ))}

            {loading && (
              <div style={{
                alignSelf: "flex-start", padding: "8px 12px",
                background: "var(--bg-secondary, #f3f4f6)", borderRadius: 12,
                fontSize: 13, color: "var(--text-muted)",
              }}>
                Mengetik...
              </div>
            )}

            {error && (
              <div style={{
                fontSize: 12, color: "#991b1b", padding: "8px 10px",
                background: "#fee2e2", borderRadius: 8, lineHeight: 1.5,
              }}>
                {error}
              </div>
            )}

            <div ref={bottomRef} />
          </div>

          {/* Input */}
          <div style={{
            padding: "10px 12px", borderTop: "1px solid var(--border)",
            display: "flex", gap: 8, alignItems: "flex-end",
          }}>
            <textarea
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Tanya soal produk, harga, konsep kasur..."
              disabled={loading}
              rows={1}
              style={{
                flex: 1, padding: "8px 12px",
                borderRadius: 16, border: "1px solid var(--border)",
                fontSize: 13, outline: "none",
                background: "var(--bg-secondary, #f3f4f6)",
                resize: "none", maxHeight: 80, overflowY: "auto",
                lineHeight: 1.4, fontFamily: "inherit",
              }}
              onInput={(e) => {
                // Auto-resize textarea
                e.target.style.height = "auto";
                e.target.style.height = Math.min(e.target.scrollHeight, 80) + "px";
              }}
            />
            <button
              onClick={handleSend}
              disabled={loading || !input.trim()}
              style={{
                width: 36, height: 36, borderRadius: "50%",
                background: "#2563eb", border: "none", cursor: "pointer",
                color: "#fff", display: "flex", alignItems: "center", justifyContent: "center",
                flexShrink: 0, transition: "opacity 0.15s",
                opacity: (loading || !input.trim()) ? 0.45 : 1,
                fontSize: 14, lineHeight: 1,
              }}
            >
              ➤
            </button>
          </div>
        </div>
      )}
    </>
  );
}
