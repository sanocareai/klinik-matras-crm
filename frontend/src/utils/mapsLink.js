// Validasi tautan Google Maps — cermin backend/src/lib/domain/pkrPembeli.js#validasiLokasiUrl (paritas dijaga tes). Hanya domain Google Maps; skema dipaksa https; tanpa akses internet.
const HOST_MAPS = new Set([
  "maps.app.goo.gl", "goo.gl", "g.co", "maps.google.com", "www.google.com", "google.com", "www.google.co.id", "google.co.id", "maps.google.co.id", "share.google",
]);
const MAKS_URL = 500;

/** @returns {{ ok: boolean, url: string|null, galat?: string }} kosong = ok dengan url null. */
export function validasiLinkMaps(raw) {
  let teks = String(raw ?? "").trim();
  if (!teks) return { ok: true, url: null };
  if (teks.length > MAKS_URL) return { ok: false, url: null, galat: `Link Google Maps maksimal ${MAKS_URL} karakter` };
  if (/\s/.test(teks)) return { ok: false, url: null, galat: "Link Google Maps tidak boleh berisi spasi" };
  if (/^[a-z][a-z0-9+.-]*:/i.test(teks) && !/^https?:\/\//i.test(teks)) return { ok: false, url: null, galat: "Link Google Maps harus diawali https://" };
  if (!/^https?:\/\//i.test(teks)) teks = `https://${teks}`;
  let url;
  try { url = new URL(teks); } catch { return { ok: false, url: null, galat: "Link Google Maps tidak valid" }; }
  const host = url.hostname.toLowerCase();
  if (!HOST_MAPS.has(host)) return { ok: false, url: null, galat: "Hanya link Google Maps yang diterima (maps.app.goo.gl, google.com/maps, goo.gl/maps)" };
  const jalur = url.pathname.toLowerCase();
  if (["www.google.com", "google.com", "www.google.co.id", "google.co.id"].includes(host) && !jalur.startsWith("/maps")) return { ok: false, url: null, galat: "Link Google Maps harus berupa tautan /maps" };
  if (host === "goo.gl" && !jalur.startsWith("/maps")) return { ok: false, url: null, galat: "Link goo.gl harus berupa tautan /maps" };
  url.protocol = "https:"; url.username = ""; url.password = "";
  return { ok: true, url: url.toString() };
}
