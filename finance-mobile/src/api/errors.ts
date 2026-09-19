// GALAT API. Server selalu membalas { "error": "<pesan Bahasa Indonesia>", "code"?: "..." }.
// Pesan server ditampilkan APA ADANYA (sudah ditujukan ke pengguna); `code` hanya untuk logika.

export type ApiErrorCode =
  | "SESSION_REVOKED" | "TOKEN_INVALID" | "REFRESH_INVALID" | "REFRESH_REUSED" | "SESSION_EXPIRED" | "ACCOUNT_INACTIVE"
  | "NOT_FINANCE_TEAM" | "RATE_LIMITED"
  | "IDEMPOTENCY_KEY_REQUIRED" | "IDEMPOTENCY_KEY_INVALID" | "IDEMPOTENCY_KEY_REUSED" | "IDEMPOTENCY_IN_PROGRESS"
  | "NETWORK" | "TIMEOUT" | "PARSE" | "UNKNOWN";

export class ApiError extends Error {
  readonly status: number;
  readonly code: ApiErrorCode | string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  /** true bila hasil command TIDAK PASTI (timeout/putus setelah terkirim) — jangan kirim ulang buta. */
  readonly tidakPasti: boolean;

  constructor(opts: { status: number; message: string; code?: string; requestId?: string; retryAfterSeconds?: number; tidakPasti?: boolean }) {
    super(opts.message);
    this.name = "ApiError";
    this.status = opts.status;
    this.code = opts.code ?? "UNKNOWN";
    this.requestId = opts.requestId;
    this.retryAfterSeconds = opts.retryAfterSeconds;
    this.tidakPasti = opts.tidakPasti ?? false;
  }

  get isNetwork() { return this.code === "NETWORK" || this.code === "TIMEOUT"; }
  get isAuthLost() {
    return ["SESSION_REVOKED", "REFRESH_INVALID", "REFRESH_REUSED", "SESSION_EXPIRED", "ACCOUNT_INACTIVE"].includes(this.code);
  }
  get isConflict() { return this.status === 409; }
  get isForbidden() { return this.status === 403; }
  get isServer() { return this.status >= 500; }
}

/** Pesan ramah untuk galat tanpa respons server. */
export const PESAN_JARINGAN = "Tidak bisa terhubung ke server. Periksa koneksi internet Anda.";
export const PESAN_TIMEOUT = "Server terlalu lama menjawab. Coba lagi sebentar lagi.";
export const PESAN_TIDAK_PASTI =
  "Status belum pasti — koneksi terputus setelah perintah terkirim. Cek daftar dulu sebelum mencoba lagi.";
