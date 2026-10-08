// Ringkasan observasi capture Fase 0 (baca-saja). Bekerja HANYA di atas baris
// JSONL ter-sanitasi yang ditulis ctwaCapture.js — tidak pernah menyentuh DB
// atau payload mentah, jadi aman dijalankan kapan saja.
//
// Tugasnya menjawab pertanyaan Fase 0:
//   1. Apakah sourceID / sourceType benar-benar ada di payload CTWA?
//   2. Apakah sourceURL memuat ID stabil yang bisa dipetakan ke post/ad Meta?
//   3. Seberapa sering ctwa_clid ada, dan apakah unik per klik?
//   4. Apakah customer lama juga membawa konteks iklan?
//
// ⚠️ ID yang diturunkan dari sourceURL (mis. media ID Instagram dari shortcode)
// adalah ID POSTINGAN, bukan ID iklan. Modul ini TIDAK PERNAH menyebutnya ad ID;
// ia hanya membandingkannya dengan sourceID bila sourceID ada, sebagai bukti.

const IG_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/**
 * Shortcode Instagram -> media ID numerik (basis-64 posisional). TURUNAN yang
 * belum terverifikasi terhadap Meta; dipakai hanya sebagai bahan pembanding.
 * @returns {string|null}
 */
export function igShortcodeToMediaId(code) {
  if (typeof code !== "string" || code.length < 1 || code.length > 40) return null;
  let n = 0n;
  for (const ch of code) {
    const i = IG_ALPHABET.indexOf(ch);
    if (i < 0) return null;
    n = n * 64n + BigInt(i);
  }
  return n.toString();
}

const inc = (map, key) => { map[key] = (map[key] || 0) + 1; };
const pct = (n, d) => (d ? Math.round((n / d) * 1000) / 10 : null);

/**
 * @param {object[]} rows baris observasi (hasil JSON.parse per baris)
 */
export function summarize(rows) {
  // Dedupe defensif per msgIdHash (capture sudah dedupe; ini untuk berkas gabungan).
  const seen = new Set();
  const uniq = [];
  let duplicates = 0;
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    if (r.msgIdHash && seen.has(r.msgIdHash)) { duplicates++; continue; }
    if (r.msgIdHash) seen.add(r.msgIdHash);
    uniq.push(r);
  }

  const verdicts = {};
  const byCustomer = { NEW: {}, EXISTING: {} };
  const events = {};
  const fieldMatrix = {};            // hanya untuk CTWA_AD: field -> {absent,empty,present}
  const sourceTypes = {};
  const sourceIdLens = {};
  const urlKinds = {};
  const entryApps = {};
  const entrySources = {};
  const adKeys = {};
  const ctxKeys = {};
  const rejected = {};
  const clidHashes = new Map();
  const sourceIds = new Set();
  const delays = [];
  const lags = [];
  let ctwaAd = 0, withSourceId = 0, withSourceType = 0, withClid = 0, withUrl = 0;
  const igCompare = { igPostsWithSourceId: 0, sourceIdEqualsDerivedPostId: 0, sourceIdDiffersFromDerivedPostId: 0 };
  const idTokenByKind = {};

  for (const r of uniq) {
    inc(verdicts, r.verdict || "?");
    inc(events, r.event || "?");
    if (r.customer) inc(byCustomer[r.customer] || (byCustomer[r.customer] = {}), r.verdict || "?");
    if (typeof r.lagSeconds === "number") lags.push(r.lagSeconds);
    if (r.verdict !== "CTWA_AD") continue;

    ctwaAd++;
    for (const [k, st] of Object.entries(r.fields || {})) {
      fieldMatrix[k] = fieldMatrix[k] || { absent: 0, empty: 0, present: 0 };
      fieldMatrix[k][st] = (fieldMatrix[k][st] || 0) + 1;
    }
    const v = r.values || {};
    if (v.sourceId) { withSourceId++; sourceIds.add(v.sourceId); inc(sourceIdLens, String(v.sourceId.length)); }
    if (v.sourceType) { withSourceType++; inc(sourceTypes, v.sourceType); }
    if (v.entryPointConversionApp) inc(entryApps, v.entryPointConversionApp);
    if (v.entryPointConversionSource) inc(entrySources, v.entryPointConversionSource);
    if (typeof v.entryPointConversionDelaySeconds === "number") delays.push(v.entryPointConversionDelaySeconds);
    for (const k of r.externalAdReplyKeys || []) inc(adKeys, k);
    for (const k of r.contextInfoKeys || []) inc(ctxKeys, k);
    for (const k of r.rejected || []) inc(rejected, k);

    if (r.ctwaClid?.hash) {
      withClid++;
      clidHashes.set(r.ctwaClid.hash, (clidHashes.get(r.ctwaClid.hash) || 0) + 1);
    }
    if (r.sourceUrl?.parsed) {
      withUrl++;
      inc(urlKinds, r.sourceUrl.kind);
      if (r.sourceUrl.idToken) {
        const t = (idTokenByKind[r.sourceUrl.kind] = idTokenByKind[r.sourceUrl.kind] || new Set());
        t.add(r.sourceUrl.idToken);
      }
      if ((r.sourceUrl.kind === "instagram_post" || r.sourceUrl.kind === "instagram_reel" || r.sourceUrl.kind === "instagram_tv") && v.sourceId && r.sourceUrl.idToken) {
        igCompare.igPostsWithSourceId++;
        const derived = igShortcodeToMediaId(r.sourceUrl.idToken);
        if (derived && derived === v.sourceId) igCompare.sourceIdEqualsDerivedPostId++;
        else igCompare.sourceIdDiffersFromDerivedPostId++;
      }
    }
  }

  const repeatedClids = [...clidHashes.values()].filter((n) => n > 1).length;
  const sortedDelays = delays.slice().sort((a, b) => a - b);
  const median = sortedDelays.length ? sortedDelays[Math.floor(sortedDelays.length / 2)] : null;

  // Kesimpulan mesin-bacaan untuk keputusan GO/NO-GO. Sengaja konservatif:
  // "tidak ada sampel" bukan "tidak ada field".
  const sample = ctwaAd;
  const conclusions = {
    sampleCtwaAd: sample,
    enoughSample: sample >= 30,
    sourceIdAvailablePct: pct(withSourceId, sample),
    sourceTypeAvailablePct: pct(withSourceType, sample),
    ctwaClidAvailablePct: pct(withClid, sample),
    sourceUrlAvailablePct: pct(withUrl, sample),
    sourceIdLooksLikeAdId: null, // TIDAK PERNAH disimpulkan otomatis — butuh pencocokan manual ke Ads Manager
    note: "sourceID baru boleh disebut ad ID setelah dicocokkan manual dengan Ads Manager pada >= 5 iklan berbeda.",
  };

  return {
    totalObserved: uniq.length,
    duplicatesIgnored: duplicates,
    verdicts,
    byCustomer,
    events,
    ctwaAd: {
      total: ctwaAd,
      fieldPresence: fieldMatrix,
      sourceTypes,
      sourceIdLengths: sourceIdLens,
      distinctSourceIds: sourceIds.size,
      distinctClidHashes: clidHashes.size,
      clidHashSeenMoreThanOnce: repeatedClids,
      entryPointApps: entryApps,
      entryPointSources: entrySources,
      delaySeconds: { n: delays.length, median, max: sortedDelays.length ? sortedDelays[sortedDelays.length - 1] : null },
      externalAdReplyKeys: adKeys,
      contextInfoKeys: ctxKeys,
      valuesRejectedByAllowlist: rejected,
    },
    sourceUrl: {
      kinds: urlKinds,
      distinctIdTokensByKind: Object.fromEntries(Object.entries(idTokenByKind).map(([k, s]) => [k, s.size])),
      instagramComparison: igCompare,
    },
    lagSeconds: { n: lags.length, max: lags.length ? Math.max(...lags) : null },
    conclusions,
  };
}
