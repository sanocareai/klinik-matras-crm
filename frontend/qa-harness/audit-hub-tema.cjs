// Audit: halaman hub per workspace (/portal/:key) dan ketahanan tema gelap saat refresh.
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, T, BASE, tidur } = U; const path = require("path"); const fs = require("fs");
const OUT = path.join(process.env.OUT || "C:/tmp/nilai-apple-qa", "audit"); fs.mkdirSync(OUT, { recursive: true });
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const sesi = async (p, tema) => { await p.setViewport({ width: 1440, height: 900 }); await p.evaluateOnNewDocument((token, user, t) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("pwa-install-dismissed", "1"); if (t) localStorage.setItem("sano-theme", t); } catch {} }, T.owner.token, { ...T.owner.user, role: "ADMIN", roles: ["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "SALES"] }, tema); await p.setCacheEnabled(false); };
  for (const k of ["warehouse", "finance", "growth", "bengkel", "armada", "kendali", "b2b"]) { const p = await b.newPage(); await sesi(p); await p.goto(BASE + "/portal/" + k, { waitUntil: "networkidle2", timeout: 40000 }).catch(() => {}); await tidur(1500);
    const info = await p.evaluate(() => { const s = document.querySelector(".app-shell"); return { url: location.pathname, shell: s ? [...s.classList].filter((c) => /crm-skin|prod-skin|gud-skin|glass-division/.test(c)).join(" ") : "-", ws: document.querySelector("[data-testid=workspace-switcher], .workspace-switcher")?.innerText?.replace(/\s+/g, " ").slice(0, 40) ?? "-" }; });
    console.log("HUB", k.padEnd(10), JSON.stringify(info)); await p.screenshot({ path: path.join(OUT, "hub-" + k + ".png") }); await p.close(); }
  // tema gelap: tersimpan sebagai? lalu refresh
  for (const r of ["/warehouse/inventory", "/finance/invoices", "/portal", "/armada/dashboard"]) { const p = await b.newPage(); await sesi(p, "dark"); const rek = [];
    await p.goto(BASE + r, { waitUntil: "domcontentloaded" }).catch(() => {}); const t0 = Date.now(); let last = ""; while (Date.now() - t0 < 3500) { const s = await p.evaluate(() => `${document.documentElement.getAttribute("data-theme") || "-"}|${getComputedStyle(document.body).backgroundColor}`).catch(() => ""); if (s !== last) { rek.push(`${Date.now() - t0}ms ${s}`); last = s; } await tidur(80); }
    console.log("TEMA gelap", r.padEnd(26), rek.join("  →  ")); await p.close(); }
  await b.close();
})();
