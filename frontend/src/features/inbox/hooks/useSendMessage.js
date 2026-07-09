import { useMutation } from "@tanstack/react-query";
import { api } from "../../../api.js";
import { useMessageStore } from "../stores/messageStore.js";
import { useComposerStore } from "../stores/composerStore.js";

let tempCounter = 0;
function makeTempId() {
  tempCounter += 1;
  return `temp-${Date.now()}-${tempCounter}`;
}

// Kirim pesan teks dengan optimistic update — bubble langsung muncul dengan
// status "sending" sebelum server balas, jadi terasa instan (zero-lag).
// Dipakai di Fase B menggantikan handleSend manual di ChatWindow.jsx lama;
// endpoint yang dipanggil SAMA dengan yang dipakai ChatWindow sekarang
// (api.sendMessage → POST /conversations/:id/messages), tidak ada perubahan
// backend/kontrak API.
export function useSendMessage(conversationId) {
  return useMutation({
    mutationFn: async ({ content, replyTo }) => {
      return api.sendMessage(
        conversationId,
        content,
        replyTo?.externalId || null,
        replyTo?.id || null,
      );
    },

    onMutate: ({ content, replyTo }) => {
      const tempId = makeTempId();
      const tempMessage = {
        id: tempId,
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
      useMessageStore.getState().appendMessage(conversationId, tempMessage);
      return { tempId };
    },

    onSuccess: (realMessage, _vars, context) => {
      useMessageStore.getState().replaceTempMessage(conversationId, context.tempId, realMessage);
      useComposerStore.getState().clearComposer(conversationId);
    },

    onError: (_err, _vars, context) => {
      if (context?.tempId) {
        useMessageStore.getState().markMessageFailed(conversationId, context.tempId);
      }
    },
  });
}
