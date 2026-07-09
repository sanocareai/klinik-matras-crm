import { io } from "socket.io-client";

// BASE sama dengan api.js/useSSE.js — kosong untuk browser (relative,
// same-origin), diisi untuk APK Capacitor yang perlu tahu alamat server.
const BASE = import.meta.env.VITE_API_BASE || "";

// ⚠️ CATATAN FASE A: backend saat ini belum punya server Socket.IO — realtime
// masih jalan lewat SSE (lihat hooks/useSSE.js, endpoint GET /api/events).
// File ini menyiapkan client-nya lebih dulu supaya Fase B tinggal pakai begitu
// backend Socket.IO siap. getSocket() SENGAJA lazy — tidak connect otomatis
// saat modul di-import, supaya tidak spam error koneksi selama endpoint
// backend belum ada. Baru connect saat sesuatu benar-benar memanggil getSocket().

let socket = null;

export function getSocket() {
  if (socket) return socket;

  const token = localStorage.getItem("token");

  socket = io(BASE || undefined, {
    path: "/socket.io",
    auth: { token },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,       // backoff awal 1 detik
    reconnectionDelayMax: 30000,   // maksimal 30 detik antar percobaan
    transports: ["websocket", "polling"],
  });

  socket.connect();
  return socket;
}

// Update token auth (dipanggil setelah login ulang) — reconnect dengan token baru.
export function refreshSocketAuth() {
  if (!socket) return;
  socket.auth = { token: localStorage.getItem("token") };
  if (socket.connected) socket.disconnect().connect();
}

// Dipanggil saat logout — tutup koneksi dan buang singleton supaya
// login berikutnya (user lain) mulai dari koneksi bersih.
export function disconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
