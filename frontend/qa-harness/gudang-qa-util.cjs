// Util bersama QA browser Fase 1 Penerimaan (Chrome via puppeteer-core): komponen ASLI (Vite QA) + backend ASLI di atas DB sandbox terisolasi (gudang-penerimaan-server.mjs).
// Bukti stok/dokumen diambil dari DB lewat /qa/state — BUKAN dari mock. Jalankan setelah server QA + Vite QA hidup:
//   BASE=http://localhost:5478 API=http://127.0.0.1:4478 OUT=C:/tmp/gud-qa/db node frontend/qa-harness/gudang-penerimaan-skenario.cjs
const puppeteer = require(process.env.PUPPETEER || "puppeteer-core"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:5478"; const API = process.env.API || "http://127.0.0.1:4478"; const OUT = process.env.OUT || "C:/tmp/gud-qa/db";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const ID = JSON.parse(fs.readFileSync(path.join(OUT, "ids.json"), "utf8"));
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const hasil = []; let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 500) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 300) : ""}`); };
const keadaan = async () => (await fetch(`${API}/qa/state`)).json();
const api = async (siapa, metode, url, body, header = {}) => { const r = await fetch(API + url, { method: metode, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[siapa].token}`, ...header }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, json: await r.json().catch(() => null) }; };
const saldo = (s, kode) => s.stok[kode]?.saldo ?? 0; const gerak = (s, kode) => s.stok[kode]?.gerakan ?? 0;

async function buka(browser, siapa, rute, { lebar = 1440, tinggi = 900, tema = "light", hp = false } = {}) {
  const page = await browser.newPage(); page.setDefaultTimeout(20000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((token, user, tema2) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("sano-theme", tema2); } catch {} }, T[siapa].token, T[siapa].user, tema);
  await page.setBypassServiceWorker(true).catch(() => {}); // bundel produksi mendaftarkan service worker: permintaan harus lewat intersepsi halaman
  page.galat = []; page.permintaan = [];
  page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|404|401|403|409|500|WebSocket|socket\.io|favicon/i.test(m.text())) page.galat.push("console: " + m.text().slice(0, 200)); });
  page.on("request", (r) => { const u = r.url().replace(/^https?:\/\/[^/]+/, ""); if (/^\/api\//.test(u) && r.method() !== "GET") page.permintaan.push({ m: r.method(), u, b: r.postData() ? (() => { try { return JSON.parse(r.postData()); } catch { return r.postData(); } })() : null, h: r.headers() }); });
  await page.goto(BASE + rute, { waitUntil: "networkidle2", timeout: 60000 }); await tidur(600);
  return page;
}
const lihat = (page, sel) => page.$(sel).then((e) => !!e);
const tampak = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed"), sel);
const tunggu = (page, sel, ms = 15000) => page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null || getComputedStyle(e).position === "fixed"), { timeout: ms }, sel);
const klik = async (page, sel) => { await tunggu(page, sel); await page.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent !== null || getComputedStyle(x).position === "fixed"); e.scrollIntoView({ block: "center" }); }, sel); await page.click(sel); await tidur(250); };
const klikTeks = async (page, sel, teks) => { const h = await page.evaluateHandle((s, t) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(t) && (e.offsetParent !== null || getComputedStyle(e).position === "fixed")) ?? null, sel, teks); const el = h.asElement(); if (!el) throw new Error(`tidak ada ${sel} berteks "${teks}"`); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await el.click(); await tidur(250); };
const isi = async (page, sel, nilai) => { await tunggu(page, sel); await page.focus(sel); await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace"); if (nilai !== "") await page.type(sel, String(nilai)); await tidur(120); };
const teksDari = (page, sel) => page.evaluate((s) => [...document.querySelectorAll(s)].filter((e) => e.offsetParent !== null).map((e) => e.textContent.trim()).join(" | "), sel);
const foto = async (page, nama) => { await tidur(300); await page.screenshot({ path: path.join(SHOTS, nama + ".png") }); };
const tanpaGulirSamping = (page) => page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1);
async function pilihTanggalHariIni(page, sel) { await klik(page, sel); await klikTeks(page, 'button', "Hari ini"); await tidur(200); }

module.exports = { puppeteer, CHROME, T, ID, API, BASE, tidur, ok, keadaan, api, saldo, gerak, buka, lihat, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, tanpaGulirSamping, pilihTanggalHariIni, selesai: (nama = "hasil-browser.json") => { fs.writeFileSync(path.join(OUT, nama), JSON.stringify({ gagal, hasil }, null, 2)); console.log(`\n${hasil.length - gagal}/${hasil.length} lulus${gagal ? `, ${gagal} GAGAL` : ""}`); process.exitCode = gagal ? 1 : 0; } };
