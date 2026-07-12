// Store pesan per percakapan — pola SAMA dengan
// frontend/src/features/inbox/stores/messageStore.js versi web.
import { create } from "zustand";
import { useConversationStore } from "./conversationStore";

const EMPTY_ARR = [];

// BUG (fix): FlashList/React butuh KEY YANG STABIL per cell (keyExtractor di
// ChatScreen.js pakai item.id, yang sebelumnya = m.id langsung) — begitu
// pesan optimistic (id="temp-...") dibalas server dan diganti objek asli
// (id=cuid asli, lihat replaceTempMessage), key cell itu berubah TOTAL di
// posisi yang SAMA. React/FlashList melihat ini sebagai "hapus cell lama +
// pasang cell baru", bukan "update cell yang sudah ada" — dipaksa
// unmount+remount PERSIS di posisi paling bawah (anchor) tempat
// maintainVisibleContentPosition sedang berusaha jaga posisi scroll, itu
// yang menyebabkan list "loncat" tiap kirim pesan. _key dibuat SEKALI saat
// pesan pertama masuk store (baik optimistic maupun dari server/socket) dan
// TIDAK PERNAH berubah lagi — beda dari `id`/`externalId` yang boleh
// berganti (temp→real, atau null→terisi).
function ensureKey(m) {
  return m._key ? m : { ...m, _key: m.id };
}

export const useMessageStore = create((set) => ({
  messagesByConvId: {}, // { [convId]: Message[] }
  hasMoreByConvId: {},  // { [convId]: boolean } — masih ada pesan lama untuk di-load

  setMessages: (convId, msgs, hasMore = false) => set((state) => ({
    messagesByConvId: { ...state.messagesByConvId, [convId]: msgs.map(ensureKey) },
    hasMoreByConvId: { ...state.hasMoreByConvId, [convId]: hasMore },
  })),

  // BUG (fix) — DOUBLE-APPEND: pesan yang KITA kirim sendiri dari HP ini
  // datang balik lewat DUA jalur yang keduanya berakhir manggil appendMessage
  // TERPISAH: (1) response HTTP POST /messages di ChatScreen.js (lewat
  // replaceTempMessage) dan (2) echo Socket.IO "message:new" — backend
  // nge-broadcast ke SELURUH room percakapan itu TERMASUK pengirimnya
  // sendiri (lihat backend/src/routes/conversations.js emitNewMessage
  // dipanggil pakai `message` yang SAMA dengan yang di-`res.json`).
  // Dedupe LAMA cuma cek `m.id === msg.id` — itu TIDAK PERNAH bisa nangkep
  // race ini, karena entry optimistic-nya masih id="temp-..." sedangkan
  // echo socket sudah bawa id ASLI dari DB, jadi dua-duanya keliatan "beda
  // pesan" padahal sama, hasilnya 2 bubble utk 1 pesan — nyisip 1 baris
  // BARU ke tengah list yang di-render itulah yang bikin FlashList
  // reflow/loncat (bukan cuma soal key berubah seperti bug sebelumnya).
  //
  // Fix: cocokkan JUGA by `clientId` (dibuat sekali di ChatScreen.js#handleSend,
  // ikut dikirim ke backend & di-echo balik di response DAN di payload
  // socket — lihat conversations.js). Kalau ketemu match (baik by id exact
  // ATAU by clientId), MERGE ke entry yang SUDAH ADA (pertahankan _key-nya),
  // JANGAN append baris baru — apa pun jalur mana yang tiba lebih dulu.
  appendMessage: (convId, msg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    const existingIdx = list.findIndex((m) => m.id === msg.id || (msg.clientId && m.clientId === msg.clientId));
    if (existingIdx !== -1) {
      const updatedList = [...list];
      // BUG (fix): pesan asli dari server tidak punya field `status` sama
      // sekali (cuma entry optimistic yang punya "sending"/"failed") — spread
      // `{...old, ...msg}` TIDAK menimpa key yang absen di `msg`, jadi status
      // "sending" nyangkut selamanya di bubble walau pesan sudah sukses
      // terkirim (macet nunjukin ikon jam pasir). `status: msg.status ?? null`
      // SENGAJA menimpa penuh supaya entry yang sudah direkonsiliasi ke pesan
      // asli selalu bersih dari status optimistic lama.
      updatedList[existingIdx] = { ...updatedList[existingIdx], ...msg, status: msg.status ?? null, _key: updatedList[existingIdx]._key };
      return { messagesByConvId: { ...state.messagesByConvId, [convId]: updatedList } };
    }
    return { messagesByConvId: { ...state.messagesByConvId, [convId]: [...list, ensureKey(msg)] } };
  }),

  // Load pesan lebih lama (infinite scroll ke atas) — ditaruh di depan array.
  prependMessages: (convId, olderMsgs, hasMore) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    const existingIds = new Set(list.map((m) => m.id));
    const fresh = olderMsgs.filter((m) => !existingIds.has(m.id)).map(ensureKey);
    return {
      messagesByConvId: { ...state.messagesByConvId, [convId]: [...fresh, ...list] },
      hasMoreByConvId: hasMore !== undefined
        ? { ...state.hasMoreByConvId, [convId]: hasMore }
        : state.hasMoreByConvId,
    };
  }),

  // Ganti pesan sementara (optimistic, id = tempId) dengan pesan asli dari
  // server — _key SENGAJA dipertahankan dari entry lama (= tempId) supaya
  // keyExtractor tidak melihat ini sebagai cell baru (lihat catatan
  // ensureKey di atas). id/externalId/semua field lain tetap diganti utuh
  // ke nilai asli dari server seperti sebelumnya.
  //
  // Kalau echo socket (lihat appendMessage di atas) SUDAH LEBIH DULU
  // merge entry ini ke id asli (urutan tiba bisa kebalik — socket vs
  // response HTTP, siapa lebih cepat tidak pasti), tempId ini sudah tidak
  // ada lagi di list → findIndex gagal → sengaja no-op (return {}), bukan
  // fallback ke .map yang toh tidak mengubah apa pun tapi tetap bikin
  // reference array baru (re-render sia-sia).
  replaceTempMessage: (convId, tempId, realMsg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    const idx = list.findIndex((m) => m.id === tempId);
    if (idx === -1) return {};
    const updatedList = [...list];
    updatedList[idx] = { ...realMsg, _key: updatedList[idx]._key || tempId };
    return { messagesByConvId: { ...state.messagesByConvId, [convId]: updatedList } };
  }),

  // Tandai pesan optimistic gagal terkirim (setelah outbox habis retry) —
  // UI menampilkan tombol retry manual.
  markMessageFailed: (convId, tempId) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    return {
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: list.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
      },
    };
  }),

  // Update status centang kirim (ack) untuk 1 pesan via externalId. Dicari
  // di conversation AKTIF dulu, baru fallback ke semua conversation di cache.
  updateAck: (externalId, ack) => set((state) => {
    const activeId = useConversationStore.getState().activeConversationId;
    const searchOrder = activeId
      ? [activeId, ...Object.keys(state.messagesByConvId).filter((id) => id !== activeId)]
      : Object.keys(state.messagesByConvId);

    for (const convId of searchOrder) {
      const list = state.messagesByConvId[convId];
      if (!list) continue;
      const idx = list.findIndex((m) => m.externalId === externalId);
      if (idx === -1) continue;
      const updatedList = [...list];
      updatedList[idx] = { ...updatedList[idx], ack };
      return { messagesByConvId: { ...state.messagesByConvId, [convId]: updatedList } };
    }
    return {};
  }),

  // Update sebagian field pesan yang SUDAH ada (by id) — dipakai untuk
  // message:update socket event (edit/revoke dari webhook, lihat
  // useSocketEvents.js), pola SAMA dengan updateAck di atas dan
  // frontend/src/features/inbox/stores/messageStore.js#updateMessage.
  updateMessage: (messageId, patch) => set((state) => {
    const activeId = useConversationStore.getState().activeConversationId;
    const searchOrder = activeId
      ? [activeId, ...Object.keys(state.messagesByConvId).filter((id) => id !== activeId)]
      : Object.keys(state.messagesByConvId);

    for (const convId of searchOrder) {
      const list = state.messagesByConvId[convId];
      if (!list) continue;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) continue;
      const updatedList = [...list];
      updatedList[idx] = { ...updatedList[idx], ...patch };
      return { messagesByConvId: { ...state.messagesByConvId, [convId]: updatedList } };
    }
    return {};
  }),

  // "Hapus untuk Saya" (lokal) — hard remove dari store, dipakai untuk hasil
  // sukses DELETE .../local (dipanggil sendiri) MAUPUN socket event
  // message:deleted (dihapus dari sesi CRM lain, lihat useSocketEvents.js).
  removeMessage: (messageId) => set((state) => {
    const activeId = useConversationStore.getState().activeConversationId;
    const searchOrder = activeId
      ? [activeId, ...Object.keys(state.messagesByConvId).filter((id) => id !== activeId)]
      : Object.keys(state.messagesByConvId);

    for (const convId of searchOrder) {
      const list = state.messagesByConvId[convId];
      if (!list) continue;
      const idx = list.findIndex((m) => m.id === messageId);
      if (idx === -1) continue;
      return {
        messagesByConvId: { ...state.messagesByConvId, [convId]: list.filter((m) => m.id !== messageId) },
      };
    }
    return {};
  }),

  clearConversation: (convId) => set((state) => {
    const messagesByConvId = { ...state.messagesByConvId };
    delete messagesByConvId[convId];
    const hasMoreByConvId = { ...state.hasMoreByConvId };
    delete hasMoreByConvId[convId];
    return { messagesByConvId, hasMoreByConvId };
  }),
}));

// ── Selectors granular ───────────────────────────────────────────────────────
export const useMessagesForConv = (convId) =>
  useMessageStore((s) => (convId ? s.messagesByConvId[convId] || EMPTY_ARR : EMPTY_ARR));
export const useHasMoreForConv = (convId) =>
  useMessageStore((s) => (convId ? !!s.hasMoreByConvId[convId] : false));
