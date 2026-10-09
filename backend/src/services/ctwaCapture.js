// FASE 0 atribusi Meta Click-to-WhatsApp — CAPTURE TERBATAS (observasi saja).
//
// TUJUAN. Membuktikan field atribusi apa yang BENAR-BENAR diterima dari
// WAHA/GOWS untuk pesan inbound, terutama apakah `externalAdReply.sourceID`
// dan `sourceType` ada (fixture test hanya punya sourceURL + ctwaClid, tapi
// fixture itu sudah dipangkas — lihat tests/leadAttribution.test.js). Hasilnya
// menentukan apakah tabel `attribution_touch` layak dibangun.
//
// ⚠️ INI BUKAN ATRIBUSI. Modul ini TIDAK mengubah Customer.leadSource,
// TIDAK membuat attribution_touch, TIDAK mengirim apa pun ke Meta. Ia hanya
// mencatat observasi ter-sanitasi.
//
// ── DUA KELUARAN ───────────────────────────────────────────────────────────
//   1. JSONL (ctwa-capture-YYYY-MM-DD.jsonl): SATU baris HANYA untuk pesan yang
//      punya SINYAL atribusi (externalAdReply, penanda iklan, entry point
//      conversion, atau key bernama referral/ctwa/dst). Pesan biasa — termasuk
//      reply yang cuma punya quotedMessage — TIDAK menghasilkan baris.
//   2. Hitungan agregat harian (ctwa-capture-counts-YYYY-MM-DD.json): angka
//      saja (total inbound, per verdict, baru/lama, jumlah drop). Tanpa ID
//      pesan, tanpa data customer. Ini penyebut untuk "berapa persen pesan
//      yang membawa sinyal" dan sekaligus ukuran volume inbound aktual.
//
// ── YANG DILARANG MASUK CAPTURE (dijaga di kode, bukan janji) ──────────────
//   isi pesan, nama customer, nomor telepon/JID, media, healthStatus,
//   complaintCategory, token/API key, payload mentah.
// Caranya ALLOWLIST: observasi dirakit dari nol, field demi field, dan
// tiap nilai divalidasi bentuknya. TIDAK ADA jalur "salin objek lalu buang
// yang sensitif". Nilai yang gagal validasi TIDAK disimpan; hanya dicatat
// bahwa ia ditolak (`rejected`).
//
// ── ctwa_clid ──────────────────────────────────────────────────────────────
// Disimpan HANYA sebagai HMAC-SHA256 (dipotong 16 hex) + panjang + kelas
// karakter. Nilai utuh dan potongannya (termasuk 4 karakter terakhir) tidak
// pernah ditulis/di-log.
//
// ── FEATURE FLAG ───────────────────────────────────────────────────────────
// CTWA_ATTRIBUTION_CAPTURE_ENABLED harus persis "true" (default: mati).
// Wajib juga CTWA_CAPTURE_HASH_SALT (>=16 karakter); tanpa salt capture
// menolak menyala. Jangan memutar salt di tengah jendela observasi: hash lama
// dan baru tidak bisa dicocokkan (tiap baris membawa `sid`, sidik salt 6 hex,
// supaya report bisa memperingatkan).
//
// ── ISOLASI KEGAGALAN & KEAMANAN TEPI ──────────────────────────────────────
// captureInbound() sinkron-ringan, TIDAK PERNAH melempar, dipanggil SETELAH
// Message.create berhasil. Penulisan lewat SATU antrean serial berbatas
// (MAX_QUEUE): tidak ada append bersamaan yang bisa saling menyisip, dan
// lonjakan pesan tidak membuat memori tumbuh — antrean penuh = drop + counter,
// inbox tetap jalan. Berhenti-aman:
//   - salt tidak valid        -> tidak menulis apa pun
//   - folder tak bisa ditulis -> circuit breaker (BREAKER_FAILS gagal berturut
//                                -> jeda BREAKER_COOLDOWN_MS), bukan menghantam
//                                filesystem tiap pesan
//   - disk penuh / hampir     -> ENOSPC membuka breaker; sebelum itu, ruang
//                                bebas < CTWA_CAPTURE_MIN_FREE_MB (default
//                                1024) menghentikan tulis (disk dipakai bersama
//                                Postgres & uploads — jangan jadi pemicu disk penuh)
//   - restart proses          -> antrean memori hilang (wajar); ekor baris
//                                terpotong akibat crash dilindungi dengan
//                                awalan "\n" pada tulis pertama berkas
//   - flag jadi false         -> captureInbound langsung berhenti; sisa antrean
//                                dibuang tanpa ditulis
// ── RETENSI ────────────────────────────────────────────────────────────────
// Maksimum 7 hari (berkas harian dihapus otomatis sekali per hari-UTC, juga
// saat flag mati) + scripts/ctwa-capture-purge.js [--all]. TANPA perubahan
// skema DB.

import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { idPesanInti } from "../utils/idPesanWa.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

export const FLAG_NAME = "CTWA_ATTRIBUTION_CAPTURE_ENABLED";
export const SCHEMA_VERSION = 1;
export const MAX_RETENTION_DAYS = 7;
export const MAX_FILE_BYTES = 5 * 1024 * 1024;
export const MAX_LINE_BYTES = 4096;
export const MAX_QUEUE = 500;
export const BREAKER_FAILS = 5;
export const BREAKER_COOLDOWN_MS = 60_000;
export const COUNTS_FLUSH_MS = 60_000;
const DISK_CHECK_MS = 60_000;
const DEFAULT_MIN_FREE_MB = 1024;
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const DEDUPE_CAP = 2000;
const FILE_RE = /^ctwa-capture-(?:counts-)?(\d{4})-(\d{2})-(\d{2})\.jsonl?(?:\.tmp)?$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Penanda iklan — SAMA dengan PENANDA_IKLAN_CTWA di leadAttribution.js.
const PENANDA_IKLAN = /fb_ads|ig_ads|ctwa_ad/i;
// Nama key yang MENCIRIKAN data atribusi (hanya NAMA key yang dicocokkan).
const SIGNAL_KEY_RE = /(referral|ctwa|adreply|ad_?context|entry_?point|conversion|campaign|utm_|source_?(id|type|url)|fbclid|gclid)/i;

export const SIGNAL_VERDICTS = new Set(["CTWA_AD", "AD_REPLY_UNMARKED", "ENTRY_POINT_OTHER", "OTHER_ATTRIBUTION_FIELD"]);

// ── konfigurasi ────────────────────────────────────────────────────────────
export function isCaptureFlagOn() {
  return process.env[FLAG_NAME] === "true";
}

export function captureDir() {
  return process.env.CTWA_CAPTURE_DIR || path.join(__dirname, "../../data/ctwa-capture");
}

export function effectiveRetentionDays() {
  const n = parseInt(process.env.CTWA_CAPTURE_RETENTION_DAYS ?? "", 10);
  if (!Number.isFinite(n) || n < 1) return MAX_RETENTION_DAYS;
  return Math.min(n, MAX_RETENTION_DAYS);
}

function minFreeBytes() {
  const n = parseInt(process.env.CTWA_CAPTURE_MIN_FREE_MB ?? "", 10);
  return (Number.isFinite(n) && n >= 0 ? n : DEFAULT_MIN_FREE_MB) * 1024 * 1024;
}

function saltOrNull() {
  const s = process.env.CTWA_CAPTURE_HASH_SALT;
  return typeof s === "string" && s.length >= 16 ? s : null;
}

function hmac(salt, value) {
  return crypto.createHmac("sha256", salt).update(String(value)).digest("hex").slice(0, 16);
}

// Titik injeksi untuk tes (waktu, statfs, appendFile). Produksi memakai bawaan.
export const _hooks = {
  now: () => Date.now(),
  statfs: (p) => fs.promises.statfs(p),
  appendFile: (f, data, opts) => fs.promises.appendFile(f, data, opts),
};

// ── statistik proses (tanpa nilai apa pun dari payload) ────────────────────
const stats = {
  observed: 0, written: 0, deduped: 0, failed: 0, skippedNoSalt: 0,
  droppedOversize: 0, droppedFileCap: 0, droppedQueueFull: 0, droppedLowDisk: 0, droppedBreaker: 0, droppedFlagOff: 0,
};
export function _getStats() { return { ...stats }; }
export function _queueLength() { return queue.length; }

const recentIds = new Map();
const fileState = new Map(); // path -> { size, needsNewline }
const queue = [];
let draining = false;
const breaker = { fails: 0, openUntil: 0 };
let diskCheck = { at: 0, ok: true };
let lastPurgeDay = null;
let lastWarnAt = 0;
let countsTimer = null;
let countsFlushing = null;
const counts = new Map();      // day -> delta sejak proses start
const countsBase = new Map();  // day -> isi berkas saat pertama kali di-flush proses ini

export function _resetForTests() {
  for (const k of Object.keys(stats)) stats[k] = 0;
  recentIds.clear(); fileState.clear(); queue.length = 0; draining = false;
  breaker.fails = 0; breaker.openUntil = 0; diskCheck = { at: 0, ok: true };
  lastPurgeDay = null; lastWarnAt = 0; counts.clear(); countsBase.clear(); countsFlushing = null;
  if (countsTimer) { clearTimeout(countsTimer); countsTimer = null; }
  _hooks.now = () => Date.now();
  _hooks.statfs = (p) => fs.promises.statfs(p);
  _hooks.appendFile = (f, data, opts) => fs.promises.appendFile(f, data, opts);
}

// Peringatan dibatasi 1x/menit dan HANYA memuat kode error, tidak pernah
// pesan error (pesan error bisa menyisipkan path/nilai).
function warnLimited(code) {
  const now = Date.now();
  if (now - lastWarnAt < 60_000) return;
  lastWarnAt = now;
  console.warn(`[ctwa-capture] ${code}`);
}

// ── sanitasi nilai (allowlist bentuk) ──────────────────────────────────────
const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

/** absent = key tak ada; empty = key ada tapi null/undefined/""; present = ada isi. */
function presence(obj, names) {
  if (!isObj(obj)) return { state: "absent", value: undefined };
  for (const n of names) {
    if (Object.prototype.hasOwnProperty.call(obj, n)) {
      const v = obj[n];
      if (v === null || v === undefined) return { state: "empty", value: undefined };
      if (typeof v === "string" && v.trim() === "") return { state: "empty", value: undefined };
      return { state: "present", value: v };
    }
  }
  return { state: "absent", value: undefined };
}

const ENUM_RE = /^[A-Za-z0-9_\-]{1,32}$/;
const DIGITS_RE = /^\d{1,32}$/;
const KEYNAME_RE = /^[A-Za-z][A-Za-z0-9_]{0,40}$/;

function enumValue(v) {
  if (typeof v === "number" && Number.isFinite(v)) v = String(v);
  return typeof v === "string" && ENUM_RE.test(v) ? v : null;
}
function digitsValue(v) {
  if (typeof v === "number" && Number.isSafeInteger(v) && v >= 0) v = String(v);
  return typeof v === "string" && DIGITS_RE.test(v) ? v : null;
}
function safeKeyNames(obj) {
  if (!isObj(obj)) return [];
  return Object.keys(obj).filter((k) => KEYNAME_RE.test(k)).sort().slice(0, MAX_KEYS);
}
function signalKeyNames(...objs) {
  const out = new Set();
  for (const o of objs) for (const k of safeKeyNames(o)) if (SIGNAL_KEY_RE.test(k)) out.add(k);
  return [...out].sort().slice(0, MAX_KEYS);
}

/**
 * Ringkas sourceURL TANPA menyimpan URL utuh. Yang keluar hanya jenis,
 * token ID publik (shortcode post/reel, kode fb.me, id post/video FB), dan
 * NAMA parameter query (tidak pernah nilainya). wa.me TIDAK PERNAH diambil
 * path-nya — path wa.me bisa berisi nomor telepon.
 */
export function describeSourceUrl(raw) {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 2048) return { parsed: false, kind: "unparseable" };
  let u;
  try {
    u = new URL(/^[a-z][a-z0-9+.-]*:\/\//i.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { parsed: false, kind: "unparseable" };
  }
  if (u.protocol !== "https:" && u.protocol !== "http:") return { parsed: false, kind: "unparseable" };

  const host = u.hostname.toLowerCase().replace(/^(www|m|web|l|lm|mobile)\./, "");
  const segs = u.pathname.split("/").filter(Boolean);
  const queryParamNames = [...new Set([...u.searchParams.keys()])]
    .filter((k) => /^[A-Za-z_][A-Za-z0-9_]{0,23}$/.test(k)).sort().slice(0, 8);
  const out = { parsed: true, kind: "other_host", queryParamNames };
  const token = (t, re = /^[A-Za-z0-9_-]{4,64}$/) => (typeof t === "string" && re.test(t) ? t : null);
  const withToken = (kind, t) => {
    const ok = token(t);
    out.kind = kind;
    if (ok) { out.idToken = ok; out.idTokenLen = ok.length; }
    return out;
  };

  if (host === "instagram.com" || host === "instagr.am") {
    if (["p", "reel", "reels", "tv"].includes(segs[0])) {
      return withToken(segs[0] === "p" ? "instagram_post" : segs[0] === "tv" ? "instagram_tv" : "instagram_reel", segs[1]);
    }
    out.kind = "instagram_other";
    return out;
  }
  if (host === "fb.me") return withToken("fb_short", segs[0]);
  if (host === "facebook.com" || host === "fb.com" || host === "fb.watch") {
    if (host === "fb.watch") return withToken("facebook_video", segs[0]);
    const iPosts = segs.indexOf("posts");
    if (iPosts !== -1) return withToken("facebook_post", segs[iPosts + 1]);
    if (segs[0] === "permalink.php") return withToken("facebook_post", u.searchParams.get("story_fbid"));
    if (segs[0] === "watch") return withToken("facebook_video", u.searchParams.get("v"));
    const iVid = segs.findIndex((s) => s === "videos" || s === "reel");
    if (iVid !== -1) return withToken("facebook_video", segs[iVid + 1]);
    out.kind = "facebook_other";
    return out;
  }
  if (host === "wa.me" || host === "whatsapp.com" || host === "api.whatsapp.com") {
    out.kind = segs[0] === "wamo" ? "whatsapp_status" : "whatsapp_other"; // path SENGAJA dibuang
    return out;
  }
  return out; // other_host: host tidak disimpan
}

// ── pencarian contextInfo (terbatas, tidak masuk ke quotedMessage) ─────────
function findContext(payload) {
  const data = payload?._data;
  const containers = [["Message", data?.Message], ["RawMessage", data?.RawMessage], ["message", data?.message]];
  let firstContext = null;
  let sawContainer = false;
  for (const [name, root] of containers) {
    if (!isObj(root)) continue;
    sawContainer = true;
    // BFS terbatas: [node, namaKunciPenampung, kedalaman]
    const bfs = [[root, null, 0]];
    let visited = 0;
    while (bfs.length && visited < 200) {
      const [node, via, depth] = bfs.shift();
      visited++;
      const ctx = node.contextInfo;
      if (isObj(ctx)) {
        const cand = { container: name, messageType: via && KEYNAME_RE.test(via) ? via : null, depth, ctx };
        const ear = isObj(ctx.externalAdReply);
        const marker = PENANDA_IKLAN.test(`${enumValue(ctx.conversionSource) || ""} ${enumValue(ctx.entryPointConversionSource) || ""}`);
        const clid = typeof ctx.externalAdReply?.ctwaClid === "string" && ctx.externalAdReply.ctwaClid.trim() !== "";
        if (ear || marker || clid) return { found: cand, sawContainer };
        if (!firstContext) firstContext = cand;
      }
      if (depth >= MAX_DEPTH) continue;
      for (const key of Object.keys(node).slice(0, MAX_KEYS)) {
        if (key === "contextInfo") continue; // jangan turun ke quotedMessage dll
        const child = node[key];
        if (isObj(child)) bfs.push([child, key, depth + 1]);
      }
    }
  }
  return { found: firstContext, sawContainer };
}

function providerTimestamp(payload) {
  let v = payload?.timestamp ?? payload?._data?.Info?.Timestamp;
  if (typeof v === "string" && /^\d+$/.test(v)) v = Number(v);
  let ms = null;
  if (typeof v === "number" && Number.isFinite(v)) ms = v > 1e12 ? v : v * 1000;
  else if (typeof v === "string") { const t = Date.parse(v); if (Number.isFinite(t)) ms = t; }
  if (ms === null) return null;
  const y = new Date(ms).getUTCFullYear();
  return y >= 2020 && y <= 2100 ? new Date(ms).toISOString() : null;
}

/**
 * Rakit observasi ter-sanitasi. FUNGSI MURNI (tanpa I/O).
 * Dipanggil untuk SETIAP pesan (verdict dipakai untuk hitungan agregat), tapi
 * hanya yang `SIGNAL_VERDICTS.has(verdict)` yang ditulis ke JSONL.
 * @param {object} payload   payload WAHA (hanya dibaca; tidak pernah disalin)
 * @param {{event?:string, engine?:string, externalId?:string, isNewCustomer?:boolean, salt:string, now?:number}} ctx
 */
export function buildObservation(payload, ctx) {
  const now = ctx.now ?? Date.now();
  const core = idPesanInti(ctx.externalId) ?? String(ctx.externalId ?? "");
  const providerTs = providerTimestamp(payload);

  const base = {
    v: SCHEMA_VERSION,
    sid: hmac(ctx.salt, "sid").slice(0, 6),
    observedAt: new Date(now).toISOString(),
    event: ctx.event === "message" || ctx.event === "message.any" ? ctx.event : "other",
    engine: enumValue(ctx.engine) || null,
    msgIdHash: hmac(ctx.salt, core),
    providerTs,
    lagSeconds: providerTs ? Math.round((now - Date.parse(providerTs)) / 1000) : null,
    customer: ctx.isNewCustomer ? "NEW" : "EXISTING",
  };

  const { found, sawContainer } = findContext(payload);
  const data = payload?._data;
  const extraKeys = signalKeyNames(found?.ctx, isObj(data) ? data : null, isObj(data?.Info) ? data.Info : null);

  if (!found) {
    if (extraKeys.length) return { ...base, verdict: "OTHER_ATTRIBUTION_FIELD", signalKeys: extraKeys };
    return { ...base, verdict: sawContainer ? "NO_CONTEXT_INFO" : "NO_MESSAGE_BODY" };
  }

  const c = found.ctx;
  const ear = isObj(c.externalAdReply) ? c.externalAdReply : null;

  const pSrcUrl = presence(ear, ["sourceURL", "sourceUrl"]);
  const pSrcId = presence(ear, ["sourceID", "sourceId"]);
  const pSrcType = presence(ear, ["sourceType"]);
  const pClid = presence(ear, ["ctwaClid"]);
  const pFlows = presence(ear, ["containsCtwaFlowsAutoReply"]);
  const pConv = presence(c, ["conversionSource"]);
  const pEntry = presence(c, ["entryPointConversionSource"]);
  const pApp = presence(c, ["entryPointConversionApp"]);
  const pDelay = presence(c, ["entryPointConversionDelaySeconds"]);

  const fields = {
    sourceUrl: pSrcUrl.state, sourceId: pSrcId.state, sourceType: pSrcType.state, ctwaClid: pClid.state,
    containsCtwaFlowsAutoReply: pFlows.state, conversionSource: pConv.state,
    entryPointConversionSource: pEntry.state, entryPointConversionApp: pApp.state,
    entryPointConversionDelaySeconds: pDelay.state,
  };

  const rejected = [];
  const reject = (name, p, v) => { if (p.state === "present" && v === null) rejected.push(name); return v; };

  const values = {
    sourceId: reject("sourceId", pSrcId, digitsValue(pSrcId.value)),
    sourceType: reject("sourceType", pSrcType, enumValue(pSrcType.value)),
    conversionSource: reject("conversionSource", pConv, enumValue(pConv.value)),
    entryPointConversionSource: reject("entryPointConversionSource", pEntry, enumValue(pEntry.value)),
    entryPointConversionApp: reject("entryPointConversionApp", pApp, enumValue(pApp.value)),
    entryPointConversionDelaySeconds: reject(
      "entryPointConversionDelaySeconds", pDelay,
      typeof pDelay.value === "number" && Number.isInteger(pDelay.value) && pDelay.value >= 0 && pDelay.value <= 2_592_000 ? pDelay.value : null,
    ),
    containsCtwaFlowsAutoReply: reject("containsCtwaFlowsAutoReply", pFlows, typeof pFlows.value === "boolean" ? pFlows.value : null),
  };

  const clid = typeof pClid.value === "string" ? pClid.value.trim() : null;
  const ctwaClid = clid
    ? { hash: hmac(ctx.salt, clid), len: clid.length, charset: /^[A-Za-z0-9_-]+$/.test(clid) ? "urlsafe" : "other" }
    : null;
  if (pClid.state === "present" && !clid) rejected.push("ctwaClid");

  const url = pSrcUrl.state === "present" && typeof pSrcUrl.value === "string" ? describeSourceUrl(pSrcUrl.value) : null;
  if (pSrcUrl.state === "present" && !url) rejected.push("sourceUrl");

  const marker = PENANDA_IKLAN.test(`${values.conversionSource || ""} ${values.entryPointConversionSource || ""}`);
  const entryPointPresent = [pConv, pEntry, pApp, pDelay].some((p) => p.state !== "absent");
  const verdict = clid || marker ? "CTWA_AD"
    : ear ? "AD_REPLY_UNMARKED"
    : entryPointPresent ? "ENTRY_POINT_OTHER"
    : extraKeys.length ? "OTHER_ATTRIBUTION_FIELD"
    : "CONTEXT_NON_AD";

  return {
    ...base,
    verdict,
    messageType: found.messageType,
    container: found.container,
    depth: found.depth,
    fields,
    values,
    ctwaClid,
    sourceUrl: url,
    rejected: rejected.length ? rejected : undefined,
    // Hanya NAMA key (bukan nilai) — menjawab "field referral lain apa yang benar-benar ada".
    externalAdReplyKeys: safeKeyNames(ear),
    contextInfoKeys: safeKeyNames(c),
    signalKeys: extraKeys.length ? extraKeys : undefined,
  };
}

// ── hitungan agregat harian ────────────────────────────────────────────────
const dayKey = (ms) => new Date(ms).toISOString().slice(0, 10);

function emptyCounts(day) {
  return {
    v: 1, day, total: 0, signal: 0, signalWritten: 0,
    verdicts: {}, events: {},
    customer: { NEW: { total: 0, signal: 0 }, EXISTING: { total: 0, signal: 0 } },
    dropped: {},
  };
}
const bump = (map, key, n = 1) => { map[key] = (map[key] || 0) + n; };

function dayCounts(ms) {
  const day = dayKey(ms);
  let c = counts.get(day);
  if (!c) { c = emptyCounts(day); counts.set(day, c); }
  return c;
}

function countObservation(obs, ms) {
  const c = dayCounts(ms);
  const sig = SIGNAL_VERDICTS.has(obs.verdict);
  c.total++;
  if (sig) c.signal++;
  bump(c.verdicts, obs.verdict);
  bump(c.events, obs.event);
  const cust = c.customer[obs.customer] || (c.customer[obs.customer] = { total: 0, signal: 0 });
  cust.total++;
  if (sig) cust.signal++;
  scheduleCountsFlush();
}

function countDrop(reason, ms) {
  const k = "dropped" + reason[0].toUpperCase() + reason.slice(1);
  stats[k] = (stats[k] || 0) + 1;
  bump(dayCounts(ms).dropped, reason);
  scheduleCountsFlush();
}

function mergeCounts(a, b) {
  const out = emptyCounts(b.day || a.day);
  for (const src of [a, b]) {
    if (!isObj(src)) continue;
    for (const k of ["total", "signal", "signalWritten"]) out[k] += Number(src[k]) || 0;
    for (const grp of ["verdicts", "events", "dropped"]) {
      for (const [k, v] of Object.entries(isObj(src[grp]) ? src[grp] : {})) if (typeof v === "number" && KEYNAME_RE.test(k)) bump(out[grp], k, v);
    }
    for (const t of ["NEW", "EXISTING"]) {
      out.customer[t].total += Number(src.customer?.[t]?.total) || 0;
      out.customer[t].signal += Number(src.customer?.[t]?.signal) || 0;
    }
  }
  return out;
}

function scheduleCountsFlush() {
  if (countsTimer) return;
  countsTimer = setTimeout(() => { countsTimer = null; flushCapture().catch(() => {}); }, COUNTS_FLUSH_MS);
  countsTimer.unref?.();
}

/** Tulis hitungan agregat (tmp + rename atomik). Aman dipanggil kapan saja. */
export function flushCapture() {
  if (countsFlushing) return countsFlushing;
  const run = (async () => {
    try {
      if (!isCaptureFlagOn()) { counts.clear(); return; }      // flag mati: buang, jangan tulis
      if (breakerOpen() || !(await diskOk())) return;           // tulis ditunda; delta tetap di memori
      const dir = captureDir();
      for (const [day, delta] of [...counts.entries()]) {
        const file = path.join(dir, `ctwa-capture-counts-${day}.json`);
        if (!countsBase.has(day)) {
          const txt = await fs.promises.readFile(file, "utf8").catch(() => null);
          let base = emptyCounts(day);
          try { if (txt) base = mergeCounts(emptyCounts(day), JSON.parse(txt)); } catch { /* berkas rusak: mulai dari nol */ }
          countsBase.set(day, base);
        }
        const merged = mergeCounts(countsBase.get(day), delta);
        const body = JSON.stringify(merged);
        await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
        const tmp = `${file}.tmp`;
        await fs.promises.writeFile(tmp, body, { mode: 0o600 });
        await fs.promises.rename(tmp, file);
      }
      noteSuccess();
    } catch (e) {
      noteFailure(e);
    }
  })();
  // Pelepasan kunci lewat .finally(): jalur sinkron (mis. flag mati) tidak boleh meninggalkan
  // promise lama terpasang selamanya.
  const p = run.finally(() => { if (countsFlushing === p) countsFlushing = null; });
  countsFlushing = p;
  return p;
}

// ── circuit breaker & disk guard ───────────────────────────────────────────
function breakerOpen() { return _hooks.now() < breaker.openUntil; }
function noteSuccess() { breaker.fails = 0; }
function noteFailure(e) {
  stats.failed++;
  breaker.fails++;
  if (breaker.fails >= BREAKER_FAILS || e?.code === "ENOSPC" || e?.code === "EDQUOT") {
    breaker.openUntil = _hooks.now() + BREAKER_COOLDOWN_MS;
    breaker.fails = 0;
  }
  warnLimited(`gagal menulis (${e?.code || "ERR"})`);
}

async function nearestExisting(p) {
  let cur = p;
  for (let i = 0; i < 4; i++) {
    try { await fs.promises.access(cur); return cur; } catch { cur = path.dirname(cur); }
  }
  return cur;
}

/** false = ruang bebas di bawah ambang -> jangan menulis. Gagal mengukur = anggap aman. */
async function diskOk() {
  const t = _hooks.now();
  if (t - diskCheck.at < DISK_CHECK_MS) return diskCheck.ok;
  let ok = true;
  const min = minFreeBytes();
  if (min > 0) {
    try {
      const st = await _hooks.statfs(await nearestExisting(captureDir()));
      ok = Number(st.bavail) * Number(st.bsize) >= min;
    } catch { ok = true; }
  }
  diskCheck = { at: t, ok };
  return ok;
}

// ── antrean tulis serial ───────────────────────────────────────────────────
async function prepareFile(file) {
  let st = fileState.get(file);
  if (st) return st;
  st = { size: 0, needsNewline: false };
  try {
    const stat = await fs.promises.stat(file);
    st.size = stat.size;
    if (stat.size > 0) {
      // Ekor berkas tanpa "\n" = sisa tulis terpotong (crash/disk penuh): awali dengan newline.
      const fh = await fs.promises.open(file, "r");
      try {
        const buf = Buffer.alloc(1);
        await fh.read(buf, 0, 1, stat.size - 1);
        st.needsNewline = buf[0] !== 0x0a;
      } finally { await fh.close(); }
    }
  } catch { /* berkas belum ada */ }
  fileState.set(file, st);
  return st;
}

async function writeOne(item) {
  if (breakerOpen()) return countDrop("breaker", item.now);
  if (!(await diskOk())) return countDrop("lowDisk", item.now);

  const dir = captureDir();
  const file = path.join(dir, `ctwa-capture-${dayKey(item.now)}.jsonl`);
  try {
    const st = await prepareFile(file);
    const payload = (st.needsNewline ? "\n" : "") + item.line;
    const bytes = Buffer.byteLength(payload);
    if (st.size + bytes > MAX_FILE_BYTES) return countDrop("fileCap", item.now);
    try {
      await _hooks.appendFile(file, payload, { mode: 0o600 });
    } catch (e) {
      if (e?.code !== "ENOENT") throw e;
      await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 }); // folder hilang: buat ulang, coba sekali lagi
      await _hooks.appendFile(file, payload, { mode: 0o600 });
    }
    st.size += bytes;
    st.needsNewline = false;
    stats.written++;
    dayCounts(item.now).signalWritten++;
    noteSuccess();
  } catch (e) {
    const st = fileState.get(file);
    if (st) st.needsNewline = true; // tulis bisa setengah jadi: awali tulis berikutnya dengan newline
    noteFailure(e);
  }
}

async function drain() {
  draining = true;
  try {
    while (queue.length) {
      const item = queue.shift();
      if (!isCaptureFlagOn()) {
        // Flag dimatikan saat antrean masih berisi: buang semuanya, jangan tulis.
        countDrop("flagOff", item.now);
        for (const rest of queue.splice(0)) countDrop("flagOff", rest.now);
        break;
      }
      await writeOne(item);
    }
  } finally {
    draining = false;
  }
}

function enqueue(line, now) {
  if (Buffer.byteLength(line) > MAX_LINE_BYTES) { stats.droppedOversize++; return false; }
  if (queue.length >= MAX_QUEUE) { countDrop("queueFull", now); return false; }
  queue.push({ line, now });
  if (!draining) drain().catch(() => { stats.failed++; });
  return true;
}

async function observe(args, salt) {
  const now = _hooks.now();
  const core = idPesanInti(args.externalId) ?? String(args.externalId ?? "");
  const key = hmac(salt, core);
  if (recentIds.has(key)) { stats.deduped++; return; }
  recentIds.set(key, now);
  if (recentIds.size > DEDUPE_CAP) recentIds.delete(recentIds.keys().next().value);

  const obs = buildObservation(args.payload, { ...args, salt, now });
  stats.observed++;
  countObservation(obs, now);
  if (SIGNAL_VERDICTS.has(obs.verdict)) enqueue(JSON.stringify(obs) + "\n", now);
}

/**
 * Titik masuk dari webhook. TIDAK PERNAH melempar, TIDAK PERNAH di-await.
 * @returns {boolean} true kalau pekerjaan dijadwalkan (hanya untuk tes).
 */
export function captureInbound({ payload, event, engine, externalId, isNewCustomer }) {
  try {
    maybePurgeDaily();
    if (!isCaptureFlagOn()) return false;
    const salt = saltOrNull();
    if (!salt) { stats.skippedNoSalt++; warnLimited("flag aktif tetapi CTWA_CAPTURE_HASH_SALT (>=16 karakter) belum diisi — capture dilewati"); return false; }
    setImmediate(() => {
      if (!isCaptureFlagOn()) return;
      observe({ payload, event, engine, externalId, isNewCustomer }, salt).catch((e) => {
        stats.failed++;
        warnLimited(`gagal memproses observasi (${e?.code || "ERR"})`);
      });
    });
    return true;
  } catch (e) {
    stats.failed++;
    try { warnLimited(`gagal menjadwalkan capture (${e?.code || "ERR"})`); } catch { /* sengaja diam */ }
    return false;
  }
}

// ── retensi ────────────────────────────────────────────────────────────────
/**
 * Hapus berkas capture yang melewati retensi. HANYA menyentuh nama berkas yang
 * cocok pola ketat (ctwa-capture[-counts]-YYYY-MM-DD.json[l][.tmp]) — tidak
 * pernah berkas lain. Berkas dihapus bila AWAL hari-UTC-nya lebih tua dari
 * retensi, sehingga baris tertua yang tersisa tidak pernah lebih tua dari
 * `retentionDays`.
 */
export async function purgeCaptures({ dir = captureDir(), retentionDays = effectiveRetentionDays(), now = Date.now(), all = false, dryRun = false } = {}) {
  const days = Math.min(Math.max(1, retentionDays), MAX_RETENTION_DAYS);
  let names;
  try {
    names = await fs.promises.readdir(dir);
  } catch (e) {
    if (e.code === "ENOENT") return { removed: [], kept: 0, errors: 0 };
    throw e;
  }
  const removed = [];
  let kept = 0, errors = 0;
  for (const name of names) {
    const m = FILE_RE.exec(name);
    if (!m) continue;
    const dayStart = Date.UTC(+m[1], +m[2] - 1, +m[3]);
    if (all || dayStart < now - days * DAY_MS) {
      try {
        if (!dryRun) {
          await fs.promises.unlink(path.join(dir, name));
          fileState.delete(path.join(dir, name));
          const cm = /^ctwa-capture-counts-(\d{4}-\d{2}-\d{2})\.json$/.exec(name);
          if (cm) { countsBase.delete(cm[1]); counts.delete(cm[1]); }
        }
        removed.push(name);
      } catch { errors++; }
    } else kept++;
  }
  return { removed, kept, errors };
}

function maybePurgeDaily() {
  const today = dayKey(Date.now());
  if (lastPurgeDay === today) return;
  lastPurgeDay = today;
  purgeCaptures().catch(() => { stats.failed++; });
}
