// Dampak performa: 6 tab Chrome nyata membuka halaman Posting Pemakaian Historis saat batch berjalan (server + DB terisolasi). Mengukur permintaan/dtk, p50/p95 durasi (resource timing),
// CPU/memori kontainer, polling tab yang tidak terlihat, dan memastikan batch tetap maju. Batch diajukan lewat API (hash rencana 90 order) agar tab hanya MENAMPILKAN.
const puppeteer = require("puppeteer-core"); const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:4020"; const DB = process.env.DB || "ui1"; const CONTAINER = process.env.CONTAINER || "km-ui"; const DIR = process.env.KM_UI_DIR || "C:/tmp/km-ui";
const T = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8")); const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const env = { ...process.env, MSYS_NO_PATHCONV: "1" }; const dock = (...a) => execFileSync("docker", a, { encoding: "utf8", env }).trim();
const sql = (q) => execFileSync("docker", ["exec", "km-rekon-pg", "psql", "-U", "klinik", "-d", DB, "-At", "-c", q], { encoding: "utf8", env }).trim();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms)); const N = 6; const DETIK = 30;
(async () => {
  const H = { Authorization: "Bearer " + T.owner.token, "Content-Type": "application/json" };
  const q = await (await fetch(BASE + "/api/production/posting-historis/pratinjau", { headers: H })).json(); const ids = q.unitIds.slice(0, 150);
  const p = await (await fetch(BASE + "/api/production/posting-historis/pratinjau?unitIds=" + ids.join(","), { headers: H })).json();
  const a = await fetch(BASE + "/api/production/posting-historis/batch", { method: "POST", headers: H, body: JSON.stringify({ hashDisetujui: p.hash, rujukan: "UJI-6TAB-001", unitIds: ids }) }); console.log("batch", a.status, ids.length, "order");
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null, protocolTimeout: 120000 });
  const ctx = await browser.createBrowserContext(); const tabs = [];
  for (let i = 0; i < N; i++) {
    const pg = await ctx.newPage(); await pg.setViewport({ width: 1100, height: 800 });
    await pg.evaluateOnNewDocument((t, u) => { try { if (!localStorage.getItem("token")) { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); } } catch (e) {} }, T.owner.token, T.owner.user);
    await pg.goto(BASE + "/warehouse/posting-historis", { waitUntil: "domcontentloaded" }); await pg.waitForSelector('[data-testid="kartu-progres"]', { timeout: 40000 }); tabs.push(pg);
  }
  console.log(N, "tab terbuka"); await tabs[0].bringToFront();
  await Promise.all(tabs.map((pg) => pg.evaluate(() => performance.clearResourceTimings()))); const g0 = Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'")); const t0 = Date.now();
  await tidur(DETIK * 1000 / 2); const cpu1 = dock("stats", "--no-stream", "--format", "{{.CPUPerc}} {{.MemUsage}}", CONTAINER); await tidur(DETIK * 1000 / 2);
  const per = []; for (const pg of tabs) per.push(await pg.evaluate(() => ({ hidden: document.hidden, e: performance.getEntriesByType("resource").filter((x) => x.name.includes("/posting-historis/")).map((x) => ({ u: x.name.split("/posting-historis/")[1].replace(/[0-9a-f]{64}/, ":id").split("?")[0], d: x.duration })) })));
  const lama = (Date.now() - t0) / 1000; const semua = per.flatMap((x) => x.e); const d = semua.map((x) => x.d).sort((x, y) => x - y); const pct = (r) => Math.round(d[Math.min(d.length - 1, Math.floor(d.length * r))]);
  const terlihat = per.filter((x) => !x.hidden); const tersembunyi = per.filter((x) => x.hidden);
  const rata = (arr) => (arr.length ? (arr.reduce((s, x) => s + x.e.length, 0) / arr.length).toFixed(1) : "-");
  console.log(JSON.stringify({ tab: N, detik: Math.round(lama), permintaanTotal: semua.length, perDetik: +(semua.length / lama).toFixed(2), p50ms: pct(0.5), p95ms: pct(0.95), maksMs: Math.round(d.at(-1)), tabTerlihat: terlihat.length, permintaanPerTabTerlihat: rata(terlihat), tabTersembunyi: tersembunyi.length, permintaanPerTabTersembunyi: rata(tersembunyi), cpuKontainer: cpu1, pergerakanBertambah: Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'")) - g0 }));
  const jenis = {}; for (const x of semua) jenis[x.u] = (jenis[x.u] ?? 0) + 1; console.log("per jenis:", JSON.stringify(jenis));
  await browser.close();
})().catch((e) => { console.log("GALAT", e.stack || e.message); process.exit(1); });
