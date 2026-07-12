import React, { memo, useRef, useState } from "react";
import {
  Reply, Forward, FileText, Image as ImageIcon, Video, Mic, Smile,
  Play, Pause, Check, CheckCheck, Clock, Download, Loader2,
} from "lucide-react";
import { formatWaktu } from "../../../../utils/format.js";
import { ACK, ackToTicks } from "../../utils/ackLevel.js";
import { api } from "../../../../api.js";
import { useMessageStore } from "../../stores/messageStore.js";

// Cek apakah string adalah JSON error (dari bug lama download media)
function isJsonError(str) {
  if (!str) return false;
  try { const p = JSON.parse(str); return !!p.message || !!p.error; } catch { return false; }
}

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

const MEDIA_TYPE_ICON = { image: ImageIcon, video: Video, audio: Mic, document: FileText, sticker: Smile };
const MEDIA_TYPE_LABEL = { image: "Foto", video: "Video", audio: "Pesan Suara", document: "Dokumen", sticker: "Stiker" };

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

function MessageBubbleBase({ message: m, conversationId, isGroup, onReply, onForward, onJumpToReply, highlighted, onRetry, onOpenMedia }) {
  const [hovered, setHovered] = useState(false);
  const longPressTimerRef = useRef(null);

  const isOut     = m.direction === "OUTBOUND";
  const isSending = m.status === "sending";
  const isFailed  = m.status === "failed";
  const hasMedia  = !!m.mediaType;
  // Placeholder bracket ("[Foto]" dst, lihat parseHistoryMessage.js) sudah
  // ditampilkan via MediaPlaceholderCard di bawah — JANGAN dobel-render
  // sebagai bubble-text terpisah juga.
  const isBracketPlaceholder = typeof m.content === "string" && /^\[.+\]$/.test(m.content);
  const text = (!isJsonError(m.content) && m.content && !(hasMedia && !m.mediaUrl && isBracketPlaceholder)) ? m.content : "";

  function handleTouchStart() {
    longPressTimerRef.current = setTimeout(() => {
      setHovered(true);
      setTimeout(() => setHovered(false), 4000);
    }, 600);
  }
  function handleTouchEnd() { clearTimeout(longPressTimerRef.current); }

  return (
    <div
      className="msg-row"
      style={{ display: "flex", flexDirection: "column", alignItems: isOut ? "flex-end" : "flex-start", width: "100%" }}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onTouchStart={handleTouchStart}
      onTouchEnd={handleTouchEnd}
      onTouchMove={() => clearTimeout(longPressTimerRef.current)}
    >
      {hovered && !isSending && !isFailed && (
        <div className="msg-action-bar">
          {onReply && (
            <button onClick={(e) => { e.stopPropagation(); onReply(m); setHovered(false); }} title="Balas">
              <Reply size={14} />
            </button>
          )}
          {onForward && (
            <button onClick={(e) => { e.stopPropagation(); onForward(m); setHovered(false); }} title="Teruskan">
              <Forward size={14} />
            </button>
          )}
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
              {m.replyTo.content || (m.replyTo.mediaType ? `[${m.replyTo.mediaType}]` : "Pesan")}
            </div>
          </div>
        )}

        {m.forwarded && (
          <div className="bubble-forwarded"><Forward size={11} /> Diteruskan</div>
        )}

        {m.mediaType === "sticker" && m.mediaUrl && (
          // Stiker WhatsApp = WebP transparan kecil — bukan foto, tidak masuk
          // lightbox onOpenMedia (WhatsApp asli juga tidak bisa di-zoom stiker),
          // objectFit "contain" (bukan "cover" seperti .bubble-img) supaya
          // transparansi & rasio aslinya tidak terpotong/di-crop.
          <img src={m.mediaUrl} alt="Stiker" className="bubble-sticker" onError={(e) => { e.target.style.display = "none"; }} />
        )}
        {m.mediaType === "image" && m.mediaUrl && (
          <button type="button" className="bubble-img-btn" onClick={() => onOpenMedia?.("image", m.mediaUrl)}>
            <img src={m.mediaUrl} alt="Foto" className="bubble-img" onError={(e) => { e.target.closest("button").style.display = "none"; }} />
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
        {hasMedia && !m.mediaUrl && (
          <MediaPlaceholderCard message={m} conversationId={conversationId} />
        )}

        {text && <span className="bubble-text">{text}</span>}

        <span className="bubble-meta">
          {isSending && <Clock size={11} className="bubble-status-icon" />}
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
  );
}

export default memo(MessageBubbleBase);
