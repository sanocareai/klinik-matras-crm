// Screenshot mockup: mobile 390 px (berkas 01–06) dan desktop 1440 px (berkas d1–d2). Butuh puppeteer-core + Chrome lokal.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { createRequire } from "node:module";
const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(process.env.PUPPETEER_FROM || "C:/Users/rudya/Downloads/01_Project/01_Sano/SANO_02_Technology/SANO_KM_Hub/KM_SANSS-rencana-fix/frontend/package.json");
const puppeteer = require("puppeteer-core");
const out = path.join(here, "..", "screenshots-mockup"); fs.mkdirSync(out, { recursive: true });
const files = JSON.parse(fs.readFileSync(path.join(here, "files.json"), "utf8"));
const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
for (const n of files) {
  const desktop = n.startsWith("d");
  const page = await browser.newPage();
  await page.setViewport(desktop ? { width: 1440, height: 900 } : { width: 390, height: 844, deviceScaleFactor: 2 });
  await page.goto(pathToFileURL(path.join(here, `${n}.html`)).href, { waitUntil: "load" });
  if (!desktop) await page.screenshot({ path: path.join(out, `${n}_390_viewport.png`) }); // tampilan nyata: tombol utama & navigasi lengket di bawah
  if (!desktop) await page.addStyleTag({ content: ".bar,.nav{position:static!important}.bar{background:none}.app{padding-bottom:0!important}" }); // versi panjang: bar/nav di akhir halaman
  await page.screenshot({ path: path.join(out, `${n}${desktop ? "_1440" : "_390"}.png`), fullPage: true });
  await page.close();
}
await browser.close();
console.log(files.length, "screenshot ditulis ke", out);
