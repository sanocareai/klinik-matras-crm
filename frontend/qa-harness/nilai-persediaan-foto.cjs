// Tangkapan layar cepat Nilai Persediaan (desktop terang/gelap + HP) dari bundel build + backend QA terisolasi.
//   BASE=http://localhost:5492 API=http://127.0.0.1:4490 OUT=C:/tmp/nilai-apple-qa TAG=sesudah node frontend/qa-harness/nilai-persediaan-foto.cjs
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, buka, tunggu, tidur } = U;
const TAG = process.env.TAG || "sesudah"; const path = require("path"); const fs = require("fs");
const OUT = path.join(process.env.OUT || "C:/tmp/nilai-apple-qa", "shots-" + TAG); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const ambil = async (p, nama, penuh = true) => { await p.screenshot({ path: path.join(OUT, nama + ".png"), fullPage: penuh }); console.log("foto", nama); };
  try {
    let p = await buka(browser, "finance", "/warehouse/nilai-persediaan", { lebar: 1440, tinggi: 1000 }); await tunggu(p, '[data-testid="np-k1"]'); await tidur(500); await ambil(p, "d-terang");
    console.log("galat:", JSON.stringify(p.galat));
    await p.evaluate(() => document.querySelector('[data-testid="np-cakupan"] summary').click()); await tidur(300); await ambil(p, "d-terang-cakupan");
    await p.evaluate(() => document.querySelector('[data-testid="np-cakupan"] summary').click());
    await p.evaluate(() => document.querySelector('[data-testid="np-k1"] [data-testid="info-toggle"]').click()); await tidur(200); await ambil(p, "d-terang-info", false);
    await p.evaluate(() => document.querySelector('[data-testid="np-k1"] [data-testid="info-toggle"]').click());
    await p.evaluate(() => document.querySelector('[data-testid="buka-filter"]').click()); await tidur(300); await p.evaluate(() => document.querySelector('[data-testid="np-panel"]').scrollIntoView()); await tidur(200); await ambil(p, "d-terang-filter", false);
    await p.keyboard.press("Escape"); await tidur(200);
    await p.evaluate(() => document.querySelector('[data-testid="np-baris"] [data-testid="np-buka-baris"]').click()); await tidur(900); await ambil(p, "d-terang-drawer", false);
    await p.close();
    p = await buka(browser, "finance", "/warehouse/nilai-persediaan", { lebar: 1440, tinggi: 1000, tema: "dark" }); await tunggu(p, '[data-testid="np-k1"]'); await tidur(500); await ambil(p, "d-gelap"); await p.close();
    p = await buka(browser, "gudang", "/warehouse/nilai-persediaan", { lebar: 390, tinggi: 844, hp: true }); await tunggu(p, '[data-testid="np-k1"]'); await tidur(500); await ambil(p, "h-atas");
    await p.evaluate(() => document.querySelector('[data-testid="buka-filter"]').click()); await tidur(400); await ambil(p, "h-filter", false); await p.keyboard.press("Escape"); await tidur(200);
    await p.evaluate(() => document.querySelector('[data-testid="np-baris"] [data-testid="np-buka-baris"]').click()); await tidur(900); await ambil(p, "h-drawer", false);
    await p.close();
  } finally { await browser.close(); }
})();
