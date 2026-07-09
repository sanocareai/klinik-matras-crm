import React, { useEffect, useRef, useState } from "react";
import {
  Send, MessageSquare, CheckCircle, X,
  Mic, MicOff, FileText, Phone, Image as ImageIcon, Video, Package,
  ArrowLeft, UserCheck, Users, Info, Plus, MoreVertical,
  Reply, Forward, Smile, Search, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { api } from "../../../../api.js";
import Avatar from "../../../../components/Avatar.jsx";
import { formatPhoneDisplay } from "../../../../utils/format.js";
import { ProductPicker } from "../../../../components/ProductPicker.jsx";
import CustomerPanel from "../../../../components/CustomerPanel.jsx";
import MessageList from "./MessageList.jsx";
import InChatSearch from "./InChatSearch.jsx";
import { useMessages } from "../../hooks/useMessages.js";
import { useSendMessage } from "../../hooks/useSendMessage.js";
import { useMessageStore } from "../../stores/messageStore.js";
import { useConversationStore } from "../../stores/conversationStore.js";
import { useDraft, useReplyTarget, useComposerStore } from "../../stores/composerStore.js";

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

const EMOJI_LIST = [
  "😀","😁","😂","🤣","😊","😍","😘","😉","😎","🤔",
  "😅","😢","😭","😡","🙏","👍","👎","👏","🙌","💪",
  "❤️","🔥","✨","🎉","😴","🤗","😇","🥰","😋","🤝",
  "👋","✅","❌","⭐","💯","😐","😱","🙈","💤","☕",
];

// ── Template Picker ───────────────────────────────────────────────────────
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
                <button key={tpl.id} className="template-item" onClick={() => { onSelect(preview); onClose(); }}>
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

// ── Emoji Picker ───────────────────────────────────────────────────────────
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
          <button key={em} type="button" className="emoji-picker-item" onClick={() => onSelect(em)}>{em}</button>
        ))}
      </div>
    </div>
  );
}

// ── Forward Modal ────────────────────────────────────────────────────────
function ForwardModal({ messageToForward, onClose }) {
  const [convs, setConvs]           = useState([]);
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(true);
  const [forwarding, setForwarding] = useState(false);

  useEffect(() => {
    api.getConversations().then((data) => { setConvs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = convs.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.customer?.name?.toLowerCase().includes(q) || (c.customer?.phone || "").includes(q);
  });

  async function handleForward(targetConvId) {
    if (forwarding) return;
    setForwarding(true);
    try {
      await api.forwardMessage(messageToForward.conversationId, messageToForward.id, targetConvId);
      onClose();
    } catch (err) {
      alert("Gagal teruskan pesan: " + err.message);
    } finally {
      setForwarding(false);
    }
  }

  return (
    <div className="modal-overlay" onClick={onClose} style={{ zIndex: 1200 }}>
      <div className="modal-box" style={{ display: "flex", flexDirection: "column", maxHeight: "80vh" }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header" style={{ paddingBottom: 16, borderBottom: "1px solid var(--border)" }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8, fontWeight: 700, fontSize: 15 }}>
            <Forward size={16} /> Teruskan Pesan
          </div>
          <button onClick={onClose} className="modal-close"><X size={16} /></button>
        </div>
        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)", fontSize: 12, color: "var(--text-muted)" }}>
          <div style={{ background: "var(--bg-page)", borderRadius: 8, padding: "8px 12px", borderLeft: "3px solid var(--color-primary)" }}>
            {messageToForward.content || (messageToForward.mediaType ? `[${messageToForward.mediaType}]` : "Pesan")}
          </div>
        </div>
        <div style={{ padding: "10px 20px", borderBottom: "1px solid var(--border)" }}>
          <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari percakapan..."
            style={{ width: "100%", boxSizing: "border-box" }} />
        </div>
        <div style={{ overflowY: "auto", flex: 1 }}>
          {loading && <p style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Memuat...</p>}
          {!loading && filtered.length === 0 && <p style={{ padding: 20, textAlign: "center", color: "var(--text-muted)", fontSize: 13 }}>Tidak ditemukan</p>}
          {filtered.map((c) => {
            const name = c.customer?.name || c.customer?.phone || "Pelanggan";
            return (
              <button key={c.id} onClick={() => handleForward(c.id)} disabled={forwarding}
                style={{ width: "100%", display: "flex", alignItems: "center", gap: 12, padding: "10px 20px", background: "none", border: "none", borderBottom: "1px solid #f3f4f6", cursor: forwarding ? "not-allowed" : "pointer", textAlign: "left" }}>
                <Avatar name={name} src={c.customer?.profilePictureUrl} size="sm" />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{name}</div>
                  {c.customer?.phone && <div style={{ fontSize: 11, color: "var(--text-muted)" }}>{c.customer.phone}</div>}
                </div>
                <Forward size={13} style={{ color: "var(--color-primary)", flexShrink: 0 }} />
              </button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

// ── Preview file sebelum kirim ──────────────────────────────────────────
function FilePreview({ pending, caption, onCaption, onSend, onCancel, sending }) {
  return (
    <div className="file-preview-area">
      <div className="file-preview-inner">
        {pending.mediaType === "image" && <img src={pending.preview} alt="Preview" className="preview-img" />}
        {pending.mediaType === "video" && <video src={pending.preview} controls className="preview-video" />}
        {pending.mediaType === "audio" && <audio src={pending.preview} controls className="preview-audio" />}
        {pending.mediaType === "document" && (
          <div className="preview-doc">
            <FileText size={28} />
            <span>{pending.file.name}</span>
            <span style={{ fontSize: 11, color: "var(--text-muted)" }}>{(pending.file.size / 1024).toFixed(0)} KB</span>
          </div>
        )}
        <button onClick={onCancel} className="preview-close"><X size={14} /></button>
      </div>
      <div className="file-preview-footer">
        <input value={caption} onChange={(e) => onCaption(e.target.value)} placeholder="Tambah caption (opsional)..."
          onKeyDown={(e) => e.key === "Enter" && !e.shiftKey && onSend()} className="caption-input" />
        <button onClick={onSend} disabled={sending} className="btn btn-primary btn-sm">{sending ? "Mengirim..." : "Kirim"}</button>
      </div>
    </div>
  );
}

// ── Main ChatWindow (Fase C) ────────────────────────────────────────────
export default function ChatWindow({ conversation, user, onBack, panelCollapsed, onTogglePanel }) {
  const conversationId = conversation?.id;

  // Fetch + realtime + windowing pesan (lihat useMessages.js)
  useMessages(conversationId);
  const sendMutation = useSendMessage(conversationId);

  const draft       = useDraft(conversationId);
  const replyTarget = useReplyTarget();

  const [sendingMedia, setSendingMedia]           = useState(false);
  const [showTemplates, setShowTemplates]         = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [showEmoji, setShowEmoji]                 = useState(false);
  const [showSearch, setShowSearch]               = useState(false);
  const [takingOver, setTakingOver]               = useState(false);
  const [resolving, setResolving]                 = useState(false);
  const [showAttachSheet, setShowAttachSheet]     = useState(false);
  const [showDotMenu, setShowDotMenu]             = useState(false);
  const [forwardMsg, setForwardMsg]               = useState(null);
  const [showCustomerDetail, setShowCustomerDetail] = useState(false); // bottom sheet mobile

  const [pendingFile, setPendingFile] = useState(null);
  const [caption, setCaption]         = useState("");
  const [dragOver, setDragOver]       = useState(false);

  const [recording, setRecording]   = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const recorderRef = useRef(null);
  const chunksRef    = useRef([]);
  const timerRef      = useRef(null);
  const textareaRef   = useRef(null);
  const messageListRef = useRef(null);

  useEffect(() => {
    setShowTemplates(false);
    setShowProductPicker(false);
    setShowEmoji(false);
    setShowSearch(false);
    setShowAttachSheet(false);
    setShowCustomerDetail(false);
    setPendingFile(null);
    setCaption("");
  }, [conversationId]);

  useEffect(() => {
    if (!draft && textareaRef.current) textareaRef.current.style.height = "auto";
  }, [draft]);

  function autoGrowTextarea(el) {
    el.style.height = "auto";
    el.style.height = Math.min(el.scrollHeight, 120) + "px";
  }

  function handleTextareaKeyDown(e) {
    const isMobile = window.innerWidth < 768;
    if (e.key === "Enter") {
      if (isMobile) return;
      if (!e.shiftKey) { e.preventDefault(); handleSend(); }
    }
  }

  function handleSend(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    sendMutation.mutate({ content: text, replyTo: replyTarget });
    useComposerStore.getState().setDraft(conversationId, "");
    useComposerStore.getState().clearReply();
  }

  function handleRetry(m) {
    sendMutation.mutate({ content: m.content, replyTo: m.replyTo || null });
    // buang bubble gagal yang lama supaya tidak dobel dengan yang baru dikirim
    useMessageStore.setState((state) => ({
      messagesByConvId: {
        ...state.messagesByConvId,
        [conversationId]: (state.messagesByConvId[conversationId] || []).filter((x) => x.id !== m.id),
      },
    }));
  }

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

  function handleFileSelect(e, sendAs = "media") {
    const file = e.target.files?.[0];
    if (!file) return;
    openFilePreview(file, sendAs);
    e.target.value = "";
  }

  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItem = items.find((item) => item.kind === "file");
    if (!fileItem) return;
    e.preventDefault();
    const file = fileItem.getAsFile();
    if (file) openFilePreview(file);
  }

  function handleDragOver(e) { e.preventDefault(); setDragOver(true); }
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (file) openFilePreview(file);
  }

  async function handleSendMedia() {
    if (!pendingFile) return;
    const fd = new FormData();
    fd.append("file", pendingFile.file);
    fd.append("sendAs", pendingFile.sendAs || "media");
    if (caption.trim()) fd.append("caption", caption.trim());
    setSendingMedia(true);
    try {
      const msg = await api.sendMedia(conversationId, fd);
      useMessageStore.getState().appendMessage(conversationId, msg);
      setPendingFile(null);
      setCaption("");
    } catch (err) { alert(err.message); }
    finally { setSendingMedia(false); }
  }

  async function startRecording() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = async () => {
        stream.getTracks().forEach((t) => t.stop());
        const blob = new Blob(chunksRef.current, { type: mime });
        const ext  = mime.includes("webm") ? "webm" : "ogg";
        const fd   = new FormData();
        fd.append("file", blob, `voice-${Date.now()}.${ext}`);
        setSendingMedia(true);
        try {
          const msg = await api.sendMedia(conversationId, fd);
          useMessageStore.getState().appendMessage(conversationId, msg);
        } catch (err) { alert(err.message); }
        finally { setSendingMedia(false); }
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
      const updated = await api.updateConversation(conversationId, { status: newStatus });
      useConversationStore.getState().upsertConversation(updated);
    } catch (err) { alert(err.message); }
  }

  async function handleResolve() {
    if (conversation.status === "RESOLVED") return;
    setResolving(true);
    try {
      const updated = await api.updateConversation(conversationId, { status: "RESOLVED" });
      useConversationStore.getState().upsertConversation(updated);
    } catch (err) { alert(err.message); }
    finally { setResolving(false); }
  }

  async function handleTakeover() {
    if (!confirm("Ambil alih percakapan ini sebagai lead kamu?")) return;
    setTakingOver(true);
    try {
      const updated = await api.takeoverConversation(conversationId);
      useConversationStore.getState().upsertConversation(updated);
    } catch (err) { alert(err.message); }
    finally { setTakingOver(false); }
  }

  if (!conversation) {
    return (
      <div className="chat-window empty-state">
        <MessageSquare size={40} className="chat-empty-icon" />
        <span>Pilih percakapan di sebelah kiri</span>
      </div>
    );
  }

  const isGroup      = conversation.type === "GROUP";
  const rawPhone     = conversation.customer?.phone;
  const name         = isGroup
    ? (conversation.groupName || conversation.groupJid?.split("@")[0] || "Grup")
    : (conversation.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || conversation.customer?.instagramHandle || "Pelanggan");
  const assignedTo   = conversation.assignedTo;
  const isMine       = assignedTo?.id === user?.id;
  const canTakeover  = conversation.canTakeOver ?? false;
  const formatRec    = (s) => `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;

  return (
    <div className="chat-window">
      {/* ── Header ── */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={onBack} title="Kembali ke daftar"><ArrowLeft size={18} /></button>
        {isGroup ? (
          <div className="conv-group-avatar"><Users size={18} /></div>
        ) : (
          <Avatar name={name} src={conversation.customer?.profilePictureUrl} size="sm" />
        )}
        <div className="chat-header-info" style={{ flex: 1, minWidth: 0 }}>
          <p className="chat-header-name">{name}</p>
          <div className="chat-header-meta">
            {isGroup ? (
              <span className="text-muted" style={{ fontSize: 12 }}>Percakapan Grup</span>
            ) : (
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
            )}
          </div>
        </div>

        {/* Tombol info — dipakai mobile untuk buka bottom sheet Customer Panel (di desktop info sudah tampil sebagai kolom 3) */}
        <button className="chat-info-btn" onClick={() => setShowCustomerDetail(true)} title="Info Pelanggan">
          <Info size={18} />
        </button>

        <div className="chat-header-desktop-actions">
          <button className="chat-action-btn" onClick={() => setShowSearch((v) => !v)} title="Cari dalam percakapan">
            <Search size={17} />
          </button>
          {onTogglePanel && (
            <button className="chat-action-btn" onClick={onTogglePanel}
              title={panelCollapsed ? "Tampilkan panel pelanggan" : "Sembunyikan panel pelanggan"}>
              {panelCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
            </button>
          )}
          {!isGroup && !isMine && (
            !assignedTo ? (
              <button className="btn btn-secondary btn-sm" onClick={handleTakeover} disabled={takingOver} style={{ flexShrink: 0 }}>
                <UserCheck size={13} /> {takingOver ? "..." : "Ambil Percakapan"}
              </button>
            ) : canTakeover ? (
              <button className="btn btn-secondary btn-sm" onClick={handleTakeover} disabled={takingOver} style={{ flexShrink: 0 }}>
                <UserCheck size={13} /> {takingOver ? "..." : "Ambil Alih (belum dibalas 1j+)"}
              </button>
            ) : (
              <button className="btn btn-ghost btn-sm" disabled style={{ flexShrink: 0, opacity: 0.5, cursor: "not-allowed" }}>
                <UserCheck size={13} /> {assignedTo.name}
              </button>
            )
          )}
          {!isGroup && (
            <select value={conversation.status} onChange={(e) => handleStatusChange(e.target.value)} className="status-select" style={{ flexShrink: 0 }}>
              {STATUS_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>
          )}
          {!isGroup && conversation.status !== "RESOLVED" && (
            <button className="btn btn-primary btn-sm" onClick={handleResolve} disabled={resolving} style={{ gap: 4, display: "flex", alignItems: "center", flexShrink: 0 }}>
              <CheckCircle size={13} /> <span className="resolve-label">{resolving ? "..." : "Selesaikan"}</span>
            </button>
          )}
        </div>

        <div className="chat-dots-container">
          <button className="chat-action-btn chat-dots-btn" onClick={() => setShowDotMenu((v) => !v)} title="Menu"><MoreVertical size={18} /></button>
          {showDotMenu && (
            <>
              <div className="chat-dots-backdrop" onClick={() => setShowDotMenu(false)} />
              <div className="chat-dots-dropdown">
                <button onClick={() => { setShowSearch(true); setShowDotMenu(false); }}><Search size={14} /> Cari Pesan</button>
                <button onClick={() => { setShowCustomerDetail(true); setShowDotMenu(false); }}><Info size={14} /> Info Pelanggan</button>
                {!isGroup && conversation.status !== "RESOLVED" && (
                  <button onClick={() => { handleResolve(); setShowDotMenu(false); }}><CheckCircle size={14} /> Tandai Selesai</button>
                )}
                {!isGroup && (
                  <button onClick={() => { handleStatusChange("PENDING"); setShowDotMenu(false); }}><MessageSquare size={14} /> Tandai Pending</button>
                )}
                {!isGroup && !isMine && !assignedTo && (
                  <button onClick={() => { handleTakeover(); setShowDotMenu(false); }}><UserCheck size={14} /> Ambil Percakapan</button>
                )}
                {!isGroup && !isMine && assignedTo && canTakeover && (
                  <button onClick={() => { handleTakeover(); setShowDotMenu(false); }}><UserCheck size={14} /> Ambil Alih (belum dibalas 1j+)</button>
                )}
              </div>
            </>
          )}
        </div>
      </div>

      {/* ── Search dalam percakapan ── */}
      {showSearch && (
        <InChatSearch
          conversationId={conversationId}
          onJumpTo={(id) => messageListRef.current?.scrollToMessage(id)}
          onClose={() => setShowSearch(false)}
        />
      )}

      {/* ── Daftar pesan (virtualized) ── */}
      <MessageList
        ref={messageListRef}
        conversation={conversation}
        onReply={(msg) => { useComposerStore.getState().setReplyTarget(msg); textareaRef.current?.focus(); }}
        onForward={(msg) => setForwardMsg(msg)}
        onRetry={handleRetry}
      />

      {/* ── Input area ── */}
      {isGroup ? (
        <div className="chat-input-area" style={{ justifyContent: "center", padding: "12px 16px" }}>
          <span style={{ fontSize: 12, color: "var(--text-muted)", textAlign: "center" }}>
            Percakapan grup — tidak bisa dibalas dari CRM
          </span>
        </div>
      ) : (
        <div className={`chat-input-area${dragOver ? " drag-active" : ""}`} onDragOver={handleDragOver} onDragLeave={() => setDragOver(false)} onDrop={handleDrop}>
          {dragOver && <div className="chat-drop-zone"><span>Drop file di sini untuk melampirkan</span></div>}

          {pendingFile && (
            <FilePreview pending={pendingFile} caption={caption} onCaption={setCaption} onSend={handleSendMedia}
              onCancel={() => { setPendingFile(null); setCaption(""); }} sending={sendingMedia} />
          )}

          {showTemplates && (
            <TemplatePicker customer={conversation.customer}
              onSelect={(text) => { useComposerStore.getState().setDraft(conversationId, text); setShowTemplates(false); }}
              onClose={() => setShowTemplates(false)} />
          )}

          {showProductPicker && (
            <ProductPicker conversation={conversation} onClose={() => setShowProductPicker(false)}
              onSent={(msgs) => { msgs.forEach((m) => useMessageStore.getState().appendMessage(conversationId, m)); setShowProductPicker(false); }} />
          )}

          {replyTarget && (
            <div className="reply-strip">
              <div className="reply-strip-bar" />
              <div style={{ flex: 1, minWidth: 0 }}>
                <div className="reply-strip-title">Membalas {replyTarget.direction === "OUTBOUND" ? "pesan kamu" : "pelanggan"}</div>
                <div className="reply-strip-text">{replyTarget.content || (replyTarget.mediaType ? `[${replyTarget.mediaType}]` : "Pesan")}</div>
              </div>
              <button onClick={() => useComposerStore.getState().clearReply()} className="reply-strip-close"><X size={14} /></button>
            </div>
          )}

          {recording ? (
            <div className="recording-bar">
              <span className="rec-dot" />
              <span className="rec-time">{formatRec(recSeconds)}</span>
              <button onClick={cancelRecording} className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }}><X size={13} /> Batal</button>
              <button onClick={stopRecording} className="btn btn-primary btn-sm"><MicOff size={13} /> Kirim</button>
            </div>
          ) : !pendingFile && (
            <form className="chat-input" onSubmit={handleSend}>
              <button type="button" onClick={() => setShowTemplates((v) => !v)} className={`chat-action-btn ${showTemplates ? "active" : ""}`} title="Pilih template">
                <MessageSquare size={15} />
              </button>
              <button type="button" onClick={() => setShowAttachSheet((v) => !v)} className={`chat-action-btn ${showAttachSheet ? "active" : ""}`} title="Lampiran">
                <Plus size={16} />
              </button>
              <div style={{ position: "relative" }}>
                <button type="button" onClick={() => setShowEmoji((v) => !v)} className={`chat-action-btn ${showEmoji ? "active" : ""}`} title="Emoji">
                  <Smile size={16} />
                </button>
                {showEmoji && (
                  <EmojiPicker
                    onSelect={(em) => useComposerStore.getState().setDraft(conversationId, draft + em)}
                    onClose={() => setShowEmoji(false)}
                  />
                )}
              </div>
              <textarea
                ref={textareaRef}
                value={draft}
                rows={1}
                className="chat-textarea"
                placeholder="Tulis balasan..."
                onChange={(e) => { useComposerStore.getState().setDraft(conversationId, e.target.value); autoGrowTextarea(e.target); }}
                onKeyDown={handleTextareaKeyDown}
                onPaste={handlePaste}
              />
              <button type="button" onClick={startRecording} className="chat-action-btn" title="Rekam pesan suara"><Mic size={15} /></button>
              <button type="submit" className="chat-send-btn" disabled={!draft.trim()}><Send size={16} /></button>
            </form>
          )}
        </div>
      )}

      {/* ── Attach Sheet ── */}
      {showAttachSheet && (
        <div className="attach-sheet-overlay" onClick={() => setShowAttachSheet(false)}>
          <div className="attach-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="attach-sheet-handle" />
            <div className="attach-grid-title">Lampirkan</div>
            <div className="attach-grid">
              <label className="attach-item">
                <input type="file" accept="image/*" style={{ display: "none" }} onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#dbeafe" }}><ImageIcon size={24} style={{ color: "#2563eb" }} /></div>
                <span className="attach-item-label">Foto</span>
              </label>
              <label className="attach-item">
                <input type="file" accept="video/*" style={{ display: "none" }} onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#e0f2fe" }}><Video size={24} style={{ color: "#0284c7" }} /></div>
                <span className="attach-item-label">Video</span>
              </label>
              <label className="attach-item">
                <input type="file" accept="image/*" capture="environment" style={{ display: "none" }} onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#dcfce7" }}>
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="#16a34a" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                    <path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" /><circle cx="12" cy="13" r="4" />
                  </svg>
                </div>
                <span className="attach-item-label">Kamera</span>
              </label>
              <label className="attach-item">
                <input type="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.ppt,.pptx,.zip,.txt,.csv" style={{ display: "none" }} onChange={(e) => { handleFileSelect(e, "document"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#fef9c3" }}><FileText size={24} style={{ color: "#ca8a04" }} /></div>
                <span className="attach-item-label">Dokumen</span>
              </label>
              <label className="attach-item">
                <input type="file" accept="audio/*" style={{ display: "none" }} onChange={(e) => { handleFileSelect(e, "media"); setShowAttachSheet(false); }} />
                <div className="attach-item-icon" style={{ background: "#fce7f3" }}><Mic size={24} style={{ color: "#db2777" }} /></div>
                <span className="attach-item-label">Audio</span>
              </label>
              <button className="attach-item" onClick={() => { setShowProductPicker(true); setShowAttachSheet(false); }}>
                <div className="attach-item-icon" style={{ background: "#ede9fe" }}><Package size={24} style={{ color: "#7c3aed" }} /></div>
                <span className="attach-item-label">Produk</span>
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Forward Modal ── */}
      {forwardMsg && <ForwardModal messageToForward={forwardMsg} onClose={() => setForwardMsg(null)} />}

      {/* ── CustomerPanel Bottom Sheet (mobile only, via CSS) ── */}
      {showCustomerDetail && (
        <div className="mobile-bottom-sheet-overlay" onClick={() => setShowCustomerDetail(false)}>
          <div className="mobile-bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-handle" />
            <CustomerPanel customerId={conversation?.customer?.id} conversation={conversation} />
          </div>
        </div>
      )}
    </div>
  );
}
