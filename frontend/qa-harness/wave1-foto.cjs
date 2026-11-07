// QA Gelombang 1 (Main Hub, Delivery, All Teams): gelap, HP, ikon info (klik + keyboard + sentuh), tanpa gulir samping & galat.
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, T, BASE, tidur } = U; const path = require("path"); const fs = require("fs");
const OUT = path.join(process.env.OUT || "C:/tmp/nilai-apple-qa", "wave1"); fs.mkdirSync(OUT, { recursive: true }); let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 200) : ""}`); };
const HALAMAN = [["hub", "/portal"], ["delivery", "/armada/dashboard"], ["allteams", "/kendali"]];
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const buka = async (rute, { w = 1440, h = 900, hp = false, tema = "light" } = {}) => { const p = await b.newPage(); await p.setViewport({ width: w, height: h, isMobile: hp, hasTouch: hp }); p.galat = [];
    await p.evaluateOnNewDocument((token, user, t) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("pwa-install-dismissed", "1"); localStorage.setItem("sano-theme", t); } catch {} }, T.owner.token, { ...T.owner.user, role: "ADMIN", roles: ["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "SALES"] }, tema);
    p.on("pageerror", (e) => p.galat.push(String(e).slice(0, 100))); await p.goto(BASE + rute, { waitUntil: "networkidle2", timeout: 40000 }); await tidur(1500); return p; };
  for (const [n, r] of HALAMAN) {
    let p = await buka(r, { tema: "dark" }); await p.screenshot({ path: path.join(OUT, `${n}-gelap.png`) }); ok(`${n} gelap: tanpa galat skrip`, p.galat.length === 0, p.galat.join("|")); await p.close();
    p = await buka(r, { w: 390, h: 844, hp: true }); await p.screenshot({ path: path.join(OUT, `${n}-hp.png`), fullPage: true });
    ok(`${n} HP: tanpa gulir samping`, await p.evaluate(() => document.scrollingElement.scrollWidth <= innerWidth + 1)); ok(`${n} HP: tanpa galat skrip`, p.galat.length === 0, p.galat.join("|")); await p.close();
    p = await buka(r); const info = await p.$('[data-testid="ap-info"]');
    if (info) { await info.click(); await tidur(250); const t1 = await p.evaluate(() => !!document.querySelector('[data-testid="ap-info-isi"]')); await p.screenshot({ path: path.join(OUT, `${n}-info.png`) });
      await p.keyboard.press("Escape"); await tidur(200); const t2 = await p.evaluate(() => !document.querySelector('[data-testid="ap-info-isi"]'));
      await p.focus('[data-testid="ap-info"]'); await p.keyboard.press("Enter"); await tidur(200); const t3 = await p.evaluate(() => !!document.querySelector('[data-testid="ap-info-isi"]') && document.querySelector('[data-testid="ap-info"]').getAttribute("aria-expanded") === "true");
      ok(`${n}: ikon info terbuka lewat KLIK, tutup lewat Esc, terbuka lewat KEYBOARD (Enter, aria-expanded)`, t1 && t2 && t3, `${t1}/${t2}/${t3}`); } else ok(`${n}: ada ikon info`, false);
    await p.close(); }
  // tujuan klik Delivery
  { const p = await buka("/armada/dashboard"); await p.evaluate(() => document.querySelector('[data-testid="ar-k-perlu"]').click()); await tidur(1200); ok("Delivery: kartu 'Perlu dijadwalkan' membuka /armada/jobs?status=UNSCHEDULED", /\/armada\/jobs\?status=UNSCHEDULED/.test(p.url()), p.url()); await p.close(); }
  { const p = await buka("/armada/dashboard"); await p.evaluate(() => document.querySelector('[data-testid="armada-buat-job"]').click()); await tidur(1200); ok("Delivery: 'Buat job' membuka /armada/jobs", /\/armada\/jobs/.test(p.url()), p.url()); await p.close(); }
  // Main Hub: klik kartu -> halaman kerja
  { const p = await buka("/portal"); const ada = await p.evaluate(() => [...document.querySelectorAll('[data-testid^="portal-"][role="button"]')].map((e) => e.dataset.testid)); await p.evaluate(() => document.querySelector('[data-testid^="portal-"][role="button"]').click()); await tidur(1500); ok("Main Hub: klik kartu workspace langsung ke halaman kerja (bukan hub per workspace)", ada.length > 0 && !/\/portal\//.test(p.url()) && !/\/portal$/.test(p.url()), `${ada.join(",")} -> ${p.url().replace(BASE, "")}`); await p.close(); }
  await b.close(); console.log(gagal ? `${gagal} GAGAL` : "semua lulus");
})();
