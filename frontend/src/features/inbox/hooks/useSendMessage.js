import { useMutation } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useComposerStore } from "../stores/composerStore.js";

let tempCounter = 0;
function makeTempId() {
  tempCounter += 1;
  return `temp-${Date.now()}-${tempCounter}`;
}

// clientId: dibuat sekali per pengiriman, diteruskan ke backend & di-echo
// balik di response HTTP DAN payload socket message:new (lihat
// backend/src/routes/conversations.js) — dipakai messageStore.js#upsertMessage
// utk mencocokkan entry optimistic dengan echo yang datang lewat jalur mana
// pun (response HTTP lebih dulu ATAU socket lebih dulu, urutan tidak pasti).
function makeClientId() {
  return `client-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

// Kirim pesan teks dengan optimistic update — bubble langsung muncul dengan
// status "sending" sebelum server balas, jadi terasa instan (zero-lag).
// Dipakai di Fase B menggantikan handleSend manual di ChatWindow.jsx lama;
// endpoint yang dipanggil SAMA dengan yang dipakai ChatWindow sekarang
// (api.sendMessage → POST /conversations/:id/messages), tidak ada perubahan
// backend/kontrak API.
//
// BUG (fix) — DUPLIKAT BUBBLE: pesan yang KITA kirim sendiri dulu bisa
// nyisip 2-4x karena appendMessage lama cuma cek `m.id === msg.id` — tidak
// bisa nangkep entry optimistic (id="temp-...") vs echo Socket.IO/response
// HTTP (id asli DB) sebagai pesan yang SAMA. Sekarang semua jalur (optimistic
// di bawah, response di onSuccess, echo socket di useSocketEvents.js, refetch
// SSE di useMessages.js) lewat upsertMessage yang cocokkan by id→externalId→
// clientId lalu MERGE in place — bukan pernah nambah baris baru untuk pesan
// yang sama.
export function useSendMessage(conversationId) {
  const mutation = useMutation({
    mutationFn: async ({ content, replyTo, clientId }) => {
      return api.sendMessage(
        conversationId,
        content,
        replyTo?.externalId || null,
        replyTo?.id || null,
        clientId,
      );
    },

    onMutate: ({ content, replyTo, clientId }) => {
      const tempId = makeTempId();
      const tempMessage = {
        id: tempId,
        clientId,
        conversationId,
        direction: "OUTBOUND",
        content,
        mediaType: null,
        mediaUrl: null,
        replyTo: replyTo || null,
        forwarded: false,
        senderName: null,
        createdAt: new Date().toISOString(),
        status: "sending", // 'sending' | 'failed' — dipakai UI Fase B untuk indikator + tombol retry
      };
      useMessageStore.getState().upsertMessage(conversationId, tempMessage);
      return { tempId };
    },

    onSuccess: (realMessage) => {
      // realMessage sudah bawa clientId yang sama (di-echo backend) — upsertMessage
      // otomatis cocokkan ke entry optimistic di atas dan MERGE, bukan nambah baris.
      useMessageStore.getState().upsertMessage(conversationId, realMessage);
      useComposerStore.getState().clearComposer(conversationId);
    },

    onError: (_err, _vars, context) => {
      if (context?.tempId) {
        useMessageStore.getState().markMessageFailed(conversationId, context.tempId);
      }
    },
  });

  // Wrapper: inject clientId di sini (bukan di dalam onMutate/mutationFn
  // masing-masing, yang tidak saling berbagi variabel lokal) supaya kedua
  // callback itu menerima clientId YANG SAMA tanpa perlu caller (Composer.jsx,
  // ChatWindow/index.jsx retry) diubah sama sekali.
  return {
    ...mutation,
    mutate: (vars) => mutation.mutate({ ...vars, clientId: makeClientId() }),
  };
}
