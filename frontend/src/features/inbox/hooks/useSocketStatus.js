import { useEffect, useState } from "react";
import { getSocket } from "../../../lib/socket.js";

// Fase G: status koneksi Socket.IO untuk offline banner ("Menyambung
// ulang...") di Inbox. Mulai dari asumsi terkoneksi supaya tidak flash
// banner sesaat saat komponen baru mount (socket singleton biasanya sudah
// connect duluan lewat useSocketEvents).
export function useSocketStatus() {
  const [connected, setConnected] = useState(true);

  useEffect(() => {
    const socket = getSocket();
    setConnected(socket.connected);

    function handleConnect() { setConnected(true); }
    function handleDisconnect() { setConnected(false); }

    socket.on("connect", handleConnect);
    socket.on("disconnect", handleDisconnect);
    return () => {
      socket.off("connect", handleConnect);
      socket.off("disconnect", handleDisconnect);
    };
  }, []);

  return connected;
}
