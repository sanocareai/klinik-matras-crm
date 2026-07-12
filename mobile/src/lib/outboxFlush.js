// Flush antrean outbox otomatis saat koneksi kembali online (NetInfo).
// Dipanggil sekali dari App.js selama user login.
import NetInfo from "@react-native-community/netinfo";
import { api } from "../api";
import { useOutboxStore } from "../store/outboxStore";
import { useMessageStore } from "../store/messageStore";

const MAX_RETRY = 5;

async function flushOutbox() {
  const { queue } = useOutboxStore.getState();
  for (const item of queue) {
    try {
      // item.clientId (kalau ada — cuma ada utk item yang di-enqueue dari
      // ChatScreen.js sejak fix double-append, item lama dari sebelum fix
      // ini tidak akan punya field ini, wajar) diteruskan lagi supaya echo
      // socket dari pengiriman ulang ini TETAP di-merge ke entry optimistic
      // yang sama, bukan nyisip baris baru — lihat messageStore.js#appendMessage.
      const msg = await api.sendMessage(
        item.convId,
        item.payload.content,
        item.payload.quotedMessageId || null,
        item.payload.replyToId || null,
        item.clientId || null,
      );
      useMessageStore.getState().replaceTempMessage(item.convId, item.tempId, msg);
      useOutboxStore.getState().dequeue(item.tempId);
    } catch (err) {
      if (item.retryCount + 1 >= MAX_RETRY) {
        // Sudah dicoba berkali-kali tetap gagal (bukan cuma soal koneksi,
        // kemungkinan error server) — berhenti coba otomatis, tandai gagal
        // supaya sales bisa retry manual dari UI.
        useMessageStore.getState().markMessageFailed(item.convId, item.tempId);
        useOutboxStore.getState().dequeue(item.tempId);
      } else {
        useOutboxStore.getState().incrementRetry(item.tempId);
      }
    }
  }
}

export function initOutboxFlush() {
  let wasConnected = true;
  const unsubscribe = NetInfo.addEventListener((state) => {
    const isConnected = !!state.isConnected;
    if (isConnected && !wasConnected) flushOutbox();
    wasConnected = isConnected;
  });
  // Coba flush juga saat pertama dipasang — antrean sisa dari sesi
  // sebelumnya (app ditutup paksa saat masih offline) langsung diproses
  // kalau ternyata sekarang sudah online.
  flushOutbox();
  return unsubscribe;
}
