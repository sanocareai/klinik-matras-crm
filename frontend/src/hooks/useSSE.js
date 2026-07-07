import { useEffect, useRef } from "react";

// BASE sama dengan api.js — kosong untuk browser (relative), diisi untuk APK Capacitor
const BASE = import.meta.env.VITE_API_BASE || "";

// ── Singleton SSE connection ─────────────────────────────────────────────────
// Satu koneksi SSE dibagi oleh semua komponen yang pakai hook ini.
// Tidak perlu buat koneksi baru setiap komponen mount.

let es = null;               // EventSource aktif
let reconnectTimer = null;   // timer sebelum reconnect
let reconnectDelay = 3000;   // delay saat ini (exponential backoff)

// appListeners: eventType → Set<callback> — subscriber dari komponen React
const appListeners = new Map();

// esHandlers: eventType → handler function yang dipasang ke EventSource
// Dipertahankan antar reconnect supaya tidak perlu daftar ulang di setiap komponen
const esHandlers = new Map();

function dispatch(eventType, data) {
  appListeners.get(eventType)?.forEach((cb) => {
    try { cb(data); } catch {}
  });
}

// Pastikan EventSource handler ada untuk eventType ini.
// Kalau EventSource sudah connect, langsung pasang; kalau belum, dipasang saat connectSSE().
function ensureEsHandler(eventType) {
  if (esHandlers.has(eventType)) return;

  const handler = (e) => {
    try { dispatch(eventType, JSON.parse(e.data)); } catch {}
  };
  esHandlers.set(eventType, handler);

  if (es && es.readyState !== EventSource.CLOSED) {
    es.addEventListener(eventType, handler);
  }
}

function connectSSE() {
  const token = localStorage.getItem("token");
  if (!token) return;
  // Sudah terkoneksi atau sedang menghubungkan — tidak perlu buat lagi
  if (es && es.readyState !== EventSource.CLOSED) return;

  try {
    es = new EventSource(`${BASE}/api/events?token=${encodeURIComponent(token)}`);
  } catch {
    return; // EventSource tidak tersedia (misal environment non-browser)
  }

  es.onopen = () => {
    reconnectDelay = 3000; // reset backoff saat berhasil connect
  };

  es.onerror = () => {
    es.close();
    es = null;
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(() => {
      reconnectDelay = Math.min(reconnectDelay * 2, 30000); // max 30 detik
      connectSSE();
    }, reconnectDelay);
  };

  // Pasang semua handler yang sudah terdaftar ke EventSource baru
  for (const [eventType, handler] of esHandlers) {
    es.addEventListener(eventType, handler);
  }
}

// ── Hook ─────────────────────────────────────────────────────────────────────
// Contoh pemakaian:
//   useSSE("new_message", (data) => { /* data = { conversationId, customerId } */ });
export function useSSE(eventType, callback) {
  // cbRef: selalu pegang versi terbaru callback tanpa restart effect
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; });

  useEffect(() => {
    if (!appListeners.has(eventType)) {
      appListeners.set(eventType, new Set());
    }

    // Bungkus callback dalam stable reference supaya cleanup benar
    const cb = (data) => cbRef.current(data);
    appListeners.get(eventType).add(cb);

    ensureEsHandler(eventType); // pastikan EventSource handler ada
    connectSSE();               // mulai koneksi kalau belum ada

    return () => {
      appListeners.get(eventType)?.delete(cb);
    };
  }, [eventType]); // eventType adalah string literal stabil, tidak perlu re-run
}
