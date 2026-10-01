// Draf unggahan DOKUMENTASI produksi yang bertahan offline (P10B) — IndexedDB.
//
// Masalah yang ditutup: foto lapangan yang belum terkirim hilang bila browser/PWA tertutup saat offline.
// Model: satu RECORD = satu pengiriman (principal + run + kategori [+ koreksi]) berisi foto (Blob), keterangan, urutan, kunci idempoten.
//   DRAFT  -> disusun di HP, belum dikirim (foto langsung dicoba diunggah bila online; Blob dibuang setelah unggahan sukses)
//   QUEUED -> pengguna menekan Kirim; menunggu sinyal / giliran / jeda ulang
//   SENDING-> sedang dikirim (lease, aman terhadap dua tab/dua worker)
//   FAILED -> gagal permanen (5x gagal jaringan, atau ditolak server); tombol Coba Lagi / Hapus draft
// Aturan keras: draf TIDAK PERNAH tercampur antar-user atau antar-unit; logout / pergantian user / skema berbeda / cache rusak membersihkan
// draf principal lama; unggahan sukses membersihkan Blob; batas penyimpanan dengan pesan Bahasa Indonesia; kirim exact-once (unggahan
// idempoten by isi + kunci idempoten tetap per record + claim atomik).
//
// Modul ini murni (tanpa React/DOM): adapter penyimpanan, api, jam, jaringan, dan penjadwal disuntikkan sehingga seluruhnya bisa diuji.

export const DRAFT_DB_NAME = "sanss-doc-drafts";
export const DRAFT_SCHEMA = 1;
export const STORE = "drafts";
export const MAX_RETRY = 5;
export const BACKOFF_MS = Object.freeze([3_000, 8_000, 20_000, 45_000, 90_000]);
export const LEASE_MS = 60_000;
export const LIMITS = Object.freeze({
  maxItemsPerDraft: 12, maxPhotoBytes: 15 * 1024 * 1024, maxBytesPerPrincipal: 120 * 1024 * 1024, maxDrafts: 40, quotaSafetyRatio: 0.9,
});
export const STATUS = Object.freeze({ DRAFT: "DRAFT", QUEUED: "QUEUED", SENDING: "SENDING", FAILED: "FAILED" });
export const IMAGE_TYPES = Object.freeze(["image/jpeg", "image/png", "image/webp"]);

export class DraftError extends Error {
  constructor(code, message, details) { super(message); this.name = "DraftError"; this.code = code; if (details) this.details = details; }
}
const MSG = Object.freeze({
  STORAGE_FULL: "Penyimpanan HP penuh. Kirim atau hapus draf lain lalu coba lagi.",
  TOO_MANY_ITEMS: `Maksimal ${LIMITS.maxItemsPerDraft} foto per pengiriman.`,
  TOO_MANY_DRAFTS: `Terlalu banyak draf tertunda (maksimal ${LIMITS.maxDrafts}). Kirim atau hapus draf lama dulu.`,
  PRINCIPAL_FULL: `Draf di HP ini sudah mencapai ${Math.round(LIMITS.maxBytesPerPrincipal / 1048576)} MB. Kirim atau hapus draf lama dulu.`,
  NOT_IMAGE: "Hanya foto JPG/PNG/WEBP yang bisa dikirim sebagai dokumentasi.",
  TOO_BIG: "Foto terlalu besar (maksimal 15 MB).",
  NOT_EDITABLE: "Draf ini sedang dikirim atau sudah gagal — tidak bisa diubah.",
  EMPTY: "Ambil atau pilih minimal satu foto.",
  REASON: "Alasan koreksi wajib diisi (minimal 3 karakter).",
  NOT_FOUND: "Draf tidak ditemukan.",
  STORAGE_UNAVAILABLE: "Penyimpanan draf di HP ini tidak tersedia. Foto tidak bisa disimpan offline.",
});

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isStr = (v) => typeof v === "string" && v.length > 0;
// Validasi bentuk record dari penyimpanan — apa pun yang tidak lolos dianggap RUSAK dan dibuang.
export function isValidRecord(r) {
  if (!isObj(r) || !isStr(r.id) || !isStr(r.principalId) || !isStr(r.runId) || !isStr(r.category) || !isStr(r.idempotencyKey)) return false;
  if (!Object.values(STATUS).includes(r.status) || !Number.isInteger(r.retryCount) || !Array.isArray(r.items)) return false;
  if (r.correction != null && !(isObj(r.correction) && isStr(r.correction.evidenceId))) return false;
  return r.items.every((i) => isObj(i) && isStr(i.id) && typeof i.size === "number" && (i.url == null || typeof i.url === "string") && (i.blob == null || typeof i.blob === "object") && (i.blob != null || isStr(i.url)));
}

// ---------------------------------------------------------------- adapter memori (uji) ----------------------------------------------
export function createMemoryAdapter({ failPutWith = null } = {}) {
  const rows = new Map();
  const clone = (v) => (v == null ? v : structuredClone(v));
  const api = {
    kind: "memory", rows, failPutWith,
    async getAll() { return [...rows.values()].map(clone); },
    async get(id) { return clone(rows.get(id) ?? null); },
    async put(rec) { if (api.failPutWith) throw api.failPutWith; rows.set(rec.id, clone(rec)); return rec; },
    async remove(id) { rows.delete(id); },
    // update ATOMIK: fn(current) -> next | null (null = tidak berubah). Mengembalikan next atau null.
    async update(id, fn) { const cur = clone(rows.get(id) ?? null); const next = fn(cur); if (!next) return null; if (api.failPutWith) throw api.failPutWith; rows.set(id, clone(next)); return clone(next); },
    async reset() { rows.clear(); },
  };
  return api;
}

// ---------------------------------------------------------------- adapter IndexedDB ----------------------------------------------------
export function createIdbAdapter(idb = globalThis.indexedDB) {
  if (!idb) throw new DraftError("STORAGE_UNAVAILABLE", MSG.STORAGE_UNAVAILABLE);
  let dbPromise = null;
  const openOnce = () => new Promise((resolve, reject) => {
    const req = idb.open(DRAFT_DB_NAME, DRAFT_SCHEMA);
    req.onupgradeneeded = () => { const db = req.result; if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "id" }); };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
    req.onblocked = () => reject(new Error("blocked"));
  });
  const deleteDb = () => new Promise((resolve) => { const r = idb.deleteDatabase(DRAFT_DB_NAME); r.onsuccess = r.onerror = r.onblocked = () => resolve(); });
  const db = () => {
    if (!dbPromise) {
      dbPromise = openOnce().then((d) => { d.onversionchange = () => { d.close(); dbPromise = null; }; return d; })
        .catch(async () => { await deleteDb(); return openOnce(); }); // versi lebih baru / DB rusak -> reset bersih
    }
    return dbPromise;
  };
  const run = async (mode, work) => {
    const d = await db();
    return new Promise((resolve, reject) => {
      let result = null;
      let t;
      try { t = d.transaction(STORE, mode); } catch (e) { dbPromise = null; reject(e); return; }
      const store = t.objectStore(STORE);
      work(store, (v) => { result = v; });
      t.oncomplete = () => resolve(result);
      t.onabort = () => reject(t.error || new Error("transaksi dibatalkan"));
      t.onerror = () => reject(t.error);
    });
  };
  return {
    kind: "indexeddb",
    getAll: () => run("readonly", (s, set) => { const r = s.getAll(); r.onsuccess = () => set(r.result || []); }),
    get: (id) => run("readonly", (s, set) => { const r = s.get(id); r.onsuccess = () => set(r.result ?? null); }),
    put: (rec) => run("readwrite", (s, set) => { s.put(rec); set(rec); }),
    remove: (id) => run("readwrite", (s) => { s.delete(id); }),
    update: (id, fn) => run("readwrite", (s, set) => {
      const r = s.get(id);
      r.onsuccess = () => { const next = fn(r.result ?? null); if (next) { s.put(next); set(next); } else set(null); };
    }),
    reset: async () => { try { const d = await db(); d.close(); } catch { /* abaikan */ } dbPromise = null; await deleteDb(); },
  };
}

// ---------------------------------------------------------------- pembersihan lintas-sesi -----------------------------------------------
// Dipanggil saat LOGOUT (App.jsx) — tanpa manager. Membuang semua draf milik principal itu + record rusak/skema lama.
export async function purgePrincipalDrafts(adapter, principalId) {
  let all = [];
  try { all = await adapter.getAll(); } catch { try { await adapter.reset?.(); } catch { /* abaikan */ } return { removed: 0, reset: true }; }
  let removed = 0;
  for (const r of all) {
    if (!isValidRecord(r) || r.schema !== DRAFT_SCHEMA || r.principalId === principalId) { await adapter.remove(r?.id ?? "").catch(() => {}); removed += 1; }
  }
  return { removed, reset: false };
}

const defaultId = () => (globalThis.crypto?.randomUUID ? globalThis.crypto.randomUUID() : `id-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`);
const isNetworkError = (e) => e?.status === 0 || e?.code === "NETWORK" || e?.code === "TIMEOUT" || e?.name === "TypeError" || /Failed to fetch|NetworkError|timeout/i.test(e?.message || "");
export const isRetryableError = (e) => isNetworkError(e) || (Number.isInteger(e?.status) && (e.status >= 500 || e.status === 408 || e.status === 429));
const keyFor = (id) => `p10b-doc-${id}`;

// ---------------------------------------------------------------- manager ---------------------------------------------------------------
export function createDraftManager({
  adapter, api, principalId, now = () => Date.now(), newId = defaultId, isOnline = () => (typeof navigator === "undefined" ? true : navigator.onLine !== false),
  schedule = (fn, ms) => setTimeout(fn, ms), clearSchedule = (h) => clearTimeout(h), estimateStorage = async () => null, makeThumb = async () => null, compress = async (f) => f,
}) {
  if (!isStr(principalId)) throw new DraftError("NO_PRINCIPAL", "Pengguna tidak dikenali — draf offline tidak aktif.");
  const listeners = new Set();
  const uploading = new Map(); // `${draftId}:${itemId}` -> persen (hanya memori; untuk UI)
  let timer = null; let loop = null; let loopAgain = false;
  const emit = (event) => { for (const fn of listeners) { try { fn(event); } catch { /* pendengar tidak boleh merusak alur */ } } };
  const subscribe = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };

  const mine = (r) => r && r.principalId === principalId;
  async function readAll() {
    const all = await adapter.getAll();
    return all.filter((r) => isValidRecord(r) && r.schema === DRAFT_SCHEMA && mine(r));
  }
  async function persistFail(e) {
    if (e?.name === "QuotaExceededError" || e?.code === 22 || /quota/i.test(e?.message || "")) throw new DraftError("STORAGE_FULL", MSG.STORAGE_FULL);
    throw e;
  }
  const bytesOf = (r) => r.items.reduce((s, i) => s + (i.blob ? i.size : 0), 0);

  // init: buang foreign / skema lain / rusak; kembalikan lease kedaluwarsa ke QUEUED.
  async function init() {
    const summary = { foreign: 0, corrupt: 0, schema: 0, reset: false, recovered: 0 };
    let all;
    try { all = await adapter.getAll(); } catch { await adapter.reset?.(); summary.reset = true; return summary; }
    for (const r of all) {
      if (!isValidRecord(r)) { summary.corrupt += 1; await adapter.remove(r?.id ?? "").catch(() => {}); continue; }
      if (r.schema !== DRAFT_SCHEMA) { summary.schema += 1; await adapter.remove(r.id); continue; }
      if (!mine(r)) { summary.foreign += 1; await adapter.remove(r.id); continue; }
      if (r.status === STATUS.SENDING && (r.leaseUntil ?? 0) < now()) { await adapter.update(r.id, (cur) => (cur && cur.status === STATUS.SENDING ? { ...cur, status: STATUS.QUEUED, leaseUntil: null } : null)); summary.recovered += 1; }
    }
    return summary;
  }

  const list = async ({ runId = null } = {}) => (await readAll()).filter((r) => (runId ? r.runId === runId : true)).sort((a, b) => a.createdAt - b.createdAt);
  const get = async (id) => { const r = await adapter.get(id); return r && isValidRecord(r) && mine(r) ? r : null; };

  async function openDraft({ runId, unitCode = null, customerName = null, category, categoryLabel = null, correction = null, seedItems = [] }) {
    const existing = (await readAll()).find((r) => r.status === STATUS.DRAFT && r.runId === runId && r.category === category && (r.correction?.evidenceId || null) === (correction?.evidenceId || null));
    if (existing) return existing;
    if ((await readAll()).length >= LIMITS.maxDrafts) throw new DraftError("TOO_MANY_DRAFTS", MSG.TOO_MANY_DRAFTS);
    const id = newId();
    const t = now();
    const rec = {
      id, schema: DRAFT_SCHEMA, principalId, runId, unitCode, customerName, category, categoryLabel,
      correction: correction ? { evidenceId: correction.evidenceId, reason: correction.reason || "" } : null,
      idempotencyKey: keyFor(newId()), status: STATUS.DRAFT, retryCount: 0, lastError: null, outcomeKnown: false, nextAttemptAt: 0, leaseUntil: null, createdAt: t, updatedAt: t,
      items: seedItems.map((s) => ({ id: newId(), blob: null, mime: "image/jpeg", size: 0, thumb: s.previewUrl || null, caption: s.caption || "", url: s.url, previewUrl: s.previewUrl || null, attempts: 0, error: null, existing: true })),
    };
    try { await adapter.put(rec); } catch (e) { await persistFail(e); }
    emit({ type: "changed", id });
    return rec;
  }

  const editable = (r) => r && r.status === STATUS.DRAFT;
  async function mutate(id, fn, { rotate = false } = {}) {
    const next = await adapter.update(id, (cur) => (cur && mine(cur) && editable(cur) ? { ...fn(structuredClone(cur)), updatedAt: now(), ...(rotate ? { idempotencyKey: keyFor(newId()) } : {}) } : null)).catch(persistFail);
    if (!next) throw new DraftError("NOT_EDITABLE", MSG.NOT_EDITABLE);
    emit({ type: "changed", id });
    return next;
  }

  async function addFiles(id, files) {
    const rec = await get(id);
    if (!rec) throw new DraftError("NOT_FOUND", MSG.NOT_FOUND);
    if (!editable(rec)) throw new DraftError("NOT_EDITABLE", MSG.NOT_EDITABLE);
    const added = []; const rejected = [];
    const all = await readAll();
    let totalBytes = all.reduce((s, r) => s + bytesOf(r), 0);
    let count = rec.items.length;
    const est = await estimateStorage().catch(() => null);
    for (const file of files) {
      if (!IMAGE_TYPES.includes(file.type)) { rejected.push({ name: file.name, code: "NOT_IMAGE", message: MSG.NOT_IMAGE }); continue; }
      const prepared = await compress(file);
      const size = prepared.size ?? file.size;
      if (size > LIMITS.maxPhotoBytes) { rejected.push({ name: file.name, code: "TOO_BIG", message: MSG.TOO_BIG }); continue; }
      if (count + added.length >= LIMITS.maxItemsPerDraft) { rejected.push({ name: file.name, code: "TOO_MANY_ITEMS", message: MSG.TOO_MANY_ITEMS }); continue; }
      if (totalBytes + size > LIMITS.maxBytesPerPrincipal) { rejected.push({ name: file.name, code: "PRINCIPAL_FULL", message: MSG.PRINCIPAL_FULL }); continue; }
      if (est && est.quota && est.usage + size > est.quota * LIMITS.quotaSafetyRatio) { rejected.push({ name: file.name, code: "STORAGE_FULL", message: MSG.STORAGE_FULL }); continue; }
      totalBytes += size;
      added.push({ id: newId(), blob: prepared, mime: prepared.type || file.type, size, thumb: await makeThumb(prepared).catch(() => null), caption: "", url: null, previewUrl: null, attempts: 0, error: null, existing: false, name: file.name });
    }
    if (added.length) await mutate(id, (cur) => ({ ...cur, items: [...cur.items, ...added] }), { rotate: true }); // QuotaExceededError -> STORAGE_FULL (persistFail)
    return { added: added.map((a) => a.id), rejected };
  }

  const setCaption = (id, itemId, caption) => mutate(id, (cur) => ({ ...cur, items: cur.items.map((i) => (i.id === itemId ? { ...i, caption: String(caption ?? "").slice(0, 200) } : i)) }), { rotate: true });
  const moveItem = (id, itemId, delta) => mutate(id, (cur) => {
    const from = cur.items.findIndex((i) => i.id === itemId); const to = from + delta;
    if (from < 0 || to < 0 || to >= cur.items.length) return cur;
    const items = [...cur.items]; const [it] = items.splice(from, 1); items.splice(to, 0, it); return { ...cur, items };
  }, { rotate: true });
  const removeItem = (id, itemId) => mutate(id, (cur) => ({ ...cur, items: cur.items.filter((i) => i.id !== itemId) }), { rotate: true });
  const setReason = (id, reason) => mutate(id, (cur) => ({ ...cur, correction: cur.correction ? { ...cur.correction, reason: String(reason ?? "").slice(0, 300) } : null }), { rotate: true });

  // ---------------- unggah foto (fase 1) ----------------
  async function uploadItem(rec, item) {
    const k = `${rec.id}:${item.id}`;
    uploading.set(k, 0); emit({ type: "progress", id: rec.id });
    try {
      const res = await api.upload(rec.runId, item.blob, (p) => { uploading.set(k, p); emit({ type: "progress", id: rec.id }); });
      const saved = res?.items?.[0];
      if (!saved?.url) throw Object.assign(new Error("Respons unggahan tidak valid"), { status: 502 });
      // Unggahan sukses -> Blob LOKAL DIBUANG (hanya thumbnail kecil yang tersisa untuk tampilan).
      await adapter.update(rec.id, (cur) => (cur && mine(cur) ? { ...cur, items: cur.items.map((i) => (i.id === item.id ? { ...i, blob: null, url: saved.url, previewUrl: saved.previewUrl || null, attempts: 0, error: null } : i)) } : null));
      return { ok: true };
    } catch (e) {
      const retryable = isRetryableError(e);
      await adapter.update(rec.id, (cur) => (cur && mine(cur) ? { ...cur, items: cur.items.map((i) => (i.id === item.id ? { ...i, attempts: retryable ? i.attempts + 1 : MAX_RETRY, error: e?.message || "Gagal mengunggah" } : i)) } : null)).catch(() => {});
      return { ok: false, error: e, retryable };
    } finally { uploading.delete(k); emit({ type: "changed", id: rec.id }); }
  }

  // Unggah foto draf yang belum terunggah (dipanggil saat foto ditambah / saat kembali online). Tidak mengirim pengiriman.
  async function uploadPending(id) {
    if (!isOnline()) return { skipped: true };
    const rec = await get(id);
    if (!rec) return { skipped: true };
    let failed = 0;
    for (const item of rec.items) {
      if (item.url || !item.blob || item.attempts >= MAX_RETRY || uploading.has(`${rec.id}:${item.id}`)) continue;
      const r = await uploadItem(rec, item);
      if (!r.ok) failed += 1;
    }
    return { failed };
  }
  async function retryItem(id, itemId) {
    await adapter.update(id, (cur) => (cur && mine(cur) ? { ...cur, items: cur.items.map((i) => (i.id === itemId ? { ...i, attempts: 0, error: null } : i)) } : null));
    return uploadPending(id);
  }

  // ---------------- antrean kirim (fase 2) ----------------
  async function queue(id) {
    const rec = await get(id);
    if (!rec) throw new DraftError("NOT_FOUND", MSG.NOT_FOUND);
    if (!editable(rec)) throw new DraftError("NOT_EDITABLE", MSG.NOT_EDITABLE);
    if (rec.items.length === 0) throw new DraftError("EMPTY", MSG.EMPTY);
    if (rec.correction && (rec.correction.reason || "").trim().length < 3) throw new DraftError("REASON", MSG.REASON);
    await adapter.update(id, (cur) => (cur && editable(cur) ? { ...cur, status: STATUS.QUEUED, retryCount: 0, lastError: null, nextAttemptAt: 0, updatedAt: now() } : null)).catch(persistFail);
    emit({ type: "queued", id });
    return processQueue();
  }

  function bodyOf(rec) {
    const items = rec.items.map((i, idx) => ({ url: i.url, caption: (i.caption || "").trim() || undefined, order: idx + 1 }));
    return rec.correction
      ? { category: rec.category, items, supersedesEvidenceId: rec.correction.evidenceId, reason: rec.correction.reason.trim() }
      : { category: rec.category, items };
  }

  async function release(id, patch) { await adapter.update(id, (cur) => (cur && mine(cur) ? { ...cur, ...patch, leaseUntil: null, updatedAt: now() } : null)).catch(() => {}); }

  async function deliver(rec0) {
    let rec = rec0;
    // 1) unggah foto yang masih berupa Blob (idempoten by isi di server)
    for (const item of rec.items) {
      if (item.url) continue;
      if (!item.blob) { await release(rec.id, { status: STATUS.FAILED, lastError: "Foto lokal hilang — hapus draf lalu ambil ulang.", outcomeKnown: true }); emit({ type: "failed", id: rec.id }); return; }
      const r = await uploadItem(rec, item);
      if (!r.ok) return failure(rec, r.error);
    }
    rec = await get(rec.id); if (!rec) return null;
    // 2) kirim (kunci idempoten TETAP -> replay aman bila respons hilang / tab ditutup di tengah)
    let res;
    try {
      const body = bodyOf(rec);
      res = rec.correction ? await api.correct(rec.runId, body, rec.idempotencyKey) : await api.submit(rec.runId, body, rec.idempotencyKey);
    } catch (e) { return failure(rec, e); }
    // Server SUDAH menerima. Bila pembersihan lokal gagal (mis. tab mati di tengah), record dibiarkan QUEUED dengan kunci yang SAMA:
    // percobaan berikutnya hanya me-replay (server membalas replayed) lalu membersihkan — tidak pernah kirim dua kali.
    try { await adapter.remove(rec.id); } catch {
      await release(rec.id, { status: STATUS.QUEUED, nextAttemptAt: now() + BACKOFF_MS[0], lastError: null });
      emit({ type: "sent", id: rec.id, record: rec, result: res, cleanupPending: true }); armTimer();
      return { sent: true, cleanupPending: true };
    }
    emit({ type: "sent", id: rec.id, record: rec, result: res });
    return { sent: true };
  }

  async function failure(rec, e) {
    if (isRetryableError(e)) {
      const retryCount = rec.retryCount + 1;
      if (retryCount >= MAX_RETRY) {
        await release(rec.id, { status: STATUS.FAILED, retryCount, lastError: `Gagal ${MAX_RETRY} kali karena koneksi atau server tidak terjangkau. Periksa sinyal lalu tekan Coba Lagi.`, outcomeKnown: false });
        emit({ type: "failed", id: rec.id });
      } else {
        const delay = BACKOFF_MS[Math.min(retryCount - 1, BACKOFF_MS.length - 1)];
        await release(rec.id, { status: STATUS.QUEUED, retryCount, lastError: e?.message || "Koneksi terputus", nextAttemptAt: now() + delay });
        emit({ type: "retry", id: rec.id, retryCount, delay });
        armTimer();
      }
    } else {
      // Ditolak server (4xx): hasil PASTI tidak diterapkan; mengulang tanpa perubahan percuma -> FAILED, bisa dibuka lagi untuk diedit.
      await release(rec.id, { status: STATUS.FAILED, lastError: e?.message || "Ditolak server", outcomeKnown: true, errorCode: e?.code || null });
      emit({ type: "failed", id: rec.id });
    }
    return { sent: false };
  }

  async function armTimer() {
    if (timer) { clearSchedule(timer); timer = null; }
    const queued = (await readAll()).filter((r) => r.status === STATUS.QUEUED && r.nextAttemptAt > now());
    if (!queued.length) return;
    const wait = Math.max(0, Math.min(...queued.map((r) => r.nextAttemptAt)) - now());
    timer = schedule(() => { timer = null; processQueue(); }, wait);
  }

  // Single-flight dalam proses ini; antar-proses/tab diamankan claim atomik + lease.
  function processQueue() {
    if (loop) { loopAgain = true; return loop; }
    const run = (async () => {
      {
        do {
          loopAgain = false;
          if (!isOnline()) break; // tunggu event online — tidak menghitung sebagai percobaan
          const due = (await readAll()).filter((r) => r.status === STATUS.QUEUED && r.nextAttemptAt <= now());
          for (const r of due) {
            const claimed = await adapter.update(r.id, (cur) => (cur && mine(cur) && cur.status === STATUS.QUEUED && cur.nextAttemptAt <= now() && !(cur.leaseUntil && cur.leaseUntil > now())
              ? { ...cur, status: STATUS.SENDING, leaseUntil: now() + LEASE_MS } : null));
            if (!claimed) continue;
            emit({ type: "sending", id: claimed.id });
            await deliver(claimed);
          }
        } while (loopAgain);
      }
      await armTimer();
    })();
    // Reset di .finally (BUKAN di dalam IIFE): IIFE yang selesai sinkron (offline) akan mereset sebelum penugasan dan membuat loop macet.
    const tracked = run.finally(() => { if (loop === tracked) loop = null; });
    loop = tracked;
    return tracked;
  }

  async function retry(id) {
    const rec = await get(id);
    if (!rec || rec.status !== STATUS.FAILED) return null;
    await adapter.update(id, (cur) => (cur && cur.status === STATUS.FAILED ? { ...cur, status: STATUS.QUEUED, retryCount: 0, nextAttemptAt: 0, lastError: null, items: cur.items.map((i) => ({ ...i, attempts: 0, error: null })) } : null));
    emit({ type: "queued", id });
    return processQueue();
  }
  // Gagal karena ditolak server (hasil pasti tidak diterapkan) -> buka lagi sebagai DRAFT dengan kunci idempoten baru agar bisa diedit.
  async function reopen(id) {
    const next = await adapter.update(id, (cur) => (cur && mine(cur) && cur.status === STATUS.FAILED && cur.outcomeKnown ? { ...cur, status: STATUS.DRAFT, retryCount: 0, lastError: null, idempotencyKey: keyFor(newId()), updatedAt: now(), items: cur.items.map((i) => ({ ...i, attempts: 0, error: null })) } : null));
    if (!next) throw new DraftError("NOT_EDITABLE", "Draf ini tidak bisa dibuka lagi (hasil pengiriman belum pasti). Gunakan Coba Lagi atau Hapus draf.");
    emit({ type: "changed", id });
    return next;
  }
  async function discard(id) {
    const rec = await get(id);
    if (!rec) return false;
    if (rec.status === STATUS.SENDING && (rec.leaseUntil ?? 0) > now()) throw new DraftError("BUSY", "Draf sedang dikirim — tunggu selesai.");
    await adapter.remove(id);
    emit({ type: "changed", id });
    return true;
  }
  async function purgeAll() { const all = await readAll(); for (const r of all) await adapter.remove(r.id); emit({ type: "changed" }); return all.length; }

  // Saat kembali online / aplikasi dibuka: lanjutkan unggahan foto draf + antrean kirim.
  async function onOnline() {
    for (const r of await readAll()) if (r.status === STATUS.DRAFT) await uploadPending(r.id);
    return processQueue();
  }
  async function stats() {
    const all = await readAll();
    return { total: all.length, draft: all.filter((r) => r.status === STATUS.DRAFT).length, queued: all.filter((r) => r.status === STATUS.QUEUED).length, sending: all.filter((r) => r.status === STATUS.SENDING).length, failed: all.filter((r) => r.status === STATUS.FAILED).length, bytes: all.reduce((s, r) => s + bytesOf(r), 0), uploading: uploading.size };
  }
  // true bila masih ada pekerjaan aktif yang akan hilang/terganggu bila halaman ditinggalkan.
  async function hasActiveWork() { const s = await stats(); return s.queued + s.sending + s.uploading > 0; }
  const progressOf = (draftId, itemId) => uploading.get(`${draftId}:${itemId}`) ?? null;
  function dispose() { if (timer) clearSchedule(timer); timer = null; listeners.clear(); }

  return { init, list, get, openDraft, addFiles, setCaption, moveItem, removeItem, setReason, uploadPending, retryItem, queue, processQueue, retry, reopen, discard, purgeAll, onOnline, stats, hasActiveWork, progressOf, subscribe, dispose, principalId };
}

// Thumbnail kecil (data URL) untuk tampilan setelah Blob dibuang; hanya browser. Gagal -> null (UI memakai ikon).
export async function makeThumbDataUrl(blob, max = 160) {
  if (typeof createImageBitmap !== "function" || typeof document === "undefined") return null;
  const bmp = await createImageBitmap(blob);
  const scale = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(bmp.width * scale)); c.height = Math.max(1, Math.round(bmp.height * scale));
  c.getContext("2d").drawImage(bmp, 0, 0, c.width, c.height); bmp.close?.();
  return c.toDataURL("image/jpeg", 0.6);
}
export const draftStatusLabel = (r, { online = true } = {}) => ({
  DRAFT: "Draf — belum dikirim", QUEUED: online ? "Menunggu giliran kirim" : "Menunggu sinyal", SENDING: "Mengirim…", FAILED: "Gagal",
}[r.status] || r.status);
