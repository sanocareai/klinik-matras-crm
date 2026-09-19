// RATE LIMIT sederhana (memori proses) — tanpa dependency baru.
//
// Backend berjalan sebagai SATU container, jadi penghitung di memori sudah
// cukup dan tidak butuh Redis. Kalau kelak backend di-scale ke beberapa
// instance, batas ini menjadi per-instance (lebih longgar, bukan lebih ketat)
// — pindahkan ke penyimpanan bersama saat itu terjadi.
//
// Dua bentuk:
//   • createLimiter()  — middleware "N request per jendela" (hitung SEMUA).
//   • createFailureLimiter() — hitung hanya KEGAGALAN (mis. login salah);
//     keberhasilan mereset penghitung. Dipakai untuk login supaya orang sah
//     yang berhasil login tidak pernah terkunci.

const stores = new Set();

function sweepAll() {
  const now = Date.now();
  for (const store of stores) {
    for (const [key, entry] of store) {
      if (entry.resetAt <= now && (!entry.blockedUntil || entry.blockedUntil <= now)) store.delete(key);
    }
  }
}
const sweeper = setInterval(sweepAll, 60_000);
sweeper.unref?.();

/** Kosongkan semua penghitung — hanya untuk tes. */
export function resetRateLimits() {
  for (const store of stores) store.clear();
}

function isPrivateAddress(addr = "") {
  return (
    addr === "::1" || addr === "127.0.0.1" || addr.startsWith("::ffff:127.") ||
    addr.startsWith("10.") || addr.startsWith("192.168.") || /^172\.(1[6-9]|2\d|3[01])\./.test(addr) ||
    addr.startsWith("::ffff:10.") || addr.startsWith("::ffff:192.168.") || addr.startsWith("::ffff:172.")
  );
}

/**
 * IP klien. Di produksi backend berada di belakang nginx (alamat soket selalu
 * loopback/privat), yang MENAMBAHKAN IP asli di ujung X-Forwarded-For. Isi
 * header sebelum itu dikirim klien dan bisa dipalsukan, jadi yang dipakai
 * entri TERAKHIR — dan hanya bila soketnya memang dari proxy privat.
 */
export function clientIp(req) {
  const socketAddr = req.socket?.remoteAddress || "";
  const xff = req.headers?.["x-forwarded-for"];
  if (xff && isPrivateAddress(socketAddr)) {
    const parts = String(xff).split(",").map((s) => s.trim()).filter(Boolean);
    if (parts.length) return parts[parts.length - 1];
  }
  return socketAddr || "unknown";
}

function tooMany(res, retryAfterSec, message) {
  res.setHeader("Retry-After", String(Math.max(1, retryAfterSec)));
  return res.status(429).json({
    error: message,
    code: "RATE_LIMITED",
    retryAfterSeconds: Math.max(1, retryAfterSec),
  });
}

/**
 * Batas "max request per windowMs" per kunci. `keyFn(req)` boleh mengembalikan
 * null/"" untuk melewati pembatasan (mis. request tanpa pengguna).
 */
export function createLimiter({ windowMs, max, keyFn, message }) {
  const store = new Map();
  stores.add(store);
  return function limiter(req, res, next) {
    const key = keyFn(req);
    if (!key) return next();
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count += 1;
    if (entry.count > max) {
      return tooMany(res, Math.ceil((entry.resetAt - now) / 1000), message);
    }
    next();
  };
}

/**
 * Batas KEGAGALAN. Pemakaian:
 *   const lim = createFailureLimiter({ windowMs, max, message });
 *   const gate = lim.check(key);          // { blocked, retryAfterSeconds }
 *   lim.fail(key) / lim.success(key)
 * Setelah `max` kegagalan dalam satu jendela, kunci diblokir sampai jendela
 * habis; kegagalan berikutnya TIDAK memperpanjang blokir (tidak bisa dipakai
 * untuk mengunci akun orang lain selamanya).
 */
export function createFailureLimiter({ windowMs, max }) {
  const store = new Map();
  stores.add(store);
  return {
    check(key) {
      const now = Date.now();
      const entry = store.get(key);
      if (!entry) return { blocked: false, retryAfterSeconds: 0 };
      if (entry.resetAt <= now) { store.delete(key); return { blocked: false, retryAfterSeconds: 0 }; }
      if (entry.count >= max) return { blocked: true, retryAfterSeconds: Math.ceil((entry.resetAt - now) / 1000) };
      return { blocked: false, retryAfterSeconds: 0 };
    },
    fail(key) {
      const now = Date.now();
      let entry = store.get(key);
      if (!entry || entry.resetAt <= now) {
        entry = { count: 0, resetAt: now + windowMs };
        store.set(key, entry);
      }
      entry.count += 1;
    },
    success(key) {
      store.delete(key);
    },
  };
}

export { tooMany };
