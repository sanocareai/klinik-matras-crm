import React, { useEffect, useRef, useState } from "react";
import { useSSE } from "../hooks/useSSE.js";
import {
  Send, MessageSquare, CheckCircle, X,
  Paperclip, Mic, MicOff, FileText, Phone, Image as ImageIcon, Video, Package,
  ArrowLeft, UserCheck, Users, Info, Plus, MoreVertical, Eye, CheckCheck,
  Reply, Forward, Pin, Smile, Search, ChevronUp, ChevronDown,
  PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import { formatWaktu, formatPhoneDisplay } from "../utils/format.js";
import { ProductPicker } from "./ProductPicker.jsx";
import CustomerPanel from "./CustomerPanel.jsx";

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
  pembukaan: "Pembukaan", follow_up: "Follow Up", penawaran: "Penawaran",
  konfirmasi: "Konfirmasi", penutupan: "Penutupan", lainnya: "Lainnya",
};

function applyVariables(text, customer) {
  return text
    .replace(/\{nama_customer\}/g, customer?.name || "Kak")
    .replace(/\{nomor_wa\}/g,      customer?.phone || "")
    .replace(/\{kota\}/g,          customer?.city  || "");
}

// ── Template Picker ───────────────────────────────────────────────────────────
function TemplatePicker({ customer, onSelect, onClose }) {
  const [templates, setTemplates] = useState([]);
  const [search, setSearch]       = useState("");
  const ref = useRef(null);

  useEffect(() => { api.getTemplates().then(setTemplates).catch(() => {}); }, []);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const filtered = templates.filter((t) =>
    !search || t.nama.toLowerCase().includes(search.toLowerCase()) ||
    t.isi.toLowerCase().includes(search.toLowerCase())
  );
  const grouped = Object.keys(KATEGORI_LABELS).reduce((acc, k) => {
    const items = filtered.filter((t) => t.kategori === k);
    if (items.length) acc[k] = items;
    return acc;
  }, {});

  return (
    <div ref={ref} className="template-picker-popup">
      <div className="template-picker-header">
        <span style={{ fontWeight: 700, fontSize: 13 }}>Pilih Template</span>
        <button onClick={onClose} className="btn-icon"><X size={14} /></button>
      </div>
      <div style={{ padding: "8px 12px", borderBottom: "1px solid var(--border)" }}>
        <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Cari template..." className="template-search" />
      </div>
      <div style={{ overflowY: "auto", flex: 1 }}>
        {filtered.length === 0 && <p style={{ padding: "12px 16px", fontSize: 13, color: "var(--text-muted)" }}>Tidak ada template.</p>}
        {Object.entries(grouped).map(([kat, items]) => (
          <div key={kat}>
            <div className="template-cat-label">{KATEGORI_LABELS[kat]}</div>
            {items.map((tpl) => {
              const c = KATEGORI_COLORS[tpl.kategori] || KATEGORI_COLORS.lainnya;
              const preview = applyVariables(tpl.isi, customer);
              return (
                <button key={tpl.id} className="template-item"
                  onClick={() => { onSelect(preview); onClose(); }}>
                  <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                    <span className="template-badge" style={{ background: c.bg, color: c.color }}>
                      {KATEGORI_LABELS[tpl.kategori]}
                    </span>
                    <span style={{ fontSize: 12, fontWeight: 600 }}>{tpl.nama}</span>
                  </div>
                  <p className="template-preview">{preview}</p>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Emoji Picker ──────────────────────────────────────────────────────────────
const EMOJI_LIST = [
  "😀","😁","😂","🤣","😊","😍","😘","😉","😎","🤔",
  "😅","😢","😭","😡","🙏","👍","👎","👏","🙌","💪",
  "❤️","🔥","✨","🎉","😴","🤗","😇","🥰","😋","🤝",
  "👋","✅","❌","⭐","💯","😐","😱","🙈","💤","☕",
];
function EmojiPicker({ onSelect, onClose }) {
  const ref = useRef(null);
  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="emoji-picker-popup">
      <div className="emoji-picker-grid">
        {EMOJI_LIST.map((em) => (
          <button key={em} type="button" className="emoji-picker-item" onClick={() => onSelect(em)}>
            {em}
          </button>
        ))}
      </div>
    </div>
  );
}

// Cek apakah string adalah JSON error (dari bug lama download media)
function isJsonError(str) {
  if (!str) return false;
  try { const p = JSON.parse(str); return !!p.message || !!p.error; } catch { return false; }
}

// ── Media Bubble ──────────────────────────────────────────────────────────────
function MediaBubble({ m, onReply, onForward, onJumpTo, registerRef, highlighted, searchMatch }) {
  const [hovered, setHovered] = useState(false);
  const longPressTimerRef = useRef(null);
  const longPressAt       = useRef(0);

  const isOut  = m.direction === "OUTBOUND";
  const hasMedia = !!m.mediaType;
  const text = (!isJsonError(m.content) && m.content) ? m.content : "";

  function handleTouchStart() {
    longPressTimerRef.current = setTimeout(() => {
      longPressAt.current = Date.now();
      setHovered(true);
      // Auto-hide setelah 4 detik agar tombol tidak menghalangi layar selamanya
      setTimeout(() => setHovered(false), 4000);
    }, 600);
  }
  function handleTouchEnd() {
    clearTimeout(longPressTimerRef.current);
  }

  return (
    <div
      ref={(el) => registerRef?.(m.id, el)}
      style={{
        width: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: isOut ? "flex-end" : "flex-start",
      }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={() => clearTimeout(longPressTimerRef.current)}
    >
      {/* Tombol aksi — muncul saat hover (balas + teruskan) */}
      {hovered && (
        <div style={{
          display: "flex",
          gap: 4,
          marginBottom: 4,
          background: "var(--card-bg, #fff)",
          border: "1px solid var(--border, #e5e7eb)",
          borderRadius: 14,
          boxShadow: "0 2px 8px rgba(0,0,0,0.12)",
          padding: "3px 8px",
        }}>
          {onReply && (
            <button
              onClick={(e) => { e.stopPropagation(); onReply(m); setHovered(false); }}
              title="Balas"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #6b7280)", padding: "3px", borderRadius: "50%", display: "flex", alignItems: "center" }}
            >
              <Reply size={14} />
            </button>
          )}
          {onForward && (
            <button
              onClick={(e) => { e.stopPropagation(); onForward(m); setHovered(false); }}
              title="Teruskan"
              style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-secondary, #6b7280)", padding: "3px", borderRadius: "50%", display: "flex", alignItems: "center" }}
            >
              <Forward size={14} />
            </button>
          )}
        </div>
      )}

      <div className={`bubble ${isOut ? "out" : "in"}${highlighted ? " bubble-flash" : ""}${searchMatch ? " bubble-search-match" : ""}`} style={{ alignSelf: "auto" }}>
        {/* Nama pengirim — hanya untuk pesan grup (inbound) */}
        {!isOut && m.senderName && (
          <div style={{ fontSize: 11, fontWeight: 700, color: "#7c3aed", marginBottom: 3 }}>
            {m.senderName}
          </div>
        )}

        {/* Preview pesan yang dikutip (reply/quote) — klik untuk lompat ke pesan asli */}
        {m.replyTo && (
          <div
            onClick={(e) => { e.stopPropagation(); onJumpTo?.(m.replyTo.id); }}
            className="bubble-quote"
            style={{
              borderLeft: `3px solid ${isOut ? "rgba(255,255,255,0.6)" : "var(--primary, #2563eb)"}`,
              background: isOut ? "rgba(0,0,0,0.12)" : "rgba(37,99,235,0.07)",
              borderRadius: 6,
              padding: "5px 8px",
              marginBottom: 7,
              fontSize: 12,
              cursor: "pointer",
            }}>
            <div style={{ fontWeight: 700, marginBottom: 2, fontSize: 11, opacity: 0.85 }}>
              {m.replyTo.direction === "OUTBOUND" ? "Kamu" : "Pelanggan"}
            </div>
            <div style={{
              opacity: 0.75,
              whiteSpace: "nowrap",
              overflow: "hidden",
              textOverflow: "ellipsis",
              maxWidth: 220,
            }}>
              {m.replyTo.content || (m.replyTo.mediaType ? `[${m.replyTo.mediaType}]` : "Pesan")}
            </div>
          </div>
        )}

        {/* Label diteruskan */}
        {m.forwarded && (
          <div style={{ display: "flex", alignItems: "center", gap: 3, fontSize: 11, opacity: 0.65, marginBottom: 4 }}>
            <Forward size={11} /> Diteruskan
          </div>
        )}

        {/* Konten media */}
        {m.mediaType === "image" && m.mediaUrl && (
          // Pakai <a> bukan onClick agar tidak kena popup blocker mobile
          <a
            href={m.mediaUrl}
            target="_blank"
            rel="noreferrer"
            onClick={(e) => e.stopPropagation()}
            style={{ display: "block", lineHeight: 0 }}
          >
            <img
              src={m.mediaUrl}
              alt="Foto"
              className="bubble-img"
              onError={(e) => { e.target.closest("a").style.display = "none"; }}
            />
          </a>
        )}
        {m.mediaType === "video" && m.mediaUrl && (
          <video src={m.mediaUrl} controls className="bubble-video" onClick={(e) => e.stopPropagation()} />
        )}
        {m.mediaType === "audio" && m.mediaUrl && (
          <audio src={m.mediaUrl} controls className="bubble-audio" onClick={(e) => e.stopPropagation()} />
        )}
        {m.mediaType === "document" && m.mediaUrl && (
          <a
            href={m.mediaUrl}
            target="_blank"
            rel="noreferrer"
            className="bubble-doc"
            onClick={(e) => e.stopPropagation()}
          >
            <FileText size={18} style={{ flexShrink: 0 }} />
            <span className="bubble-doc-name">{m.mediaUrl.split("/").pop()}</span>
          </a>
        )}
        {hasMedia && !m.mediaUrl && (
          <div className="bubble-media-placeholder">
            {m.mediaType === "image"    && <><ImageIcon size={16} /> Foto (tidak bisa diunduh)</>}
            {m.mediaType === "video"    && <><Video size={16} /> Video (tidak bisa diunduh)</>}
            {m.mediaType === "audio"    && <><Mic size={16} /> Pesan Suara (tidak bisa diunduh)</>}
            {m.mediaType === "document" && <><FileText size={16} /> Dokumen (tidak bisa diunduh)</>}
          </div>
        )}
        {text && <span className="bubble-text">{text}</span>}
        <span className="bubble-time">{formatWaktu(m.createdAt)}</span>
      </div>
    </div>
  );
}

// ── Forward Modal ─────────────────────────────────────────────────────────────
function ForwardModal({ messageToForward, onClose, onForwarded }) {
  const [convs, setConvs]       = useState([]);
  const [search, setSearch]     = useState("");
  const [loading, setLoading]   = useState(true);
  const [forwarding, setForwarding] = useState(false);

  useEffect(() => {
    api.getConversations().then((data) => { setConvs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = convs.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return (
      c.customer?.name?.toLowerCase().includes(q) ||
      (c.customer?.phone || "").includes(q)
    );
  });

  async function handleForward(targetConvId) {
    if (forwarding) return;
    setForwarding(true);
    try {
      await api.forwardMessage(messageToForward.conversationId, messageToForward.id, targetConvId);
      onForwarded?.();
      onClose();
    } catch (err) {
      alert("Gagal teruskan pesan: " + err.message);
    } finally {
      setForwarding(false);
    }
  }

  return (
    <div
      style={{ position: "fixed", inset: 0, background: "rgba(0,0,0,0.5)", zIndex: 1200, display: "flex", alignItems: "center", justifyContent: "center" }}
      onClick={onClose}
    >
      <div
        style={{ background: "var(--card-bg, #fff)", borderRadius: 14, width: "90%", maxWidth: 420, boxShadow: "0 8px 32px rgba(0,0,0,0.25)", display: "flex", flexDirection: "column", maxHeight: "80vh" }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "16px 20px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
            <Forward size={16} /> Teruskan Pesan
          </div>
          <button onClick={onClose} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #9ca3af)", padding: 4 }}>
            <X size={16} />
          </button>
        </div>

        {/* Preview pesan yang diteruskan */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border, #e5e7eb)", fontSize: 12, color: "var(--text-secondary, #6b7280)" }}>
          <div style={{ background: "var(--bg, #f8fafc)", borderRadius: 8, padding: "8px 12px", borderLeft: "3px solid var(--primary, #2563eb)" }}>
            {messageToForward.content || (messageToForward.mediaType ? `[${messageToForward.mediaType}]` : "Pesan")}
          </div>
        </div>

        {/* Search */}
        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border, #e5e7eb)" }}>
          <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Cari percakapan..."
            style={{ width: "100%", boxSizing: "border-box", padding: "8px 12px", border: "1px solid var(--border, #e5e7eb)", borderRadius: 8, fontSize: 13, outline: "none", fontFamily: "inherit" }}
          />
        </div>

        {/* Daftar percakapan */}
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && <p style={{ padding: 20, textAlign: "center", color: "var(--text-muted, #9ca3af)", fontSize: 13 }}>Memuat...</p>}
          {!loading && filtered.length === 0 && <p style={{ padding: 20, textAlign: "center", color: "var(--text-muted, #9ca3af)", fontSize: 13 }}>Tidak ditemukan</p>}
          {filtered.map((c) => {
            const name = c.customer?.name || c.customer?.phone || "Pelanggan";
            return (
              <button
                key={c.id}
                onClick={() => handleForward(c.id)}
                disabled={forwarding}
                style={{
                  width: "100%", display: "flex", alignItems: "center", gap: 12,
                  padding: "10px 20px", background: "none", border: "none",
                  borderBottom: "1px solid var(--border, #e5e7eb)",
                  cursor: forwarding ? "not-allowed" : "pointer",
                  textAlign: "left",
                }}
              >
                <Avatar name={name} src={c.customer?.profilePictureUrl} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                  {c.customer?.phone && (
                    <div style={{ fontSize: 11, color: "var(--text-muted, #9ca3af)" }}>{c.customer.phone}</div>
                  )}
                </div>
                <Forward size={13} style={{ color: "var(--primary, #2563eb)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Preview file yang dipilih sebelum kirim ────────────────────────────────
function FilePreview({ pending, caption, onCaption, onSend, onCancel, sending }) {
  return (
    <div className="file-preview-area">
      <div className="file-preview-inner">
        {pending.mediaType === "image" && (
          <img src={pending.preview} alt="Preview" className="preview-img" />
        )}
        {pending.mediaType === "video" && (
          <video src={pending.preview} controls className="preview-video" />
        )}
        {pending.mediaType === "audio" && (
          <audio src={pending.preview} controls className="preview-audio" />
        )}
        {pending.mediaType === "document" && (
          <div className="preview-doc">
            <FileText size={28} />
            <span>{pending.file.name}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>
              {(pending.file.size / 1024).toFixed(0)} KB
            </span>
          </div>
        )}
        <button onClick={onCancel} className="preview-close"><X size={14} /></button>
      </div>
      <div className="file-preview-footer">
        <input
          value={caption}
          onChange={(e) => onCaption(e.target.value)}
          placeholder="Tambah caption (opsional)..."
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && onSend()}
          className="caption-input"
        />
        <button onClick={onSend} disabled={sending} className="btn btn-primary btn-sm">
          {sending ? "Mengirim..." : "Kirim"}
        </button>
      </div>
    </div>
  );
}

// ── Main ChatWindow ───────────────────────────────────────────────────────────
export default function ChatWindow({ conversation, user, onConversationUpdated, onBack, panelCollapsed, onTogglePanel }) {
  const [messages, setMessages]           = useState([]);
  const [draft, setDraft]                 = useState("");
  const [sending, setSending]             = useState(false);
  const [convStatus, setConvStatus]       = useState(conversation?.status || "OPEN");
  const [resolving, setResolving]         = useState(false);
  const [showTemplates, setShowTemplates]         = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [takingOver, setTakingOver]               = useState(false);
  const [showCustomerDetail, setShowCustomerDetail] = useState(false);
  const [showAttachSheet, setShowAttachSheet]     = useState(false);
  const [showDotMenu, setShowDotMenu]             = useState(false);
  const [showEmoji, setShowEmoji]                 = useState(false);

  // Pencarian dalam percakapan
  const [showSearch, setShowSearch]   = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchIndex, setSearchIndex] = useState(0);
  const [highlightedId, setHighlightedId] = useState(null);
  const messageRefs   = useRef({});
  const highlightTimerRef = useRef(null);

  // Context Banner (handover)
  const [bannerCollapsed, setBannerCollapsed] = useState(false);
  const [draftLoading, setDraftLoading]       = useState(false);

  // Reply (quote) state
  const [replyingTo, setReplyingTo] = useState(null); // pesan yang sedang dibalas
  // Forward state
  const [forwardMsg, setForwardMsg] = useState(null); // pesan yang sedang diteruskan
  const [showForwardModal, setShowForwardModal] = useState(false);

  // Media attachment state
  const [pendingFile, setPendingFile]     = useState(null); // { file, preview, mediaType, sendAs }
  const [caption, setCaption]             = useState("");
  const [dragOver, setDragOver]           = useState(false); // drag-drop indicator
  const textareaRef                       = useRef(null); // input teks

  // Voice recording state
  const [recording, setRecording]         = useState(false);
  const [recSeconds, setRecSeconds]       = useState(0);
  const recorderRef                       = useRef(null);
  const chunksRef                         = useRef([]);
  const timerRef                          = useRef(null);

  const bottomRef    = useRef(null);
  const loadMsgRef   = useRef(null); // selalu pegang versi load() terbaru untuk SSE callback

  // SSE: refresh pesan saat ada pesan masuk di conversation ini
  useSSE("new_message", (data) => {
    if (data.conversationId === conversation?.id) {
      loadMsgRef.current?.();
    }
  });

  useEffect(() => {
    if (!conversation) return;
    setConvStatus(conversation.status || "OPEN");
    setShowTemplates(false);
    setShowProductPicker(false);
    setPendingFile(null);
    setDraft("");
    setBannerCollapsed(false);
    setReplyingTo(null);
    setForwardMsg(null);
    setShowForwardModal(false);
    setShowSearch(false);
    setSearchQuery("");
    setShowEmoji(false);
    messageRefs.current = {};

    let interval;
    async function load() {
      const data = await api.getMessages(conversation.id);
      setMessages(data);
    }
    loadMsgRef.current = load; // update ref supaya SSE callback pakai versi terbaru
    load();
    // SSE sebagai trigger utama — polling 60s hanya sebagai fallback
    interval = setInterval(load, 60000);
    return () => clearInterval(interval);
  }, [conversation?.id]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Reset tinggi textarea saat draft dikosongkan (misal setelah kirim)
  useEffect(() => {
    if (!draft && textareaRef.current) {
      textareaRef.current.style.height = "auto";
    }
  }, [draft]);

  function autoGrowTextarea(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleTextareaKeyDown(e) {
    const isMobile = window.innerWidth < 768;
    if (e.key === "Enter") {
      if (isMobile) return; // di mobile: Enter = baris baru (default browser)
      if (!e.shiftKey) {
        e.preventDefault();
        handleSend();
      }
      // Shift+Enter → baris baru (default browser)
    }
  }

  // ── Kirim teks ──
  async function handleSend(e) {
    e?.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      // Kalau sedang reply, kirim dengan quotedMessageId (externalId di WAHA) + replyToId (DB id)
      const msg = await api.sendMessage(
        conversation.id,
        draft,
        replyingTo?.externalId || null,
        replyingTo?.id || null,
      );
      setMessages((p) => [...p, msg]);
      setDraft("");
      setReplyingTo(null); // hapus reply strip setelah kirim
      setBannerCollapsed(true);
    } catch (err) { alert(err.message); }
    finally { setSending(false); }
  }

  // ── Draft balasan (Context Banner) ──
  async function handleGenerateDraft() {
    setDraftLoading(true);
    try {
      const history = messages
        .map((m) => ({ role: m.direction === "INBOUND" ? "user" : "assistant", content: m.content || "" }))
        .filter((m) => m.content);
      const res = await api.generateDraftReply(history, conversation.handoverNote);
      if (res.draft) {
        setDraft(res.draft);
        setTimeout(() => textareaRef.current?.focus(), 50);
      }
    } catch (err) {
      alert("Gagal generate draft: " + err.message);
    } finally {
      setDraftLoading(false);
    }
  }

  // ── Buka preview file (dari input, paste, atau drag-drop) ──
  function openFilePreview(file, sendAs) {
    const mime = file.type || "";
    let mediaType = "document";
    let preview   = null;
    if (mime.startsWith("image/")) { mediaType = "image"; preview = URL.createObjectURL(file); }
    if (mime.startsWith("video/")) { mediaType = "video"; preview = URL.createObjectURL(file); }
    if (mime.startsWith("audio/")) { mediaType = "audio"; preview = URL.createObjectURL(file); }
    const finalSendAs = sendAs || (mediaType === "document" ? "document" : "media");
    setPendingFile({ file, preview, mediaType, sendAs: finalSendAs });
  }

  // ── Pilih file dari input ──
  function handleFileSelect(e, sendAs = "media") {
    const file = e.target.files?.[0];
    if (!file) return;
    openFilePreview(file, sendAs);
    e.target.value = "";
  }

  // ── Paste gambar dari clipboard (Ctrl+V / long-press paste) ──
  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItem = items.find(item => item.kind === "file");
    if (!fileItem) return; // teks biasa, biarkan default
    e.preventDefault();
    const file = fileItem.getAsFile();
    if (file) openFilePreview(file);
  }

  // ── Drag-drop file ke area input ──
  function handleDragOver(e) {
    e.preventDefault();
    setDragOver(true);
  }

  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) openFilePreview(file);
  }

  // ── Kirim media / attachment ──
  async function handleSendMedia() {
    if (!pendingFile) return;
    const fd = new FormData();
    fd.append("file", pendingFile.file);
    fd.append("sendAs", pendingFile.sendAs || "media");
    if (caption.trim()) fd.append("caption", caption.trim());
    setSending(true);
    try {
      const msg = await api.sendMedia(conversation.id, fd);
      setMessages((p) => [...p, msg]);
      setPendingFile(null);
      setCaption("");
    } catch (err) { alert(err.message); }
    finally { setSending(false); }
  }

  // ── Rekam suara ──
  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime   = MediaRecorder.isTypeSupported("audio/webm;codecs=opus")
        ? "audio/webm;codecs=opus" : "audio/webm";
      const rec    = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const ext  = mime.includes("webm") ? "webm" : "ogg";
        const fd   = new FormData();
        fd.append("file", blob, `voice-${Date.now()}.${ext}`);
        setSending(true);
        try {
          const msg = await api.sendMedia(conversation.id, fd);
          setMessages((p) => [...p, msg]);
        } catch (err) { alert(err.message); }
        finally { setSending(false); }
      };
      rec.start(100);
      recorderRef.current = rec;
      setRecording(true);
      setRecSeconds(0);
      timerRef.current = setInterval(() => setRecSeconds((s) => s + 1), 1000);
    } catch (err) {
      alert("Tidak bisa akses mikrofon: " + err.message);
    }
  }

  function stopRecording() {
    clearInterval(timerRef.current);
    recorderRef.current?.stop();
    setRecording(false);
  }

  function cancelRecording() {
    clearInterval(timerRef.current);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = null;
      recorderRef.current.stop();
    }
    setRecording(false);
    setRecSeconds(0);
  }

  async function handleStatusChange(newStatus) {
    try {
      const updated = await api.updateConversation(conversation.id, { status: newStatus });
      setConvStatus(updated.status);
      onConversationUpdated?.(updated);
    } catch (err) { alert(err.message); }
  }

  async function handleResolve() {
    if (convStatus === "RESOLVED") return;
    setResolving(true);
    try {
      const updated = await api.updateConversation(conversation.id, { status: "RESOLVED" });
      setConvStatus("RESOLVED");
      onConversationUpdated?.(updated);
    } catch (err) { alert(err.message); }
    finally { setResolving(false); }
  }

  async function handleTakeover() {
    if (!confirm("Ambil alih percakapan ini sebagai lead kamu?")) return;
    setTakingOver(true);
    try {
      const updated = await api.takeoverConversation(conversation.id);
      onConversationUpdated?.(updated);
    } catch (err) { alert(err.message); }
    finally { setTakingOver(false); }
  }

  // ── Referensi elemen pesan (untuk scroll + highlight) ──
  function registerMessageRef(id, el) {
    if (el) messageRefs.current[id] = el;
    else delete messageRefs.current[id];
  }

  function scrollToMessage(id) {
    const el = messageRefs.current[id];
    if (!el) return;
    el.scrollIntoView({ behavior: "smooth", block: "center" });
    setHighlightedId(id);
    clearTimeout(highlightTimerRef.current);
    highlightTimerRef.current = setTimeout(() => setHighlightedId(null), 1600);
  }

  // ── Pencarian dalam percakapan ──
  const searchResults = searchQuery.trim()
    ? messages.filter((m) => (m.content || "").toLowerCase().includes(searchQuery.trim().toLowerCase()))
    : [];

  useEffect(() => { setSearchIndex(0); }, [searchQuery]);

  useEffect(() => {
    if (searchResults.length) scrollToMessage(searchResults[searchIndex]?.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [searchIndex, searchQuery]);

  function goSearch(dir) {
    if (!searchResults.length) return;
    setSearchIndex((i) => (i + dir + searchResults.length) % searchResults.length);
  }

  function closeSearch() {
    setShowSearch(false);
    setSearchQuery("");
    setSearchIndex(0);
  }

  // ── Sisipkan emoji di posisi kursor textarea ──
  function insertEmoji(emoji) {
    const el = textareaRef.current;
    if (!el) { setDraft((d) => d + emoji); return; }
    const start = el.selectionStart ?? draft.length;
    const end   = el.selectionEnd ?? draft.length;
    const next  = draft.slice(0, start) + emoji + draft.slice(end);
    setDraft(next);
    setTimeout(() => {
      el.focus();
      el.selectionStart = el.selectionEnd = start + emoji.length;
      autoGrowTextarea(el);
    }, 0);
  }

  if (!conversation) {
    return (
      <div className="chat-window empty-state">
        <MessageSquare size={40} className="chat-empty-icon" />
        <span>Pilih percakapan di sebelah kiri</span>
      </div>
    );
  }

  const rawPhone     = conversation.customer?.phone;
  const name         = conversation.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null)
    || conversation.customer?.instagramHandle || "Pelanggan";
  const channelClass  = conversation.channel?.toLowerCase();
  const channelLabel  = conversation.channel === "WHATSAPP" ? "WhatsApp" : "Instagram";
  const assignedTo    = conversation.assignedTo;
  const isMine        = assignedTo?.id === user?.id;
  const isAdmin       = user?.role === "ADMIN";

  // Eligibilitas takeover — pakai nilai yang sudah dihitung di backend
  const canTakeover  = conversation.canTakeOver ?? false;
  const isRead       = !!conversation.isRead;
  const isReplied    = !conversation.isUnanswered;

  const formatRec = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="chat-window">
      {/* ── Header ── */}
      <div className="chat-header">
        {/* Back button (hanya tampil di mobile) */}
        <button className="chat-back-btn" onClick={onBack} title="Kembali ke daftar">
          <ArrowLeft size={18} />
        </button>
        <Avatar name={name} src={conversation.customer?.profilePictureUrl} size="sm" />
        <div className="chat-header-info" style={{ flex: 1, minWidth: 0 }}>
          <p className="chat-header-name">{name}</p>
          <div className="chat-header-meta">
            <span className={`channel-badge ${channelClass}`}>{channelLabel}</span>
            {/* Badge "Sudah Dibuka" — saat isRead true tapi belum dibalas */}
            {isRead && !isReplied && (
              <span title="Sudah dibuka tapi belum dibalas" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "#ede9fe", color: "#5b21b6", flexShrink: 0 }}>
                <Eye size={10} /> Dibuka
              </span>
            )}
            {/* Badge "Sudah Dibalas" */}
            {isReplied && (
              <span title="Sudah dibalas" style={{ display: "inline-flex", alignItems: "center", gap: 3, fontSize: 10, fontWeight: 600, padding: "2px 6px", borderRadius: 6, background: "#dcfce7", color: "#166534", flexShrink: 0 }}>
                <CheckCheck size={10} /> Dibalas
              </span>
            )}
            {/* Info tambahan — disembunyikan di mobile supaya tidak overflow */}
            <span className="chat-meta-desktop">
              {rawPhone && (
                <a href={`tel:+${rawPhone}`} className="phone-link" title="Telepon via dialer">
                  <Phone size={12} /> {formatPhoneDisplay(rawPhone)}
                </a>
              )}
              {isMine ? (
                <span className="lead-badge mine"><UserCheck size={11} /> Lead Kamu</span>
              ) : assignedTo ? (
                <span className="lead-badge other"><Users size={11} /> {assignedTo.name}</span>
              ) : null}
            </span>
          </div>
        </div>

        {/* Desktop-only: tombol ⓘ, Ambil Alih, status, Selesaikan */}
        <div className="chat-header-desktop-actions">
          <button className="chat-action-btn" onClick={() => setShowSearch((v) => !v)} title="Cari dalam percakapan">
            <Search size={17} />
          </button>
          <button className="chat-info-btn" onClick={() => setShowCustomerDetail(true)} title="Info Pelanggan">
            <Info size={18} />
          </button>
          {onTogglePanel && (
            <button className="chat-action-btn" onClick={onTogglePanel}
              title={panelCollapsed ? "Tampilkan panel pelanggan" : "Sembunyikan panel pelanggan"}>
              {panelCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
            </button>
          )}
          {/* Tombol Ambil Alih/Percakapan — tersembunyi kalau sudah milik kita */}
          {!isMine && (
            !assignedTo ? (
              <button className="btn btn-secondary btn-sm" onClick={handleTakeover}
                disabled={takingOver} title="Ambil percakapan ini sebagai lead kamu" style={{ flexShrink: 0 }}>
                <UserCheck size={13} />
                {takingOver ? "..." : "Ambil Percakapan"}
              </button>
            ) : canTakeover ? (
              <button className="btn btn-secondary btn-sm" onClick={handleTakeover}
                disabled={takingOver} title="Percakapan belum dibalas ≥1 jam — bisa diambil alih" style={{ flexShrink: 0 }}>
                <UserCheck size={13} />
                {takingOver ? "..." : "Ambil Alih (belum dibalas 1j+)"}
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled
                title={`Masih ditangani ${assignedTo.name} — belum bisa diambil alih`}
                style={{ flexShrink: 0, opacity: 0.5, cursor: "not-allowed" }}>
                <UserCheck size={13} />
                {assignedTo.name}
              </button>
            )
          )}
          <select value={convStatus} onChange={(e) => handleStatusChange(e.target.value)}
            className="status-select" style={{ flexShrink: 0 }}>
            {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
          {convStatus !== "RESOLVED" && (
            <button className="btn btn-primary btn-sm" onClick={handleResolve} disabled={resolving}
              style={{ gap: 4, display: "flex", alignItems: "center", flexShrink: 0 }}>
              <CheckCircle size={13} />
              <span className="resolve-label">{resolving ? "..." : "Selesaikan"}</span>
            </button>
          )}
        </div>

        {/* Mobile-only: tombol ⋯ dengan dropdown aksi */}
        <div className="chat-dots-container">
          <button className="chat-action-btn chat-dots-btn"
            onClick={() => setShowDotMenu((v) => !v)} title="Menu">
            <MoreVertical size={18} />
          </button>
          {showDotMenu && (
            <>
              <div className="chat-dots-backdrop" onClick={() => setShowDotMenu(false)} />
              <div className="chat-dots-dropdown">
                <button onClick={() => { setShowSearch(true); setShowDotMenu(false); }}>
                  <Search size={14} /> Cari Pesan
                </button>
                <button onClick={() => { setShowCustomerDetail(true); setShowDotMenu(false); }}>
                  <Info size={14} /> Info Pelanggan
                </button>
                {convStatus !== "RESOLVED" && (
                  <button onClick={() => { handleResolve(); setShowDotMenu(false); }}>
                    <CheckCircle size={14} /> Tandai Selesai
                  </button>
                )}
                <button onClick={() => { handleStatusChange("PENDING"); setShowDotMenu(false); }}>
                  <MessageSquare size={14} /> Tandai Pending
                </button>
                {!isMine && !assignedTo && (
                  <button onClick={() => { handleTakeover(); setShowDotMenu(false); }}>
                    <UserCheck size={14} /> Ambil Percakapan
                  </button>
                )}
                {!isMine && assignedTo && canTakeover && (
                  <button onClick={() => { handleTakeover(); setShowDotMenu(false); }}>
                    <UserCheck size={14} /> Ambil Alih (belum dibalas 1j+)
                  </button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Search dalam percakapan ── */}
      {showSearch && (
        <div className="chat-search-bar">
          <Search size={14} className="chat-search-icon" />
          <input
            autoFocus
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Cari pesan dalam percakapan..."
            className="chat-search-input"
          />
          {searchQuery.trim() && (
            <span className="chat-search-count">
              {searchResults.length ? `${searchIndex + 1}/${searchResults.length}` : "0/0"}
            </span>
          )}
          <button type="button" className="chat-action-btn" onClick={() => goSearch(-1)} disabled={!searchResults.length} title="Sebelumnya">
            <ChevronUp size={16} />
          </button>
          <button type="button" className="chat-action-btn" onClick={() => goSearch(1)} disabled={!searchResults.length} title="Berikutnya">
            <ChevronDown size={16} />
          </button>
          <button type="button" className="chat-action-btn" onClick={closeSearch} title="Tutup pencarian">
            <X size={16} />
          </button>
        </div>
      )}

      {/* ── Context Banner (handover note) ── */}
      {conversation?.handoverNote && (
        <div style={{ background: "#fffbeb", borderBottom: "1px solid #fde68a", flexShrink: 0 }}>
          <div
            style={{
              display: "flex", alignItems: "center", justifyContent: "space-between",
              padding: bannerCollapsed ? "8px 14px" : "8px 14px 4px", cursor: "pointer",
            }}
            onClick={() => setBannerCollapsed((v) => !v)}
          >
            <span style={{ fontSize: 12, fontWeight: 700, color: "#92400e" }}>
              📋 Ringkasan sebelum kamu lanjutkan
            </span>
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              {!bannerCollapsed && (
                <button
                  onClick={(e) => { e.stopPropagation(); handleGenerateDraft(); }}
                  disabled={draftLoading}
                  style={{
                    fontSize: 11, padding: "2px 8px", borderRadius: 6,
                    background: "#7c3aed", color: "#fff", border: "none",
                    cursor: draftLoading ? "not-allowed" : "pointer",
                    opacity: draftLoading ? 0.6 : 1,
                  }}
                >
                  {draftLoading ? "..." : "✨ Draft balasan"}
                </button>
              )}
              <span style={{ fontSize: 11, color: "#92400e" }}>
                {bannerCollapsed ? "Tampilkan ▼" : "Sembunyikan ▲"}
              </span>
            </div>
          </div>
          {!bannerCollapsed && (
            <div style={{
              padding: "0 14px 10px", fontSize: 12, color: "#78350f",
              whiteSpace: "pre-wrap", lineHeight: 1.6,
              maxHeight: 140, overflowY: "auto",
            }}>
              {conversation.handoverNote}
            </div>
          )}
        </div>
      )}

      {/* ── Pesan ── */}
      <div className="chat-messages">
        {messages.map((m) => (
          <MediaBubble
            key={m.id}
            m={m}
            onReply={(msg) => { setReplyingTo(msg); textareaRef.current?.focus(); }}
            onForward={(msg) => { setForwardMsg(msg); setShowForwardModal(true); }}
            onJumpTo={scrollToMessage}
            registerRef={registerMessageRef}
            highlighted={highlightedId === m.id}
            searchMatch={showSearch && searchResults[searchIndex]?.id === m.id}
          />
        ))}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      {conversation.type === "GROUP" ? (
        <div className="chat-input-area" style={{ justifyContent: "center", padding: "12px 16px" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            Percakapan grup — tidak bisa dibalas dari CRM
          </span>
        </div>
      ) : (
      <div
        className={`chat-input-area${dragOver ? " drag-active" : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={() => setDragOver(false)}
        onDrop={handleDrop}
      >
        {dragOver && (
          <div className="chat-drop-zone">
            <span>Drop file di sini untuk melampirkan</span>
          </div>
        )}
        {/* File preview */}
        {pendingFile && (
          <FilePreview
            pending={pendingFile}
            caption={caption}
            onCaption={setCaption}
            onSend={handleSendMedia}
            onCancel={() => { setPendingFile(null); setCaption(""); }}
            sending={sending}
          />
        )}

        {/* Template picker popup */}
        {showTemplates && (
          <TemplatePicker
            customer={conversation.customer}
            onSelect={(text) => { setDraft(text); setShowTemplates(false); }}
            onClose={() => setShowTemplates(false)}
          />
        )}

        {/* Product picker modal */}
        {showProductPicker && (
          <ProductPicker
            conversation={conversation}
            onClose={() => setShowProductPicker(false)}
            onSent={(msgs) => { setMessages((p) => [...p, ...msgs]); setShowProductPicker(false); }}
          />
        )}

        {/* Reply strip — tampil saat membalas pesan tertentu */}
        {replyingTo && (
          <div style={{
            display: "flex", alignItems: "center", gap: 10,
            padding: "8px 14px", borderTop: "1px solid var(--border, #e5e7eb)",
            background: "var(--bg, #f8fafc)",
          }}>
            <div style={{ width: 3, alignSelf: "stretch", background: "var(--primary, #2563eb)", borderRadius: 4, flexShrink: 0 }} />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: "var(--primary, #2563eb)", marginBottom: 2 }}>
                Membalas {replyingTo.direction === "OUTBOUND" ? "pesan kamu" : "pelanggan"}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-secondary, #6b7280)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {replyingTo.content || (replyingTo.mediaType ? `[${replyingTo.mediaType}]` : "Pesan")}
              </div>
            </div>
            <button onClick={() => setReplyingTo(null)} style={{ background: "none", border: "none", cursor: "pointer", color: "var(--text-muted, #9ca3af)", padding: 4, flexShrink: 0 }}>
              <X size={14} />
            </button>
          </div>
        )}

        {/* Voice recording bar */}
        {recording ? (
          <div className="recording-bar">
            <span className="rec-dot" />
            <span className="rec-time">{formatRec(recSeconds)}</span>
            <button onClick={cancelRecording} className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }}>
              <X size={13} /> Batal
            </button>
            <button onClick={stopRecording} className="btn btn-primary btn-sm">
              <MicOff size={13} /> Kirim
            </button>
          </div>
        ) : !pendingFile && (
          <form className="chat-input" onSubmit={handleSend}>
            {/* Template */}
            <button type="button" onClick={() => setShowTemplates((v) => !v)}
              className={`chat-action-btn ${showTemplates ? "active" : ""}`} title="Pilih template">
              <MessageSquare size={15} />
            </button>

            {/* Tombol + lampiran (foto, dokumen, produk) — buka bottom sheet */}
            <button type="button" onClick={() => setShowAttachSheet((v) => !v)}
              className={`chat-action-btn ${showAttachSheet ? "active" : ""}`} title="Lampiran">
              <Plus size={16} />
            </button>

            {/* Emoji */}
            <div style={{ position: "relative" }}>
              <button type="button" onClick={() => setShowEmoji((v) => !v)}
                className={`chat-action-btn ${showEmoji ? "active" : ""}`} title="Emoji">
                <Smile size={16} />
              </button>
              {showEmoji && (
                <EmojiPicker onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />
              )}
            </div>

            {/* Textarea auto-grow — onPaste untuk handle paste gambar dari clipboard */}
            <textarea
              ref={textareaRef}
              value={draft}
              rows={1}
              className="chat-textarea"
              placeholder="Tulis balasan..."
              onChange={(e) => { setDraft(e.target.value); autoGrowTextarea(e.target); }}
              onKeyDown={handleTextareaKeyDown}
              onPaste={handlePaste}
            />

            {/* Rekam suara */}
            <button type="button" onClick={startRecording}
              className="chat-action-btn" title="Rekam pesan suara">
              <Mic size={15} />
            </button>

            <button type="submit" className="chat-send-btn" disabled={sending}>
              <Send size={16} />
            </button>
          </form>
        )}
      </div>
      )} {/* tutup kondisional type !== GROUP */}

      {/* ── Attach Sheet (bottom sheet gaya WhatsApp — grid 2×3) ── */}
      {showAttachSheet && (
        <div className="attach-sheet-overlay" onClick={() => setShowAttachSheet(false)}>
          <div className="attach-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="attach-sheet-handle" />
            <div className="attach-grid-title">Lampirkan</div>
            <div className="attach-grid">

              {/* Foto — accept image/* saja: Samsung langsung buka Gallery tanpa source chooser */}
              <label className="attach-item">
                <input type="file" accept="image/*" style={{ display: "none" }}
                  onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#dbeafe" }}>
                  <ImageIcon size={24} style={{ color: "#2563eb" }} />
                </div>
                <span className="attach-item-label">Foto</span>
              </label>

              {/* Video — accept video/* saja: Samsung langsung buka galeri video */}
              <label className="attach-item">
                <input type="file" accept="video/*" style={{ display: "none" }}
                  onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#e0f2fe" }}>
                  <Video size={24} style={{ color: "#0284c7" }} />
                </div>
                <span className="attach-item-label">Video</span>
              </label>

              {/* Kamera — langsung buka kamera */}
              <label className="attach-item">
                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }}
                  onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#dcfce7" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/>
                    <circle cx="12" cy="13" r="4"/>
                  </svg>
                </div>
                <span className="attach-item-label">Kamera</span>
              </label>

              {/* Dokumen — jenis file yang umum dipakai */}
              <label className="attach-item">
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv" style={{ display: "none" }}
                  onChange={(e) => { handleFileSelect(e, "document"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#fef9c3" }}>
                  <FileText size={24} style={{ color: "#ca8a04" }} />
                </div>
                <span className="attach-item-label">Dokumen</span>
              </label>

              {/* Audio — file audio; OGG → voice note, lainnya → file */}
              <label className="attach-item">
                <input type="file" accept="audio/*" style={{ display: "none" }}
                  onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#fce7f3" }}>
                  <Mic size={24} style={{ color: "#db2777" }} />
                </div>
                <span className="attach-item-label">Audio</span>
              </label>

              {/* Produk — buka galeri produk CRM */}
              <button className="attach-item" onClick={() => { setShowProductPicker(true); setShowAttachSheet(false); }}>
                <div className="attach-item-icon" style={{ background: "#ede9fe" }}>
                  <Package size={24} style={{ color: "#7c3aed" }} />
                </div>
                <span className="attach-item-label">Produk</span>
              </button>

            </div>
          </div>
        </div>
      )}

      {/* ── CustomerPanel Bottom Sheet (mobile only, via CSS) ── */}
      {showCustomerDetail && (
        <div className="mobile-bottom-sheet-overlay" onClick={() => setShowCustomerDetail(false)}>
          <div className="mobile-bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-handle" />
            <CustomerPanel customerId={conversation?.customer?.id} conversation={conversation} />
          </div>
        </div>
      )}

      {/* ── Forward Modal ── */}
      {showForwardModal && forwardMsg && (
        <ForwardModal
          messageToForward={forwardMsg}
          onClose={() => { setShowForwardModal(false); setForwardMsg(null); }}
          onForwarded={() => {
            // Tidak perlu refresh — pesan diteruskan ke percakapan LAIN
          }}
        />
      )}
    </div>
  );
}
