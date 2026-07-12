import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Send, MessageSquare, X, Smile, Paperclip, Mic, Pencil, CheckCircle2 } from "lucide-react";
import { api } from "../../../../api.js";
import { ProductPicker } from "../../../../components/ProductPicker.jsx";
import { useSendMessage } from "../../hooks/useSendMessage.js";
import { useMessageStore } from "../../stores/messageStore.js";
import { useDraft, useReplyTarget, useEditingMessage, useComposerStore } from "../../stores/composerStore.js";

// Fase G: MediaUploader & VoiceRecorder jadi chunk terpisah, di-load begitu
// ChatWindow pertama kali dibuka — bukan ikut initial bundle app/login/Dashboard.
const MediaUploader = lazy(() => import("./MediaUploader.jsx"));
const VoiceRecorder  = lazy(() => import("./VoiceRecorder.jsx"));

// Fallback tombol saat chunk MediaUploader/VoiceRecorder masih di-download —
// tampil disabled sebentar, bukan area kosong (hindari layout shift).
function ActionBtnFallback({ icon: Icon }) {
  return (
    <button type="button" className="chat-action-btn" disabled>
      <Icon size={15} />
    </button>
  );
}

const MAX_ROWS = 5;

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

// ── Template Picker (dipindah dari ChatWindow/index.jsx Fase C) ──────────
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
    !search || t.nama.toLowerCase().includes(search.toLowerCase()) || t.isi.toLowerCase().includes(search.toLowerCase())
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
        <input autoFocus value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Cari template..." className="template-search" />
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
                    <span className="template-badge" style={{ background: c.bg, color: c.color }}>{KATEGORI_LABELS[tpl.kategori]}</span>
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

// ── Emoji picker emoji-mart, lazy-loaded (JS + data JSON cuma diambil saat dibuka) ──
function EmojiMartPopup({ onSelect, onClose }) {
  const [Picker, setPicker] = useState(null);
  const [data, setData]     = useState(null);
  const ref = useRef(null);

  useEffect(() => {
    Promise.all([
      import("@emoji-mart/react").then((m) => m.default),
      import("@emoji-mart/data").then((m) => m.default),
    ]).then(([PickerComp, emojiData]) => { setPicker(() => PickerComp); setData(emojiData); });
  }, []);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  return (
    <div ref={ref} className="emoji-mart-popup">
      {Picker && data ? (
        <Picker
          data={data}
          onEmojiSelect={(emoji) => onSelect(emoji.native)}
          theme="light"
          locale="id"
          previewPosition="none"
          skinTonePosition="none"
          maxFrequentRows={2}
        />
      ) : (
        <div className="emoji-mart-loading">Memuat emoji...</div>
      )}
    </div>
  );
}

// ── Composer utama (Fase D) ───────────────────────────────────────────────
export default function Composer({ conversation, mediaUploaderRef }) {
  const conversationId = conversation.id;
  const sendMutation   = useSendMessage(conversationId);
  const draft          = useDraft(conversationId);
  const replyTarget    = useReplyTarget();
  const editingMessage = useEditingMessage();

  const [showTemplates, setShowTemplates] = useState(false);
  const [showEmoji, setShowEmoji]         = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    setShowTemplates(false);
    setShowEmoji(false);
    setShowProductPicker(false);
  }, [conversationId]);

  useEffect(() => {
    if (!draft && textareaRef.current) textareaRef.current.style.height = "auto";
  }, [draft]);

  function autoGrowTextarea(el) {
    el.style.height = "auto";
    const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 18;
    const maxHeight  = lineHeight * MAX_ROWS;
    el.style.height = Math.min(el.scrollHeight, maxHeight) + "px";
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden";
  }

  function setDraft(text) { useComposerStore.getState().setDraft(conversationId, text); }

  function handleTextareaKeyDown(e) {
    const isMobile = window.innerWidth < 768;
    if (e.key === "Enter") {
      if (isMobile) return; // di mobile: Enter = baris baru
      if (!e.shiftKey) { e.preventDefault(); handleSend(); }
      // Shift+Enter → baris baru (default browser)
    }
  }

  function handleSend(e) {
    e?.preventDefault();
    const text = draft.trim();
    if (!text) return;
    if (editingMessage) { handleSaveEdit(text); return; }
    sendMutation.mutate({ content: text, replyTo: replyTarget });
    setDraft("");
    useComposerStore.getState().clearReply();
  }

  // Pola WhatsApp asli: cuma teks (media tidak bisa), 15 menit sejak
  // terkirim (ditegakkan backend, lihat MessageBubble.jsx canEdit untuk
  // penjelasan yang sama). Tidak pakai react-query mutation terpisah
  // (beda dari useSendMessage) karena tidak butuh optimistic-append —
  // pesannya SUDAH ada di list, cuma perlu update in-place.
  async function handleSaveEdit(text) {
    setSavingEdit(true);
    try {
      const updated = await api.editMessage(conversationId, editingMessage.id, text);
      useMessageStore.getState().updateMessage(editingMessage.id, updated);
      useComposerStore.getState().finishEditingMessage(conversationId);
    } catch (err) {
      alert("Gagal edit pesan: " + err.message);
    } finally {
      setSavingEdit(false);
    }
  }

  function handleCancelEdit() {
    useComposerStore.getState().cancelEditingMessage(conversationId);
  }

  function handlePaste(e) {
    const items = Array.from(e.clipboardData?.items || []);
    const fileItem = items.find((item) => item.kind === "file");
    if (!fileItem) return; // teks biasa — biarkan default
    e.preventDefault();
    const file = fileItem.getAsFile();
    if (file) mediaUploaderRef.current?.addFiles([file]);
  }

  function insertEmoji(emoji) {
    const el = textareaRef.current;
    if (!el) { setDraft(draft + emoji); return; }
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

  // Task 3 — grup WA sekarang BISA dibalas dari CRM (sebelumnya sengaja
  // di-disable, commit 1a210d2/1ba6a23). Composer aktif penuh untuk grup:
  // teks, media, VN, reply, emoji — cuma template picker yang kurang pas
  // (placeholder {nama_customer} fallback ke "Kak" karena grup tidak
  // punya Customer record, lihat applyVariables di atas), tapi tidak
  // di-block karena tetap berfungsi, cuma kurang presisi personalisasinya.

  return (
    <div className="chat-input-area">
      {showTemplates && (
        <TemplatePicker customer={conversation.customer} onSelect={(text) => { setDraft(text); setShowTemplates(false); }} onClose={() => setShowTemplates(false)} />
      )}

      {showProductPicker && (
        <ProductPicker conversation={conversation} onClose={() => setShowProductPicker(false)}
          onSent={(msgs) => { msgs.forEach((m) => useMessageStore.getState().appendMessage(conversationId, m)); setShowProductPicker(false); }} />
      )}

      {editingMessage ? (
        // Mode edit menggantikan reply-strip total — tidak masuk akal
        // reply+edit bersamaan di composer yang sama.
        <div className="reply-strip">
          <div className="reply-strip-bar" style={{ background: "var(--warning, #f59e0b)" }} />
          <Pencil size={14} style={{ flexShrink: 0, color: "var(--warning, #f59e0b)" }} />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="reply-strip-title">Edit pesan</div>
            <div className="reply-strip-text">{editingMessage.content}</div>
          </div>
          <button onClick={handleCancelEdit} className="reply-strip-close"><X size={14} /></button>
        </div>
      ) : replyTarget && (
        <div className="reply-strip">
          <div className="reply-strip-bar" />
          <div style={{ flex: 1, minWidth: 0 }}>
            <div className="reply-strip-title">Membalas {replyTarget.direction === "OUTBOUND" ? "pesan kamu" : "pelanggan"}</div>
            <div className="reply-strip-text">{replyTarget.content || (replyTarget.mediaType ? `[${replyTarget.mediaType}]` : "Pesan")}</div>
          </div>
          <button onClick={() => useComposerStore.getState().clearReply()} className="reply-strip-close"><X size={14} /></button>
        </div>
      )}

      <form className="chat-input" onSubmit={handleSend}>
        <button type="button" onClick={() => setShowTemplates((v) => !v)} className={`chat-action-btn ${showTemplates ? "active" : ""}`} title="Pilih template">
          <MessageSquare size={15} />
        </button>

        <Suspense fallback={<ActionBtnFallback icon={Paperclip} />}>
          <MediaUploader ref={mediaUploaderRef} conversationId={conversationId} onOpenProduct={() => setShowProductPicker(true)} />
        </Suspense>

        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setShowEmoji((v) => !v)} className={`chat-action-btn ${showEmoji ? "active" : ""}`} title="Emoji">
            <Smile size={16} />
          </button>
          {showEmoji && <EmojiMartPopup onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />}
        </div>

        <textarea
          ref={textareaRef}
          value={draft}
          rows={1}
          className="chat-textarea"
          placeholder={editingMessage ? "Edit pesan..." : "Tulis balasan..."}
          onChange={(e) => { setDraft(e.target.value); autoGrowTextarea(e.target); }}
          onKeyDown={handleTextareaKeyDown}
          onPaste={handlePaste}
        />

        <Suspense fallback={<ActionBtnFallback icon={Mic} />}>
          <VoiceRecorder conversationId={conversationId} />
        </Suspense>

        <button type="submit" className="chat-send-btn" disabled={!draft.trim() || savingEdit}>
          {editingMessage ? <CheckCircle2 size={16} /> : <Send size={16} />}
        </button>
      </form>
    </div>
  );
}
