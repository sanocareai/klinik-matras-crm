import React, { memo, useRef, useState } from "react";
import {
  Reply, Forward, FileText, Image as ImageIcon, Video, Mic,
  Play, Pause, Check, CheckCheck, Clock,
} from "lucide-react";
import { formatWaktu } from "../../../../utils/format.js";
import { ACK, ackToTicks } from "../../utils/ackLevel.js";

// Cek apakah string adalah JSON error (dari bug lama download media)
function isJsonError(str) {
  if (!str) return false;
  try { const p = JSON.parse(str); return !!p.message || !!p.error; } catch { return false; }
}

// ⚠️ Backend belum punya field ack per-pesan (lihat ackLevel.js) — pesan
// outbound yang sudah sukses tersimpan (bukan sending/failed) ditampilkan
// dengan 1 centang ("terkirim") sebagai default paling jujur yang bisa
// dipastikan, KECUALI m.ackLevel memang ada (siap dipakai begitu backend
// menambahkannya nanti).
function AckTicks({ ackLevel }) {
  const ticks = ackToTicks(ackLevel ?? ACK.SENT);
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

function VideoThumb({ src, onClick }) {
  return (
    <button type="button" className="bubble-video-thumb" onClick={onClick}>
      <video src={src} preload="metadata" className="bubble-video-thumb-el" />
      <span className="bubble-video-play-icon"><Play size={20} fill="white" /></span>
    </button>
  );
}

function MessageBubbleBase({ message: m, isGroup, onReply, onForward, onJumpToReply, highlighted, onRetry, onOpenMedia }) {
  const [hovered, setHovered] = useState(false);
  const longPressTimerRef = useRef(null);

  const isOut     = m.direction === "OUTBOUND";
  const isSending = m.status === "sending";
  const isFailed  = m.status === "failed";
  const hasMedia  = !!m.mediaType;
  const text      = (!isJsonError(m.content) && m.content) ? m.content : "";

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
          <div className="bubble-media-placeholder">
            {m.mediaType === "image"    && <><ImageIcon size={16} /> Foto (tidak bisa diunduh)</>}
            {m.mediaType === "video"    && <><Video size={16} /> Video (tidak bisa diunduh)</>}
            {m.mediaType === "audio"    && <><Mic size={16} /> Pesan Suara (tidak bisa diunduh)</>}
            {m.mediaType === "document" && <><FileText size={16} /> Dokumen (tidak bisa diunduh)</>}
          </div>
        )}

        {text && <span className="bubble-text">{text}</span>}

        <span className="bubble-meta">
          {isSending && <Clock size={11} className="bubble-status-icon" />}
          <span className="bubble-time">{formatWaktu(m.createdAt)}</span>
          {isOut && !isSending && !isFailed && <AckTicks ackLevel={m.ackLevel} />}
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
