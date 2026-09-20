// node measure.cjs <label> <dist> <perfMode: full|lite|auto> <cpuThrottle> [soakSec] [--renders]
const puppeteer = require("puppeteer-core");
const { spawn } = require("child_process");
const fs = require("fs");
const [label, dist, perfMode = "full", throttle = "4", soakSec = "0", ...flags] = process.argv.slice(2);
const wantRenders = flags.includes("--renders");
const wantTrace = flags.includes("--trace");
const PORT = 5200 + Math.floor(Math.random() * 500);
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const initScript = (mode, renders) => `
  localStorage.setItem("token","t"); localStorage.setItem("user", JSON.stringify({id:"u1",name:"Tester",email:"t@x.id",role:"SALES",roles:["SALES"]}));
  ${mode === "auto" ? "" : `localStorage.setItem("perf-mode","${mode}");`}
  window.__lt = []; window.__frames = []; window.__fpsOn = false; window.__renders = {};
  try { new PerformanceObserver((l)=>{ for (const e of l.getEntries()) window.__lt.push(e.duration); }).observe({type:"longtask",buffered:true}); } catch(e){}
  window.__rafId=0; window.__startFps=function(){ let last=performance.now(); function f(t){ window.__frames.push(t-last); last=t; window.__rafId=requestAnimationFrame(f);} window.__rafId=requestAnimationFrame(f); }; window.__stopFps=function(){ cancelAnimationFrame(window.__rafId); };
  ${renders ? `
  (function(){
    const counts = window.__renders; let nid = 0; const renderers = new Map();
    function walk(f){ while(f){ const alt=f.alternate; const isFn=typeof f.type==="function";
      if(!alt){ if(isFn){const n=f.type.displayName||f.type.name||"anon"; counts[n+"(mount)"]=(counts[n+"(mount)"]||0)+1;} if(f.child) walk(f.child); }
      else { if(isFn && (f.flags & 1)){ const n=f.type.displayName||f.type.name||"anon"; counts[n]=(counts[n]||0)+1; } if(f.child!==alt.child) walk(f.child); }
      f=f.sibling; } }
    window.__REACT_DEVTOOLS_GLOBAL_HOOK__ = { supportsFiber:true, renderers, inject(r){ renderers.set(++nid,r); return nid; },
      onCommitFiberRoot(id, root){ if(window.__countOn) walk(root.current.child); }, onCommitFiberUnmount(){}, onPostCommitFiberRoot(){}, checkDCE(){}, isDisabled:false };
  })();` : ""}
`;

(async () => {
  const srv = spawn("node", ["mock-server.cjs", dist, String(PORT)], { cwd: __dirname, stdio: ["ignore", "pipe", "inherit"] });
  await new Promise((r) => srv.stdout.on("data", (d) => String(d).includes("ready") && r()));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--enable-precise-memory-info", "--disable-background-timer-throttling", "--js-flags=--expose-gc"] });
  const page = await browser.newPage();
  await page.emulate({ viewport: { width: 412, height: 915, deviceScaleFactor: 2, isMobile: true, hasTouch: true }, userAgent: "Mozilla/5.0 (Linux; Android 15; SM-S938B) AppleWebKit/537.36 Chrome/130 Mobile Safari/537.36" });
  const cdp = await page.createCDPSession();
  await cdp.send("Performance.enable");
  await cdp.send("Emulation.setCPUThrottlingRate", { rate: Number(throttle) });
  await page.evaluateOnNewDocument(initScript(perfMode, wantRenders));

  const metric = async () => Object.fromEntries((await cdp.send("Performance.getMetrics")).metrics.map((m) => [m.name, m.value]));
  const results = {};
  async function scenario(name, fn) {
    await page.evaluate(() => { window.__lt.length = 0; window.__frames.length = 0; if(!window.__noFps) window.__startFps(); window.__renders && Object.keys(window.__renders).forEach((k) => delete window.__renders[k]); window.__countOn = true; });
    await fetch(`http://localhost:${PORT}/__stats/reset`, { method: "POST" });
    if (wantTrace) await page.tracing.start({ path: require("path").join(require("os").tmpdir(), "trace-tmp.json"), categories: ["-*","devtools.timeline","disabled-by-default-devtools.timeline","cc","gpu","viz"] });
    const m0 = await metric(); const t0 = Date.now();
    await fn();
    let traceSum = null;
    if (wantTrace) {
      await page.tracing.stop(); const ev = JSON.parse(fs.readFileSync(require("path").join(require("os").tmpdir(), "trace-tmp.json"),"utf8")).traceEvents; const sum = {};
      const want = new Set(["Paint","PaintImage","RasterTask","ImageDecodeTask","Decode Image","Layerize","CompositeLayers","UpdateLayer","Layout","UpdateLayoutTree","FunctionCall","EvaluateScript","Commit","ImageUploadTask","GPUTask","DrawFrame"]);
      for (const e of ev) if (e.ph==="X" && want.has(e.name)) { const k=e.name; sum[k]=sum[k]||{n:0,ms:0}; sum[k].n++; sum[k].ms+=e.dur/1000; }
      traceSum = Object.fromEntries(Object.entries(sum).map(([k,v])=>[k,{n:v.n,ms:Math.round(v.ms)}]));
    }
    const wall = Date.now() - t0; const m1 = await metric();
    const d = await page.evaluate(() => { window.__stopFps(); window.__countOn = false; return { lt: [...window.__lt], fr: [...window.__frames], renders: { ...window.__renders } }; });
    const st = await (await fetch(`http://localhost:${PORT}/__stats`)).json();
    const fr = d.fr.slice(5).sort((a, b) => a - b);
    const p = (q) => fr.length ? +fr[Math.min(fr.length - 1, Math.floor(fr.length * q))].toFixed(1) : null;
    const top = Object.entries(d.renders).sort((a, b) => b[1] - a[1]).slice(0, 12);
    results[name] = {
      wallMs: wall, longTasks: d.lt.length, longTaskMaxMs: d.lt.length ? Math.round(Math.max(...d.lt)) : 0, over100: d.lt.filter((x) => x > 100).length,
      frames: fr.length, frameP50: p(0.5), frameP95: p(0.95), jank20: fr.filter((x) => x > 20).length,
      scriptMs: Math.round((m1.ScriptDuration - m0.ScriptDuration) * 1000), layoutMs: Math.round((m1.LayoutDuration - m0.LayoutDuration) * 1000),
      styleMs: Math.round((m1.RecalcStyleDuration - m0.RecalcStyleDuration) * 1000), taskMs: Math.round((m1.TaskDuration - m0.TaskDuration) * 1000),
      layouts: m1.LayoutCount - m0.LayoutCount, styleRecalcs: m1.RecalcStyleCount - m0.RecalcStyleCount,
      requests: st.count, heapMB: +(m1.JSHeapUsedSize / 1048576).toFixed(1), nodes: m1.Nodes, listeners: m1.JSEventListeners,
      ...(wantRenders ? { renders: top } : {}), ...(traceSum ? { trace: traceSum } : {}),
    };
  }

  // 1. Startup → inbox siap
  const tStart = Date.now();
  await page.goto(`http://localhost:${PORT}/inbox`, { waitUntil: "load" });
  await page.waitForSelector(".conversation-item", { timeout: 30000 });
  results.startup = { inboxReadyMs: Date.now() - tStart };
  const nav = await page.evaluate(() => JSON.stringify(performance.getEntriesByType("resource").map((r) => [r.name.split("/").pop(), r.transferSize, r.decodedBodySize])));
  const res = JSON.parse(nav); results.startup.jsFiles = res.filter((r) => r[0].endsWith(".js")).length; results.startup.jsKB = Math.round(res.filter((r) => r[0].endsWith(".js")).reduce((a, r) => a + r[2], 0) / 1024);
  results.startup.lazyHeavyLoaded = res.filter((r) => /MarkdownEditor|vendor-charts|module-/.test(r[0])).map((r) => r[0]);
  await sleep(1500);

  // 2. Scroll daftar chat (cepat)
  await scenario("scrollList", async () => {
    await page.evaluate(async () => {
      const el = [...document.querySelectorAll("[data-virtuoso-scroller]")].find((e) => e.querySelector(".conversation-item")) || document.querySelector("[data-virtuoso-scroller]");
      for (let i = 0; i < 60; i++) { el.scrollTop += 120; await new Promise((r) => requestAnimationFrame(r)); }
      for (let i = 0; i < 60; i++) { el.scrollTop -= 120; await new Promise((r) => requestAnimationFrame(r)); }
    });
  });

  // 3. Buka percakapan panjang
  await scenario("openLongChat", async () => {
    await page.evaluate(() => document.querySelector(".conversation-item").click());
    await page.waitForFunction(() => document.querySelectorAll(".message-virtuoso [data-index]").length > 3, { timeout: 30000 });
    await sleep(800);
  });

  // 4. Scroll cepat riwayat (memicu pagination)
  await scenario("scrollMessages", async () => {
    await page.evaluate(async () => {
      const el = document.querySelector(".message-virtuoso");
      for (let i = 0; i < 120; i++) { el.scrollTop -= 400; await new Promise((r) => requestAnimationFrame(r)); }
    });
    await sleep(500);
  });

  // 5. Mengetik 40 karakter
  await scenario("typing40", async () => {
    await page.focus("textarea");
    for (const ch of "halo kak, untuk ukuran 160x200 ready ya kak") { await page.keyboard.type(ch); await sleep(40); }
  });

  // 6. Kirim pesan
  await scenario("send", async () => {
    await page.keyboard.press("Enter");
    await sleep(600);
  });

  // 7. Pesan masuk di konv LAIN (harus tidak render ulang inbox/thread)
  await scenario("incomingOther", async () => {
    for (let i = 0; i < 5; i++) { await fetch(`http://localhost:${PORT}/__push/c${20 + i}`, { method: "POST" }); await sleep(300); }
    await sleep(2200);
  });
  // 7b. Pesan masuk di konv AKTIF
  await scenario("incomingActive", async () => {
    for (let i = 0; i < 3; i++) { await fetch(`http://localhost:${PORT}/__push/c0`, { method: "POST" }); await sleep(400); }
    await sleep(800);
  });

  // 8. Pindah chat cepat x20 + heap sebelum/sesudah
  await cdp.send("HeapProfiler.collectGarbage");
  const heap0 = (await metric()).JSHeapUsedSize;
  await scenario("switch20", async () => {
    for (let i = 0; i < 20; i++) {
      await page.evaluate((n) => document.querySelectorAll(".conversation-item")[n % 8]?.click(), i);
      await sleep(180);
    }
    await sleep(800);
  });
  await cdp.send("HeapProfiler.collectGarbage"); await sleep(500); await cdp.send("HeapProfiler.collectGarbage");
  const heap1 = (await metric()).JSHeapUsedSize;
  results.switch20.heapDeltaMB = +((heap1 - heap0) / 1048576).toFixed(1);

  // 8b. Navigasi antar halaman (route change) — transisi, chunk lazy, layout
  for (const route of ["/dashboard","/customers","/orders","/pipeline","/laporan","/inbox"]) {
    await scenario("nav:"+route, async () => {
      await page.evaluate((r) => { window.history.pushState({}, "", r); window.dispatchEvent(new PopStateEvent("popstate")); }, route);
      await sleep(1800);
    });
  }

  // 9. Idle 20 dtk (animasi idle memakan CPU?)
  await page.evaluate(()=>{window.__noFps=true;}); await scenario("idle20s", async () => { await sleep(20000); }); await page.evaluate(()=>{window.__noFps=false;});

  // 10. Background → resume
  await scenario("bgResume", async () => {
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => true }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "hidden" }); document.dispatchEvent(new Event("visibilitychange")); });
    await sleep(3000);
    await page.evaluate(() => { Object.defineProperty(document, "hidden", { configurable: true, get: () => false }); Object.defineProperty(document, "visibilityState", { configurable: true, get: () => "visible" }); document.dispatchEvent(new Event("visibilitychange")); });
    await sleep(2000);
  });

  // 11. Soak (pemakaian panjang): interaksi periodik, heap dicatat tiap 30 dtk
  if (Number(soakSec) > 0) {
    const series = [];
    const end = Date.now() + Number(soakSec) * 1000; let i = 0;
    while (Date.now() < end) {
      await page.evaluate((n) => document.querySelectorAll(".conversation-item")[n % 10]?.click(), i++);
      await fetch(`http://localhost:${PORT}/__push/c${i % 30}`, { method: "POST" });
      await sleep(4000);
      if (i % 8 === 0) { await cdp.send("HeapProfiler.collectGarbage"); const m = await metric(); series.push({ t: Math.round((Date.now() - (end - Number(soakSec) * 1000)) / 1000), heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners }); }
    }
    results.soak = series;
  }

  const m = await metric(); results.final = { heapMB: +(m.JSHeapUsedSize / 1048576).toFixed(1), nodes: m.Nodes, listeners: m.JSEventListeners };
  const unk = await (await fetch(`http://localhost:${PORT}/__stats`)).json(); results.unknownEndpoints = unk.unknown;
  fs.writeFileSync(require("path").join(__dirname, `result-${label}.json`), JSON.stringify({ label, dist, perfMode, throttle, results }, null, 2));
  console.log(JSON.stringify(results, null, 1));
  await browser.close(); srv.kill();
})().catch((e) => { console.error("FAIL", e); process.exit(1); });
