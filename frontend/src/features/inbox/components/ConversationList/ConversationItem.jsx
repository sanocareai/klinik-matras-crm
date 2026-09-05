import React, { memo, useRef, useState } from "react";
import { Pin, Users, Eye, CheckCheck, Check, AlertTriangle } from "lucide-react";
import Avatar from "../../../../components/Avatar.jsx";
import { formatPhoneDisplay } from "../../../../utils/format.js";
import { smartTimestamp } from "../../utils/formatTime.js";
import { useConversation, useActiveId, useConversationStore, useConvSearchQuery } from "../../stores/conversationStore.js";
import { api } from "../../../../api.js";
import TransferPickerPopover from "./TransferPickerPopover.jsx";
import PeekPreview from "./PeekPreview.jsx";
import { isAdminUser } from "@/lib/roles.js";

// Peek Preview (port dari mobile) — hover sebentar di baris ini, popup
// muncul dekat kursor. Delay mencegah popup muncul tiap kursor lewat
// sekilas saat scroll (bukan hover sungguhan).
const PEEK_HOVER_DELAY_MS = 450;

const STATUS_LABEL = { OPEN: "Buka", PENDING: "Pending", RESOLVED: "Selesai" };

// Baca role langsung dari localStorage (pola sama dgn api.js#authHeaders) —
// item ini ada RATUSAN di list, tidak masuk akal prop-drill `user` dari
// App.jsx → Inbox.jsx → ConversationList.jsx cuma utk 1 flag admin-only.
function isCurrentUserAdmin() {
  try {
    return isAdminUser(JSON.parse(localStorage.getItem("user") || "null"));
  } catch {
    return false;
  }
}

function ConversationItemBase({ id, selectionMode, selected, onToggleSelect, onEnterSelection }) {
  // Subscribe GRANULAR — hanya re-render item ini kalau conversation dengan
  // id ini berubah, bukan seluruh list (itu poin utama pola "pass id saja").
  const c = useConversation(id);
  const activeId = useActiveId();
  const searchQuery = useConvSearchQuery();
  const [contextMenu, setContextMenu] = useState(null); // { x, y }
  const [transferPicker, setTransferPicker] = useState(null); // { x, y }
  const [peek, setPeek] = useState(null); // { x, y }
  const longPressTimerRef = useRef(null);
  const longPressAt = useRef(0);
  const peekTimerRef = useRef(null);
  const peekCloseTimerRef = useRef(null);
  const isAdmin = isCurrentUserAdmin();

  if (!c) return null;

  const isActive   = activeId === id;
  const isGroup    = c.type === "GROUP";
  const rawPhone   = c.customer?.phone;
  const name       = isGroup
    ? (c.groupName || "Grup WhatsApp")
    : (c.customer?.name || (rawPhone ? formatPhoneDisplay(rawPhone) : null) || c.customer?.instagramHandle || "Pelanggan");
  const lastMsg    = c.messages?.[0];
  const isUnread   = !!c.unread;
  const isRead     = !!c.isRead;
  const isReplied  = !c.isUnanswered;
  const isPinned   = !!c.pinned;
  // BUG YANG DIPERBAIKI: `unreadCount ?? (isUnread ? 1 : 0)` tidak fallback
  // saat unreadCount sudah 0 (angka, bukan null/undefined) — percakapan
  // yang di-mark unread manual (unread=true, unreadCount belum ikut naik
  // dari 0) jadi tidak tampil badge angkanya sama sekali walau isUnread
  // true (bug sama ditemukan di mobile/ChatListScreen.js, konfirmasi
  // produksi: badge tab "Belum Dibaca" 34 tapi baris yang lolos filter cuma 4).
  const unreadCount = c.unreadCount > 0 ? c.unreadCount : (isUnread ? 1 : 0);
  const unreadLabel = unreadCount > 99 ? "99+" : String(unreadCount);
  // Wave 1 (redesign Inbox) — SLA risk, dari data yang SUDAH ADA di payload
  // GET /conversations (isUnanswered/unansweredMinutes), bukan hitungan
  // baru. Ambang 60 menit SAMA PERSIS dengan yang dipakai backend untuk
  // canTakeOver (backend/src/routes/conversations.js) — jangan diubah
  // sepihak di sini, nanti dua tempat beda angka. 45 menit = "mendekati",
  // kasih peringatan dini sebelum benar-benar lewat ambang.
  const unansweredMinutes = c.unansweredMinutes;
  const slaWarn = c.isUnanswered && typeof unansweredMinutes === "number" && unansweredMinutes >= 45 && unansweredMinutes < 60;
  const slaBreach = c.isUnanswered && typeof unansweredMinutes === "number" && unansweredMinutes >= 60;
  // D-119 (redesign minimalis) — CS-1/CS-2, "1st: X", dan label pipeline
  // DIHAPUS dari baris ini (dulu dihitung di sini lalu dirender sebagai pil
  // di .conv-badges) — detail sekunder itu tetap terlihat begitu percakapan
  // dibuka (header chat/peek preview), tidak perlu bersaing tempat di
  // SETIAP baris daftar. STAGE_LABELS tidak lagi dipakai file ini.

  function selectConversation() {
    useConversationStore.getState().setActive(id);
    if (c.unread || c.unreadCount > 0) {
      useConversationStore.getState().upsertConversation({ id, unread: false, unreadCount: 0 });
      // Endpoint khusus (Fase F) — reset unreadCount di server juga, bukan cuma unread lama
      api.markConversationRead(id).catch(() => {});
    }
  }

  function togglePin(nextPinned) {
    const prevPinned = c.pinned;
    const prevPinnedAt = c.pinnedAt;
    useConversationStore.getState().upsertConversation({
      id, pinned: nextPinned, pinnedAt: nextPinned ? new Date().toISOString() : null,
    });
    api.updateConversation(id, { pinned: nextPinned }).catch(() => {
      useConversationStore.getState().upsertConversation({ id, pinned: prevPinned, pinnedAt: prevPinnedAt });
    });
  }

  function openContextMenu(x, y) {
    longPressAt.current = Date.now();
    const safeX = Math.min(x, window.innerWidth - 180);
    const safeY = Math.min(y, window.innerHeight - 70);
    setContextMenu({ x: safeX, y: safeY });
  }

  function handleContextMenu(e) {
    if (selectionMode) return;
    e.preventDefault();
    openContextMenu(e.clientX, e.clientY);
  }

  function handleTouchStart(e) {
    if (selectionMode) return;
    const touch = e.touches[0];
    longPressTimerRef.current = setTimeout(() => openContextMenu(touch.clientX, touch.clientY), 600);
  }
  function handleTouchEnd() { clearTimeout(longPressTimerRef.current); }
  function handleTouchMove() { clearTimeout(longPressTimerRef.current); }

  function handleClick() {
    if (Date.now() - longPressAt.current < 800) return;
    // DULU: `if (peek) return;` — klik saat peek terbuka SENGAJA dibuang,
    // dengan asumsi user sedang berinteraksi dengan popup-nya. Ternyata itu
    // penyebab keluhan "harus klik 2 kali" (laporan owner 5 Sep 2026): peek
    // muncul SENDIRI setelah 450ms menggantung — sangat sering terjadi saat
    // sales cuma membaca baris sebelum mengklik, jadi klik pertama hilang
    // tanpa jejak. Sekarang: tutup peek-nya, lalu TETAP lanjut buka chat —
    // satu klik selalu berarti satu aksi.
    if (peek) setPeek(null);
    if (selectionMode) { onToggleSelect?.(id); return; }
    selectConversation();
  }

  function handleAvatarClick(e) {
    e.stopPropagation();
    if (selectionMode) onToggleSelect?.(id); else onEnterSelection?.(id);
  }

  function handleMouseEnter(e) {
    if (selectionMode) return;
    const x = e.clientX, y = e.clientY;
    clearTimeout(peekTimerRef.current);
    clearTimeout(peekCloseTimerRef.current);
    peekTimerRef.current = setTimeout(() => setPeek({ x, y }), PEEK_HOVER_DELAY_MS);
  }
  // BUG NYATA (dilaporkan owner, 5 September 2026): dulu di sini CUMA
  // `clearTimeout(peekTimerRef.current)` — itu cuma membatalkan timer YANG
  // BELUM SEMPAT jalan (peek yang belum terbuka). Begitu peek SUDAH terbuka
  // (mouse diam >450ms di baris ini), pindah kursor pergi TIDAK menutupnya
  // sama sekali — popup (dan `.conv-context-backdrop` fixed inset:0 z-index
  // 998 miliknya, lihat PeekPreview.jsx) tetap ada TAK TERLIHAT di layar,
  // menelan SETIAP klik berikutnya di baris manapun (klik jatuh ke backdrop
  // yang cuma menutup popup lamanya, bukan ke tombol baris di baliknya).
  // Gejala persis: "gabisa diklik, pas diklik cuma warna row berubah abu"
  // (:hover row memang abu, .conversation-item.unread { background:
  // var(--bg-subtle) } juga abu — user MENGIRA itu efek klik, padahal klik
  // sungguhan tidak pernah sampai ke tombolnya). Ditutup lewat jeda pendek
  // (bukan langsung setPeek(null)) supaya kursor sempat pindah dari baris
  // ke popup-nya sendiri (klik "Buka Chat"/"Ambil Percakapan") tanpa keburu
  // hilang — dibatalkan lagi kalau popup itu sendiri yang di-hover
  // (onMouseEnter di PeekPreview, lihat props di bawah).
  function handleMouseLeave() {
    clearTimeout(peekTimerRef.current);
    clearTimeout(peekCloseTimerRef.current);
    peekCloseTimerRef.current = setTimeout(() => setPeek(null), 250);
  }

  return (
    <button
      className={`conversation-item${isActive ? " active" : ""}${isUnread ? " unread" : ""}${isRead && !isUnread ? " conv-item-read" : ""}${selected ? " conv-item-selected" : ""}`}
      onClick={handleClick}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      style={{ WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" }}
    >
      {/* Klik avatar = masuk/keluar mode pilih massal — pola sama dengan
          mobile (ConversationItem.js). role="button" murni untuk semantik,
          e.stopPropagation di handleAvatarClick sudah cegah bentrok dengan
          onClick baris. */}
      <div className="conv-avatar-wrap" onClick={handleAvatarClick} role="button" tabIndex={-1}>
        {isGroup ? (
          <div className="conv-group-avatar"><Users size={18} /></div>
        ) : (
          <Avatar name={name} src={c.customer?.profilePictureUrl} size="md" />
        )}
        {selectionMode && (
          <span className={`conv-select-checkbox${selected ? " selected" : ""}`}>
            {selected && <Check size={11} color="#fff" strokeWidth={3} />}
          </span>
        )}
      </div>
      <div className="conversation-item-body">
        <div className="conversation-top">
          <span className="customer-name">
            {isPinned && <Pin size={11} className="conv-pin-icon" title="Disematkan" />}
            {isGroup && <Users size={12} className="conv-name-group-icon" title="Percakapan grup" />}
            {name}
          </span>
          {/* D-119 (redesign minimalis, laporan owner: "lebih minimalis, enak
              diliat, tapi tetep keep warnanya") — SLA dulu pil teks penuh
              ("⚠ 178m") di baris badge terpisah, sekarang cuma ikon kecil di
              sebelah waktu (warna SAMA — merah lewat ambang, oranye mendekati
              — detail menit persis pindah ke tooltip, bukan hilang). */}
          <span className="conv-time-group">
            {slaBreach && <AlertTriangle size={11} className="conv-sla-icon breach" title={`Belum dibalas ${unansweredMinutes} menit — sudah bisa diambil alih`} />}
            {slaWarn && <AlertTriangle size={11} className="conv-sla-icon warn" title={`Belum dibalas ${unansweredMinutes} menit`} />}
            <span className="conv-time">{smartTimestamp(c.lastMessageAt)}</span>
          </span>
        </div>

        <div className="conversation-bottom">
          {/* BUG YANG DIPERBAIKI (26 Agustus 2026): baris ini SELALU tampilkan
              pesan TERAKHIR, walau kecocokan pencarian ada di pesan yang jauh
              lebih lama — hasil pencarian jadi kelihatan "asal muncul" karena
              baris preview-nya sama sekali tidak menyebut kata yang dicari.
              Kalau lagi ada pencarian aktif DAN server menemukan pesan yang
              cocok (c.searchMatch, lihat routes/conversations.js), tampilkan
              potongan di SEKITAR kata itu — bukan pesan terakhir. */}
          <p className="last-message">
            {searchQuery.trim() && c.searchMatch
              ? c.searchMatch.snippet
              : lastMsg?.content || (lastMsg?.mediaType ? `[${lastMsg.mediaType}]` : "Belum ada pesan")}
          </p>
          {/* Satu slot kanan-bawah, SATU dari tiga: badge unread (paling
              penting, selalu menang kalau ada), lalu centang "dibalas"/mata
              "dibuka belum dibalas" sebagai IKON POLOS (dulu pil teks
              "Dibuka"/"Dibalas" di baris badge terpisah) — warna SAMA
              (hijau=dibalas, ungu=dibuka, cocok .conv-flag-replied/-opened
              lama), cuma bentuknya ikon kecil, bukan pil. */}
          {unreadCount > 0 ? (
            <span className="unread-count-badge">{unreadLabel}</span>
          ) : isReplied ? (
            <CheckCheck size={14} className="conv-status-icon replied" title="Sudah dibalas" />
          ) : isRead ? (
            <Eye size={13} className="conv-status-icon opened" title="Sudah dibuka, belum dibalas" />
          ) : null}
        </div>

        {/* Baris meta SANGAT ringkas — cuma tampil kalau memang ada info
            yang tidak default: siapa pemegang chat (teks polos, BUKAN pil
            berwarna lagi — cocok warna .lead-badge.other lama, ungu) dan
            titik status (cuma utk admin/status-menyimpang, ganti pil
            "Buka"/"Pending"/"Selesai" yang dulu selalu makan tempat).
            CS-1/CS-2 & "1st: X" (kredit historis siapa balas pertama)
            SENGAJA dihapus dari baris ini — detail sekunder yang sudah bisa
            dilihat di header chat/peek preview begitu dibuka, bukan info
            yang perlu bersaing tempat di tiap baris daftar. */}
        {(c.assignedTo || c.status !== "OPEN" || isAdmin) && (
          <div className="conv-meta-row">
            {(c.status !== "OPEN" || isAdmin) && (
              <span
                className={`conv-status-dot conv-status-${(c.status || "OPEN").toLowerCase()}${isAdmin ? " clickable" : ""}`}
                title={isAdmin ? `Status: ${STATUS_LABEL[c.status] || c.status} — klik untuk transfer lead ke sales lain` : `Status: ${STATUS_LABEL[c.status] || c.status}`}
                onClick={isAdmin ? (e) => { e.stopPropagation(); setTransferPicker({ x: e.clientX, y: e.clientY }); } : undefined}
              />
            )}
            {c.assignedTo && (
              <span className="conv-assigned-name" title={`Sedang dipegang ${c.assignedTo.name}`}>
                {c.assignedTo.name}
              </span>
            )}
          </div>
        )}
      </div>

      {contextMenu && (
        <>
          <div className="conv-context-backdrop"
            onClick={(e) => { e.stopPropagation(); setContextMenu(null); }}
            onContextMenu={(e) => { e.preventDefault(); e.stopPropagation(); setContextMenu(null); }}
          />
          <div className="conv-context-menu" style={{ left: contextMenu.x, top: contextMenu.y }}>
            <button onClick={(e) => { e.stopPropagation(); togglePin(!isPinned); setContextMenu(null); }}>
              <Pin size={14} style={{ color: "#7c3aed" }} />
              {isPinned ? "Lepas Sematan" : "Sematkan di Atas"}
            </button>
          </div>
        </>
      )}

      {peek && (
        <PeekPreview
          conversation={c}
          x={peek.x}
          y={peek.y}
          onClose={() => setPeek(null)}
          onOpenChat={() => { setPeek(null); selectConversation(); }}
          onMouseEnter={() => clearTimeout(peekCloseTimerRef.current)}
          onMouseLeave={() => setPeek(null)}
        />
      )}

      {transferPicker && (
        <TransferPickerPopover
          x={transferPicker.x}
          y={transferPicker.y}
          conversationId={id}
          currentAssignedId={c.assignedToId}
          onClose={() => setTransferPicker(null)}
          onTransferred={(updated) => useConversationStore.getState().upsertConversation(updated)}
        />
      )}
    </button>
  );
}

export default memo(ConversationItemBase);
