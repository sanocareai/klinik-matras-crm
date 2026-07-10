import { useEffect, useRef, useState } from "react";
import { getSocket } from "../../../lib/socket.js";

const OFFLINE_BANNER_DEBOUNCE_MS = 3000;

// Fase G: status koneksi Socket.IO untuk offline banner ("Menyambung
// ulang...") di Inbox. Mulai dari asumsi terkoneksi supaya tidak flash
// banner sesaat saat komponen baru mount (socket singleton biasanya sudah
// connect duluan lewat useSocketEvents).
//
// BUG produksi — banner sebelumnya muncul instan di setiap event "disconnect",
// termasuk reconnect cepat (<1 detik) yang NORMAL terjadi di socket.io (mis.
// saat transport upgrade polling->websocket, atau hiccup jaringan sekilas).
// Sekarang di-debounce: banner baru tampil kalau socket BENAR-BENAR terputus
// terus-menerus >3 detik, dan langsung hilang begitu "connect" ter-trigger
// (tidak ikut didebounce saat hilang — reconnect harus terasa instan).
export function useSocketStatus() {
  const [showOffline, setShowOffline] = useState(false);
  const timerRef = useRef(null);

  useEffect(() => {
    const socket = getSocket();

    function clearPendingTimer() {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    }

    function handleConnect() {
      clearPendingTimer();
      setShowOffline(false);
    }
    function handleDisconnect() {
      clearPendingTimer();
      timerRef.current = setTimeout(() => setShowOffline(true), OFFLINE_BANNER_DEBOUNCE_MS);
    }

    if (!socket.connected) handleDisconnect();

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
      clearPendingTimer();
    };
  }, []);

  return !showOffline;
}
