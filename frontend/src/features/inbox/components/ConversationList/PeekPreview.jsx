// Peek Preview — port dari mobile (PeekPreviewModal.js). Hover sebentar di
// atas baris percakapan (desktop) → popup ringan dekat kursor, tampilkan
// beberapa pesan terakhir TANPA menandai percakapan sudah dibaca. Fetch
// lewat api.peekConversation() (GET /conversations/:id/peek) — endpoint
// terpisah dari getMessages yang punya side-effect mark-as-read.
//
// Trigger HOVER (bukan long-press/klik-kanan seperti mobile) — klik-kanan
// di baris ini sudah dipakai untuk menu Sematkan (lihat ConversationItem.jsx),
// jadi Peek butuh trigger sendiri yang wajar untuk mouse.
import React, { useEffect, useState } from "react";
import { MessageCircle, UserPlus, Image as ImageIcon, Video, Mic, FileText } from "lucide-react";
import { api } from "../../../../api.js";
import { formatWaktu } from "../../../../utils/format.js";
import { useConversationStore } from "../../stores/conversationStore.js";

const PEEK_LIMIT = 5;
const MEDIA_ICON = { image: ImageIcon, video: Video, audio: Mic, document: FileText };
const MEDIA_LABEL = { image: "Foto", video: "Video", audio: "Pesan suara", document: "Dokumen" };

function PeekMessageRow({ message }) {
  const isOut = message.direction === "OUTBOUND";
  const MediaIcon = message.mediaType ? MEDIA_ICON[message.mediaType] : null;
  const isBracketPlaceholder = typeof message.content === "string" && /^\[.+\]$/.test(message.content);
  const label = message.content && !isBracketPlaceholder
    ? message.content
    : (message.mediaType ? (MEDIA_LABEL[message.mediaType] || "Media") : "Pesan");

  return (
    <div className={`peek-msg-row${isOut ? " out" : " in"}`}>
      <div className={`peek-msg-bubble${isOut ? " out" : " in"}`}>
        {MediaIcon && <MediaIcon size={12} />}
        <span>{label}</span>
      </div>
      <span className="peek-msg-time">{formatWaktu(message.createdAt)}</span>
    </div>
  );
}

export default function PeekPreview({ conversation, x, y, onClose, onOpenChat }) {
  const [messages, setMessages] = useState([]);
  const [loading, setLoading]   = useState(true);
  const [errorMsg, setErrorMsg] = useState(null);
  const [takingOver, setTakingOver] = useState(false);

  const conversationId = conversation?.id;

  useEffect(() => {
    if (!conversationId) return;
    let alive = true;
    setLoading(true);
    setErrorMsg(null);
    api.peekConversation(conversationId, PEEK_LIMIT)
      .then((data) => { if (alive) setMessages(data || []); })
      .catch((err) => { if (alive) setErrorMsg(err.message || "Gagal memuat pratinjau"); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [conversationId]);

  async function handleTakeover() {
    if (takingOver) return;
    setTakingOver(true);
    try {
      const updated = await api.takeoverConversation(conversationId);
      useConversationStore.getState().upsertConversation(updated);
      onClose?.();
    } catch (err) {
      setErrorMsg(err.message || "Gagal ambil percakapan");
    } finally {
      setTakingOver(false);
    }
  }

  if (!conversation) return null;

  const isGroup = conversation.type === "GROUP";
  const name = isGroup
    ? (conversation.groupName || "Grup WhatsApp")
    : (conversation.customer?.name || conversation.customer?.phone || "Pelanggan");
  const needsTakeover = !isGroup && !conversation.assignedToId;

  // Clamp posisi supaya popup tidak lewat tepi layar — pola sama dengan
  // MessageBubble.jsx#openMenuAt.
  const POPUP_W = 300, POPUP_H = 340, PAD = 8;
  const left = Math.min(Math.max(PAD, x), window.innerWidth - POPUP_W - PAD);
  const top  = Math.min(Math.max(PAD, y - 40), window.innerHeight - POPUP_H - PAD);

  return (
    <>
      <div className="conv-context-backdrop" onClick={onClose} />
      <div className="peek-popup" style={{ left, top }} onClick={(e) => e.stopPropagation()}>
        <div className="peek-header">
          <span className="peek-header-name">{name}</span>
        </div>
        <div className="peek-body">
          {loading ? (
            <div className="peek-loading">Memuat…</div>
          ) : errorMsg ? (
            <div className="peek-error">{errorMsg}</div>
          ) : messages.length === 0 ? (
            <div className="peek-empty">Belum ada pesan</div>
          ) : (
            messages.map((m) => <PeekMessageRow key={m.id} message={m} />)
          )}
        </div>
        <div className="peek-footer">
          {needsTakeover && (
            <button type="button" className="peek-footer-btn secondary" onClick={handleTakeover} disabled={takingOver}>
              <UserPlus size={14} />
              {takingOver ? "Mengambil…" : "Ambil Percakapan"}
            </button>
          )}
          <button type="button" className="peek-footer-btn primary" onClick={onOpenChat}>
            <MessageCircle size={14} />
            Buka Chat
          </button>
        </div>
      </div>
    </>
  );
}
