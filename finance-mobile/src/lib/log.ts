// LOG AMAN — satu-satunya tempat `console` boleh dipakai (ESLint no-console menjaga).
//
// Aturan (PRD §11.7): token, PIN, kata sandi, header Authorization, dan nominal/nama tidak boleh
// muncul di log. `redact()` menyamarkan nilai pada kunci sensitif secara rekursif. Build produksi
// juga membuang console.* lewat babel (`transform-remove-console`).

const KUNCI_SENSITIF = /(token|password|sandi|^pin$|pin[A-Z_]|authorization|refresh|secret|rahasia|hash|salt|amount|nominal|saldo|email)/i;
const MASK = "[disembunyikan]";

export function redact(nilai: unknown, kedalaman = 0): unknown {
  if (kedalaman > 6) return MASK;
  if (Array.isArray(nilai)) return nilai.map((x) => redact(x, kedalaman + 1));
  if (nilai && typeof nilai === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(nilai as Record<string, unknown>)) {
      out[k] = KUNCI_SENSITIF.test(k) ? MASK : redact(v, kedalaman + 1);
    }
    return out;
  }
  if (typeof nilai === "string") {
    // Potongan yang tampak seperti token/JWT/PIN mentah.
    if (/^smr_[A-Za-z0-9_-]{10,}$/.test(nilai) || /^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\./.test(nilai) || /^Bearer\s/i.test(nilai)) return MASK;
  }
  return nilai;
}

type Level = "debug" | "info" | "warn" | "error";

function tulis(level: Level, pesan: string, data?: unknown) {
  if (!__DEV__ && level === "debug") return;
  const safe = data === undefined ? [] : [redact(data)];
  // eslint-disable-next-line no-console
  console[level === "debug" ? "log" : level](`[finance] ${pesan}`, ...safe);
}

export const log = {
  debug: (pesan: string, data?: unknown) => tulis("debug", pesan, data),
  info: (pesan: string, data?: unknown) => tulis("info", pesan, data),
  warn: (pesan: string, data?: unknown) => tulis("warn", pesan, data),
  error: (pesan: string, data?: unknown) => tulis("error", pesan, data),
};
