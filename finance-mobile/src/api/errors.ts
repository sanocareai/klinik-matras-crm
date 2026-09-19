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

/** Kode alasan sesi berakhir → kalimat untuk pengguna (banner di layar login). */
export const PESAN_SESI_HILANG: Record<string, string> = {
  SESSION_REVOKED: "Sesi Anda dicabut (mungkin dikeluarkan dari perangkat lain). Silakan masuk lagi.",
  SESSION_EXPIRED: "Sesi Anda sudah berakhir karena lama tidak dipakai. Silakan masuk lagi.",
  REFRESH_REUSED: "Sesi dihentikan demi keamanan karena ada percobaan memakai sesi lama. Silakan masuk lagi.",
  REFRESH_INVALID: "Sesi Anda tidak valid lagi. Silakan masuk lagi.",
  TOKEN_INVALID: "Sesi Anda tidak valid lagi. Silakan masuk lagi.",
  ACCOUNT_INACTIVE: "Akun ini sudah dinonaktifkan. Hubungi admin kalau ini keliru.",
  NOT_FINANCE_TEAM: "Akun Anda tidak lagi punya akses Finance. Hubungi admin.",
  PIN_TERLALU_BANYAK_SALAH: "PIN salah terlalu banyak kali. Demi keamanan Anda dikeluarkan — silakan masuk lagi.",
};

export function pesanSesiHilang(kode: string | null | undefined): string | null {
  if (!kode) return null;
  return PESAN_SESI_HILANG[kode] ?? "Sesi Anda berakhir. Silakan masuk lagi.";
}

/** Galat apa pun → satu kalimat Bahasa Indonesia yang aman ditampilkan (tanpa detail teknis server). */
export function pesanUntukPengguna(e: unknown): string {
  if (!(e instanceof ApiError)) return "Terjadi kesalahan. Coba lagi.";
  if (e.isNetwork) return e.message; // sudah berbahasa Indonesia (PESAN_JARINGAN/TIMEOUT/TIDAK_PASTI)
  if (e.code === "RATE_LIMITED") {
    const d = e.retryAfterSeconds;
    const waktu = d == null ? "beberapa menit" : d >= 90 ? `${Math.ceil(d / 60)} menit` : `${d} detik`;
    return `Terlalu banyak percobaan. Coba lagi dalam ${waktu}.`;
  }
  if (e.status >= 500) return "Server sedang bermasalah. Coba lagi sebentar lagi.";
  if (e.status === 403 && e.code === "NOT_FINANCE_TEAM") return e.message;
  return e.message;
}
