import { ApiError, PESAN_JARINGAN, PESAN_TIDAK_PASTI, PESAN_TIMEOUT } from "./errors";
import { parseResponse, type OpsiNormalisasi } from "./normalize";

// API CLIENT — satu pintu ke backend SANSS.
//   • Bearer access token (15 menit); 401 kedaluwarsa → refresh SINGLE-FLIGHT lalu ulangi sekali.
//   • Token baru DISIMPAN (await saveTokens) SEBELUM dipakai: server mencabut sesi bila refresh
//     token lama dipakai ulang, jadi kehilangan token baru = logout paksa.
//   • Command (POST/PUT/PATCH/DELETE) WAJIB membawa Idempotency-Key (server menolak dengan 428).
//   • Timeout/putus pada command ⇒ ApiError.tidakPasti=true: jangan kirim ulang buta.
//   • Uang di respons menjadi string desimal (normalize.ts).

export type Tokens = {
  accessToken: string;
  refreshToken: string;
  accessTokenExpiresAt: string;
  refreshTokenExpiresAt: string;
};

export type ClientDeps = {
  baseUrl: string;
  getTokens: () => Tokens | null;
  /** Harus menyimpan ke penyimpanan aman lalu resolve — dipanggil SEBELUM token baru dipakai. */
  saveTokens: (t: Tokens) => Promise<void>;
  onSessionLost: (reason: string) => void;
  newId: () => string;
  device: () => { id: string; appVersion: string };
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
};

export type RequestOptions = {
  query?: Record<string, string | number | undefined | null>;
  body?: unknown;
  auth?: boolean;
  timeoutMs?: number;
  signal?: AbortSignal;
  normalisasi?: OpsiNormalisasi;
};

type Metode = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";

export class ApiClient {
  private refreshing: Promise<Tokens> | null = null;
  constructor(private deps: ClientDeps) {}

  get<T>(path: string, opts: RequestOptions = {}) {
    return this.kirim<T>("GET", path, opts, null);
  }

  /** Perintah yang mengubah data. `idempotencyKey` WAJIB: satu UUID per niat pengguna, dipakai ulang saat mencoba lagi. */
  command<T>(metode: Exclude<Metode, "GET">, path: string, idempotencyKey: string, opts: RequestOptions = {}) {
    if (!idempotencyKey) throw new Error("Idempotency-Key wajib untuk perintah keuangan");
    return this.kirim<T>(metode, path, opts, idempotencyKey);
  }

  /** Unggah multipart (foto nota). Idempoten oleh nama = hash isi di server, jadi boleh diulang. */
  async upload<T>(path: string, form: FormData, opts: Pick<RequestOptions, "timeoutMs" | "signal"> = {}): Promise<T> {
    let terakhir: unknown;
    for (let i = 0; i < 3; i++) {
      try {
        return await this.kirim<T>("POST", path, { ...opts, timeoutMs: opts.timeoutMs ?? 90_000 }, null, form);
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

  private async kirim<T>(
    metode: Metode, path: string, opts: RequestOptions, idempotencyKey: string | null, form?: FormData, sudahRefresh = false,
  ): Promise<T> {
    const requestId = this.deps.newId();
    const auth = opts.auth !== false;
    const tokens = this.deps.getTokens();
    const headers: Record<string, string> = { Accept: "application/json", "X-Request-Id": requestId };
    if (auth && tokens) headers.Authorization = `Bearer ${tokens.accessToken}`;
    if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
    let body: BodyInit | undefined;
    if (form) body = form;
    else if (opts.body !== undefined) { headers["Content-Type"] = "application/json"; body = JSON.stringify(opts.body); }

    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), opts.timeoutMs ?? this.deps.timeoutMs ?? 30_000);
    opts.signal?.addEventListener("abort", () => ctl.abort());
    const perintah = metode !== "GET";

    let res: Response;
    try {
      res = await (this.deps.fetchImpl ?? fetch)(this.url(path, opts.query), { method: metode, headers, body, signal: ctl.signal });
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
        return parseResponse<T>(teks, opts.normalisasi);
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
      // Token kedaluwarsa/tidak valid → refresh sekali lalu ulangi permintaan yang sama (kunci idempotensi sama).
      if (err.code === "TOKEN_INVALID" && tokens && !sudahRefresh) {
        await this.refresh();
        return this.kirim<T>(metode, path, opts, idempotencyKey, form, true);
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
        { auth: false, body: { refreshToken: sekarang.refreshToken, device: { appVersion: this.deps.device().appVersion } } },
        null,
      );
      const baru: Tokens = {
        accessToken: r.accessToken, refreshToken: r.refreshToken,
        accessTokenExpiresAt: r.accessTokenExpiresAt, refreshTokenExpiresAt: r.refreshTokenExpiresAt,
      };
      await this.deps.saveTokens(baru); // simpan DULU
      return baru;
    } catch (e) {
      if (e instanceof ApiError && (e.isAuthLost || e.status === 401 || e.status === 403)) this.deps.onSessionLost(String(e.code));
      throw e;
    }
  }
}
