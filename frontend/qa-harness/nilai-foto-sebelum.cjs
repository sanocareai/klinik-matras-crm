// Tangkapan "sebelum" (kode live) untuk perbandingan: desktop + HP, Finance.
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, buka, tunggu, tidur } = U; const path = require("path"); const fs = require("fs");
const OUT = path.join(process.env.OUT || "C:/tmp/nilai-apple-qa", "shots-sebelum"); fs.mkdirSync(OUT, { recursive: true });
(async () => { const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  for (const [n, w, h, hp] of [["d-terang", 1440, 1000, false], ["h-atas", 390, 844, true]]) { const p = await buka(b, "finance", "/warehouse/nilai-persediaan", { lebar: w, tinggi: h, hp }); await tunggu(p, '[data-testid="np-k1"]'); await tidur(500); await p.screenshot({ path: path.join(OUT, n + ".png"), fullPage: true }); await p.close(); }
  await b.close(); })();
