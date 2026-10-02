// Logika murni dataset demo (tanpa impor JSON → dapat diuji dengan node --test): normalisasi kunci URL, pergeseran tanggal ke "hari ini" (WIB),
// penggantian URL media ke fixture lokal aman, dan resolver. Snapshot dibuat dari STAGING QA-PV2 (backend/scripts/staging/export-demo-snapshot.js).
import { DemoMissError } from "./demoGate.js";

export const DEMO_PHOTO_COUNT = 12;
const WIB_MS = 7 * 3600_000;
const DAY = 86_400_000;
export const wibDay = (d) => new Date(new Date(d).getTime() + WIB_MS).toISOString().slice(0, 10);
export const daysBetween = (a, b) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY);
const addDays = (key, n) => new Date(Date.parse(`${key}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
const DROP_PARAMS = new Set(["from", "to", "since", "_"]);

// "/api/x/y?b=2&a=1&date=2026-10-02" → "/x/y?a=1&b=2&date=@+0" (tanggal → selisih hari dari `today`; param periode/polling dibuang).
export function normalizeKey(pathWithQuery, today) {
  const raw = String(pathWithQuery).replace(/^\/api(?=\/)/, "");
  const [path, query = ""] = raw.split("?");
  const params = new URLSearchParams(query);
  const kept = [];
  for (const [k, v] of [...params.entries()].sort(([a], [b]) => a.localeCompare(b))) {
    if (DROP_PARAMS.has(k)) continue;
    if (k === "q" && v === "") continue;
    if (k === "date" && /^\d{4}-\d{2}-\d{2}$/.test(v)) { const off = daysBetween(today, v); kept.push(`date=@${off >= 0 ? "+" : ""}${off}`); continue; }
    kept.push(`${k}=${v}`);
  }
  return kept.length ? `${path}?${kept.join("&")}` : path;
}

const ISO_DT = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/;
const ISO_D = /^\d{4}-\d{2}-\d{2}$/;
export function shiftDeep(value, deltaDays) {
  if (!deltaDays) return value;
  if (typeof value === "string") {
    if (ISO_DT.test(value)) return new Date(Date.parse(value) + deltaDays * DAY).toISOString();
    if (ISO_D.test(value)) return addDays(value, deltaDays);
    return value;
  }
  if (Array.isArray(value)) return value.map((x) => shiftDeep(x, deltaDays));
  if (value && typeof value === "object") { const out = {}; for (const [k, v] of Object.entries(value)) out[k] = shiftDeep(v, deltaDays); return out; }
  return value;
}

// Semua URL media (foto customer/unit/bukti/QC) → fixture lokal /demo/photo-NN.png (deterministik per URL asal). Tidak ada URL customer production.
const hash = (s) => { let h = 2166136261; for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
export const demoPhotoUrl = (src) => `/demo/photo-${String((hash(String(src).split("?")[0]) % DEMO_PHOTO_COUNT) + 1).padStart(2, "0")}.png`;
export function rewriteMedia(value) {
  if (typeof value === "string") return value.startsWith("/media/") ? demoPhotoUrl(value) : value;
  if (Array.isArray(value)) return value.map(rewriteMedia);
  if (value && typeof value === "object") { const out = {}; for (const [k, v] of Object.entries(value)) out[k] = rewriteMedia(v); return out; }
  return value;
}

// snapshot: { today, entries: [{ url, data }] } → resolve(pathWithQuery) → data (salinan baru tiap panggilan; pemanggil boleh memutasi state lokalnya).
export function buildResolver(snapshot, { now = new Date() } = {}) {
  const demoToday = wibDay(now);
  const delta = daysBetween(snapshot.today, demoToday);
  const index = new Map(); const boards = [];
  for (const e of snapshot.entries) {
    const key = normalizeKey(e.url, snapshot.today);
    const data = shiftDeep(rewriteMedia(e.data), delta);
    index.set(key, data);
    const m = key.match(/^\/production-v2\/board\?date=@([+-]\d+)$/); if (m) boards.push({ off: Number(m[1]), key });
  }
  const clone = (x) => JSON.parse(JSON.stringify(x));
  return function resolve(pathWithQuery) {
    const key = normalizeKey(pathWithQuery, demoToday);
    if (index.has(key)) return clone(index.get(key));
    const m = key.match(/^\/production-v2\/board\?date=@([+-]\d+)$/); // tanggal di luar rentang rekaman → hari terdekat yang ada
    if (m && boards.length) { const want = Number(m[1]); const near = boards.reduce((a, b) => (Math.abs(b.off - want) < Math.abs(a.off - want) ? b : a)); return clone(index.get(near.key)); }
    const noQuery = key.split("?")[0]; // filter/param tak dikenal → versi tanpa param bila ada
    if (index.has(noQuery)) return clone(index.get(noQuery));
    throw new DemoMissError(pathWithQuery);
  };
}
export const coverageOf = (snapshot) => ({ entries: snapshot.entries.length, unitCodes: snapshot.unitCodes || [] });
