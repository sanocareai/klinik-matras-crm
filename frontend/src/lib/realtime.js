// Realtime tunggal per sesi web.
//
// SEBELUMNYA: Socket.IO (cuma hidup di halaman Inbox) + EventSource SSE
// (hidup di seluruh app) jalan PARALEL = 2 koneksi terbuka terus-menerus per
// tab, dan tiap event memicu refetch ganda. SEKARANG: event global
// ("new_message") dikirim backend lewat Socket.IO juga (backend/routes/sse.js
// #broadcast), jadi cukup SATU koneksi socket. SSE tinggal FALLBACK — baru
// dibuka kalau socket putus terus-menerus > graceMs, dan langsung ditutup
// begitu socket tersambung lagi. Reconnect SSE pakai exponential backoff.
//
// Semua dependency diinjeksi supaya bisa dites tanpa browser (lihat
// frontend/tests/realtime.test.js).
export function createRealtime({
  getSocket,
  openEventSource,
  graceMs = 4000,
  backoffStartMs = 3000,
  backoffMaxMs = 30000,
  setTimeoutFn = setTimeout,
  clearTimeoutFn = clearTimeout,
}) {
  const listeners = new Map();      // eventType → Set<cb>
  const socketHandlers = new Map(); // eventType → handler terpasang di socket
  const esHandlers = new Map();     // eventType → handler terpasang di EventSource
  let socket = null;
  let es = null;
  let graceTimer = null;
  let retryTimer = null;
  let backoff = backoffStartMs;
  let onConnect = null;
  let onDisconnect = null;

  function dispatch(type, data) {
    listeners.get(type)?.forEach((cb) => { try { cb(data); } catch { /* error satu listener tidak mematikan yang lain */ } });
  }

  function closeEs() {
    clearTimeoutFn(retryTimer); retryTimer = null;
    if (es) {
      try { es.close(); } catch { /* sudah tertutup */ }
      es = null;
      esHandlers.clear();
    }
  }

  function attachEsHandler(type) {
    if (!es || esHandlers.has(type)) return;
    const h = (e) => { try { dispatch(type, JSON.parse(e.data)); } catch { /* payload rusak diabaikan */ } };
    esHandlers.set(type, h);
    es.addEventListener(type, h);
  }

  function openEs() {
    if (es || !listeners.size || (socket && socket.connected)) return;
    const next = openEventSource();
    if (!next) return;
    es = next;
    es.onopen = () => { backoff = backoffStartMs; };
    es.onerror = () => {
      closeEs();
      // Socket sudah pulih / tidak ada peminat lagi → jangan reconnect SSE.
      if (!listeners.size || (socket && socket.connected)) return;
      retryTimer = setTimeoutFn(() => { retryTimer = null; openEs(); }, backoff);
      backoff = Math.min(backoff * 2, backoffMaxMs);
    };
    for (const type of listeners.keys()) attachEsHandler(type);
  }

  function scheduleFallback() {
    if (graceTimer || es) return;
    graceTimer = setTimeoutFn(() => { graceTimer = null; openEs(); }, graceMs);
  }

  function start() {
    socket = getSocket();
    onConnect = () => { clearTimeoutFn(graceTimer); graceTimer = null; backoff = backoffStartMs; closeEs(); };
    onDisconnect = () => scheduleFallback();
    socket.on("connect", onConnect);
    socket.on("disconnect", onDisconnect);
    if (!socket.connected) scheduleFallback();
  }

  function stop() {
    clearTimeoutFn(graceTimer); graceTimer = null;
    closeEs();
    if (socket) {
      for (const [type, h] of socketHandlers) socket.off(type, h);
      socket.off("connect", onConnect);
      socket.off("disconnect", onDisconnect);
    }
    socketHandlers.clear();
    socket = null;
  }

  function subscribe(type, cb) {
    if (!listeners.size) start();
    if (!listeners.has(type)) listeners.set(type, new Set());
    listeners.get(type).add(cb);
    if (!socketHandlers.has(type)) {
      const h = (data) => dispatch(type, data);
      socketHandlers.set(type, h);
      socket.on(type, h);
    }
    attachEsHandler(type);

    return () => {
      listeners.get(type)?.delete(cb);
      if (listeners.get(type)?.size === 0) {
        listeners.delete(type);
        const h = socketHandlers.get(type);
        if (h && socket) socket.off(type, h);
        socketHandlers.delete(type);
        if (es && esHandlers.has(type)) { es.removeEventListener(type, esHandlers.get(type)); esHandlers.delete(type); }
      }
      if (!listeners.size) stop();
    };
  }

  // Untuk tes/diagnostik.
  const stats = () => ({ types: listeners.size, sseOpen: !!es, socketHandlers: socketHandlers.size });

  return { subscribe, stats };
}
