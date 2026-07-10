// Client Socket.IO singleton — pola SAMA dengan frontend/src/lib/socket.js
// versi web. Backend Socket.IO sudah ada di backend/src/socket.js (dipakai
// bareng CRM web), mobile tinggal konsumsi event yang sama:
// message:new, message:ack, conversation:update.
import { io } from "socket.io-client";
import { getServerUrl, getToken } from "../api";

let socket = null;

export function getSocket() {
  if (socket) return socket;

  socket = io(getServerUrl(), {
    path: "/socket.io",
    auth: { token: getToken() },
    autoConnect: false,
    reconnection: true,
    reconnectionAttempts: Infinity,
    reconnectionDelay: 1000,      // backoff awal 1 detik
    reconnectionDelayMax: 30000,  // maksimal 30 detik antar percobaan
    transports: ["websocket"],
  });

  socket.connect();
  return socket;
}

// Dipanggil setelah login/refresh sesi — reconnect dengan token baru.
export function refreshSocketAuth() {
  if (!socket) return;
  socket.auth = { token: getToken() };
  if (socket.connected) socket.disconnect().connect();
  else socket.connect();
}

// Dipanggil saat logout — tutup koneksi & buang singleton supaya login
// berikutnya (user lain di device yang sama) mulai dari koneksi bersih.
export function disconnectSocket() {
  if (!socket) return;
  socket.disconnect();
  socket = null;
}
