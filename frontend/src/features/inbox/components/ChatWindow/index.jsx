import React, { useEffect, useRef, useState } from "react";
import {
  MessageSquare, CheckCircle, X,
  Phone, ArrowLeft, UserCheck, Users, Info, MoreVertical,
  Forward, Search, PanelRightClose, PanelRightOpen,
} from "lucide-react";
import { api } from "../../../../api.js";
import Avatar from "../../../../components/Avatar.jsx";
import { formatPhoneDisplay } from "../../../../utils/format.js";
import CustomerPanel from "../CustomerPanel/index.jsx";
import MessageList from "./MessageList.jsx";
import InChatSearch from "./InChatSearch.jsx";
import Composer from "./Composer.jsx";
import { useMessages } from "../../hooks/useMessages.js";
import { useSendMessage } from "../../hooks/useSendMessage.js";
import { useMessageStore } from "../../stores/messageStore.js";
import { useConversationStore } from "../../stores/conversationStore.js";
import { useComposerStore } from "../../stores/composerStore.js";

const STATUS_OPTIONS = [
  { value: "OPEN",     label: "Terbuka" },
  { value: "PENDING",  label: "Pending" },
  { value: "RESOLVED", label: "Selesai" },
];

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

// ── Main ChatWindow (Fase C + D) ────────────────────────────────────────
export default function ChatWindow({ conversation, user, onBack, panelCollapsed, onTogglePanel }) {
  const conversationId = conversation?.id;

  // Fetch + realtime + windowing pesan (lihat useMessages.js)
  useMessages(conversationId);
  // Instance terpisah dari yang dipakai Composer — sama-sama menulis ke
  // messageStore/backend yang sama, aman dipanggil dari 2 tempat berbeda
  // (dipakai khusus untuk tombol "Coba lagi" di bubble gagal kirim).
  const retryMutation = useSendMessage(conversationId);

  const [showSearch, setShowSearch]     = useState(false);
  const [takingOver, setTakingOver]     = useState(false);
  const [resolving, setResolving]       = useState(false);
  const [showDotMenu, setShowDotMenu]   = useState(false);
  const [forwardMsg, setForwardMsg]     = useState(null);
  const [showCustomerDetail, setShowCustomerDetail] = useState(false); // bottom sheet mobile
  const [dragOver, setDragOver]         = useState(false);

  const messageListRef  = useRef(null);
  const mediaUploaderRef = useRef(null); // diisi Composer -> MediaUploader, dipakai untuk drag-drop & paste dari luar composer

  useEffect(() => {
    setShowSearch(false);
    setShowDotMenu(false);
    setShowCustomerDetail(false);
  }, [conversationId]);

  function handleRetry(m) {
    // Buang bubble gagal yang lama dulu, baru kirim ulang lewat mutation
    // yang sama (optimistic) supaya tidak dobel bubble.
    useMessageStore.setState((state) => ({
      messagesByConvId: {
        ...state.messagesByConvId,
        [conversationId]: (state.messagesByConvId[conversationId] || []).filter((x) => x.id !== m.id),
      },
    }));
    retryMutation.mutate({ content: m.content, replyTo: m.replyTo || null });
  }

  // Drag & drop dari area manapun di jendela chat → serahkan ke MediaUploader (lewat ref)
  function handleDragOver(e) { e.preventDefault(); if (conversation?.type !== "GROUP") setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) mediaUploaderRef.current?.addFiles(e.dataTransfer.files);
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

  const isGroup     = conversation.type === "GROUP";
  const rawPhone    = conversation.customer?.phone;
  const name        = isGroup
    ? (conversation.groupName || conversation.groupJid?.split("@")[0] || "Grup")
    : (conversation.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || conversation.customer?.instagramHandle || "Pelanggan");
  const assignedTo  = conversation.assignedTo;
  const isMine      = assignedTo?.id === user?.id;
  const canTakeover = conversation.canTakeOver ?? false;

  return (
    <div className={`chat-window${dragOver ? " chat-window-drag" : ""}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragOver && (
        <div className="chat-window-drop-overlay"><span>Lepaskan untuk mengirim</span></div>
      )}

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

        {/* Tombol info — dipakai mobile untuk buka bottom sheet Customer Panel */}
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
        onReply={(msg) => useComposerStore.getState().setReplyTarget(msg)}
        onForward={(msg) => setForwardMsg(msg)}
        onRetry={handleRetry}
      />

      {/* ── Composer (Fase D) ── */}
      <Composer conversation={conversation} mediaUploaderRef={mediaUploaderRef} />

      {/* ── Forward Modal ── */}
      {forwardMsg && <ForwardModal messageToForward={forwardMsg} onClose={() => setForwardMsg(null)} />}

      {/* ── CustomerPanel Bottom Sheet (mobile only, via CSS) ── */}
      {showCustomerDetail && (
        <div className="mobile-bottom-sheet-overlay" onClick={() => setShowCustomerDetail(false)}>
          <div className="mobile-bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-handle" />
            <CustomerPanel conversation={conversation} onClose={() => setShowCustomerDetail(false)} />
          </div>
        </div>
      )}
    </div>
  );
}
