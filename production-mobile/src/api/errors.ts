// GALAT API. Server membalas { "error": "<pesan Bahasa Indonesia>", "code"?: "..." }.
// Pesan server ditampilkan APA ADANYA (sudah ditujukan ke pengguna); `code` hanya untuk logika.

export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly requestId?: string;
  readonly retryAfterSeconds?: number;
  /** true bila hasil perintah TIDAK PASTI (timeout/putus setelah terkirim) — jangan kirim ulang buta. */
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
    return ["SESSION_REVOKED", "REFRESH_INVALID", "REFRESH_REUSED", "SESSION_EXPIRED", "ACCOUNT_INACTIVE", "NOT_PRODUCTION_TEAM"].includes(this.code);
  }
}

export const PESAN_JARINGAN = "Tidak bisa terhubung ke server. Periksa koneksi internet.";
export const PESAN_TIMEOUT = "Server terlalu lama menjawab. Coba lagi sebentar lagi.";
export const PESAN_TIDAK_PASTI = "Status belum pasti — koneksi terputus setelah perintah terkirim. Muat ulang dulu sebelum mencoba lagi.";

const PESAN_SESI_HILANG: Record<string, string> = {
  SESSION_REVOKED: "Sesi dicabut (mungkin dikeluarkan dari perangkat lain). Silakan masuk lagi.",
  SESSION_EXPIRED: "Sesi berakhir karena lama tidak dipakai. Silakan masuk lagi.",
  REFRESH_REUSED: "Sesi dihentikan demi keamanan. Silakan masuk lagi.",
  REFRESH_INVALID: "Sesi tidak valid lagi. Silakan masuk lagi.",
  TOKEN_INVALID: "Sesi tidak valid lagi. Silakan masuk lagi.",
  ACCOUNT_INACTIVE: "Akun ini sudah dinonaktifkan. Hubungi admin kalau ini keliru.",
  NOT_PRODUCTION_TEAM: "Akun Anda tidak lagi punya akses Produksi. Hubungi admin.",
};

export function pesanSesiHilang(kode: string | null | undefined): string | null {
  if (!kode) return null;
  return PESAN_SESI_HILANG[kode] ?? "Sesi berakhir. Silakan masuk lagi.";
}

/** Galat apa pun → satu kalimat Bahasa Indonesia yang aman ditampilkan. */
export function pesanUntukPengguna(e: unknown): string {
  if (!(e instanceof ApiError)) return "Terjadi kesalahan. Coba lagi.";
  if (e.isNetwork) return e.message;
  if (e.status === 429) {
    const d = e.retryAfterSeconds;
    return `Terlalu banyak permintaan. Coba lagi dalam ${d == null ? "beberapa menit" : d >= 90 ? `${Math.ceil(d / 60)} menit` : `${d} detik`}.`;
  }
  if (e.status >= 500) return "Server sedang bermasalah. Coba lagi sebentar lagi.";
  return e.message;
}
