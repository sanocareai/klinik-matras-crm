import React, { useEffect, useRef, useState } from "react";
import {
  Send, MessageSquare, CheckCircle, ChevronDown, X,
  Paperclip, Mic, MicOff, FileText, Phone, Image as ImageIcon, Video,
} from "lucide-react";
import { api } from "../api.js";
import Avatar from "./Avatar.jsx";
import { formatWaktu, formatPhoneDisplay } from "../utils/format.js";

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

// ── Media Bubble ──────────────────────────────────────────────────────────────
function MediaBubble({ m }) {
  const hasMedia = !!m.mediaType;
  const hasText  = !!m.content;

  return (
    <div className={`bubble ${m.direction === "OUTBOUND" ? "out" : "in"}`}>
      {m.mediaType === "image" && m.mediaUrl && (
        <img
          src={m.mediaUrl}
          alt="Foto"
          className="bubble-img"
          onClick={() => window.open(m.mediaUrl, "_blank")}
        />
      )}
      {m.mediaType === "video" && m.mediaUrl && (
        <video src={m.mediaUrl} controls className="bubble-video" />
      )}
      {m.mediaType === "audio" && m.mediaUrl && (
        <audio src={m.mediaUrl} controls className="bubble-audio" />
      )}
      {m.mediaType === "document" && m.mediaUrl && (
        <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="bubble-doc">
          <FileText size={18} style={{ flexShrink: 0 }} />
          <span className="bubble-doc-name">{m.mediaUrl.split("/").pop()}</span>
        </a>
      )}
      {/* Kalau hasMedia true tapi mediaUrl belum ada (pending download) */}
      {hasMedia && !m.mediaUrl && (
        <div className="bubble-media-placeholder">
          {m.mediaType === "image" && <><ImageIcon size={16} /> Foto</>}
          {m.mediaType === "video" && <><Video size={16} /> Video</>}
          {m.mediaType === "audio" && <><Mic size={16} /> Pesan Suara</>}
          {m.mediaType === "document" && <><FileText size={16} /> Dokumen</>}
        </div>
      )}
      {hasText && <span className="bubble-text">{m.content}</span>}
      <span className="bubble-time">{formatWaktu(m.createdAt)}</span>
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
export default function ChatWindow({ conversation, onConversationUpdated }) {
  const [messages, setMessages]           = useState([]);
  const [draft, setDraft]                 = useState("");
  const [sending, setSending]             = useState(false);
  const [convStatus, setConvStatus]       = useState(conversation?.status || "OPEN");
  const [resolving, setResolving]         = useState(false);
  const [showTemplates, setShowTemplates] = useState(false);

  // Media attachment state
  const [pendingFile, setPendingFile]     = useState(null); // { file, preview, mediaType }
  const [caption, setCaption]             = useState("");
  const fileInputRef                      = useRef(null);

  // Voice recording state
  const [recording, setRecording]         = useState(false);
  const [recSeconds, setRecSeconds]       = useState(0);
  const recorderRef                       = useRef(null);
  const chunksRef                         = useRef([]);
  const timerRef                          = useRef(null);

  const bottomRef = useRef(null);

  useEffect(() => {
    if (!conversation) return;
    setConvStatus(conversation.status || "OPEN");
    setShowTemplates(false);
    setPendingFile(null);
    setDraft("");

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

  // ── Kirim teks ──
  async function handleSend(e) {
    e?.preventDefault();
    if (!draft.trim()) return;
    setSending(true);
    try {
      const msg = await api.sendMessage(conversation.id, draft);
      setMessages((p) => [...p, msg]);
      setDraft("");
    } catch (err) { alert(err.message); }
    finally { setSending(false); }
  }

  // ── Pilih file ──
  function handleFileSelect(e) {
    const file = e.target.files?.[0];
    if (!file) return;
    const mime = file.type;
    let mediaType = "document";
    let preview   = null;
    if (mime.startsWith("image/"))  { mediaType = "image";    preview = URL.createObjectURL(file); }
    if (mime.startsWith("video/"))  { mediaType = "video";    preview = URL.createObjectURL(file); }
    if (mime.startsWith("audio/"))  { mediaType = "audio";    preview = URL.createObjectURL(file); }
    setPendingFile({ file, preview, mediaType });
    e.target.value = "";
  }

  // ── Kirim media / attachment ──
  async function handleSendMedia() {
    if (!pendingFile) return;
    const fd = new FormData();
    fd.append("file", pendingFile.file);
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

  if (!conversation) {
    return (
      <div className="chat-window empty-state">
        <MessageSquare size={40} className="chat-empty-icon" />
        <span>Pilih percakapan di sebelah kiri</span>
      </div>
    );
  }

  const rawPhone    = conversation.customer?.phone;
  const name        = conversation.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null)
    || conversation.customer?.instagramHandle || "Pelanggan";
  const channelClass = conversation.channel?.toLowerCase();
  const channelLabel = conversation.channel === "WHATSAPP" ? "WhatsApp" : "Instagram";

  const formatRec = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="chat-window">
      {/* ── Header ── */}
      <div className="chat-header">
        <Avatar name={name} size="sm" />
        <div className="chat-header-info" style={{ flex: 1 }}>
          <p className="chat-header-name">{name}</p>
          <div className="chat-header-meta">
            <span className={`channel-badge ${channelClass}`}>{channelLabel}</span>
            {rawPhone && (
              <a href={`tel:+${rawPhone}`} className="phone-link" title="Telepon via dialer">
                <Phone size={12} /> {formatPhoneDisplay(rawPhone)}
              </a>
            )}
          </div>
        </div>
        <select value={convStatus} onChange={(e) => handleStatusChange(e.target.value)}
          style={{ fontSize: 12, padding: "4px 8px", borderRadius: 6, border: "1px solid var(--border)", marginRight: 8 }}>
          {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
        {convStatus !== "RESOLVED" && (
          <button className="btn btn-primary btn-sm" onClick={handleResolve} disabled={resolving}
            style={{ gap: 4, display: "flex", alignItems: "center" }}>
            <CheckCircle size={13} />
            {resolving ? "..." : "Selesaikan"}
          </button>
        )}
      </div>

      {/* ── Pesan ── */}
      <div className="chat-messages">
        {messages.map((m) => <MediaBubble key={m.id} m={m} />)}
        <div ref={bottomRef} />
      </div>

      {/* ── Input area ── */}
      <div className="chat-input-area">
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

            {/* Lampiran file */}
            <button type="button" onClick={() => fileInputRef.current?.click()}
              className="chat-action-btn" title="Lampirkan foto/video/dokumen">
              <Paperclip size={15} />
            </button>
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*,video/*,audio/*,.pdf,.doc,.docx,.xls,.xlsx"
              style={{ display: "none" }}
              onChange={handleFileSelect}
            />

            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              placeholder="Tulis balasan..."
              style={{ flex: 1 }}
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
    </div>
  );
}
