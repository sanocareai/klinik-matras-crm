// Util bersama skrip QA browser Marketing (Chrome via puppeteer-core). Komponen ASLI (Vite QA) + backend ASLI di atas database terisolasi.
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:5192"; const API = process.env.API || "http://127.0.0.1:4021"; const OUT = process.env.OUT || "C:/tmp/km-mkt-prodcopy";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8"));
const DL = path.join(OUT, "unduhan"); fs.mkdirSync(DL, { recursive: true });
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const hasil = []; let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 400) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 260) : ""}`); };
const num = (s) => { if (s == null) return null; const m = String(s).replace(/Rp|≥|\s|×/g, "").replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const apiGet = async (siapa, p) => { const r = await fetch(API + p, { headers: { Authorization: `Bearer ${T[siapa].token}` } }); return { status: r.status, json: await r.json().catch(() => null) }; };

async function mulai() { return puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] }); }
async function buka(browser, siapa, rute, { lebar = 1440, tinggi = 900, hp = false, awal = null, prasiap = null } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((token, user, awalTabs) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); if (awalTabs && !sessionStorage.getItem("__awal")) { localStorage.setItem("open-tabs:v1", awalTabs); sessionStorage.setItem("__awal", "1"); } } catch (e) {} }, T[siapa].token, T[siapa].user, awal);
  page.galat = []; page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|404|401|403|429|WebSocket|socket\.io/i.test(m.text())) page.galat.push("console: " + m.text().slice(0, 160)); });
  await page.setBypassServiceWorker(true).catch(() => {});   // build produksi mendaftarkan service worker: fetch-nya lolos dari intersepsi permintaan halaman
  page.ctxId = ctx.id; page.permintaan = [];
  page.on("request", (r) => { if (/\/api\/(atribusi|analytics)/.test(r.url())) page.permintaan.push({ url: r.url().replace(/^https?:\/\/[^/]+/, ""), t: Date.now() }); });
  const client = await page.createCDPSession(); await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true, browserContextId: ctx.id }).catch(() => {});
  if (prasiap) await prasiap(page);   // mis. pasang intersepsi permintaan SEBELUM halaman memuat
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
// Tunggu SALAH SATU elemen yang cocok tampak (tab shell yang disembunyikan boleh memuat elemen bertestid sama; waitForSelector hanya melihat yang pertama).
const tunggu = (page, sel, ms = 60000) => page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null), { timeout: ms }, sel);
const teks = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
const sel = (page, s) => page.$$eval(s, (els) => els.map((e) => e.textContent.trim()));
const urlKini = (page) => new URL(page.url());
const klikTeks = async (page, selector, t) => { const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(x) && e.offsetParent !== null), selector, t); const el = h.asElement(); if (!el) throw new Error(`tak ada ${selector} "${t}"`); await el.click(); };
const tungguUrl = (page, re, ms = 20000) => page.waitForFunction((r) => new RegExp(r).test(location.search + location.pathname), { timeout: ms }, re.source);
const foto = async (page, nama, penuh = true) => { const vp = page.viewport(); if (penuh) await page.setViewport({ ...vp, height: vp.isMobile ? 3200 : 2600 }); await tidur(500); await page.screenshot({ path: path.join(SHOTS, nama + ".png") }); if (penuh) await page.setViewport(vp); };
// Tunggu berkas unduhan baru (nama berawalan/berakhiran tertentu) muncul dan selesai (tanpa .crdownload).
async function tungguUnduhan(cocok, sejak, ms = 40000) {
  const batas = Date.now() + ms;
  while (Date.now() < batas) {
    const f = fs.readdirSync(DL).filter((n) => cocok.test(n) && !n.endsWith(".crdownload")).map((n) => ({ n, t: fs.statSync(path.join(DL, n)).mtimeMs })).filter((x) => x.t >= sejak - 1000).sort((a, b) => b.t - a.t)[0];
    if (f) { await tidur(300); return path.join(DL, f.n); }
    await tidur(300);
  }
  return null;
}
const selesai = (nama) => { fs.writeFileSync(path.join(OUT, nama), JSON.stringify({ gagal, hasil }, null, 2)); console.log(`\n${hasil.length - gagal}/${hasil.length} lulus${gagal ? `, ${gagal} GAGAL` : ""}`); };
module.exports = { puppeteer, fs, path, BASE, API, OUT, DL, SHOTS, T, tidur, ok, num, apiGet, mulai, buka, tunggu, teks, sel, urlKini, klikTeks, tungguUrl, foto, tungguUnduhan, selesai, hasilRef: () => ({ gagal, hasil }) };
