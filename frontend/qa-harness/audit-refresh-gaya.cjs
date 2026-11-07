// Probe "UI kembali ke gaya lama saat refresh / dari Main Hub": rekam kelas .app-shell, font judul, dan status <html data-theme> tiap 120ms selama 5 dtk.
//   BASE=http://localhost:5492 OUT=C:/tmp/nilai-apple-qa node frontend/qa-harness/audit-refresh-gaya.cjs
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, T, BASE, tidur } = U;
const RUTE = ["/warehouse/dashboard", "/warehouse/inventory", "/warehouse/nilai-persediaan", "/finance/dashboard", "/finance/invoices", "/finance/cash", "/bengkel/ringkasan", "/dashboard", "/orders", "/pipeline", "/armada/dashboard", "/kendali", "/notifications", "/pengaturan", "/komplain"];
const SAMPEL = () => { const s = document.querySelector(".app-shell"); const h = document.querySelector("h1, .page-title, .t-page-title"); const css = (e) => (e ? getComputedStyle(e) : null);
  return { shell: s ? [...s.classList].filter((c) => /crm-skin|prod-skin|gud-skin|glass-division|sidebar-collapsed/.test(c)).sort().join(" ") : "(belum ada app-shell)", font: h ? css(h).fontFamily.split(",")[0].replace(/"/g, "").slice(0, 18) : "-", bodyFont: css(document.body).fontFamily.split(",")[0].replace(/"/g, "").slice(0, 18), tema: document.documentElement.getAttribute("data-theme") || "-" }; };
const rekam = async (p, ms = 5000) => { const t0 = Date.now(); const out = []; let last = ""; while (Date.now() - t0 < ms) { let s; try { s = await p.evaluate(SAMPEL); } catch { await tidur(60); continue; } const k = JSON.stringify(s); if (k !== last) { out.push({ t: Date.now() - t0, ...s }); last = k; } await tidur(120); } return out; };
const tampil = (nama, r) => { console.log("\n== " + nama); for (const x of r) console.log(`  ${String(x.t).padStart(5)}ms shell=[${x.shell}] judul=${x.font} body=${x.bodyFont} tema=${x.tema}`); const stabil = r[r.length - 1]; const berubah = new Set(r.map((x) => x.shell)).size > 1 || new Set(r.map((x) => x.font)).size > 1; console.log(berubah ? "  >>> BERUBAH selama muat (kilatan gaya)" : "  (stabil)"); };
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const sesi = async (p) => { await p.setViewport({ width: 1440, height: 900 }); await p.evaluateOnNewDocument((token, user) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("pwa-install-dismissed", "1"); } catch {} }, T.owner.token, { ...T.owner.user, role: "ADMIN", roles: ["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "SALES"] }); await p.setCacheEnabled(false); };
  for (const r of RUTE) { const p = await b.newPage(); await sesi(p); const gal = []; p.on("pageerror", (e) => gal.push(String(e).slice(0, 80)));
    const nav = p.goto(BASE + r, { waitUntil: "domcontentloaded" }).catch(() => {}); const rec = await rekam(p, 4500); await nav; tampil("MUAT LANGSUNG " + r + (gal.length ? " | galat: " + gal.join(";") : ""), rec); await p.close(); }
  // refresh (reload) pada halaman yang sudah terbuka
  for (const r of ["/warehouse/inventory", "/finance/invoices", "/bengkel/ringkasan"]) { const p = await b.newPage(); await sesi(p); await p.goto(BASE + r, { waitUntil: "networkidle2" }); await tidur(800); const nav = p.reload({ waitUntil: "domcontentloaded" }).catch(() => {}); const rec = await rekam(p, 4500); await nav; tampil("REFRESH " + r, rec); await p.close(); }
  // dari Main Hub klik kartu workspace
  { const p = await b.newPage(); await sesi(p); await p.goto(BASE + "/portal", { waitUntil: "networkidle2" }); await tidur(1200);
    const kartu = await p.evaluate(() => [...document.querySelectorAll("a, button")].map((e) => (e.innerText || "").trim().split("\n")[0]).filter((t) => /Gudang|Warehouse|Finance|Produksi|Production|Sales|Delivery/i.test(t)).slice(0, 12)); console.log("\nkartu/menu di Main Hub:", JSON.stringify(kartu));
    for (const kata of ["Warehouse", "Finance", "Production", "Sales"]) { await p.goto(BASE + "/portal", { waitUntil: "networkidle2" }); await tidur(900);
      const klik = await p.evaluate((k) => { const e = [...document.querySelectorAll("a, button, [role=link], [role=button]")].find((x) => new RegExp(k, "i").test(x.innerText || "") && x.offsetParent !== null && !/Notifikasi|Pengaturan/.test(x.innerText)); if (!e) return false; e.click(); return (e.innerText || "").trim().slice(0, 40); }, kata);
      const rec = await rekam(p, 4000); tampil("MAIN HUB -> klik '" + kata + "' (" + klik + ") url=" + (await p.url()).replace(BASE, ""), rec); }
    await p.close(); }
  await b.close();
})();
