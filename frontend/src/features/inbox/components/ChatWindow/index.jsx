import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useQueryClient } from "@tanstack/react-query";
import {
  MessageSquare, CheckCircle, X,
  Phone, ArrowLeft, UserCheck, Users, Info, MoreVertical,
  Forward, Search, PanelRightClose, PanelRightOpen, PanelLeftClose, PanelLeftOpen, Download, Trash2, Megaphone,
  Maximize2, Minimize2, RotateCcw,
} from "lucide-react";
import { api } from "../../../../api.js";
import Avatar from "../../../../components/Avatar.jsx";
import { Badge } from "@/components/ui/badge.jsx";
import { Menu, MenuItem, MenuSeparator } from "@/components/ui/menu.jsx";
import { formatPhoneDisplay, STAGE_LABELS, stageVariant } from "../../../../utils/format.js";
import { buatPetaMention } from "../../../../utils/mention.js";
import CustomerPanel from "../CustomerPanel/index.jsx";
import MessageList from "./MessageList.jsx";
import InChatSearch from "./InChatSearch.jsx";
import Composer from "./Composer.jsx";
import HandoverHistoryBanner from "./HandoverHistoryBanner.jsx";
import { useMessages } from "../../hooks/useMessages.js";
import { useSendMessage } from "../../hooks/useSendMessage.js";
import { useMessageStore, useMessagesForConv } from "../../stores/messageStore.js";
import { isAdminUser } from "@/lib/roles.js";
import { useConversationStore } from "../../stores/conversationStore.js";
import { useComposerStore } from "../../stores/composerStore.js";

// ── Forward Modal ────────────────────────────────────────────────────────
// messagesToForward: array opsional — dipakai forward BULK dari mode pilih
// (selectionMode di bawah). Kalau tidak ada, fallback ke messageToForward
// tunggal (pola lama, dipakai action-bar hover per-bubble).
function ForwardModal({ messageToForward, messagesToForward, onClose }) {
  const [convs, setConvs]           = useState([]);
  const [search, setSearch]         = useState("");
  const [loading, setLoading]       = useState(true);
  const [forwarding, setForwarding] = useState(false);

  const items = messagesToForward?.length ? messagesToForward : (messageToForward ? [messageToForward] : []);

  useEffect(() => {
    api.getConversations().then(({ data }) => { setConvs(data); setLoading(false); }).catch(() => setLoading(false));
  }, []);

  const filtered = convs.filter((c) => {
    if (!search) return true;
    const q = search.toLowerCase();
    return c.customer?.name?.toLowerCase().includes(q) || (c.customer?.phone || "").includes(q);
  });

  // BUG (fix, 17 Agt 2026): SEBELUMNYA `Promise.allSettled(items.map(...))`
  // mengirim SEMUA pesan bersamaan — untuk album (>1 foto sekaligus, lihat
  // laporan mobile app dengan gejala identik) hasilnya cuma 1 dari beberapa
  // yang benar-benar terkirim ke WhatsApp. Root cause: WAHA/WhatsApp tidak
  // bisa diandalkan menerima beberapa kirim media BERSAMAAN dari satu sesi —
  // sudah ditangani di jalur lain (send-product & send-documentation di
  // backend/src/routes/conversations.js) dengan loop SEKUENSIAL + delay
  // 1500ms antar kirim; forward bulk luput dari pola yang sama.
  async function handleForward(targetConvId) {
    if (forwarding || !items.length) return;
    setForwarding(true);
    let gagal = 0;
    let pesanErrorPertama = "";
    for (let i = 0; i < items.length; i++) {
      try {
        await api.forwardMessage(items[i].conversationId, items[i].id, targetConvId);
      } catch (err) {
        gagal += 1;
        if (!pesanErrorPertama) pesanErrorPertama = err.message || "";
      }
      if (i < items.length - 1) await new Promise((r) => setTimeout(r, 1500));
    }
    setForwarding(false);
    if (gagal > 0) {
      // Sertakan pesan error ASLI dari backend (mis. "Media pesan ini belum
      // berhasil diunduh dari WhatsApp — coba lagi sebentar lagi.") — sales
      // sebelumnya cuma lihat "gagal diteruskan" tanpa tahu kenapa/harus
      // ngapain, jadi terasa seperti fitur forward-nya rusak permanen.
      alert(`${gagal} dari ${items.length} pesan gagal diteruskan.\n\n${pesanErrorPertama}`);
    } else {
      onClose();
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
            {items.length > 1
              ? `${items.length} pesan dipilih`
              : (items[0]?.content || (items[0]?.mediaType ? `[${items[0].mediaType}]` : "Pesan"))}
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
export default function ChatWindow({ conversation, user, onBack, panelCollapsed, onTogglePanel, listCollapsed, onToggleList, focusMode, onToggleFocusMode }) {
  const conversationId = conversation?.id;
  const queryClient = useQueryClient();
  const location = useLocation();
  const navigate = useNavigate();

  // Fetch + realtime + windowing pesan (lihat useMessages.js)
  const { isLoading: messagesLoading } = useMessages(conversationId);
  // Instance terpisah dari yang dipakai Composer — sama-sama menulis ke
  // messageStore/backend yang sama, aman dipanggil dari 2 tempat berbeda
  // (dipakai khusus untuk tombol "Coba lagi" di bubble gagal kirim).
  const retryMutation = useSendMessage(conversationId);

  const [showSearch, setShowSearch]     = useState(false);
  const [takingOver, setTakingOver]     = useState(false);
  const [resolving, setResolving]       = useState(false);
  const [forwardMsg, setForwardMsg]     = useState(null);
  const [forwardBulk, setForwardBulk]   = useState(null); // array pesan — forward BULK dari mode pilih (beda dari forwardMsg tunggal)
  const [dragOver, setDragOver]         = useState(false);
  const [syncingHistory, setSyncingHistory] = useState(false);
  const [selectionMode, setSelectionMode] = useState(false);
  const [selectedIds, setSelectedIds]     = useState(() => new Set());

  const allMessages = useMessagesForConv(conversationId);

  // Mention "@<LID>" → "@Nama" di bubble grup — port dari mobile (D-031
  // lanjutan, 21 Agustus 2026). Sebelumnya web menampilkan LID mentah
  // (mis. "@201086224863438") karena tidak pernah fetch daftar anggota
  // grup untuk menerjemahkannya, walau backend & mobile sudah lama
  // mendukung ini. isGroupForFetch dihitung terpisah dari `isGroup` di
  // bawah (yang baru ada SETELAH early-return !conversation) supaya hook
  // ini tetap aman dipanggil tanpa syarat di setiap render.
  const isGroupForFetch = conversation?.type === "GROUP";
  const [participants, setParticipants] = useState([]);
  useEffect(() => {
    if (!isGroupForFetch || !conversationId) { setParticipants([]); return; }
    let alive = true;
    api.getParticipants(conversationId).then((data) => { if (alive) setParticipants(data); }).catch(() => {});
    return () => { alive = false; };
  }, [isGroupForFetch, conversationId]);
  const mentionMap = React.useMemo(() => buatPetaMention(participants), [participants]);

  const messageListRef  = useRef(null);
  const mediaUploaderRef = useRef(null); // diisi Composer -> MediaUploader, dipakai untuk drag-drop & paste dari luar composer

  useEffect(() => {
    setShowSearch(false);
    setSelectionMode(false);
    setSelectedIds(new Set());
  }, [conversationId]);

  // BUG FIX (swipe-back di PWA/Android salah navigasi) — sama seperti
  // mobileView di Inbox.jsx: bottom sheet Customer Panel ini dulu cuma
  // local state (showCustomerDetail), tidak terhubung ke browser history.
  // Buka sheet TIDAK push history entry baru, jadi gesture "swipe back"
  // malah langsung pop keluar dari tampilan chat (bahkan sampai ke
  // Dashboard), bukan menutup sheet dulu. Sekarang derive dari
  // location.state (pola sama dengan Inbox.jsx) — swipe-back maupun tombol
  // X di sheet sama-sama cuma nutup sheet ini dulu, chat di baliknya tetap
  // utuh.
  const showCustomerDetail = !!location.state?.customerSheetOpen;

  function openCustomerDetail() {
    if (location.state?.customerSheetOpen) return;
    navigate(`${location.pathname}${location.search}`, { state: { ...location.state, customerSheetOpen: true } });
  }
  function closeCustomerDetail() {
    if (location.state?.customerSheetOpen) navigate(-1);
  }

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
  // Task 3 — drag & drop media sekarang berlaku juga untuk grup (composer
  // grup sudah aktif penuh, tidak ada alasan media di-block khusus di sini).
  function handleDragOver(e) { e.preventDefault(); setDragOver(true); }
  function handleDragLeave() { setDragOver(false); }
  function handleDrop(e) {
    e.preventDefault();
    setDragOver(false);
    if (e.dataTransfer.files?.length) mediaUploaderRef.current?.addFiles(e.dataTransfer.files);
  }

  // BUG KRITIS produksi — conversation.sessionId bisa null untuk conversation
  // lama (dibuat sebelum Fase F, atau lewat sync-history yang tidak lewat
  // webhook). Backend TOLAK kirim (409) sampai ini dibetulkan manual di sini,
  // supaya balasan tidak pernah nyasar keluar dari nomor CS yang salah.
  async function handleSetSession(sessionId) {
    try {
      const updated = await api.setConversationSession(conversationId, sessionId);
      useConversationStore.getState().upsertConversation(updated);
    } catch (err) { alert(err.message); }
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

  // Sync riwayat 1 percakapan ini saja dari WAHA (admin only) — recovery
  // kasus per-kasus (mis. bubble kosong/pesan hilang) tanpa perlu sync
  // SEMUA customer lewat Pengaturan > Status WhatsApp.
  async function handleSyncHistory() {
    setSyncingHistory(true);
    try {
      const result = await api.syncConversationHistory(conversationId);
      queryClient.invalidateQueries({ queryKey: ["messages", conversationId] });
      alert(`Sync selesai — ${result.messagesFound} pesan ditemukan di WAHA, ${result.newMessages} pesan baru disimpan.`);
    } catch (err) {
      alert("Gagal sync riwayat: " + err.message);
    } finally {
      setSyncingHistory(false);
    }
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

  // "Hapus untuk Saya" — hard delete dari DB CRM saja, tidak menyentuh
  // WhatsApp. Dipakai dari action-bar hover per-bubble.
  async function handleDeleteLocal(msg) {
    try {
      await api.deleteMessageLocal(conversationId, msg.id);
      useMessageStore.getState().removeMessage(msg.id);
    } catch (err) {
      alert("Gagal hapus: " + err.message);
    }
  }

  // "Hapus untuk Semua" — revoke via WAHA (2 hari 12 jam, ditegakkan backend).
  async function handleDeleteEveryone(msg) {
    try {
      const updated = await api.deleteMessageEveryone(conversationId, msg.id);
      useMessageStore.getState().updateMessage(msg.id, updated);
    } catch (err) {
      alert("Gagal hapus: " + err.message);
    }
  }

  // ── Mode pilih (multi-select) — dipicu dari action-bar hover per-bubble
  // (lihat MessageBubble.jsx). Tap bubble lain (selama selectionMode aktif)
  // menambah/mengurangi seleksi lewat onToggleSelect. Keluar otomatis
  // begitu seleksi kosong (sama seperti WA asli), atau lewat tombol X.
  function enterSelectionMode(msg) {
    setSelectionMode(true);
    setSelectedIds(new Set([msg.id]));
  }
  function toggleSelect(msg) {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(msg.id)) next.delete(msg.id); else next.add(msg.id);
      if (next.size === 0) setSelectionMode(false);
      return next;
    });
  }
  function cancelSelection() {
    setSelectionMode(false);
    setSelectedIds(new Set());
  }

  const selectedMessages = allMessages.filter((m) => selectedIds.has(m.id));
  const DELETE_EVERYONE_WINDOW_MS = (2 * 24 + 12) * 60 * 60 * 1000;
  const canBulkDeleteEveryone = selectedMessages.length > 0 && selectedMessages.every((m) =>
    m.direction === "OUTBOUND" && !m.isRevoked && m.status !== "sending" && m.status !== "failed"
    && (Date.now() - new Date(m.createdAt).getTime()) < DELETE_EVERYONE_WINDOW_MS
  );

  async function runBulkDeleteLocal(ids) {
    const results = await Promise.allSettled(ids.map((id) => api.deleteMessageLocal(conversationId, id)));
    results.forEach((r, i) => { if (r.status === "fulfilled") useMessageStore.getState().removeMessage(ids[i]); });
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) alert(`${failed} dari ${ids.length} pesan gagal dihapus.`);
    cancelSelection();
  }
  async function runBulkDeleteEveryone(ids) {
    const results = await Promise.allSettled(ids.map((id) => api.deleteMessageEveryone(conversationId, id)));
    results.forEach((r, i) => { if (r.status === "fulfilled") useMessageStore.getState().updateMessage(ids[i], r.value); });
    const failed = results.filter((r) => r.status === "rejected").length;
    if (failed > 0) alert(`${failed} dari ${ids.length} pesan gagal dihapus.`);
    cancelSelection();
  }
  // Satu tombol hapus di toolbar — tawarkan pilihan lewat confirm() 2 tahap
  // (pola sama dengan mobile: opsi "untuk semua" cuma muncul kalau SEMUA
  // yang dipilih memenuhi syarat, lihat canBulkDeleteEveryone).
  function handleBulkDeleteClick() {
    const ids = [...selectedIds];
    if (canBulkDeleteEveryone) {
      if (confirm(`Hapus ${ids.length} pesan untuk SEMUA (termasuk dari WhatsApp pelanggan)? Klik Batal untuk pilih "Hapus untuk Saya" saja.`)) {
        runBulkDeleteEveryone(ids);
        return;
      }
    }
    if (confirm(`Hapus ${ids.length} pesan untuk SAYA saja (tidak menghapus dari WhatsApp pelanggan)?`)) {
      runBulkDeleteLocal(ids);
    }
  }
  function handleBulkForward() {
    setForwardBulk(selectedMessages);
  }

  if (!conversation) {
    return (
      <div className="chat-window empty-state">
        {/* Satu-satunya cara membuka lagi daftar percakapan kalau sedang
            disembunyikan DAN belum ada chat aktif — tanpa ini, kolom kiri
            collapsed + belum pilih siapa pun = jalan buntu tanpa jalan balik
            selain reload halaman. */}
        {listCollapsed && onToggleList && (
          <button
            className="chat-action-btn chat-empty-reopen-list"
            onClick={onToggleList}
            title="Tampilkan daftar percakapan"
            aria-label="Tampilkan daftar percakapan"
          >
            <PanelLeftOpen size={18} />
          </button>
        )}
        <MessageSquare size={40} className="chat-empty-icon" />
        <span>Pilih percakapan di sebelah kiri</span>
      </div>
    );
  }

  const isGroup     = conversation.type === "GROUP";
  const rawPhone    = conversation.customer?.phone;
  const name        = isGroup
    ? (conversation.groupName || "Grup WhatsApp")
    : (conversation.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || conversation.customer?.instagramHandle || "Pelanggan");
  const assignedTo  = conversation.assignedTo;
  const isMine      = assignedTo?.id === user?.id;
  const canTakeover = conversation.canTakeOver ?? false;
  // Task 3 — grup sekarang bisa dibalas juga, jadi butuh sessionId yang
  // benar sama seperti conversation individual (grup TETAP dapat sessionId
  // dari webhook, lihat handleGroupMessage di webhooks.js) — tidak lagi
  // dikecualikan dari pengecekan ini.
  const sessionUnknown = conversation.channel === "WHATSAPP" && !conversation.sessionId;

  return (
    <div className={`chat-window${dragOver ? " chat-window-drag" : ""}`} onDragOver={handleDragOver} onDragLeave={handleDragLeave} onDrop={handleDrop}>
      {dragOver && (
        <div className="chat-window-drop-overlay"><span>Lepaskan untuk mengirim</span></div>
      )}

      {/* ── Header ── */}
      <div className="chat-header">
        <button className="chat-back-btn" onClick={onBack} title="Kembali ke daftar"><ArrowLeft size={18} /></button>
        {/* Mirror dari tombol panel kanan di bawah (PanelRightClose/Open) —
            cuma tampil di desktop (onToggleList tidak dioper di mobile,
            lihat Inbox.jsx: daftar & chat mobile tidak pernah mount
            bersamaan jadi "sembunyikan daftar" tidak relevan di sana). */}
        {onToggleList && (
          <button className="chat-action-btn chat-toggle-list-btn" onClick={onToggleList}
            title={listCollapsed ? "Tampilkan daftar percakapan" : "Sembunyikan daftar percakapan"}>
            {listCollapsed ? <PanelLeftOpen size={17} /> : <PanelLeftClose size={17} />}
          </button>
        )}
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
                {/* Wave 4 (redesign Inbox) — pipeline CRM (STAGE_LABELS) itu
                    KONSEP LAIN dari status percakapan (OPEN/PENDING/RESOLVED,
                    diubah lewat menu "More", lihat Wave 8). Sebelumnya
                    pipeline TIDAK ditampilkan sama sekali di ChatWindow —
                    sales harus buka Customer Panel dulu untuk tahu tahap
                    pipeline pelanggan. Ditaruh di baris meta (dekat identitas
                    pelanggan), bukan di cluster status/resolve, supaya dua
                    konsep itu terlihat jelas terpisah, bukan tercampur. */}
                {conversation.customer?.pipelineStage && (
                  <Badge variant={stageVariant(conversation.customer.pipelineStage)}>
                    {STAGE_LABELS[conversation.customer.pipelineStage] || conversation.customer.pipelineStage}
                  </Badge>
                )}
                {isMine ? (
                  <span className="lead-badge mine"><UserCheck size={11} /> Lead Kamu</span>
                ) : assignedTo ? (
                  <span className="lead-badge other"><Users size={11} /> {assignedTo.name}</span>
                ) : null}
                {/* Penanda asal dari iklan Meta (CTWA) — dicatat sekali di
                    Customer.leadSource saat pelanggan baru dibuat (webhooks.js
                    "Lapis 1"), ditampilkan di sini karena WhatsApp asli juga
                    menandai pesan pertama dari iklan klik-ke-WhatsApp. */}
                {conversation.customer?.leadSource === "META_ADS" && (
                  <span className="lead-badge ads" title={conversation.customer?.leadSourceDetail || undefined}>
                    <Megaphone size={11} /> Dari Iklan
                  </span>
                )}
              </span>
            )}
          </div>
        </div>

        {/* Tombol info — dipakai mobile untuk buka bottom sheet Customer Panel */}
        <button className="chat-info-btn" onClick={openCustomerDetail} title="Info Pelanggan">
          <Info size={18} />
        </button>

        {/* Wave 8 (redesign Inbox) — cluster ini dulu berisi 6 kontrol
            (search/panel-toggle/focus-mode/sync-history/takeover/status-
            select) sebelum "Selesaikan". Sekarang cuma kontrol LAYOUT
            (panel-toggle, focus-mode) + Resolve (aksi primer) — sisanya
            (search, tarik riwayat, ganti status, ambil alih) pindah ke
            menu "More" di bawah, satu komponen yang sama dipakai desktop
            MAUPUN mobile (lihat komentar .chat-dots-container di index.css). */}
        <div className="chat-header-desktop-actions">
          {onTogglePanel && (
            <button className="chat-action-btn" onClick={onTogglePanel}
              title={panelCollapsed ? "Tampilkan panel pelanggan" : "Sembunyikan panel pelanggan"}>
              {panelCollapsed ? <PanelRightOpen size={17} /> : <PanelRightClose size={17} />}
            </button>
          )}
          {/* Focus Mode DIPINDAH ke menu "More" (D-115, laporan owner:
              "banyak ikon"). Dulu ikonnya (Maximize2) duduk berjejer dengan
              2 ikon panel-toggle yang bentuknya mirip — tiga ikon layout
              beruntun yang sulit dibedakan sekilas. Sekarang cuma 2 ikon
              layout yang tersisa di header (kiri=pane kiri, kanan=pane
              kanan), Focus Mode jadi item BERLABEL di menu + shortcut F. */}
          {!isGroup && conversation.status !== "RESOLVED" && (
            <button className="btn btn-primary btn-sm" onClick={handleResolve} disabled={resolving} style={{ gap: 4, display: "flex", alignItems: "center", flexShrink: 0 }}>
              <CheckCircle size={13} /> <span className="resolve-label">{resolving ? "..." : "Selesaikan"}</span>
            </button>
          )}
        </div>

        <div className="chat-dots-container">
          <Menu
            trigger={<button className="chat-action-btn chat-dots-btn" title="Menu"><MoreVertical size={18} /></button>}
          >
            <MenuItem icon={Search} onSelect={() => setShowSearch(true)}>Cari Pesan</MenuItem>
            <MenuItem icon={Info} onSelect={openCustomerDetail}>Info Pelanggan</MenuItem>
            {onToggleFocusMode && (
              <MenuItem
                icon={focusMode ? Minimize2 : Maximize2}
                onSelect={onToggleFocusMode}
              >
                {focusMode ? "Keluar Focus Mode (F)" : "Focus Mode (F)"}
              </MenuItem>
            )}
            {!isGroup && isAdminUser(user) && (
              <MenuItem icon={Download} onSelect={handleSyncHistory} disabled={syncingHistory}>
                {syncingHistory ? "Sedang sinkronisasi..." : "Tarik Riwayat dari WAHA"}
              </MenuItem>
            )}
            {!isGroup && (
              <>
                <MenuSeparator />
                {/* Ketiga status TETAP bisa dipilih eksplisit (dulu lewat
                    <select>, sekarang per-item) — status SEKARANG disembunyikan
                    dari daftar (tidak ada gunanya "ubah ke status yang sama"). */}
                {conversation.status !== "OPEN" && (
                  <MenuItem icon={RotateCcw} onSelect={() => handleStatusChange("OPEN")}>Tandai Terbuka</MenuItem>
                )}
                {conversation.status !== "PENDING" && (
                  <MenuItem icon={MessageSquare} onSelect={() => handleStatusChange("PENDING")}>Tandai Pending</MenuItem>
                )}
                {conversation.status !== "RESOLVED" && (
                  <MenuItem icon={CheckCircle} onSelect={handleResolve} disabled={resolving}>Tandai Selesai</MenuItem>
                )}
              </>
            )}
            {!isGroup && !isMine && (
              <>
                <MenuSeparator />
                {!assignedTo ? (
                  <MenuItem icon={UserCheck} onSelect={handleTakeover} disabled={takingOver}>Ambil Percakapan</MenuItem>
                ) : canTakeover ? (
                  <MenuItem icon={UserCheck} onSelect={handleTakeover} disabled={takingOver}>Ambil Alih (belum dibalas 1j+)</MenuItem>
                ) : (
                  <MenuItem icon={UserCheck} disabled>Dipegang {assignedTo.name}</MenuItem>
                )}
              </>
            )}
          </Menu>
        </div>
      </div>

      {/* ── Sesi WA belum diketahui — wajib dipilih dulu sebelum bisa kirim ── */}
      {sessionUnknown && (
        <div className="session-unknown-banner">
          <span>Sesi WA percakapan ini belum diketahui — pilih sesi untuk bisa membalas.</span>
          <select
            defaultValue=""
            onChange={(e) => { if (e.target.value) handleSetSession(e.target.value); }}
          >
            <option value="" disabled>Pilih sesi...</option>
            <option value="CS-1">CS-1</option>
            <option value="CS-2">CS-2</option>
          </select>
        </div>
      )}

      {!isGroup && <HandoverHistoryBanner conversationId={conversationId} />}

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
        loading={messagesLoading}
        mentionMap={mentionMap}
        onReply={(msg) => useComposerStore.getState().setReplyTarget(msg)}
        onForward={(msg) => setForwardMsg(msg)}
        onEdit={(msg) => useComposerStore.getState().startEditingMessage(conversationId, msg)}
        onRetry={handleRetry}
        onDeleteLocal={handleDeleteLocal}
        onDeleteEveryone={handleDeleteEveryone}
        onEnterSelection={enterSelectionMode}
        selectionMode={selectionMode}
        selectedIds={selectedIds}
        onToggleSelect={toggleSelect}
      />

      {/* ── Toolbar mode pilih GANTIKAN Composer total selama aktif — tidak
          masuk akal mengetik pesan baru SEKALIGUS memilih pesan lama utk
          dihapus/diteruskan. ── */}
      {selectionMode ? (
        <div className="chat-input-area" style={{ display: "flex", alignItems: "center", gap: 8, padding: "10px 16px" }}>
          <button onClick={cancelSelection} className="btn-icon" title="Batal"><X size={18} /></button>
          <span style={{ fontWeight: 700, fontSize: 14 }}>{selectedIds.size} dipilih</span>
          <div style={{ flex: 1 }} />
          <button onClick={handleBulkForward} className="btn-icon" title="Teruskan"><Forward size={18} /></button>
          <button onClick={handleBulkDeleteClick} className="btn-icon" title="Hapus"><Trash2 size={18} color="var(--danger, #dc2626)" /></button>
        </div>
      ) : (
        <Composer conversation={conversation} mediaUploaderRef={mediaUploaderRef} />
      )}

      {/* ── Forward Modal ── */}
      {forwardMsg && <ForwardModal messageToForward={forwardMsg} onClose={() => setForwardMsg(null)} />}
      {forwardBulk && (
        <ForwardModal messagesToForward={forwardBulk} onClose={() => { setForwardBulk(null); cancelSelection(); }} />
      )}

      {/* ── CustomerPanel — full-screen sheet di mobile (Level 3 navigasi,
          via CSS breakpoint), modal biasa di desktop ── */}
      {showCustomerDetail && (
        <div className="mobile-bottom-sheet-overlay" onClick={closeCustomerDetail}>
          <div className="mobile-bottom-sheet" onClick={(e) => e.stopPropagation()}>
            <div className="bottom-sheet-header">
              <div className="bottom-sheet-handle" />
              <button
                type="button"
                className="bottom-sheet-close-btn"
                onClick={closeCustomerDetail}
                title="Tutup"
                aria-label="Tutup"
              >
                <X size={18} />
              </button>
            </div>
            <CustomerPanel conversation={conversation} onClose={closeCustomerDetail} />
          </div>
        </div>
      )}
    </div>
  );
}
