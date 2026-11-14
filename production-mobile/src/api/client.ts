import { ApiError, PESAN_JARINGAN, PESAN_TIDAK_PASTI, PESAN_TIMEOUT } from "./errors";

// API CLIENT — satu pintu ke backend SANSS (pola sama dengan finance-mobile).
//   • Bearer access token (15 menit); 401 TOKEN_INVALID → refresh SINGLE-FLIGHT lalu ulangi sekali.
//   • Token baru DISIMPAN sebelum dipakai: server mencabut sesi bila refresh token lama dipakai ulang.
//   • Refresh & login membawa `app: "production"` — token Produksi hanya menjangkau jalur produksi,
//     dan refresh TANPA `app` akan diperlakukan sebagai Finance (sesi tim produksi dicabut).
//   • Perintah (POST/PUT/PATCH/DELETE) membawa Idempotency-Key; timeout/putus ⇒ tidakPasti=true.

export const APP_ID = "production" as const;

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type ClientDeps = {
  baseUrl: string;
  getTokens: () => Tokens | null;
  saveTokens: (t: Tokens) => Promise<void>;
  onSessionLost: (reason: string) => void;
  newId: () => string;
  device: () => { id: string; appVersion: string };
  /** true di preview/production: menolak baseUrl bukan HTTPS. */
  wajibHttps?: boolean;
  fetchImpl?: typeof fetch;
  /** Pengirim multipart (unggahan). Bawaan: XMLHttpRequest — lihat `xhrFetch`. Tes boleh mengganti. */
  uploadImpl?: typeof fetch;
  timeoutMs?: number;
};

/**
 * Kirim multipart lewat XMLHttpRequest bawaan React Native.
 * MENGAPA bukan fetch: Expo SDK 57 mengganti `fetch` global dengan expo/fetch, yang TIDAK mendukung bagian FormData berbentuk
 * `{ uri, name, type }` (berkas lokal) — unggahan langsung gagal "Tidak bisa terhubung" tanpa pernah sampai ke server
 * (ditemukan 14 Nov 2026 saat menguji dokumentasi; ikut memengaruhi foto bukti tahap, Catatan Komponen, dan foto QC).
 * XHR React Native membaca berkas dari `uri` secara native. Bentuk balikan cukup untuk `kirim()`: ok, status, text(), headers.get().
 */
export const xhrFetch = ((url: string, init: { method: string; headers: Record<string, string>; body: FormData; signal?: AbortSignal }) =>
  new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(init.method, url);
    for (const [k, v] of Object.entries(init.headers)) xhr.setRequestHeader(k, v);
    xhr.onload = () => resolve({
      ok: xhr.status >= 200 && xhr.status < 300,
      status: xhr.status,
      text: async () => String(xhr.responseText ?? ""),
      headers: { get: (n: string) => xhr.getResponseHeader(n) },
    });
    xhr.onerror = () => reject(new TypeError("Network request failed"));
    xhr.ontimeout = () => reject(new TypeError("Network request failed"));
    if (init.signal) {
      if (init.signal.aborted) { reject(Object.assign(new Error("Aborted"), { name: "AbortError" })); return; }
      init.signal.addEventListener("abort", () => { xhr.abort(); reject(Object.assign(new Error("Aborted"), { name: "AbortError" })); });
    }
    xhr.send(init.body);
  })) as unknown as typeof fetch;

export type RequestOptions = {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
};

type Metode = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiClient {
  private refreshing: Promise<Tokens> | null = null;
  constructor(private deps: ClientDeps) {}

  get<T>(path: string, opts: RequestOptions = {}) {
    return this.kirim<T>("GET", path, opts, null);
  }

  /** Perintah yang mengubah data. `idempotencyKey`: satu UUID per niat pengguna, dipakai ulang saat mencoba lagi. */
  command<T>(metode: Exclude<Metode, "GET">, path: string, idempotencyKey: string, opts: RequestOptions = {}) {
    if (!idempotencyKey) throw new Error("Idempotency-Key wajib untuk perintah");
    return this.kirim<T>(metode, path, opts, idempotencyKey);
  }

  /**
   * Unggah multipart (foto/video bukti). Server menamai berkas dengan hash isinya, jadi unggah ulang berkas sama = URL sama:
   * aman diulang otomatis setelah galat jaringan (maks 3 kali). Timeout panjang karena video bisa puluhan MB.
   */
  async upload<T>(path: string, form: FormData, opts: Pick<RequestOptions, "timeoutMs" | "signal"> = {}): Promise<T> {
    let terakhir: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await this.kirim<T>("POST", path, { ...opts, timeoutMs: opts.timeoutMs ?? 180_000 }, null, false, form);
      } catch (e) {
        terakhir = e;
        if (!(e instanceof ApiError && e.isNetwork)) throw e;
      }
    }
    throw terakhir;
  }

  private url(path: string, query?: RequestOptions["query"]) {
    const q = Object.entries(query ?? {})
      .filter(([, v]) => v !== undefined && v !== null && v !== "")
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(String(v))}`)
      .join("&");
    return `${this.deps.baseUrl}${path}${q ? `?${q}` : ""}`;
  }

  private async kirim<T>(metode: Metode, path: string, opts: RequestOptions, idempotencyKey: string | null, sudahRefresh = false, form?: FormData): Promise<T> {
    if (this.deps.wajibHttps && !/^https:\/\//i.test(this.deps.baseUrl)) {
      throw new ApiError({ status: 0, code: "HTTPS_WAJIB", message: "Koneksi tidak aman diblokir. Hubungi admin." });
    }
    const requestId = this.deps.newId();
    const auth = opts.auth !== false;
    const tokens = this.deps.getTokens();
    const headers: Record<string, string> = { Accept: "application/json", "X-Request-Id": requestId };
    if (auth && tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    // Multipart: Content-Type (dengan boundary) diisi fetch sendiri — jangan diset manual.
    let body: string | FormData | undefined;
    if (form) body = form;
    else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? this.deps.timeoutMs ?? 30_000);
    opts.signal?.addEventListener("abort", () => ctl.abort());
    // Unggahan TIDAK dianggap "tidak pasti": idempoten oleh hash isi, aman diulang.
    const perintah = metode !== "GET" && !form;

    let res: Response;
    try {
      const kirimKe = form ? (this.deps.uploadImpl ?? (this.deps.fetchImpl ? this.deps.fetchImpl : xhrFetch)) : (this.deps.fetchImpl ?? fetch);
      res = await kirimKe(this.url(path, opts.query), { method: metode, headers, body, signal: ctl.signal });
    } catch (e) {
      const timeout = (e as { name?: string })?.name === "AbortError";
      throw new ApiError({
        status: 0,
        code: timeout ? "TIMEOUT" : "NETWORK",
        message: perintah ? PESAN_TIDAK_PASTI : timeout ? PESAN_TIMEOUT : PESAN_JARINGAN,
        requestId,
        tidakPasti: perintah,
      });
    } finally {
      clearTimeout(timer);
    }

    const teks = await res.text();
    const retryAfter = Number(res.headers.get("retry-after")) || undefined;

    if (res.ok) {
      if (!teks) return null as T;
      try {
        return JSON.parse(teks) as T;
      } catch {
        throw new ApiError({ status: res.status, code: "PARSE", message: "Respons server tidak bisa dibaca", requestId });
      }
    }

    let json: { error?: string; code?: string } = {};
    try { json = JSON.parse(teks) as typeof json; } catch { /* bukan JSON */ }
    const err = new ApiError({
      status: res.status,
      code: json.code,
      message: json.error ?? (res.status >= 500 ? "Server sedang bermasalah. Coba lagi sebentar lagi." : "Permintaan ditolak"),
      requestId,
      retryAfterSeconds: retryAfter,
    });

    if (res.status === 401 && auth) {
      if (err.code === "TOKEN_INVALID" && tokens && !sudahRefresh) {
        await this.refresh();
        return this.kirim<T>(metode, path, opts, idempotencyKey, true, form);
      }
      if (err.isAuthLost || err.code === "TOKEN_INVALID") this.deps.onSessionLost(String(err.code));
    }
    throw err;
  }

  /** Refresh single-flight: banyak request paralel yang kedaluwarsa menunggu satu panggilan. */
  refresh(): Promise<Tokens> {
    if (this.refreshing) return this.refreshing;
    const p = this.jalankanRefresh().finally(() => { this.refreshing = null; });
    this.refreshing = p;
    return p;
  }

  private async jalankanRefresh(): Promise<Tokens> {
    const sekarang = this.deps.getTokens();
    if (!sekarang) {
      this.deps.onSessionLost("REFRESH_INVALID");
      throw new ApiError({ status: 401, code: "REFRESH_INVALID", message: "Sesi tidak valid, silakan login ulang" });
    }
    try {
      const r = await this.kirim<Tokens>(
        "POST", "/mobile/auth/refresh",
        { auth: false, body: { refreshToken: sekarang.refreshToken, app: APP_ID, device: { appVersion: this.deps.device().appVersion } } },
        null,
      );
      const baru: Tokens = {
        accessToken: r.accessToken, refreshToken: r.refreshToken,
        accessTokenExpiresAt: r.accessTokenExpiresAt, refreshTokenExpiresAt: r.refreshTokenExpiresAt,
      };
      await this.deps.saveTokens(baru);
      return baru;
    } catch (e) {
      if (e instanceof ApiError && (e.isAuthLost || e.status === 401 || e.status === 403)) this.deps.onSessionLost(String(e.code));
      throw e;
    }
  }
}
