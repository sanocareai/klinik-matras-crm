// QA browser FOTO BAHAN (sandbox terisolasi, SBX-*): unggah, tampil di daftar/drawer, ganti, putar, hapus, penolakan, izin, HP + gelap, stok/harga tidak berubah.
//   BASE=http://127.0.0.1:5321 OUT=C:/tmp/km-foto-bahan-qa node frontend/qa-harness/stok-foto-browser.cjs
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const sharp = require("../../backend/node_modules/sharp");
const BASE = process.env.BASE || "http://127.0.0.1:5321"; const OUT = process.env.OUT || "C:/tmp/km-foto-bahan-qa";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const ada = (page, s, t = 30000) => page.waitForFunction((x) => [...document.querySelectorAll(x)].some((e) => e.getClientRects().length > 0), { timeout: t }, s);
const hilang = (page, s, t = 30000) => page.waitForFunction((x) => ![...document.querySelectorAll(x)].some((e) => e.getClientRects().length > 0), { timeout: t }, s);
async function buka(browser, siapa, rute, { lebar = 1440, tinggi = 900, hp = false, tema = "" } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((t, u, th) => { try { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); if (th) localStorage.setItem("sano-theme", th); } catch (e) { /* abaikan */ } }, T[siapa].token, T[siapa].user, tema);
  page.galat = []; page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  page.reqFoto = []; page.on("response", (r) => { if (r.url().includes("/photo")) page.reqFoto.push(`${r.request().method()} ${r.status()}`); });
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" }); await ada(page, '[data-testid="baris-stok"]').catch(() => {}); await tidur(800);
  return page;
}
const teks = (page, s) => page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); return e ? e.textContent.trim() : null; }, s);
const jepret = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png") });
const klik = async (page, s) => { await ada(page, s); await page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); e.scrollIntoView({ block: "center" }); e.click(); }, s); };
const tanpaGulir = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const dimGambar = (page, s) => page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); return e ? { w: e.naturalWidth, h: e.naturalHeight, src: e.getAttribute("src") } : null; }, s);
const status = (page, url) => page.evaluate(async (u) => (await fetch(u, { cache: "no-store" })).status, url);
const tinggiTombol = (page, s) => page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); return e ? Math.round(e.getBoundingClientRect().height) : null; }, s);

(async () => {
  const gbr = { besar: path.join(OUT, "uji-besar.jpg"), potret: path.join(OUT, "uji-potret.jpg"), teks: path.join(OUT, "uji.txt") };
  await sharp({ create: { width: 3000, height: 2000, channels: 3, background: { r: 30, g: 120, b: 200 } } }).jpeg().toFile(gbr.besar);
  await sharp({ create: { width: 600, height: 900, channels: 3, background: { r: 200, g: 90, b: 40 } } }).jpeg().toFile(gbr.potret);
  fs.writeFileSync(gbr.teks, "ini bukan foto");
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null });
  try {
    const G = await buka(browser, "gudang", "/warehouse/inventory?q=SBX-HR-N44");
    ok("daftar awal: bahan tanpa foto memakai ikon kelompok", !(await G.$('button[data-testid="baris-stok"] [data-foto="1"]')) && !!(await G.$('button[data-testid="baris-stok"] [data-testid="ikon-bahan"]')));
    await klik(G, 'button[data-testid="baris-stok"]'); await ada(G, '[data-testid="kartu-foto"]'); await tidur(700);
    const stokSebelum = await teks(G, '[data-testid="stok-tersedia"]'); const hargaSebelum = await teks(G, '[data-testid="header-harga"]');
    ok("drawer: kartu Foto bahan tampil, kosong, hanya tombol Unggah (belum ada Putar/Hapus)", !!(await G.$('[data-testid="foto-kosong"]')) && !!(await G.$('[data-testid="foto-unggah"]')) && !(await G.$('[data-testid="foto-putar"]')) && !(await G.$('[data-testid="foto-hapus"]')));
    ok("tombol Unggah foto berlabel 'Unggah foto'", /Unggah foto/.test(await teks(G, '[data-testid="foto-unggah"]')));
    await jepret(G, "a-drawer-kosong");

    // unggah
    const input = await G.$('[data-testid="input-foto"]'); await input.uploadFile(gbr.besar);
    await ada(G, '[data-testid="foto-bahan"]', 40000); await tidur(800);
    const d1 = await dimGambar(G, '[data-testid="foto-bahan"]');
    ok("unggah foto 3000×2000: tampil di drawer, gambar termuat, sisi terpanjang 1280 (diproses server)", d1 && d1.w === 1280 && d1.h === 853 && /^\/api\/inventory\/foto-bahan\/[^?]+\.webp\?exp=\d+&sig=[0-9a-f]{64}$/.test(d1.src), JSON.stringify(d1));
    ok("tombol berubah: Ganti foto + Putar + Hapus", /Ganti foto/.test(await teks(G, '[data-testid="foto-unggah"]')) && !!(await G.$('[data-testid="foto-putar"]')) && !!(await G.$('[data-testid="foto-hapus"]')));
    ok("header drawer memakai foto (thumbnail) menggantikan ikon", !!(await G.$('[data-testid="drawer-bahan"] [data-testid="ikon-bahan"][data-foto="1"]')));
    ok("stok dan harga di drawer TIDAK berubah setelah unggah", (await teks(G, '[data-testid="stok-tersedia"]')) === stokSebelum && (await teks(G, '[data-testid="header-harga"]')) === hargaSebelum, `${stokSebelum} | ${hargaSebelum}`);
    await jepret(G, "b-drawer-berfoto");

    // daftar ikut berubah
    await G.keyboard.press("Escape"); await hilang(G, '[data-testid="drawer-bahan"]'); await tidur(1200);
    const thumbDaftar = await dimGambar(G, 'button[data-testid="baris-stok"] [data-foto="1"] img');
    ok("daftar: baris bahan menampilkan thumbnail 192×192 (bukan ikon)", thumbDaftar && thumbDaftar.w === 192 && thumbDaftar.h === 192 && /-t\.webp\?exp=\d+&sig=[0-9a-f]{64}$/.test(thumbDaftar.src), JSON.stringify(thumbDaftar));
    await jepret(G, "c-daftar-berfoto");

    // muat ulang: foto bertahan
    await G.reload({ waitUntil: "domcontentloaded" }); await ada(G, 'button[data-testid="baris-stok"]'); await tidur(1000);
    ok("setelah muat ulang halaman: thumbnail masih ada", !!(await G.$('button[data-testid="baris-stok"] [data-foto="1"]')));
    await klik(G, 'button[data-testid="baris-stok"]'); await ada(G, '[data-testid="foto-bahan"]'); await tidur(500);

    // putar
    const sebelumPutar = await dimGambar(G, '[data-testid="foto-bahan"]');
    await klik(G, '[data-testid="foto-putar"]'); await G.waitForFunction((src) => { const e = document.querySelector('[data-testid="foto-bahan"]'); return e && e.getAttribute("src") !== src && e.complete && e.naturalWidth > 0; }, { timeout: 30000 }, sebelumPutar.src); await tidur(400);
    const sesudahPutar = await dimGambar(G, '[data-testid="foto-bahan"]');
    ok("putar 90°: dimensi bertukar (1280×853 → 853×1280), URL baru", sesudahPutar.w === 853 && sesudahPutar.h === 1280 && sesudahPutar.src !== sebelumPutar.src, JSON.stringify(sesudahPutar));
    ok("URL foto sebelum diputar sudah dihapus dari penyimpanan (404)", (await status(G, sebelumPutar.src)) === 404);

    // ganti
    const inputGanti = await G.$('[data-testid="input-foto"]'); await inputGanti.uploadFile(gbr.potret);
    await G.waitForFunction((src) => { const e = document.querySelector('[data-testid="foto-bahan"]'); return e && e.getAttribute("src") !== src && e.complete && e.naturalWidth > 0; }, { timeout: 30000 }, sesudahPutar.src); await tidur(400);
    const sesudahGanti = await dimGambar(G, '[data-testid="foto-bahan"]');
    ok("ganti foto: foto baru 600×900 tampil, URL lama 404", sesudahGanti.w === 600 && sesudahGanti.h === 900 && (await status(G, sesudahPutar.src)) === 404 && (await status(G, sesudahGanti.src)) === 200, JSON.stringify(sesudahGanti));

    // tolak berkas bukan foto (di sisi klien, tanpa permintaan ke server)
    const jumlahReq = G.reqFoto.length; await (await G.$('[data-testid="input-foto"]')).uploadFile(gbr.teks); await ada(G, '[data-testid="foto-galat"]');
    ok("berkas bukan foto ditolak dengan pesan jelas, tanpa memanggil server, foto lama tetap", /bukan foto/.test(await teks(G, '[data-testid="foto-galat"]')) && G.reqFoto.length === jumlahReq && (await dimGambar(G, '[data-testid="foto-bahan"]')).src === sesudahGanti.src);

    // hapus: batal lalu ya
    await klik(G, '[data-testid="foto-hapus"]'); await ada(G, '[data-testid="foto-hapus-konfirmasi"]');
    await jepret(G, "d-konfirmasi-hapus");
    await G.evaluate(() => [...document.querySelectorAll('[data-testid="foto-hapus-konfirmasi"] button')].find((b) => /Batal/.test(b.textContent)).click()); await tidur(300);
    ok("Batal pada konfirmasi: foto tetap ada", !!(await G.$('[data-testid="foto-bahan"]')) && !(await G.$('[data-testid="foto-hapus-konfirmasi"]')));
    await klik(G, '[data-testid="foto-hapus"]'); await klik(G, '[data-testid="foto-hapus-ya"]'); await ada(G, '[data-testid="foto-kosong"]', 30000); await tidur(500);
    ok("Ya, hapus: kartu kembali kosong, ikon kelompok kembali di header, URL foto 404", !(await G.$('[data-testid="foto-bahan"]')) && !(await G.$('[data-testid="drawer-bahan"] [data-foto="1"]')) && (await status(G, sesudahGanti.src)) === 404);
    ok("stok dan harga tetap sama setelah seluruh rangkaian foto", (await teks(G, '[data-testid="stok-tersedia"]')) === stokSebelum && (await teks(G, '[data-testid="header-harga"]')) === hargaSebelum);
    ok("tanpa galat JS (Gudang)", G.galat.length === 0, G.galat.join("|"));

    // pemakai tanpa izin ubah bahan
    const F = await buka(browser, "finance", "/warehouse/inventory?q=SBX-HR-N44"); await klik(F, 'button[data-testid="baris-stok"]'); await ada(F, '[data-testid="kartu-foto"]'); await tidur(500);
    await (await F.$('[data-testid="input-foto"]')).uploadFile(gbr.besar); await ada(F, '[data-testid="foto-galat"]', 40000);
    const g = await teks(F, '[data-testid="foto-galat"]');
    ok("peran tanpa izin ubah bahan: pesan izin jelas, tidak ada foto tersimpan", /izin/i.test(g) && !(await F.$('[data-testid="foto-bahan"]')), g);

    // HP + gelap
    await G.goto(BASE + "/warehouse/inventory?q=SBX-HR-N44", { waitUntil: "domcontentloaded" }); await ada(G, 'button[data-testid="baris-stok"]'); await tidur(500);
    await klik(G, 'button[data-testid="baris-stok"]'); await ada(G, '[data-testid="kartu-foto"]'); await (await G.$('[data-testid="input-foto"]')).uploadFile(gbr.besar); await ada(G, '[data-testid="foto-bahan"]', 40000);
    const H = await buka(browser, "gudang", "/warehouse/inventory?q=SBX-HR-N44", { lebar: 390, tinggi: 844, hp: true });
    ok("HP: daftar tanpa gulir horizontal, thumbnail tampil", await tanpaGulir(H) && !!(await H.$('button[data-testid="baris-stok"] [data-foto="1"]')));
    await jepret(H, "e-daftar-hp");
    await klik(H, 'button[data-testid="baris-stok"]'); await ada(H, '[data-testid="foto-bahan"]'); await tidur(900);
    ok("HP: drawer tanpa gulir horizontal; tombol foto ≥ 44px", await tanpaGulir(H) && (await tinggiTombol(H, '[data-testid="foto-unggah"]')) >= 44 && (await tinggiTombol(H, '[data-testid="foto-putar"]')) >= 44 && (await tinggiTombol(H, '[data-testid="foto-hapus"]')) >= 44, `${await tinggiTombol(H, '[data-testid="foto-unggah"]')}`);
    ok("HP: input foto menawarkan kamera/galeri (accept=image/*)", (await H.$eval('[data-testid="input-foto"]', (e) => e.getAttribute("accept"))) === "image/*");
    await H.evaluate(() => document.querySelector('[data-testid="kartu-foto"]').scrollIntoView({ block: "center" })); await tidur(300); await jepret(H, "f-drawer-hp");
    const D = await buka(browser, "gudang", "/warehouse/inventory?q=SBX-HR-N44", { tema: "dark" });
    await klik(D, 'button[data-testid="baris-stok"]'); await ada(D, '[data-testid="foto-bahan"]'); await tidur(900);
    await D.evaluate(() => document.querySelector('[data-testid="kartu-foto"]').scrollIntoView({ block: "center" })); await tidur(300); await jepret(D, "g-drawer-gelap");
    await jepret(await (async () => { await D.keyboard.press("Escape"); await tidur(800); return D; })(), "h-daftar-gelap");
    ok("tanpa galat JS (HP, gelap)", H.galat.length === 0 && D.galat.length === 0, [...H.galat, ...D.galat].join("|"));
  } catch (e) { gagal++; console.log("FAIL  galat tak terduga —", String(e).slice(0, 400)); }
  await browser.close();
  console.log(gagal === 0 ? "\nSEMUA PASS" : `\n${gagal} GAGAL`); process.exit(gagal ? 1 : 0);
})();
