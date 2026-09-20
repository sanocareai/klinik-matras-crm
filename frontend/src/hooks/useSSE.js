import { useEffect, useRef } from "react";
import { getSocket } from "../lib/socket.js";
import { createRealtime } from "../lib/realtime.js";

// BASE sama dengan api.js — kosong untuk browser (relative), diisi untuk APK Capacitor
const BASE = import.meta.env.VITE_API_BASE || "";

// Nama hook dipertahankan (dipakai Layout/Inbox/useMessages) tapi transport
// utamanya sekarang Socket.IO singleton; SSE cuma fallback saat socket putus.
// Lihat lib/realtime.js.
const realtime = createRealtime({
  getSocket,
  openEventSource: () => {
    const token = localStorage.getItem("token");
    if (!token) return null;
    try {
      return new EventSource(`${BASE}/api/events?token=${encodeURIComponent(token)}`);
    } catch {
      return null; // EventSource tidak tersedia
    }
  },
});

// Contoh: useSSE("new_message", (data) => { /* { conversationId, customerId } */ });
export function useSSE(eventType, callback) {
  // cbRef: selalu pegang versi terbaru callback tanpa restart effect
  const cbRef = useRef(callback);
  useEffect(() => { cbRef.current = callback; });

  useEffect(() => realtime.subscribe(eventType, (data) => cbRef.current(data)), [eventType]);
}
