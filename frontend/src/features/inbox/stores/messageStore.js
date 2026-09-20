import { create } from "zustand";
import { useConversationStore } from "./conversationStore.js";

const EMPTY_ARR = [];

// Key stabil per cell, dibuat SEKALI saat pesan pertama masuk store (baik
// optimistic maupun dari server/socket) dan TIDAK PERNAH berubah lagi —
// beda dari `id`/`externalId` yang boleh berganti (temp→real, atau
// null→terisi). computeItemKey di MessageList.jsx pakai ini, BUKAN `id`
// langsung, supaya react-virtuoso melihat "update cell yang sudah ada"
// (bukan "hapus lama + pasang baru") saat entry optimistic direkonsiliasi.
function ensureKey(m) {
  return m._key ? m : { ...m, _key: m.id };
}

// upsertMessage — SATU jalur reconciliation dipakai SEMUA sumber pesan
// (optimistic send, response HTTP, event socket message:new, refetch SSE).
// Root cause duplikat bubble: pesan outbound yang KITA kirim sendiri
// datang balik lewat 2-3 jalur terpisah yang dulu SEMUA manggil
// appendMessage yang cuma cek `m.id === msg.id` — tidak pernah nangkep
// race antara entry optimistic (id="temp-...") dan echo socket/response
// (id asli dari DB), jadi nyisip baris baru per jalur yang datang.
//
// Match by (urut prioritas): id persis → externalId persis → clientId
// (dibuat sekali saat optimistic-send, diteruskan ke backend & di-echo
// balik di response + payload socket, lihat api.js#sendMessage &
// backend/src/routes/conversations.js) → fallback heuristik utk pesan
// lama tanpa clientId (OUTBOUND, status "sending", content sama persis).
// Match → MERGE field ke entry yang SUDAH ADA (pertahankan _key), TIDAK
// PERNAH remove+insert. Tidak match → append normal.
function findMatchIndex(list, msg) {
  return list.findIndex((m) => {
    if (m.id === msg.id) return true;
    if (msg.externalId && m.externalId === msg.externalId) return true;
    if (msg.clientId && m.clientId === msg.clientId) return true;
    if (!msg.clientId && !m.clientId && m.direction === "OUTBOUND" && msg.direction === "OUTBOUND"
        && m.status === "sending" && m.content === msg.content) return true;
    return false;
  });
}

// Batas percakapan yang riwayatnya ditahan di memori (RAM HP lama). Yang
// dibuang paling lama masuk store & bukan yang aktif; dimuat ulang saat dibuka lagi.
const MAX_CACHED_CONVERSATIONS = 8;
function evictOld(messagesByConvId, hasMoreByConvId, keepId) {
  const ids = Object.keys(messagesByConvId);
  if (ids.length <= MAX_CACHED_CONVERSATIONS) return { messagesByConvId, hasMoreByConvId };
  const drop = ids.filter((id) => id !== keepId).slice(0, ids.length - MAX_CACHED_CONVERSATIONS);
  const m = { ...messagesByConvId }; const h = { ...hasMoreByConvId };
  for (const id of drop) { delete m[id]; delete h[id]; }
  return { messagesByConvId: m, hasMoreByConvId: h };
}

export const useMessageStore = create((set) => ({
  messagesByConvId: {},   // { [convId]: Message[] }
  hasMoreByConvId: {},    // { [convId]: boolean } — masih ada pesan lama untuk di-load

  setMessages: (convId, msgs, hasMore = false) => set((state) => ({
    messagesByConvId: { ...state.messagesByConvId, [convId]: msgs.map(ensureKey) },
    hasMoreByConvId: { ...state.hasMoreByConvId, [convId]: hasMore },
  })),

  // Hasil fetch halaman TERBARU (initial load / refetch fallback). Beda dari
  // setMessages: pesan LEBIH LAMA yang sudah dimuat user (scroll ke atas) dan
  // entry optimistic yang belum terekonsiliasi TIDAK dibuang. Dedupe by
  // id/externalId/clientId (jalur yang sama dengan upsertMessage).
  mergeLatest: (convId, latest, hasMoreIfFirstLoad = false) => set((state) => {
    const existing = state.messagesByConvId[convId];
    if (!existing || existing.length === 0) {
      return evictOld(
        { ...state.messagesByConvId, [convId]: latest.map(ensureKey) },
        { ...state.hasMoreByConvId, [convId]: hasMoreIfFirstLoad },
        convId,
      );
    }
    const keyById = new Map(existing.map((m) => [m.id, m._key]));
    const fetched = latest.map((m) => (keyById.has(m.id) ? { ...m, _key: keyById.get(m.id) } : ensureKey(m)));
    const firstTs = fetched.length ? new Date(fetched[0].createdAt).getTime() : Infinity;
    const isSame = (a, b) => a.id === b.id
      || (b.externalId && a.externalId === b.externalId)
      || (b.clientId && a.clientId === b.clientId);
    // Lebih lama dari halaman terbaru → pertahankan; yang lebih baru & sudah ada di server → diganti fetched.
    const older = existing.filter((m) => !m.status && new Date(m.createdAt).getTime() < firstTs && !fetched.some((f) => isSame(m, f)));
    // Datang lewat socket SETELAH snapshot fetch diambil (lebih baru dari pesan terakhir fetch) → jangan hilang.
    const lastTs = fetched.length ? new Date(fetched[fetched.length - 1].createdAt).getTime() : -Infinity;
    const newer = existing.filter((m) => !m.status && new Date(m.createdAt).getTime() > lastTs && !fetched.some((f) => isSame(m, f)));
    // Optimistic (sending/failed) yang belum punya padanan di server → pertahankan di ujung.
    const pending = existing.filter((m) => m.status && !fetched.some((f) => isSame(m, f)));
    return { messagesByConvId: { ...state.messagesByConvId, [convId]: [...older, ...fetched, ...newer, ...pending] } };
  }),

  upsertMessage: (convId, msg) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    const idx = findMatchIndex(list, msg);
    if (idx !== -1) {
      const updatedList = [...list];
      // BUG (fix): pesan ASLI dari server (response HTTP/echo socket) tidak
      // punya field `status` sama sekali (cuma entry optimistic yang punya,
      // "sending"/"failed") — spread `{...old, ...msg}` TIDAK menimpa key
      // yang tidak ada di `msg`, jadi status "sending" nyangkut selamanya
      // di bubble walau pesannya sudah sukses terkirim (macet nunjukin ikon
      // jam pasir, AckTicks tidak pernah muncul karena isSending selalu
      // true). `status: msg.status ?? null` di bawah SENGAJA menimpa penuh
      // (bukan cuma saat msg.status ada) supaya entry yang sudah rekonsiliasi
      // ke pesan asli selalu bersih dari status optimistic lama.
      updatedList[idx] = { ...updatedList[idx], ...msg, status: msg.status ?? null, _key: updatedList[idx]._key };
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

  // Tandai pesan optimistic gagal terkirim — UI menampilkan tombol retry.
  markMessageFailed: (convId, tempId) => set((state) => {
    const list = state.messagesByConvId[convId] || [];
    return {
      messagesByConvId: {
        ...state.messagesByConvId,
        [convId]: list.map((m) => (m.id === tempId ? { ...m, status: "failed" } : m)),
      },
    };
  }),

  // Update status centang kirim (ack) untuk 1 pesan spesifik via externalId.
  // Dicari di conversation AKTIF dulu (paling umum — user sedang lihat chat itu),
  // baru fallback cari di semua conversation yang sudah dimuat di cache.
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

  // Update field arbitrer (mis. mediaUrl setelah "Muat Media" berhasil) —
  // dicari lintas conversation sama seperti updateAck (id pesan unik global,
  // tidak perlu tahu convId dari caller).
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
