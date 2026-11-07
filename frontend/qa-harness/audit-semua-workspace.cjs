// Audit visual baca-saja SEMUA workspace SANSS (bundel build + backend QA sandbox, data uji). Menangkap halaman utama tiap workspace dengan sesi ADMIN+OWNER.
//   BASE=http://localhost:5492 API=http://127.0.0.1:4490 OUT=C:/tmp/nilai-apple-qa node frontend/qa-harness/audit-semua-workspace.cjs
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, T, BASE, tidur } = U; const path = require("path"); const fs = require("fs");
const OUT = path.join(process.env.OUT || "C:/tmp/nilai-apple-qa", process.env.AUDIT_DIR || "audit"); fs.mkdirSync(OUT, { recursive: true });
const RUTE_BAWAAN = [
  ["main-hub", "/portal"], ["sales-dashboard", "/dashboard"], ["sales-inbox", "/inbox"], ["sales-pipeline", "/pipeline"], ["sales-orders", "/orders"], ["sales-laporan", "/laporan"],
  ["delivery-dashboard", "/armada/dashboard"], ["delivery-jobs", "/armada/jobs"], ["delivery-kendali-rute", "/armada/kendali-rute"], ["delivery-ringkasan", "/armada/ringkasan"], ["delivery-biaya", "/armada/biaya"],
  ["produksi-ringkasan", "/bengkel/ringkasan"], ["produksi-order", "/bengkel/order-produksi"], ["produksi-rencana", "/bengkel/rencana-produksi"],
  ["all-teams", "/kendali"], ["finance-dashboard", "/finance/dashboard"], ["finance-invoices", "/finance/invoices"], ["finance-kas", "/finance/cash"],
  ["gudang-beranda", "/warehouse/dashboard"], ["gudang-stok", "/warehouse/inventory"], ["b2b", "/b2b"], ["komplain", "/komplain"],
];
// RUTE_JSON=[["nama","/rute"],…] menimpa daftar bawaan (audit sebagian halaman).
const RUTE = process.env.RUTE_JSON ? JSON.parse(process.env.RUTE_JSON) : RUTE_BAWAAN;
(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  for (const [nama, rute] of RUTE) {
    const p = await b.newPage(); await p.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
    await p.evaluateOnNewDocument((token, user) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("pwa-install-dismissed", "1"); } catch {} }, T.owner.token, { ...T.owner.user, role: "ADMIN", roles: ["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "SALES"] });
    const galat = []; p.on("pageerror", (e) => galat.push(String(e).slice(0, 120)));
    try { await p.goto(BASE + rute, { waitUntil: "networkidle2", timeout: 45000 }); } catch (e) { galat.push("nav: " + e.message.slice(0, 60)); }
    await tidur(1800); await p.screenshot({ path: path.join(OUT, nama + ".png") });
    console.log(nama.padEnd(24), rute.padEnd(28), "galat:", galat.length ? galat.join(" | ") : "-"); await p.close();
  }
  await b.close();
})();
