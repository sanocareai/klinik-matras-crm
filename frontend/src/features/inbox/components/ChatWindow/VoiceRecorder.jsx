import React, { useRef, useState } from "react";
import { Mic, X, Send, Play, Pause } from "lucide-react";
import { api } from "../../../../api.js";
import { useMessageStore } from "../../stores/messageStore.js";

// ⚠️ Format rekaman: browser (MediaRecorder) menghasilkan audio/webm;codecs=opus.
// Backend SUDAH otomatis transcode ke ogg/opus (ffmpeg) sebelum dikirim ke
// WAHA sebagai voice note (ptt) — lihat backend/src/routes/conversations.js
// (endpoint /media yang sama dipakai di sini, tidak ada perubahan backend).
// Jadi frontend tidak perlu konversi apapun, cukup kirim blob apa adanya.
const MIN_DURATION_SEC = 1; // rekaman lebih pendek dari ini otomatis dibuang (kepencet nggak sengaja)

function fmtTime(s) {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return `${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export default function VoiceRecorder({ conversationId }) {
  const [recording, setRecording]   = useState(false);
  const [recSeconds, setRecSeconds] = useState(0);
  const [preview, setPreview]       = useState(null); // { blob, url, seconds }
  const [playing, setPlaying]       = useState(false);
  const [sending, setSending]       = useState(false);

  const recorderRef = useRef(null);
  const chunksRef    = useRef([]);
  const timerRef      = useRef(null);
  const streamRef     = useRef(null);
  const audioElRef     = useRef(null);
  // rec.onstop adalah closure yang dibuat sekali saat startRecording — kalau
  // baca state `recSeconds` langsung, nilainya akan STALE (selalu nilai
  // render saat closure dibuat, bukan detik terakhir saat user lepas mic).
  // Pakai ref supaya onstop selalu baca durasi TERKINI.
  const recSecondsRef = useRef(0);

  async function startRecording() {
    if (recording) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mime = MediaRecorder.isTypeSupported("audio/webm;codecs=opus") ? "audio/webm;codecs=opus" : "audio/webm";
      const rec = new MediaRecorder(stream, { mimeType: mime });
      chunksRef.current = [];
      rec.ondataavailable = (e) => { if (e.data.size > 0) chunksRef.current.push(e.data); };
      rec.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        const seconds = recSecondsRef.current;
        const blob = new Blob(chunksRef.current, { type: mime });
        if (seconds < MIN_DURATION_SEC) return; // kepencet sebentar — buang diam-diam
        setPreview({ blob, url: URL.createObjectURL(blob), seconds });
      };
      rec.start(100);
      recorderRef.current = rec;
      setRecording(true);
      recSecondsRef.current = 0;
      setRecSeconds(0);
      timerRef.current = setInterval(() => {
        recSecondsRef.current += 1;
        setRecSeconds(recSecondsRef.current);
      }, 1000);
    } catch (err) {
      alert("Tidak bisa akses mikrofon: " + err.message);
    }
  }

  function stopRecording() {
    if (!recording) return;
    clearInterval(timerRef.current);
    setRecording(false);
    recorderRef.current?.stop();
  }

  function cancelRecording() {
    clearInterval(timerRef.current);
    setRecording(false);
    if (recorderRef.current?.state === "recording") {
      recorderRef.current.ondataavailable = null;
      recorderRef.current.onstop = () => streamRef.current?.getTracks().forEach((t) => t.stop());
      recorderRef.current.stop();
    }
    setRecSeconds(0);
  }

  function discardPreview() {
    if (preview) URL.revokeObjectURL(preview.url);
    setPreview(null);
    setPlaying(false);
  }

  function togglePlay() {
    const el = audioElRef.current;
    if (!el) return;
    if (playing) el.pause(); else el.play();
  }

  async function sendVoiceNote() {
    if (!preview) return;
    setSending(true);
    try {
      const fd = new FormData();
      fd.append("file", preview.blob, `voice-${Date.now()}.webm`);
      const msg = await api.sendMedia(conversationId, fd);
      useMessageStore.getState().appendMessage(conversationId, msg);
      discardPreview();
    } catch (err) {
      alert("Gagal kirim pesan suara: " + err.message);
    } finally {
      setSending(false);
    }
  }

  // Preview setelah rekam — player kecil + kirim/batal
  if (preview) {
    return (
      <div className="voice-preview-bar">
        <audio ref={audioElRef} src={preview.url} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onEnded={() => setPlaying(false)} />
        <button type="button" className="audio-player-btn" onClick={togglePlay}>
          {playing ? <Pause size={15} /> : <Play size={15} />}
        </button>
        <span className="voice-preview-duration">{fmtTime(preview.seconds)}</span>
        <button type="button" className="btn btn-secondary btn-sm" onClick={discardPreview} disabled={sending}>
          <X size={13} /> Batal
        </button>
        <button type="button" className="btn btn-primary btn-sm" onClick={sendVoiceNote} disabled={sending}>
          <Send size={13} /> {sending ? "..." : "Kirim"}
        </button>
      </div>
    );
  }

  // Sedang merekam — tahan terus, lepas untuk berhenti
  if (recording) {
    return (
      <div className="recording-bar">
        <span className="rec-dot" />
        <span className="rec-time">{fmtTime(recSeconds)}</span>
        <span className="rec-hint">Lepas untuk selesai</span>
        <button type="button" onClick={cancelRecording} className="btn btn-secondary btn-sm" style={{ marginLeft: "auto" }}>
          <X size={13} /> Batal
        </button>
        <button
          type="button"
          className="chat-action-btn active"
          onMouseUp={stopRecording}
          onTouchEnd={stopRecording}
          title="Lepas untuk selesai rekam"
        >
          <Mic size={16} />
        </button>
      </div>
    );
  }

  // Idle — tahan (press & hold) untuk mulai rekam, gaya WhatsApp
  return (
    <button
      type="button"
      className="chat-action-btn"
      title="Tahan untuk rekam pesan suara"
      onMouseDown={startRecording}
      onMouseUp={stopRecording}
      onMouseLeave={() => { if (recording) stopRecording(); }}
      onTouchStart={(e) => { e.preventDefault(); startRecording(); }}
      onTouchEnd={stopRecording}
    >
      <Mic size={15} />
    </button>
  );
}
