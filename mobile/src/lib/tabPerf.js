// Instrumentasi ukur perpindahan tab — AKTIF HANYA di build dev (__DEV__); di rilis semuanya no-op.
//
// Yang dicatat per perpindahan (satu baris log "TABPERF {json}" yang dibaca skrip QA lewat logcat):
//   toEnd        ms dari sentuhan sampai animasi selesai (event transitionEnd navigator)
//   toLastCommit ms dari sentuhan sampai commit React TERAKHIR layar tujuan dalam jendela 800 ms
//                (≈ waktu sampai layar tujuan stabil & bisa disentuh)
//   commits/ms   jumlah render commit layar tujuan & total actualDuration-nya (React Profiler)
//   jsMaxStall   jeda terpanjang event-loop JS selama jendela (≥ 50 ms = long task di thread JS)
//   jsStalls50   jumlah jeda ≥ 50 ms
// Frame UI/GPU diukur dari luar lewat `dumpsys gfxinfo` (lihat mobile/scripts/tab-bench.cjs).
import React, { Profiler } from "react";

// Aktif di build dev, ATAU di build rilis khusus ukur (EXPO_PUBLIC_TAB_PERF=1 saat membangun). Build produksi biasa: mati.
export const TAB_PERF_ON = (typeof __DEV__ !== "undefined" && __DEV__) || process.env.EXPO_PUBLIC_TAB_PERF === "1";
// Log lewat alias: babel-plugin-transform-remove-console (produksi) hanya membuang pemanggilan literal `console.xxx()`.
const sink = globalThis.console && globalThis.console.warn ? globalThis.console.warn.bind(globalThis.console) : () => {};
const WINDOW_MS = 800;
const now = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());

let cur = null; // { from, to, t0, commits, commitMs, lastCommit, ended, timer }
let monitorTimer = null;
let lastTick = 0;
let stalls = [];
let lastStallEnd = 0;

function startMonitor() {
  if (monitorTimer) return;
  lastTick = now();
  monitorTimer = setInterval(() => {
    const t = now();
    const gap = t - lastTick - 8; // interval 8 ms; selebihnya = jeda thread JS
    lastTick = t;
    if (gap >= 20) { stalls.push(gap); lastStallEnd = t; if (cur && gap >= 30) cur.stallAt.push([Math.round(t - gap - cur.t0), Math.round(gap)]); }
  }, 8);
}
function stopMonitor() { clearInterval(monitorTimer); monitorTimer = null; }

function flush() {
  if (!cur) return;
  const c = cur; cur = null; stopMonitor();
  const max = stalls.length ? Math.round(Math.max(...stalls)) : 0;
  sink("TABPERF " + JSON.stringify({
    from: c.from, to: c.to,
    toEnd: c.ended ? Math.round(c.ended - c.t0) : null,
    toLastCommit: c.lastCommit ? Math.round(c.lastCommit - c.t0) : null,
    // sampai thread JS bebas (akhir jeda ≥ 20 ms terakhir) — dipakai di build rilis, tempat Profiler tidak aktif
    toIdle: lastStallEnd > c.t0 ? Math.round(lastStallEnd - c.t0) : 0,
    commits: c.commits, commitMs: Math.round(c.commitMs * 10) / 10,
    // render SEMUA layar tab selama jendela (termasuk layar yang tidak dituju) — {id: [jumlahCommit, ms]}
    all: Object.fromEntries(Object.entries(c.byId).map(([k, v]) => [k, [v.n, Math.round(v.ms)]])),
    // jeda ≥ 30 ms: [mulai (ms sejak sentuhan), durasi] — membedakan jeda SELAMA animasi vs SESUDAH animasi selesai
    stallAt: c.stallAt,
    navMs: c.navMs, counts: c.counts,
    jsMaxStall: max, jsStalls50: stalls.filter((g) => g >= 50).length, jsStalls20: stalls.length,
  }));
  stalls = [];
}

export function markTap(from, to) {
  if (!TAB_PERF_ON) return;
  if (cur) flush();
  stalls = [];
  lastStallEnd = 0;
  cur = { from, to, t0: now(), commits: 0, commitMs: 0, lastCommit: 0, ended: 0, byId: {}, stallAt: [], counts: {}, navMs: null };
  startMonitor();
  cur.timer = setTimeout(flush, WINDOW_MS);
}

/** Hitung render komponen tertentu selama jendela ukur (build ukur saja). */
export const count = TAB_PERF_ON
  ? (name) => { if (cur) cur.counts[name] = (cur.counts[name] || 0) + 1; }
  : () => {};

/** Lama pemanggilan navigation.navigate() SINKRON (React merender di dalam event sentuhan). */
export function markNavCall(ms) {
  if (TAB_PERF_ON && cur) cur.navMs = Math.round(ms);
}
export const perfNow = now;

export function markTransitionEnd(to) {
  if (!TAB_PERF_ON || !cur || cur.to !== to) return;
  cur.ended = now();
}

function onRender(id, phase, actualDuration) {
  if (!cur) return;
  const b = cur.byId[id] || (cur.byId[id] = { n: 0, ms: 0 });
  b.n += 1; b.ms += actualDuration;
  if (cur.to !== id) return;
  cur.commits += 1;
  cur.commitMs += actualDuration;
  cur.lastCommit = now();
}

/** Bungkus komponen layar dengan Profiler (hanya dev). Dipanggil SEKALI di level modul. */
export function withTabProfiler(Comp, id) {
  if (!TAB_PERF_ON) return Comp;
  function Wrapped(props) {
    count("wrap:" + id);
    return <Profiler id={id} onRender={onRender}><Comp {...props} /></Profiler>;
  }
  Wrapped.displayName = `TabPerf(${id})`;
  return Wrapped;
}
