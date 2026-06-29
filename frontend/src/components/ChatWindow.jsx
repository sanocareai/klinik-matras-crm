import React, { useEffect, useRef, useState } from "react";
import { api } from "../api.js";

export default function ChatWindow({ conversation }) {
  const [messages, setMessages] = useState([]);
  const [draft, setDraft] = useState("");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  useEffect(() => {
    if (!conversation) return;
    let interval;
    async function load() {
      const data = await api.getMessages(conversation.id);
      setMessages(data);
    }
    load();
    interval = setInterval(load, 5000); // polling sederhana, cukup untuk Phase 1
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
      const message = await api.sendMessage(conversation.id, draft);
      setMessages((prev) => [...prev, message]);
      setDraft("");
    } catch (err) {
      alert(err.message);
    } finally {
      setSending(false);
    }
  }

  if (!conversation) {
    return <div className="chat-window empty-state">Pilih percakapan di sebelah kiri</div>;
  }

  return (
    <div className="chat-window">
      <div className="chat-header">
        <strong>{conversation.customer.name || conversation.customer.phone}</strong>
        <span className="muted"> · {conversation.channel}</span>
      </div>

      <div className="chat-messages">
        {messages.map((m) => (
          <div key={m.id} className={`bubble ${m.direction === "OUTBOUND" ? "out" : "in"}`}>
            {m.content}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <form className="chat-input" onSubmit={handleSend}>
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          placeholder="Tulis balasan..."
        />
        <button type="submit" disabled={sending}>Kirim</button>
      </form>
    </div>
  );
}
