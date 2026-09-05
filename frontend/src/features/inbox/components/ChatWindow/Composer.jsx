import React, { lazy, Suspense, useEffect, useRef, useState } from "react";
import { Send, LayoutTemplate, X, Smile, Paperclip, Mic, Pencil, CheckCircle2, Bold, Italic, Strikethrough, Sparkles } from "lucide-react";
import { api } from "../../../../api.js";
import { ProductPicker } from "../../../../components/ProductPicker.jsx";
import OrderEditDrawer from "../CustomerPanel/OrderEditDrawer.jsx";
import { useSendMessage } from "../../hooks/useSendMessage.js";
import { useMessageStore } from "../../stores/messageStore.js";
import { useDraft, useReplyTarget, useEditingMessage, useComposerStore } from "../../stores/composerStore.js";
import { WA_MARKERS, toggleWaFormat, parseWaFormatting } from "../../../../utils/waFormat.jsx";

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

// Fix dark mode (20 Agt 2026): bg pastel + teks gelap HARDCODE — pastelnya
// tidak ikut gelap, jadi chip ini selalu tampil terang mencolok di atas
// popup gelap. bg alpha dari warna solid (bukan pastel) otomatis membaur
// wajar di permukaan terang MAUPUN gelap — sama seperti pillTone() di
// InfoSection.jsx (masalah yang identik).
const KATEGORI_COLORS = {
  pembukaan:  { bg: "#2563eb26", color: "#2563eb" },
  follow_up:  { bg: "#7c3aed26", color: "#7c3aed" },
  penawaran:  { bg: "#16a34a26", color: "#16a34a" },
  konfirmasi: { bg: "#b4530926", color: "#b45309" },
  penutupan:  { bg: "#dc262626", color: "#dc2626" },
  lainnya:    { bg: "var(--bg-inset)", color: "var(--text-secondary)" },
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
                  <p className="template-preview">{parseWaFormatting(preview)}</p>
                </button>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// Wave 5 (redesign Inbox, plan starry-humming-knuth) — "Suggest Reply".
// Menyambungkan backend yang sudah lama jadi (POST /api/ai/reply-
// suggestions — kuota harian, validator anti-janji-terlarang, gate
// komplain/handover WAJIB manusia, fallback template kalau LLM tidak
// tersedia) tapi belum pernah dipanggil dari frontend manapun sebelum ini.
// Klik satu saran cuma MENGISI draft (setDraft), TIDAK PERNAH mengirim
// langsung — sales tetap harus baca ulang & tekan Kirim sendiri.
//
// CATATAN JUJUR (bukan disembunyikan): endpoint PATCH /reply-suggestions/:id
// (lapor status Disalin/Diedit/Dikirim/Ditolak ke ReplySuggestionLog) ADA
// di backend, tapi orchestrator (services/replyAssistant/index.js#finalize)
// tidak pernah mengembalikan id baris log itu ke response — jadi frontend
// tidak punya id yang valid untuk di-PATCH. Sengaja TIDAK dipanggil di sini
// (mengarang/menebak id akan menulis data audit yang salah) — pelaporan
// status itu perlu perbaikan kecil di backend dulu (kembalikan id log di
// payload), bukan pekerjaan wave ini.
function SuggestReplyPopover({ conversationId, onSelect, onClose }) {
  const [state, setState] = useState("loading"); // loading | ready | error
  const [data, setData]   = useState(null);
  const [errorMsg, setErrorMsg] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    let alive = true;
    api.getReplySuggestions(conversationId)
      .then((res) => { if (alive) { setData(res); setState("ready"); } })
      .catch((err) => { if (alive) { setErrorMsg(err.message || "Gagal memuat saran balasan"); setState("error"); } });
    return () => { alive = false; };
  }, [conversationId]);

  useEffect(() => {
    const handler = (e) => { if (ref.current && !ref.current.contains(e.target)) onClose(); };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [onClose]);

  const suggestions = data?.suggestions || [];

  return (
    <div ref={ref} className="template-picker-popup">
      <div className="template-picker-header">
        <span style={{ fontWeight: 700, fontSize: 13, display: "flex", alignItems: "center", gap: 6 }}>
          <Sparkles size={14} /> Saran Balasan AI
        </span>
        <button onClick={onClose} className="btn-icon"><X size={14} /></button>
      </div>
      <div style={{ overflowY: "auto", flex: 1, padding: "10px 14px" }}>
        {state === "loading" && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Memuat saran...</p>
        )}
        {state === "error" && (
          <p style={{ fontSize: 13, color: "var(--color-danger)" }}>{errorMsg}</p>
        )}
        {state === "ready" && data?.blocked && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>
            Percakapan ini butuh ditangani langsung oleh sales (komplain/permintaan handover
            terdeteksi) — AI sengaja tidak menyarankan draf balasan untuk kasus seperti ini.
          </p>
        )}
        {state === "ready" && !data?.blocked && suggestions.length === 0 && (
          <p style={{ fontSize: 13, color: "var(--text-muted)" }}>Tidak ada saran untuk saat ini.</p>
        )}
        {state === "ready" && !data?.blocked && suggestions.map((s) => (
          <button
            key={s.id}
            className="template-item"
            style={{ display: "block", width: "100%", textAlign: "left" }}
            onClick={() => { onSelect(s.text); onClose(); }}
          >
            <p className="template-preview" style={{ margin: 0 }}>{s.text}</p>
          </button>
        ))}
        {state === "ready" && data?.quota && (
          <p style={{ fontSize: 11, color: "var(--text-muted)", marginTop: 10 }}>
            Sisa kuota hari ini: {data.quota.remaining}/{data.quota.limit}
          </p>
        )}
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
  const isGroup         = conversation.type === "GROUP";
  const sendMutation   = useSendMessage(conversationId);
  const draft          = useDraft(conversationId);
  const replyTarget    = useReplyTarget();
  const editingMessage = useEditingMessage();

  const [showTemplates, setShowTemplates] = useState(false);
  const [showEmoji, setShowEmoji]         = useState(false);
  const [showProductPicker, setShowProductPicker] = useState(false);
  // Wave 13 (redesign Inbox) — "Buat Order" di menu lampiran. Order milik
  // Customer, jadi tidak relevan untuk percakapan grup (isGroup).
  const [showCreateOrder, setShowCreateOrder] = useState(false);
  // Wave 5 (redesign Inbox) — "Suggest Reply". Tidak relevan untuk grup
  // (endpoint butuh customerId tunggal, sama seperti Buat Order di atas).
  const [showSuggestReply, setShowSuggestReply] = useState(false);
  const [savingEdit, setSavingEdit] = useState(false);
  const [showSelectionToolbar, setShowSelectionToolbar] = useState(false);
  const textareaRef = useRef(null);

  useEffect(() => {
    setShowTemplates(false);
    setShowEmoji(false);
    setShowProductPicker(false);
    setShowCreateOrder(false);
    setShowSuggestReply(false);
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

  // Terapkan format WhatsApp (*tebal*/_miring_/~coret~) ke teks yang dipilih
  // di textarea. Textarea TETAP teks polos (sengaja, sama seperti kotak
  // ketik WhatsApp asli — simbol format terlihat apa adanya saat mengetik,
  // baru dirender jadi gaya setelah terkirim/diterima, lihat MessageBubble +
  // utils/waFormat.jsx). Kalau tidak ada seleksi, simbol kosong disisipkan
  // di posisi kursor supaya user tinggal mengetik di tengahnya.
  function applyFormat(marker) {
    const el = textareaRef.current;
    if (!el) return;
    const { nextText, selStart, selEnd } = toggleWaFormat(el, draft, marker);
    setDraft(nextText);
    setTimeout(() => {
      el.focus();
      el.selectionStart = selStart;
      el.selectionEnd = selEnd;
      autoGrowTextarea(el);
    }, 0);
  }

  // BUG YANG DIPERBAIKI: sebelumnya 3 tombol format (Bold/Italic/Strikethrough)
  // permanen di baris toolbar — di layar sempit itu mendorong kotak ketik +
  // tombol kirim KELUAR LAYAR (tidak wrap), jadi disembunyikan total di
  // mobile lewat CSS (`.chat-format-btn { display:none }` @768px). Solusinya
  // BUKAN memuat ulang tombolnya, tapi meniru pola asli WhatsApp: tombol
  // format cuma muncul SEMENTARA sebagai popup mengambang begitu ada teks
  // yang diblok (selection non-kosong) di kotak ketik, lalu hilang lagi
  // begitu seleksi dilepas — tidak pernah merebut ruang permanen di toolbar,
  // jadi tidak ada lagi risiko mendorong elemen lain keluar layar di HP.
  function handleSelectionChange() {
    const el = textareaRef.current;
    if (!el) return;
    setShowSelectionToolbar(el.selectionStart !== el.selectionEnd);
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
          onSent={(msgs) => { msgs.forEach((m) => useMessageStore.getState().upsertMessage(conversationId, m)); setShowProductPicker(false); }} />
      )}

      {showSuggestReply && (
        <SuggestReplyPopover
          conversationId={conversationId}
          onSelect={(text) => setDraft(text)}
          onClose={() => setShowSuggestReply(false)}
        />
      )}

      {/* Wave 13 (redesign Inbox) — "Buat Order" dari menu lampiran. Instance
          drawer TERSENDIRI (bukan berbagi dengan CustomerPanel, yang berada
          di cabang komponen SIBLING, bukan leluhur/turunan Composer ini) —
          cuma perlu customerId, drawer fetch data customer-nya sendiri
          (lihat OrderEditDrawer.jsx). `onUpdate` tidak perlu berbuat apa-apa
          di sini: Composer tidak menyimpan state customer sendiri untuk
          disegarkan (beda dari CustomerPanel, yang memang menyimpannya). */}
      <OrderEditDrawer
        open={showCreateOrder}
        order={null}
        customerId={conversation.customer?.id}
        onClose={() => setShowCreateOrder(false)}
        onUpdate={() => {}}
      />

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
        {/* D-121 (redesign ikon) — dulu MessageSquare (bubble chat polos),
            gampang tertukar sekilas dengan ikon bubble lain di sekitarnya
            (compose baru, dots menu). LayoutTemplate lebih literal
            menggambarkan "pilih template". */}
        <button type="button" onClick={() => setShowTemplates((v) => !v)} className={`chat-action-btn ${showTemplates ? "active" : ""}`} title="Pilih template">
          <LayoutTemplate size={15} />
        </button>

        <Suspense fallback={<ActionBtnFallback icon={Paperclip} />}>
          <MediaUploader
            ref={mediaUploaderRef}
            conversationId={conversationId}
            onOpenProduct={() => setShowProductPicker(true)}
            onCreateOrder={!isGroup && conversation.customer?.id ? () => setShowCreateOrder(true) : undefined}
          />
        </Suspense>

        {/* Wave 5 (redesign Inbox) — "Suggest Reply". Tidak relevan untuk
            grup (endpoint AI butuh 1 customer, bukan banyak anggota). */}
        {!isGroup && conversation.customer?.id && (
          <div style={{ position: "relative" }}>
            <button
              type="button"
              onClick={() => setShowSuggestReply((v) => !v)}
              className={`chat-action-btn ${showSuggestReply ? "active" : ""}`}
              title="Saran balasan AI"
            >
              <Sparkles size={16} />
            </button>
          </div>
        )}

        <div style={{ position: "relative" }}>
          <button type="button" onClick={() => setShowEmoji((v) => !v)} className={`chat-action-btn ${showEmoji ? "active" : ""}`} title="Emoji">
            <Smile size={16} />
          </button>
          {showEmoji && <EmojiMartPopup onSelect={insertEmoji} onClose={() => setShowEmoji(false)} />}
        </div>

        {/* Popup format mengambang — gaya WhatsApp: muncul HANYA saat ada
            teks diblok di kotak ketik, mengambang di atas textarea, hilang
            lagi begitu seleksi dilepas. Tidak ada tombol underline — bukan
            fitur WhatsApp asli. onMouseDown+preventDefault di tiap tombol
            supaya textarea TIDAK kehilangan fokus/seleksi saat tombol
            diklik (kalau tidak, seleksi keburu collapse sebelum applyFormat
            sempat baca selectionStart/End-nya). */}
        <div className="chat-textarea-wrap">
          {showSelectionToolbar && (
            <div className="chat-selection-toolbar">
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat(WA_MARKERS.bold)} title="Tebal (*teks*)">
                <Bold size={14} />
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat(WA_MARKERS.italic)} title="Miring (_teks_)">
                <Italic size={14} />
              </button>
              <button type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => applyFormat(WA_MARKERS.strike)} title="Coret (~teks~)">
                <Strikethrough size={14} />
              </button>
            </div>
          )}
          <textarea
            ref={textareaRef}
            value={draft}
            rows={1}
            className="chat-textarea"
            placeholder={editingMessage ? "Edit pesan..." : "Tulis balasan..."}
            onChange={(e) => { setDraft(e.target.value); autoGrowTextarea(e.target); }}
            onKeyDown={handleTextareaKeyDown}
            onPaste={handlePaste}
            onSelect={handleSelectionChange}
            onKeyUp={handleSelectionChange}
            onMouseUp={handleSelectionChange}
            onTouchEnd={handleSelectionChange}
            onBlur={() => setShowSelectionToolbar(false)}
          />
        </div>

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
