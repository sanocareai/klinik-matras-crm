// Benchmark perpindahan bottom tab di emulator/perangkat Android via adb.
//   node scripts/tab-bench.cjs <label> [--skip-launch]
// Prasyarat: build dev (log TABPERF aktif), Metro berjalan, sudah login, data uji banyak (chat/order).
// Mengukur: (1) log TABPERF dari lib/tabPerf.js (toEnd, toLastCommit, commits, jsMaxStall),
//           (2) frame UI dari `dumpsys gfxinfo` (total, janky, persentil frame time).
// Skenario: COLD = kunjungan pertama tiap tab sejak app dimulai; WARM = seluruh 20 pasangan tab;
//           RAPID = 20 ketukan beruntun Home↔Chats; DOUBLE = ketuk tab aktif 2×.
const fs = require("fs");
const { sh, sleep, launch, launchRelease, tap, TABS, PKG } = require("./adb-util.cjs");
const label = process.argv[2] || "run";
const skipLaunch = process.argv.includes("--skip-launch");

function gfxReset() { sh(`shell dumpsys gfxinfo ${PKG} reset`); }
function gfx() {
  const t = sh(`shell dumpsys gfxinfo ${PKG}`);
  const g = (re) => { const m = t.match(re); return m ? Number(m[1]) : null; };
  return {
    frames: g(/Total frames rendered: (\d+)/), janky: g(/Janky frames: (\d+)/),
    p50: g(/50th percentile: (\d+)ms/), p90: g(/90th percentile: (\d+)ms/), p95: g(/95th percentile: (\d+)ms/), p99: g(/99th percentile: (\d+)ms/),
    missedVsync: g(/Number Missed Vsync: (\d+)/), slowUi: g(/Number Slow UI thread: (\d+)/), slowDraw: g(/Number Slow issue draw commands: (\d+)/),
  };
}
function logs() {
  const t = sh("logcat -d -s ReactNativeJS:V");
  sh("logcat -c");
  return [...t.matchAll(/TABPERF (\{.*\})/g)].map((m) => { try { return JSON.parse(m[1]); } catch { return null; } }).filter(Boolean);
}
const stat = (a) => { const v = a.filter((x) => x != null).sort((x, y) => x - y); if (!v.length) return null; const q = (p) => v[Math.min(v.length - 1, Math.floor(v.length * p))]; return { n: v.length, p50: q(0.5), p90: q(0.9), max: v[v.length - 1], mean: Math.round(v.reduce((s, x) => s + x, 0) / v.length) }; };
function summarize(rows) {
  return {
    n: rows.length, toEnd: stat(rows.map((r) => r.toEnd)), toLastCommit: stat(rows.map((r) => r.toLastCommit)), toIdle: stat(rows.map((r) => r.toIdle)),
    commits: stat(rows.map((r) => r.commits)), commitMs: stat(rows.map((r) => r.commitMs)),
    jsMaxStall: stat(rows.map((r) => r.jsMaxStall)), jsStalls50: rows.reduce((s, r) => s + r.jsStalls50, 0),
    detail: rows.map((r) => `${r.from}→${r.to}: end ${r.toEnd} idle ${r.toIdle} stall ${r.jsMaxStall} at ${JSON.stringify(r.stallAt || [])}`),
  };
}

const out = { label, at: new Date().toISOString() };
if (!skipLaunch) { if (!(process.argv.includes("--release") ? launchRelease() : launch())) { console.error("Home tidak muncul"); process.exit(1); } sleep(6000); }
sh("logcat -c");

// COLD — kunjungan pertama tiap tab (urutan tetap)
gfxReset();
for (const t of ["Chats", "Pelanggan", "Order", "Profil", "Home"]) { tap(t); sleep(2600); }
out.cold = { ...summarize(logs()), gfx: gfx() };

// WARM — seluruh 20 pasangan (tiap pasangan: tab asal distabilkan dulu, log dibersihkan, baru ketuk tujuan)
gfxReset(); sh("logcat -c");
const pairs = [];
for (const a of TABS) for (const b of TABS) if (a !== b) pairs.push([a, b]);
for (const [a, b] of pairs) { tap(a); sleep(1800); sh("logcat -c"); tap(b); sleep(2000); const l = logs(); pairs.rows = (pairs.rows || []).concat(l.filter((r) => r.to === b)); }
out.warm = { ...summarize(pairs.rows || []), gfx: gfx() };

// RAPID — 20 ketukan beruntun Home↔Chats (±interval alami adb)
gfxReset(); sh("logcat -c");
for (let i = 0; i < 20; i++) tap(i % 2 ? "Home" : "Chats");
sleep(2000);
out.rapid = { ...summarize(logs()), gfx: gfx(), finalTabHome: null };

// DOUBLE — ketuk tab aktif dua kali
tap("Chats"); sleep(1500); sh("logcat -c"); tap("Chats"); tap("Chats"); sleep(1200);
out.double = { events: logs().length };

fs.writeFileSync(`C:/tmp/bench-${label}.json`, JSON.stringify(out, null, 2));
const f = (s) => (s ? `p50=${s.p50} p90=${s.p90} max=${s.max}` : "-");
for (const k of ["cold", "warm", "rapid"]) {
  const o = out[k];
  console.log(`${k.padEnd(6)} n=${o.n} toEnd[${f(o.toEnd)}] toIdle[${f(o.toIdle)}] toLastCommit[${f(o.toLastCommit)}] commits[${f(o.commits)}] commitMs[${f(o.commitMs)}] jsStall[${f(o.jsMaxStall)}] stalls50=${o.jsStalls50} | frames=${o.gfx.frames} janky=${o.gfx.janky} (${o.gfx.frames ? Math.round(100 * o.gfx.janky / o.gfx.frames) : 0}%) p90=${o.gfx.p90}ms p95=${o.gfx.p95}ms p99=${o.gfx.p99}ms`);
}
console.log("double-tap-aktif log events:", out.double.events);
