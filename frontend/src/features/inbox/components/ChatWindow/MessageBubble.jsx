import React, { memo, useEffect, useRef, useState } from "react";
import {
  Reply, Forward, Pencil, Trash2, CheckSquare, FileText, Image as ImageIcon, Video, Mic, Smile,
  Play, Pause, Check, CheckCheck, Clock, Download, Loader2, MapPin, User, BarChart3, Ban, HelpCircle,
} from "lucide-react";
import { formatWaktu } from "../../../../utils/format.js";
import { parseWaFormatting, extractMapsLocation } from "../../../../utils/waFormat.jsx";
import { ACK, ackToTicks } from "../../utils/ackLevel.js";
import { api } from "../../../../api.js";
import { useMessageStore } from "../../stores/messageStore.js";

// Cek apakah string adalah JSON error (dari bug lama download media)
function isJsonError(str) {
  if (!str) return false;
  try { const p = JSON.parse(str); return !!p.message || !!p.error; } catch { return false; }
}

// Placeholder literal yang ditulis backend/src/utils/parseHistoryMessage.js
// untuk tipe pesan WhatsApp yang sama sekali tidak dikenali (reaksi emoji,
// dll — lihat komentar "unsupported" di sana). BUG YANG DIPERBAIKI:
// sebelumnya string ini dirender apa adanya lewat <span className="bubble-text">
// biasa — tampak seperti teks pesan sungguhan yang aneh/rusak, bukan
// pemberitahuan yang jelas bahwa jenis pesan ini memang belum didukung.
const UNSUPPORTED_PLACEHOLDER = "[Pesan tidak didukung]";

// Backend sekarang punya Message.ack (Fase F) — 0 pending, 1 sent, 2
// delivered, 3 read, diupdate dari webhook message.ack via Socket.IO
// (message:ack) atau ikut ke-load dari GET /:id/messages. Default ke
// ACK.SENT kalau field belum terisi (pesan lama sebelum migration, atau
// belum ada event ack masuk sama sekali).
function AckTicks({ ack }) {
  const ticks = ackToTicks(ack ?? ACK.SENT);
  if (ticks === "none") return null;
  if (ticks === "blue") return <CheckCheck size={14} className="ack-tick ack-tick-blue" />;
  if (ticks === "double") return <CheckCheck size={14} className="ack-tick" />;
  return <Check size={14} className="ack-tick" />;
}

function fmtDuration(s) {
  if (!isFinite(s) || s < 0) return "0:00";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${String(sec).padStart(2, "0")}`;
}

// Player audio kustom (play/pause + progress bar + durasi) — bukan widget
// bawaan browser, sesuai spec Fase C.
function AudioPlayer({ src }) {
  const audioRef = useRef(null);
  const [playing, setPlaying] = useState(false);
  const [progress, setProgress] = useState(0);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);

  function toggle() {
    const el = audioRef.current;
    if (!el) return;
    if (playing) el.pause(); else el.play();
  }
  function handleTimeUpdate() {
    const el = audioRef.current;
    if (!el?.duration) return;
    setCurrentTime(el.currentTime);
    setProgress(el.currentTime / el.duration);
  }
  function handleSeek(e) {
    const el = audioRef.current;
    if (!el || !duration) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    el.currentTime = ratio * duration;
  }

  return (
    <div className="audio-player" onClick={(e) => e.stopPropagation()}>
      <audio
        ref={audioRef}
        src={src}
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => setPlaying(false)}
        onTimeUpdate={handleTimeUpdate}
        onLoadedMetadata={(e) => setDuration(e.target.duration || 0)}
      />
      <button type="button" className="audio-player-btn" onClick={toggle}>
        {playing ? <Pause size={15} /> : <Play size={15} />}
      </button>
      <div className="audio-player-track" onClick={handleSeek}>
        <div className="audio-player-fill" style={{ width: `${progress * 100}%` }} />
      </div>
      <span className="audio-player-time">{fmtDuration(playing || currentTime ? currentTime : duration)}</span>
    </div>
  );
}

const MEDIA_TYPE_ICON = {
  image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Smile,
  location: MapPin, contact: User, poll: BarChart3,
};
const MEDIA_TYPE_LABEL = {
  image: "Foto", video: "Video", audio: "Pesan Suara", document: "Dokumen", sticker: "Stiker",
  location: "Lokasi", contact: "Kontak", poll: "Polling",
};

// Lokasi/kontak/poll BUKAN media asli (tidak pernah punya mediaUrl) —
// content-nya JSON string (lihat backend/src/utils/parseHistoryMessage.js),
// perlu di-parse ulang di sini untuk dirender jadi card, bukan teks mentah.
const STRUCTURED_TYPES = new Set(["location", "contact", "poll"]);
function parseStructuredContent(mediaType, content) {
  if (!STRUCTURED_TYPES.has(mediaType)) return null;
  try { return JSON.parse(content); } catch { return null; }
}

function LocationCard({ data }) {
  const { lat, lng, name, address } = data;
  const canOpen = lat != null && lng != null;
  return (
    <div className="bubble-struct-card">
      <div className="bubble-struct-header">
        <MapPin size={16} />
        <span className="bubble-struct-title">{name || "Lokasi"}</span>
      </div>
      {address && <div className="bubble-struct-sub">{address}</div>}
      {canOpen && (
        <a
          href={`https://www.google.com/maps?q=${lat},${lng}`}
          target="_blank" rel="noreferrer" className="bubble-struct-link"
          onClick={(e) => e.stopPropagation()}
        >
          Buka di Maps
        </a>
      )}
    </div>
  );
}

function ContactCard({ data }) {
  const contacts = data.contacts || [];
  return (
    <div className="bubble-struct-card">
      {contacts.map((c, i) => (
        <div key={i} className="bubble-struct-header" style={{ marginTop: i > 0 ? 6 : 0 }}>
          <User size={16} />
          <div>
            <div className="bubble-struct-title">{c.name || "Kontak"}</div>
            {c.phone && <div className="bubble-struct-sub">{c.phone}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

function PollCard({ data }) {
  const options = data.options || [];
  return (
    <div className="bubble-struct-card">
      <div className="bubble-struct-header">
        <BarChart3 size={16} />
        <span className="bubble-struct-title">{data.question || "Polling"}</span>
      </div>
      {options.map((opt, i) => (
        <div key={i} className="bubble-poll-option">{opt}</div>
      ))}
    </div>
  );
}

// Kartu placeholder untuk media yang mediaType-nya diketahui tapi mediaUrl
// belum tersedia (Fix 4 — WAHA gagal auto-download saat webhook masuk, atau
// data lama sebelum Fix 1). Tombol "Muat Media" panggil fetch-on-demand
// (POST .../load-media) — kalau berhasil, update store langsung supaya
// bubble ini otomatis ganti jadi media asli tanpa perlu refresh chat.
function MediaPlaceholderCard({ message, conversationId }) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const Icon = MEDIA_TYPE_ICON[message.mediaType] || FileText;
  const label = MEDIA_TYPE_LABEL[message.mediaType] || "Media";

  async function handleLoad(e) {
    e.stopPropagation();
    if (!conversationId) return;
    setLoading(true);
    setError(null);
    try {
      const updated = await api.loadMessageMedia(conversationId, message.id);
      useMessageStore.getState().updateMessage(message.id, { mediaUrl: updated.mediaUrl });
    } catch (err) {
      setError(err.message || "Gagal muat media");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="bubble-media-placeholder">
      <Icon size={16} />
      <span>{label}{message.content && !message.content.startsWith("[") ? ` — ${message.content}` : ""}</span>
      <button type="button" className="bubble-media-load-btn" onClick={handleLoad} disabled={loading}>
        {loading ? <Loader2 size={13} className="spin" /> : <Download size={13} />}
        {loading ? "Memuat..." : "Muat Media"}
      </button>
      {error && <span className="bubble-media-load-error">{error}</span>}
    </div>
  );
}

function VideoThumb({ src, onClick }) {
  return (
    <button type="button" className="bubble-video-thumb" onClick={onClick}>
      <video src={src} preload="metadata" className="bubble-video-thumb-el" />
      <span className="bubble-video-play-icon"><Play size={20} fill="white" /></span>
    </button>
  );
}

const EDIT_WINDOW_MS = 15 * 60 * 1000; // 15 menit — sama dengan backend (conversations.js), cuma dipakai sembunyikan tombol Edit di UI, backend tetap sumber kebenaran/penegak aturan
const DELETE_EVERYONE_WINDOW_MS = (2 * 24 + 12) * 60 * 60 * 1000; // 2 hari 12 jam — SAMA dengan backend, cuma gating tampilan

function MessageBubbleBase({
  message: m, conversationId, isGroup, onReply, onForward, onEdit, onJumpToReply, highlighted, onRetry, onOpenMedia,
  onDeleteLocal, onDeleteEveryone, onEnterSelection, selectionMode, selected, onToggleSelect,
}) {
  // Revisi 28 Jul 2026 — GANTI POLA INTERAKSI: dulu aksi pesan (Balas/
  // Teruskan/Edit/Hapus/Pilih) muncul sebagai overlay mengambang begitu
  // KURSOR LEWAT di atas bubble (`hovered`). Masalahnya: (a) kelihatan
  // kuno & "berkedip" tiap kursor lewat tanpa sengaja, (b) di layar sentuh
  // hover itu konsep yang tidak ada, jadi dulu dipaksa pakai long-press yang
  // menampilkan overlay yang SAMA lalu auto-hilang setelah 4 detik, (c)
  // overlay-nya menumpuk di atas bubble & sering ketutup/kepotong.
  //
  // Sekarang: MENU KONTEKS sungguhan — klik-kanan di desktop,
  // tahan (long-press) di HP/tablet. Menu muncul DI POSISI kursor/jari
  // (position: fixed), bukan menempel di atas bubble, jadi tidak pernah
  // kepotong dan tidak pernah muncul tanpa diminta.
  const [menuPos, setMenuPos] = useState(null); // { x, y } | null
  const longPressTimerRef = useRef(null);
  const touchStartRef = useRef(null);
  const rowRef = useRef(null);
  const menuRef = useRef(null);

  const closeMenu = () => setMenuPos(null);

  // Tutup menu saat klik/sentuh di luar, scroll, resize, atau tekan Escape.
  // Scroll WAJIB ikut menutup: menu pakai position fixed (koordinat viewport),
  // jadi kalau daftar pesan di-scroll sementara menu terbuka, menu akan
  // "menggantung" di tempat yang tidak lagi berkaitan dengan bubble-nya.
  useEffect(() => {
    if (!menuPos) return;
    function onOutside(e) {
      if (menuRef.current && !menuRef.current.contains(e.target)) closeMenu();
    }
    function onKey(e) { if (e.key === "Escape") closeMenu(); }
    document.addEventListener("mousedown", onOutside);
    document.addEventListener("touchstart", onOutside);
    document.addEventListener("keydown", onKey);
    // capture:true — event scroll tidak "bubble", jadi listener di document
    // tanpa capture TIDAK akan kena scroll dari container pesan di dalamnya.
    document.addEventListener("scroll", closeMenu, true);
    window.addEventListener("resize", closeMenu);
    return () => {
      document.removeEventListener("mousedown", onOutside);
      document.removeEventListener("touchstart", onOutside);
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("scroll", closeMenu, true);
      window.removeEventListener("resize", closeMenu);
    };
  }, [menuPos]);

  const isOut     = m.direction === "OUTBOUND";
  const isSending = m.status === "sending";
  const isFailed  = m.status === "failed";
  const isRevoked = !!m.isRevoked;
  const hasMedia  = !!m.mediaType;
  // Sama seperti WhatsApp asli: cuma teks milik sendiri, belum dihapus,
  // sudah benar-benar terkirim, dalam batas 15 menit.
  const canEdit = isOut && !isRevoked && !isSending && !isFailed && !hasMedia && !!onEdit
    && (Date.now() - new Date(m.createdAt).getTime()) < EDIT_WINDOW_MS;
  const canDeleteEveryone = isOut && !isRevoked && !isSending && !isFailed && !!onDeleteEveryone
    && (Date.now() - new Date(m.createdAt).getTime()) < DELETE_EVERYONE_WINDOW_MS;
  const canDeleteLocal = !isSending && !!onDeleteLocal;

  function handleDeleteLocalClick(e) {
    e.stopPropagation();
    if (!confirm("Pesan ini akan dihapus dari CRM (tidak menghapus dari WhatsApp pelanggan). Lanjutkan?")) return;
    onDeleteLocal(m);
    closeMenu();
  }
  function handleDeleteEveryoneClick(e) {
    e.stopPropagation();
    if (!confirm("Pesan ini akan dihapus dari WhatsApp pelanggan juga. Lanjutkan?")) return;
    onDeleteEveryone(m);
    closeMenu();
  }
  const isStructured = STRUCTURED_TYPES.has(m.mediaType);
  const structuredData = isStructured ? parseStructuredContent(m.mediaType, m.content) : null;
  // Placeholder bracket ("[Foto]" dst, lihat parseHistoryMessage.js) sudah
  // ditampilkan via MediaPlaceholderCard di bawah — JANGAN dobel-render
  // sebagai bubble-text terpisah juga.
  const isBracketPlaceholder = typeof m.content === "string" && /^\[.+\]$/.test(m.content);
  const text = (!isRevoked && !isStructured && !isJsonError(m.content) && m.content && !(hasMedia && !m.mediaUrl && isBracketPlaceholder)) ? m.content : "";
  // Link lokasi tempel-manual (bukan share-lokasi native WhatsApp, lihat
  // catatan di utils/waFormat.jsx) — kalau terdeteksi, render kartu lokasi
  // yang sama seperti mediaType:"location" asli, bukan teks link polos.
  const pastedMapsLocation = text && !hasMedia ? extractMapsLocation(text) : null;
  const isUnsupportedType = text === UNSUPPORTED_PLACEHOLDER;

  // Menu tidak masuk akal (dan aksinya tidak valid) untuk pesan yang masih
  // terkirim, gagal, sudah dihapus, atau saat mode pilih-banyak aktif.
  const menuEnabled = !selectionMode && !isSending && !isFailed && !isRevoked;

  // Jaga menu tetap di dalam viewport — kalau diklik dekat tepi kanan/bawah,
  // koordinat mentah akan membuat menu terpotong keluar layar.
  function openMenuAt(clientX, clientY) {
    const MENU_W = 210, MENU_H = 250, PAD = 8;
    const x = Math.min(clientX, window.innerWidth  - MENU_W - PAD);
    const y = Math.min(clientY, window.innerHeight - MENU_H - PAD);
    setMenuPos({ x: Math.max(PAD, x), y: Math.max(PAD, y) });
  }

  // Desktop: klik kanan. preventDefault supaya menu konteks browser tidak
  // ikut muncul menutupi menu kita.
  function handleContextMenu(e) {
    if (!menuEnabled) return;
    e.preventDefault();
    openMenuAt(e.clientX, e.clientY);
  }

  // HP/tablet: tahan ~500ms. Posisi diambil dari titik sentuh AWAL (bukan
  // posisi saat timer menyala) supaya menu muncul tepat di bawah jari.
  // Digeser >10px = user sedang scroll, BUKAN menahan → batalkan; tanpa
  // ambang ini menu ikut muncul tiap kali scroll pelan (persis keluhan
  // "swipe kepencet" yang sudah diperbaiki di ConversationItem mobile).
  function handleTouchStart(e) {
    if (!menuEnabled) return;
    const t = e.touches[0];
    touchStartRef.current = { x: t.clientX, y: t.clientY };
    longPressTimerRef.current = setTimeout(() => {
      openMenuAt(t.clientX, t.clientY);
    }, 500);
  }
  function handleTouchMove(e) {
    const start = touchStartRef.current;
    if (!start) return;
    const t = e.touches[0];
    if (Math.abs(t.clientX - start.x) > 10 || Math.abs(t.clientY - start.y) > 10) {
      clearTimeout(longPressTimerRef.current);
    }
  }
  function handleTouchEnd() { clearTimeout(longPressTimerRef.current); }
  // Bersihkan timer kalau komponen di-unmount saat jari masih menahan
  // (mis. daftar pesan di-recycle/berpindah percakapan) — kalau tidak,
  // setMenuPos dipanggil pada komponen yang sudah tidak ada.
  useEffect(() => () => clearTimeout(longPressTimerRef.current), []);

  // Satu daftar aksi, dipakai untuk menu klik-kanan MAUPUN long-press —
  // tidak ada dua sumber kebenaran daftar aksi.
  const actions = [
    onReply       && { key: "reply",   label: "Balas",             Icon: Reply,      onClick: () => onReply(m) },
    onForward     && { key: "forward", label: "Teruskan",          Icon: Forward,    onClick: () => onForward(m) },
    canEdit       && { key: "edit",    label: "Edit",              Icon: Pencil,     onClick: () => onEdit(m) },
    onEnterSelection && { key: "select", label: "Pilih",           Icon: CheckSquare, onClick: () => onEnterSelection(m) },
    canDeleteLocal && { key: "del-local", label: "Hapus untuk Saya", Icon: Trash2, onClick: null, raw: handleDeleteLocalClick },
    canDeleteEveryone && { key: "del-all", label: "Hapus untuk Semua", Icon: Trash2, onClick: null, raw: handleDeleteEveryoneClick, danger: true },
  ].filter(Boolean);

  return (
    <div
      ref={rowRef}
      className="msg-row"
      style={{ display: "flex", flexDirection: "row", alignItems: "center", width: "100%", gap: 8 }}
      onContextMenu={handleContextMenu}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={handleTouchMove}
      onTouchCancel={handleTouchEnd}
    >
      {/* Checkbox mode pilih (multi-select) — SELALU di ujung kiri layar
          (bukan cuma "sebelah kiri bubble"), sama seperti WhatsApp asli.
          flex:0 0 auto supaya wrapper kolom bubble di bawah tetap bisa
          align kanan/kiri normal di sisa ruang. */}
      {selectionMode && (
        <button
          type="button"
          className={`msg-select-checkbox${selected ? " selected" : ""}`}
          onClick={(e) => { e.stopPropagation(); onToggleSelect(m); }}
        >
          {selected && <Check size={12} color="#fff" strokeWidth={3} />}
        </button>
      )}

      <div
        style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", flex: 1, minWidth: 0, cursor: selectionMode ? "pointer" : "default" }}
        onClick={selectionMode ? () => onToggleSelect(m) : undefined}
      >
      {/* Menu konteks — klik kanan (desktop) / tahan (HP-tablet). position
          fixed di koordinat kursor/jari, dirender di dalam row ini (bukan
          portal) karena listener "klik di luar" di atas mengandalkan
          menuRef.contains(). */}
      {menuPos && actions.length > 0 && (
        <div
          ref={menuRef}
          className="msg-context-menu"
          style={{ left: menuPos.x, top: menuPos.y }}
          role="menu"
          // Klik di dalam menu jangan menembus ke row (row punya onClick
          // toggle-select saat mode pilih aktif).
          onClick={(e) => e.stopPropagation()}
          onContextMenu={(e) => e.preventDefault()}
        >
          {actions.map(({ key, label, Icon, onClick, raw, danger }) => (
            <button
              key={key}
              type="button"
              role="menuitem"
              className={danger ? "danger" : undefined}
              onClick={raw ? raw : (e) => { e.stopPropagation(); onClick(); closeMenu(); }}
            >
              <Icon size={14} />
              <span>{label}</span>
            </button>
          ))}
        </div>
      )}

      <div className={`bubble ${isOut ? "out" : "in"}${highlighted ? " bubble-flash" : ""}${isSending ? " bubble-sending" : ""}${isFailed ? " bubble-failed" : ""}`}>
        {!isOut && isGroup && m.senderName && (
          <div className="msg-sender-name">{m.senderName}</div>
        )}

        {m.replyTo && (
          <div className="bubble-quote" onClick={(e) => { e.stopPropagation(); onJumpToReply?.(m.replyTo.id); }}>
            <div className="bubble-quote-author">{m.replyTo.direction === "OUTBOUND" ? "Kamu" : "Pelanggan"}</div>
            <div className="bubble-quote-text">
              {m.replyTo.isRevoked
                ? "Pesan ini telah dihapus"
                : STRUCTURED_TYPES.has(m.replyTo.mediaType)
                ? MEDIA_TYPE_LABEL[m.replyTo.mediaType]
                : (m.replyTo.content || (m.replyTo.mediaType ? `[${m.replyTo.mediaType}]` : "Pesan"))}
            </div>
          </div>
        )}

        {m.forwarded && (
          <div className="bubble-forwarded"><Forward size={11} /> Diteruskan</div>
        )}

        {isRevoked ? (
          // Soft-delete (WAHA message.revoked) — row TETAP ADA di DB, bubble
          // tampilkan penanda "dihapus" (pola WhatsApp asli), BUKAN bubble
          // kosong/hilang.
          <div className="bubble-revoked">
            <Ban size={14} />
            <span>Pesan ini telah dihapus</span>
          </div>
        ) : (
          <>
            {m.mediaType === "sticker" && m.mediaUrl && (
              // Stiker WhatsApp = WebP transparan kecil — bukan foto, tidak masuk
              // lightbox onOpenMedia (WhatsApp asli juga tidak bisa di-zoom stiker),
              // objectFit "contain" (bukan "cover" seperti .bubble-img) supaya
              // transparansi & rasio aslinya tidak terpotong/di-crop.
              <img src={m.mediaUrl} alt="Stiker" className="bubble-sticker" loading="lazy" decoding="async" onError={(e) => { e.target.style.display = "none"; }} />
            )}
            {m.mediaType === "image" && m.mediaUrl && (
              <button type="button" className="bubble-img-btn" onClick={() => onOpenMedia?.("image", m.mediaUrl)}>
                <img src={m.mediaUrl} alt="Foto" className="bubble-img" loading="lazy" decoding="async" onError={(e) => { e.target.closest("button").style.display = "none"; }} />
              </button>
            )}
            {m.mediaType === "video" && m.mediaUrl && (
              <VideoThumb src={m.mediaUrl} onClick={() => onOpenMedia?.("video", m.mediaUrl)} />
            )}
            {m.mediaType === "audio" && m.mediaUrl && <AudioPlayer src={m.mediaUrl} />}
            {m.mediaType === "document" && m.mediaUrl && (
              <a href={m.mediaUrl} target="_blank" rel="noreferrer" className="bubble-doc" onClick={(e) => e.stopPropagation()}>
                <FileText size={18} style={{ flexShrink: 0 }} />
                <span className="bubble-doc-name">{m.mediaUrl.split("/").pop()}</span>
              </a>
            )}
            {m.mediaType === "location" && (structuredData ? <LocationCard data={structuredData} /> : (
              <div className="bubble-media-placeholder"><MapPin size={16} /><span>Lokasi tidak bisa ditampilkan</span></div>
            ))}
            {m.mediaType === "contact" && (structuredData ? <ContactCard data={structuredData} /> : (
              <div className="bubble-media-placeholder"><User size={16} /><span>Kontak tidak bisa ditampilkan</span></div>
            ))}
            {m.mediaType === "poll" && (structuredData ? <PollCard data={structuredData} /> : (
              <div className="bubble-media-placeholder"><BarChart3 size={16} /><span>Polling tidak bisa ditampilkan</span></div>
            ))}
            {hasMedia && !m.mediaUrl && !isStructured && (
              <MediaPlaceholderCard message={m} conversationId={conversationId} />
            )}

            {/* BUG YANG DIPERBAIKI: dulu `{text}` polos — sintaks format
                WhatsApp (*tebal*, _miring_, ~coret~, ```monospace```) yang
                diketik sales ATAU dikirim customer tampil sebagai tanda baca
                literal di CRM, padahal WhatsApp asli merendernya jadi teks
                bergaya. Lihat utils/waFormat.jsx. */}
            {text && (isUnsupportedType ? (
              <div className="bubble-unsupported">
                <HelpCircle size={14} />
                <span>Jenis pesan ini belum didukung di CRM (mis. reaksi emoji/stiker balasan)</span>
              </div>
            ) : pastedMapsLocation ? (
              <LocationCard data={{ lat: pastedMapsLocation.lat, lng: pastedMapsLocation.lng, name: null, address: null }} />
            ) : (
              <span className="bubble-text">{parseWaFormatting(text)}</span>
            ))}
          </>
        )}

        <span className="bubble-meta">
          {isSending && <Clock size={11} className="bubble-status-icon" />}
          {!!m.editedAt && !isRevoked && <span className="bubble-edited-label">diedit</span>}
          <span className="bubble-time">{formatWaktu(m.createdAt)}</span>
          {isOut && !isSending && !isFailed && <AckTicks ack={m.ack} />}
        </span>

        {isFailed && (
          <button type="button" className="bubble-retry-btn" onClick={(e) => { e.stopPropagation(); onRetry?.(m); }}>
            Gagal terkirim — Coba lagi
          </button>
        )}
      </div>
      </div>
    </div>
  );
}

export default memo(MessageBubbleBase);
