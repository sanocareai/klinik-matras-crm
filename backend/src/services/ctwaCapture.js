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
// mencatat satu baris observasi ter-sanitasi per pesan inbound.
//
// ── YANG DILARANG MASUK CAPTURE (dijaga di kode, bukan janji) ──────────────
//   isi pesan, nama customer, nomor telepon/JID, media, healthStatus,
//   complaintCategory, token/API key, payload mentah.
// Caranya ALLOWLIST: observasi dirakit dari nol, field demi field, dan
// tiap nilai divalidasi bentuknya. TIDAK ADA jalur "salin objek lalu buang
// yang sensitif" — objek payload tidak pernah disalin. Nilai yang gagal
// validasi TIDAK disimpan; hanya dicatat bahwa ia ditolak (`rejected`).
//
// ── ctwa_clid ──────────────────────────────────────────────────────────────
// Disimpan HANYA sebagai HMAC-SHA256 (dipotong 16 hex) + panjang + kelas
// karakter. Nilai utuh tidak pernah ditulis/di-log. Empat karakter terakhir
// SENGAJA TIDAK disimpan: untuk tujuan Fase 0 (apakah clid ada, apakah unik
// per klik, apakah satu clid muncul di >1 pesan) hash saja sudah cukup, dan
// ekor 4 karakter dari ID ber-entropi tinggi memang tidak membantu debugging
// apa pun yang tidak bisa dijawab hash + panjang. Kalau suatu saat butuh
// mencocokkan dengan Ads Manager, itu keputusan Fase 1 dengan pembahasan sendiri.
//
// ── FEATURE FLAG ───────────────────────────────────────────────────────────
// CTWA_ATTRIBUTION_CAPTURE_ENABLED harus persis "true" (default: mati).
// Wajib juga CTWA_CAPTURE_HASH_SALT (>=16 karakter); tanpa salt capture
// menolak menyala — hash tanpa salt bisa dicocokkan dengan data di tempat lain.
//
// ── ISOLASI KEGAGALAN ──────────────────────────────────────────────────────
// captureInbound() sinkron-ringan: cek flag lalu menjadwalkan kerja lewat
// setImmediate, dan TIDAK PERNAH melempar. Dipanggil SETELAH Message.create
// berhasil, jadi tidak mungkin menggagalkan penyimpanan pesan atau mengubah
// nilai kembalian handler. Karena hanya jalur "saved" yang memanggilnya,
// event `message` dan `message.any` untuk pesan yang sama (salah satunya
// kena P2002 → skip-dupe) tidak menggandakan observasi; ada juga dedupe
// in-memory berbasis hash ID pesan sebagai sabuk kedua.
//
// ── PENYIMPANAN & RETENSI ──────────────────────────────────────────────────
// JSONL harian di backend/data/ctwa-capture/ (bind-mount ke host; TANPA
// perubahan skema DB — attribution_touch dilarang di fase ini). Retensi
// maksimum 7 hari: berkas harian yang hari-UTC-nya lebih tua dari itu dihapus
// otomatis sekali per hari (juga saat flag mati) dan lewat
// scripts/ctwa-capture-purge.js. Batas ukuran per berkas 5 MB.

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
const MAX_DEPTH = 4;
const MAX_KEYS = 40;
const DEDUPE_CAP = 2000;
const FILE_RE = /^ctwa-capture-(\d{4})-(\d{2})-(\d{2})\.jsonl$/;
const DAY_MS = 24 * 60 * 60 * 1000;

// Penanda iklan — SAMA dengan PENANDA_IKLAN_CTWA di leadAttribution.js.
const PENANDA_IKLAN = /fb_ads|ig_ads|ctwa_ad/i;

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

function saltOrNull() {
  const s = process.env.CTWA_CAPTURE_HASH_SALT;
  return typeof s === "string" && s.length >= 16 ? s : null;
}

function hmac(salt, value) {
  return crypto.createHmac("sha256", salt).update(String(value)).digest("hex").slice(0, 16);
}

// ── statistik in-memory (tanpa nilai apa pun dari payload) ─────────────────
const stats = { observed: 0, written: 0, deduped: 0, failed: 0, skippedNoSalt: 0, droppedOversize: 0, droppedFileCap: 0 };
export function _getStats() { return { ...stats }; }
export function _resetForTests() {
  for (const k of Object.keys(stats)) stats[k] = 0;
  recentIds.clear();
  fileSizes.clear();
  lastPurgeDay = null;
  lastWarnAt = 0;
}

// Peringatan dibatasi 1x/menit dan HANYA memuat kode error, tidak pernah
// pesan error (pesan error bisa menyisipkan path/nilai).
let lastWarnAt = 0;
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
  return Object.keys(obj).filter((k) => /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(k)).sort().slice(0, MAX_KEYS);
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
    const queue = [[root, null, 0]];
    let visited = 0;
    while (queue.length && visited < 200) {
      const [node, via, depth] = queue.shift();
      visited++;
      const ctx = node.contextInfo;
      if (isObj(ctx)) {
        const cand = { container: name, messageType: via && /^[A-Za-z][A-Za-z0-9_]{0,40}$/.test(via) ? via : null, depth, ctx };
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
        if (isObj(child)) queue.push([child, key, depth + 1]);
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
 * @param {object} payload   payload WAHA (hanya dibaca; tidak pernah disalin)
 * @param {{event?:string, engine?:string, externalId?:string, isNewCustomer?:boolean, salt:string, now?:number}} ctx
 */
export function buildObservation(payload, ctx) {
  const now = ctx.now ?? Date.now();
  const core = idPesanInti(ctx.externalId) ?? String(ctx.externalId ?? "");
  const providerTs = providerTimestamp(payload);

  const base = {
    v: SCHEMA_VERSION,
    observedAt: new Date(now).toISOString(),
    event: ctx.event === "message" || ctx.event === "message.any" ? ctx.event : "other",
    engine: enumValue(ctx.engine) || null,
    msgIdHash: hmac(ctx.salt, core),
    providerTs,
    lagSeconds: providerTs ? Math.round((now - Date.parse(providerTs)) / 1000) : null,
    customer: ctx.isNewCustomer ? "NEW" : "EXISTING",
  };

  const { found, sawContainer } = findContext(payload);
  if (!found) {
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
  const verdict = clid || marker ? "CTWA_AD" : ear ? "AD_REPLY_UNMARKED" : "CONTEXT_NON_AD";

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
  };
}

// ── penulisan ──────────────────────────────────────────────────────────────
const recentIds = new Map();
const fileSizes = new Map();

function dayKey(ms) { return new Date(ms).toISOString().slice(0, 10); }

async function appendLine(line, now) {
  const dir = captureDir();
  const bytes = Buffer.byteLength(line);
  if (bytes > MAX_LINE_BYTES) { stats.droppedOversize++; return false; }
  const file = path.join(dir, `ctwa-capture-${dayKey(now)}.jsonl`);
  let size = fileSizes.get(file);
  if (size === undefined) {
    await fs.promises.mkdir(dir, { recursive: true, mode: 0o700 });
    size = await fs.promises.stat(file).then((s) => s.size, () => 0);
  }
  if (size + bytes > MAX_FILE_BYTES) { stats.droppedFileCap++; return false; }
  await fs.promises.appendFile(file, line, { mode: 0o600 });
  fileSizes.set(file, size + bytes);
  return true;
}

async function observeAndWrite(args, salt) {
  const now = Date.now();
  const core = idPesanInti(args.externalId) ?? String(args.externalId ?? "");
  const key = hmac(salt, core);
  if (recentIds.has(key)) { stats.deduped++; return; }
  recentIds.set(key, now);
  if (recentIds.size > DEDUPE_CAP) recentIds.delete(recentIds.keys().next().value);

  const obs = buildObservation(args.payload, { ...args, salt, now });
  stats.observed++;
  if (await appendLine(JSON.stringify(obs) + "\n", now)) stats.written++;
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
      observeAndWrite({ payload, event, engine, externalId, isNewCustomer }, salt).catch((e) => {
        stats.failed++;
        warnLimited(`gagal menulis observasi (${e?.code || "ERR"})`);
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
 * Hapus berkas harian yang melewati retensi. HANYA menyentuh nama berkas yang
 * cocok pola ketat (ctwa-capture-YYYY-MM-DD.jsonl) — tidak pernah berkas lain.
 * Berkas dihapus bila AWAL hari-UTC-nya lebih tua dari retensi, sehingga baris
 * tertua yang tersisa tidak pernah lebih tua dari `retentionDays`.
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
        if (!dryRun) { await fs.promises.unlink(path.join(dir, name)); fileSizes.delete(path.join(dir, name)); }
        removed.push(name);
      } catch { errors++; }
    } else kept++;
  }
  return { removed, kept, errors };
}

let lastPurgeDay = null;
function maybePurgeDaily() {
  const today = dayKey(Date.now());
  if (lastPurgeDay === today) return;
  lastPurgeDay = today;
  purgeCaptures().catch(() => { stats.failed++; });
}
