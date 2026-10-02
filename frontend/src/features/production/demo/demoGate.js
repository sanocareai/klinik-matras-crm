// Gerbang Mode Demo (P12A) — modul KECIL yang diimpor api.js. TIDAK memuat dataset (itu chunk terpisah, dimuat hanya setelah server
// mengizinkan ADMIN/OWNER). Kontrak: bila demo aktif → (1) setiap bacaan data Production dilayani dari dataset sintetis, tanpa
// menyentuh jaringan; (2) setiap metode bukan GET ditolak SEBELUM fetch; (3) upload/export ditolak. Demo tidak pernah ikut ke KPI/export production.
export const DEMO_LABEL = "MODE DEMO — bukan data operasional";
export const DEMO_DATA_PREFIXES = Object.freeze(["/production-v2/", "/production-planning/", "/production/", "/inventory/", "/master-data/", "/complaints"]);

export class DemoReadOnlyError extends Error {
  constructor(what = "Aksi ini") { super(`${what} dinonaktifkan di Mode Demo (hanya-baca, data sintetis).`); this.name = "DemoReadOnlyError"; this.code = "DEMO_READ_ONLY"; }
}
export class DemoMissError extends Error {
  constructor(path) { super(`Data demo untuk ${path} tidak tersedia.`); this.name = "DemoMissError"; this.code = "DEMO_MISS"; }
}

let active = false;
let resolver = null;
let version = 0;
const listeners = new Set();
const notify = () => { version += 1; for (const fn of listeners) fn(); };

export const isDemoActive = () => active;
export const demoVersion = () => version;
export const subscribeDemo = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
export function activateDemo(resolve) { if (typeof resolve !== "function") throw new Error("resolver demo wajib"); resolver = resolve; if (!active) { active = true; notify(); } }
export function deactivateDemo() { if (active) { active = false; resolver = null; notify(); } }

const isDemoOwned = (path) => { const p = String(path).split("?")[0]; return DEMO_DATA_PREFIXES.some((x) => p.startsWith(x)); };

// Dipanggil api.js SEBELUM jaringan. null = lanjutkan normal; Promise = jawaban final (data demo / penolakan).
export function demoGate(path, method = "GET") {
  if (!active) return null;
  if (String(method).toUpperCase() !== "GET") return Promise.reject(new DemoReadOnlyError());
  if (!isDemoOwned(path)) return null; // auth/notifikasi dll: tidak berisi data produksi, tetap normal
  return Promise.resolve().then(() => resolver(path));
}
// Untuk jalur non-JSON (upload multipart, export berkas): selalu ditolak di demo.
export function demoBlock(what) { return active ? Promise.reject(new DemoReadOnlyError(what)) : null; }

// Lapis kedua: menjaga SEMUA jalur jaringan (bukan hanya api.js). Dipasang sekali; hanya bertindak selama demo aktif.
let guardInstalled = false;
export function installDemoNetworkGuard(win = typeof window !== "undefined" ? window : null) {
  if (guardInstalled || !win) return false;
  guardInstalled = true;
  const isApi = (u) => /\/api\//.test(String(u));
  const blocked = (method, url) => active && isApi(url) && (String(method || "GET").toUpperCase() !== "GET" || /\/export(\?|$|\/)/.test(String(url)));
  if (typeof win.fetch === "function") {
    const realFetch = win.fetch.bind(win);
    win.fetch = (input, init) => (blocked(init?.method || input?.method, input?.url || input) ? Promise.reject(new DemoReadOnlyError()) : realFetch(input, init));
  }
  if (win.XMLHttpRequest) {
    const open = win.XMLHttpRequest.prototype.open;
    win.XMLHttpRequest.prototype.open = function guardedOpen(method, url, ...rest) { if (blocked(method, url)) throw new DemoReadOnlyError(); return open.call(this, method, url, ...rest); };
  }
  return true;
}
