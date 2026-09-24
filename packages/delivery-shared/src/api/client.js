// Klien API bersama untuk aplikasi Delivery (Control, dan kelak Driver). Murni JS
// tanpa dependency native: penyimpanan, fetch, dan upload DISUNTIKKAN oleh aplikasi
// (AsyncStorage / expo-file-system), sehingga seluruh perilaku jaringan bisa diuji
// dengan node --test. Perilakunya mengikuti driver-mobile/src/api.js yang sudah
// teruji produksi: timeout, adopsi X-Refreshed-Token, 401 = sesi berakhir, dan
// hanya GET yang diulang saat 502/503/504 atau koneksi putus.

export class ApiError extends Error {
  constructor(message, { status, body } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.body = body;
  }
}

export function buildQuery(params) {
  const q = Object.entries(params || {})
    .filter(([, v]) => v !== undefined && v !== null && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return q ? `?${q}` : "";
}

const DEFAULT_RETRY_MS = [1000, 2000, 4000];

export function createApiClient({
  serverUrl,
  storage,
  fetchImpl,
  uploadImpl,
  onUnauthorized,
  tokenKey = "token",
  timeoutMs = 30000,
  uploadTimeoutMs = 120000,
  retryDelaysMs = DEFAULT_RETRY_MS,
  sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
} = {}) {
  let server = serverUrl;
  let token = null;
  const doFetch = (...a) => (fetchImpl || globalThis.fetch)(...a);

  async function persistToken(value) {
    token = value;
    if (!storage) return;
    try {
      if (value) await storage.setItem(tokenKey, value);
      else await storage.removeItem(tokenKey);
    } catch {}
  }

  async function handleUnauthorized() {
    await persistToken(null);
    if (onUnauthorized) onUnauthorized();
    return new ApiError("Sesi berakhir, silakan login kembali", { status: 401 });
  }

  async function adoptRefreshedToken(res) {
    const baru = res.headers?.get?.("X-Refreshed-Token");
    if (baru) await persistToken(baru);
  }

  async function fetchWithRetry(url, init) {
    const safe = !init.method || init.method === "GET";
    for (let i = 0; ; i++) {
      try {
        const res = await doFetch(url, init);
        if (safe && [502, 503, 504].includes(res.status) && i < retryDelaysMs.length) {
          await sleep(retryDelaysMs[i]);
          continue;
        }
        return res;
      } catch (err) {
        if (err.name === "AbortError" || !safe || i >= retryDelaysMs.length) throw err;
        await sleep(retryDelaysMs[i]);
      }
    }
  }

  function errorFromResponse(status, text) {
    let body;
    let msg;
    try { body = JSON.parse(text); msg = body?.error; } catch {}
    if (!msg) msg = text ? `${status}: ${String(text).slice(0, 300)}` : `Error ${status}`;
    return new ApiError(msg, { status, body });
  }

  async function request(path, { method = "GET", body, headers = {} } = {}) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetchWithRetry(`${server}/api${path}`, {
        method,
        signal: controller.signal,
        headers: {
          "Content-Type": "application/json",
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
          ...headers,
        },
        ...(body !== undefined && { body: typeof body === "string" ? body : JSON.stringify(body) }),
      });
      await adoptRefreshedToken(res);
      if (res.status === 401) throw await handleUnauthorized();
      if (!res.ok) throw errorFromResponse(res.status, await res.text());
      return res.json();
    } catch (err) {
      if (controller.signal.aborted) throw new ApiError("Koneksi timeout — coba lagi", { status: 0 });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  // uploadImpl(url, file, { fieldName, fields, headers, signal }) -> { status, body }
  async function upload(path, file, { fieldName = "file", fields = {}, headers = {} } = {}) {
    if (!uploadImpl) throw new ApiError("Upload belum dikonfigurasi", { status: 0 });
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), uploadTimeoutMs);
    try {
      const result = await uploadImpl(`${server}/api${path}`, file, {
        fieldName,
        fields,
        headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), ...headers },
        signal: controller.signal,
      });
      if (result.status === 401) throw await handleUnauthorized();
      if (result.status < 200 || result.status >= 300) throw errorFromResponse(result.status, result.body);
      return JSON.parse(result.body);
    } catch (err) {
      if (controller.signal.aborted) throw new ApiError("Koneksi timeout — coba lagi", { status: 0 });
      throw err;
    } finally {
      clearTimeout(timer);
    }
  }

  return {
    request,
    upload,
    getServerUrl: () => server,
    setServerUrl: (url) => { server = url || serverUrl; },
    getToken: () => token,
    setToken: persistToken,
    async restoreToken() {
      if (!storage) return null;
      try { token = (await storage.getItem(tokenKey)) || null; } catch { token = null; }
      return token;
    },
    mediaUrl(pathOrUrl) {
      if (!pathOrUrl) return null;
      if (/^(https?:|file:)/.test(pathOrUrl)) return pathOrUrl;
      return server + pathOrUrl;
    },
  };
}

// Kunci idempotensi sisi klien: acak per AKSI, dibuat SEKALI lalu dipakai ulang
// pada retry aksi yang sama (disimpan bersama draf/antrean). Format lolos
// middleware idempotency backend: 8-128 karakter [A-Za-z0-9_\-:.].
export function newIdempotencyKey(prefix = "ctl", rand = Math.random, now = Date.now) {
  const r = () => Math.floor(rand() * 0xffffffff).toString(36).padStart(7, "0");
  return `${prefix}-${now().toString(36)}-${r()}${r()}`.slice(0, 128);
}
