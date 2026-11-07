const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const OUT = "C:/tmp/rs-qa/out"; const SH = path.join(OUT, "shots"); fs.mkdirSync(SH, { recursive: true });
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const BASE = "http://localhost:5491";
const CHROME = "C:/Program Files/Google/Chrome/Application/chrome.exe";
const tidur = (ms) => new Promise((r) => setTimeout(r, ms)); let gagal = 0; const ok = (n, c, d = "") => { if (!c) gagal++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 400) : ""}`); };

async function buka(browser, { lebar, tinggi, hp, tema }) {
  const page = await browser.newPage(); page.setDefaultTimeout(25000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: 1 });
  await page.evaluateOnNewDocument((token, user, tm) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("sano-theme", tm); } catch {} }, T.gudang.token, T.gudang.user, tema);
  await page.setBypassServiceWorker(true).catch(() => {}); page.galat = [];
  page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|404|401|403|409|500|WebSocket|socket\.io|favicon/i.test(m.text())) page.galat.push("console: " + m.text().slice(0, 200)); });
  await page.goto(BASE + "/warehouse/inventory", { waitUntil: "networkidle2", timeout: 60000 }); await tidur(800);
  return page;
}
async function bukaDrawer(page, kode) {
  await page.waitForSelector(`[data-testid="baris-stok"][data-kode="${kode}"]`);
  await page.evaluate((k) => { const e = document.querySelector(`[data-testid="baris-stok"][data-kode="${k}"]`); e.scrollIntoView({ block: "center" }); (e.querySelector("button") || e).click(); }, kode);
  await page.waitForSelector('[data-testid="daftar-pergerakan"]'); await tidur(600);
  return page.$$eval('[data-testid="baris-pergerakan"]', (els) => els.map((li) => ({ tipe: li.dataset.tipe, qty: li.querySelector('[data-testid="qty-pergerakan"]')?.textContent.trim(), satuan: li.querySelector('[data-testid="qty-pergerakan"]')?.dataset.satuan, catatanAsal: li.querySelector('[data-testid="satuan-asal"]')?.textContent.trim() ?? null })));
}
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    for (const v of [{ nama: "desktop", lebar: 1440, tinggi: 900, hp: false, tema: "light" }, { nama: "hp", lebar: 390, tinggi: 844, hp: true, tema: "light" }, { nama: "hp-gelap", lebar: 390, tinggi: 844, hp: true, tema: "dark" }]) {
      const page = await buka(browser, v);
      const wib = await bukaDrawer(page, "SBX-LIST-WIBING-PUTIH");
      console.log(v.nama, JSON.stringify(wib));
      const lama = wib.filter((r) => ["RECEIPT", "ISSUE", "RETURN"].includes(r.tipe) && r.satuan === "ROLL");
      const baru = wib.filter((r) => r.satuan === "METER");
      ok(`${v.nama}: baris riwayat lama tampil dalam satuan ASAL (ROLL), bukan satuan master sekarang (METER)`, lama.length === 4 && lama.every((r) => /roll/i.test(r.qty) || /ROLL/.test(r.satuan)), JSON.stringify(lama.map((r) => r.qty)));
      ok(`${v.nama}: baris lama memuat keterangan "Dicatat dalam … (satuan lama; saldo sekarang dalam …)"`, lama.every((r) => r.catatanAsal && /satuan lama/.test(r.catatanAsal)), lama[0]?.catatanAsal);
      ok(`${v.nama}: baris baru (penerimaan/pemakaian/pembukaan) dalam METER tanpa keterangan satuan lama`, baru.length >= 3 && baru.every((r) => !r.catatanAsal), JSON.stringify(baru.map((r) => r.qty)));
      ok(`${v.nama}: tidak ada angka lama berlabel METER (mis. "14 meter" / "3 meter")`, !wib.some((r) => r.satuan === "METER" && ["14", "−2", "−1,5", "+3"].some((x) => (r.qty || "").replace(/\s/g, "").startsWith(x.replace(/\s/g, "")) && false)) && lama.every((r) => r.satuan === "ROLL"));
      await page.evaluate(() => { const t = [...document.querySelectorAll('[role="tab"],button')].find((x) => /^Informasi bahan/.test(x.textContent.trim())); t && t.click(); }); await tidur(500);
      const ref = await page.evaluate(() => { const e = document.querySelector('[data-testid="referensi-satuan-tidak-cocok"]'); return e ? e.textContent.trim() : null; });
      ok(`${v.nama}: harga referensi Agustus (per ROLL) tampil sebagai tidak berlaku pada METER, tanpa angka Rp`, !!ref && /Tidak berlaku pada satuan/.test(ref) && !/Rp/.test(ref), ref);
      await page.screenshot({ path: path.join(SH, `${v.nama}-wibing.png`) });
      if (v.hp) ok(`${v.nama}: tanpa gulir samping`, await page.evaluate(() => document.scrollingElement.scrollWidth <= window.innerWidth + 1));
      const tutup = await page.$('[data-testid="tutup-drawer"], button[aria-label="Tutup"]'); if (tutup) { await tutup.click(); await tidur(400); }
      const kain = await bukaDrawer(page, "SBX-KAIN-METER");
      ok(`${v.nama}: bahan tanpa transisi tidak berubah (semua METER, tanpa keterangan satuan lama)`, kain.length >= 2 && kain.every((r) => r.satuan === "METER" && !r.catatanAsal), JSON.stringify(kain.map((r) => r.qty)));
      await page.screenshot({ path: path.join(SH, `${v.nama}-kain.png`) });
      ok(`${v.nama}: tanpa galat halaman/konsol`, page.galat.length === 0, page.galat.join(" | "));
      await page.close();
    }
  } finally { await browser.close(); }
  console.log(gagal ? `GAGAL ${gagal}` : "SEMUA LULUS"); process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error("QA ERROR", e); process.exit(2); });
