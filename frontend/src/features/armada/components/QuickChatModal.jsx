import React, { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { X, Send, MessageCircle, ExternalLink, Loader2 } from "lucide-react";
import { api } from "@/api.js";
import { cn } from "@/lib/utils.js";
import { formatWaktu } from "@/utils/format.js";

// Chat WA cepat dari Route Planner (8 September 2026, permintaan owner):
// "admin sales butuh konfirmasi kembali sebelum rute berjalan untuk
// memastikan customer ada di tempat, jadi gaperlu pergi ke sales crm dulu,
// trus buka inbox". Modal RINGAN, BUKAN ChatWindow penuh (Inbox) — sengaja
// TIDAK reuse Composer.jsx/ChatWindow (523+348 baris, bawa template/media/
// voice recorder/product picker yang tidak relevan untuk kebutuhan
// "konfirmasi cepat" di sini) — pilih 2 endpoint yang SUDAH ADA dan pas:
//   - GET /conversations/:id/peek (api.peekConversation) — beberapa pesan
//     TERAKHIR TANPA menandai percakapan "sudah dibaca" (beda dari
//     getMessages yang punya efek samping itu, lihat useMessages.js) —
//     modal ini murni jendela intip+kirim cepat, tidak boleh diam-diam
//     mengubah status unread yang dipantau tim CS di Inbox.
//   - POST /conversations/:id/messages (api.sendMessage) — jalur kirim
//     yang SAMA PERSIS dipakai Inbox, tidak ada logic kirim WA kedua.
// "Buka Percakapan Penuh" tetap disediakan (ExternalLink -> /inbox?conv=)
// untuk kasus yang butuh riwayat lengkap/template/kirim media.
export default function QuickChatModal({ conversationId, customerName, customerPhone, defaultMessage, onClose }) {
  const navigate = useNavigate();
  const [messages, setMessages] = useState(null); // null = belum dimuat
  const [error, setError] = useState("");
  const [text, setText] = useState(defaultMessage || "");
  const [sending, setSending] = useState(false);
  const bottomRef = useRef(null);

  function muat() {
    api.peekConversation(conversationId, 20)
      .then(setMessages)
      .catch((e) => setError(e.message || "Gagal memuat percakapan"));
  }

  useEffect(() => { muat(); }, [conversationId]);
  useEffect(() => {
    if (messages) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages]);

  async function kirim() {
    const isi = text.trim();
    if (!isi || sending) return;
    setSending(true);
    try {
      await api.sendMessage(conversationId, isi);
      setText("");
      muat();
    } catch (e) {
      alert("Gagal kirim pesan: " + e.message);
    } finally {
      setSending(false);
    }
  }

  function kirimViaEnter(e) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      kirim();
    }
  }

  return (
    <div
      className="fixed inset-0 z-[1200] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex h-[min(600px,85vh)] w-full max-w-[420px] flex-col overflow-hidden rounded-card bg-surface shadow-popover"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex shrink-0 items-center justify-between gap-2 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-1.5">
              <MessageCircle size={15} className="shrink-0 text-green" />
              <span className="truncate text-[13px] font-bold text-ink">{customerName || "Pelanggan"}</span>
            </div>
            {customerPhone && <p className="mt-0.5 truncate text-[10.5px] text-ink3">{customerPhone}</p>}
          </div>
          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              onClick={() => navigate(`/inbox?conv=${conversationId}`)}
              title="Buka percakapan penuh di Inbox"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
            >
              <ExternalLink size={14} />
            </button>
            <button
              type="button"
              onClick={onClose}
              aria-label="Tutup"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-ink3 transition-colors hover:bg-hovertint hover:text-ink"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="flex-1 space-y-2 overflow-y-auto p-3">
          {messages === null && !error ? (
            <div className="flex h-full items-center justify-center text-[12px] text-ink3">Memuat percakapan…</div>
          ) : error ? (
            <div className="flex h-full items-center justify-center text-center text-[12px] text-red">{error}</div>
          ) : messages.length === 0 ? (
            <div className="flex h-full items-center justify-center text-[12px] text-ink3">Belum ada pesan dengan pelanggan ini.</div>
          ) : (
            messages.map((m) => {
              const keluar = m.direction === "OUTBOUND";
              const isi = m.content || (m.mediaType ? `[${m.mediaType}]` : "[Pesan]");
              return (
                <div key={m.id} className={cn("flex", keluar ? "justify-end" : "justify-start")}>
                  <div
                    className={cn(
                      "max-w-[80%] rounded-2xl px-3 py-1.5 text-[12.5px] leading-snug",
                      keluar ? "rounded-br-sm bg-accent text-white" : "rounded-bl-sm bg-inset text-ink"
                    )}
                  >
                    <p className="whitespace-pre-wrap break-words">{isi}</p>
                    <p className={cn("mt-0.5 text-[9.5px]", keluar ? "text-white/70" : "text-ink3")}>{formatWaktu(m.createdAt)}</p>
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>

        <div className="flex shrink-0 items-end gap-2 border-t border-line p-2.5">
          <textarea
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={kirimViaEnter}
            placeholder="Tulis pesan konfirmasi…"
            rows={2}
            className="min-w-0 flex-1 resize-none rounded-btn border border-border bg-inset px-2.5 py-2 text-[12.5px] text-ink outline-none placeholder:text-ink3 focus:border-accent"
          />
          <button
            type="button"
            onClick={kirim}
            disabled={sending || !text.trim()}
            aria-label="Kirim pesan"
            className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-accent text-white transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={15} />}
          </button>
        </div>
      </div>
    </div>
  );
}
