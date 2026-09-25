// QA geometri tabel Tagihan Supplier (B3.3.1) — Chrome sungguhan (puppeteer-core) terhadap build produksi + API MOCK.
// Tidak menyentuh data produksi. Pakai:
//   npx vite build --outDir <dist> --emptyOutDir && node qa-harness/tagihan-geometri.cjs <dist> [--shots <dir>]
// Assertion utama: untuk SETIAP baris, kotak (bounding box) tiap sel & isi sel yang saling bertetangga tidak boleh
// tumpang-tindih (right sel kiri <= left sel kanan) — bukan sekadar memeriksa scrollWidth tabel.
const puppeteer = require("puppeteer-core");
const http = require("http");
const fs = require("fs");
const path = require("path");

const dist = path.resolve(process.argv[2]);
const shotsIdx = process.argv.indexOf("--shots");
const shotsDir = shotsIdx > 0 ? path.resolve(process.argv[shotsIdx + 1]) : null;
const CHROME = process.env.CHROME_PATH || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const PANJANG = (n, c = "X") => c.repeat(n);
const bill = (i, o = {}) => ({
  id: `b${i}`, billNumber: `BILL-01092026-${String(i).padStart(3, "0")}`, supplierRef: `SCP-2609/0${i}`, supplierId: "s1",
  supplier: { id: "s1", name: "PT SINAR UTAMA MAKMUR" }, description: "PLASTIK PE UK 240XROLLX0,05 OR",
  billDate: "2026-09-01", dueDate: "2026-09-22", amount: 3671325, terbayar: 0, sisa: 3671325, status: "DISETUJUI",
  jenisTagihan: { kode: null, label: "Belum dipilih (tagihan lama)", lama: true }, goodsReceipt: null, ...o,
});
const BILLS = [
  bill(1),
  bill(2, { status: "MENUNGGU_APPROVAL", billNumber: "BILL-01092026-002" }),
  bill(3, { billNumber: "BILL-28082026-1234567", supplierRef: "REF-" + PANJANG(70), supplier: { id: "s2", name: "PT " + PANJANG(70, "MITRA ") }, description: PANJANG(220, "Keterangan sangat panjang ") }),
  bill(4, { status: "LUNAS", terbayar: 18672864, sisa: 0, amount: 18672864, supplierRef: null }),
  bill(5, { billNumber: "BILL-20072026-004", amount: 35505600, sisa: 35505600, dueDate: null, jenisTagihan: { kode: "BAHAN_BAKU", label: "Bahan Baku / Stok", lama: false } }),
];
const API = {
  "/api/finance/suppliers": { suppliers: [{ id: "s1", code: "SUP-001", name: "PT SINAR UTAMA MAKMUR", active: true }] },
  "/api/finance/bills": { bills: BILLS },
  "/api/finance/supplier-payments": { payments: [] },
  "/api/finance/payables": { total: 0, baris: [] },
  "/api/finance/bills/unbilled-receipts": { receipts: [] },
  "/api/finance/expense-categories": { categories: [] },
  "/api/finance/cash-accounts": { accounts: [] },
  "/api/finance/purchase-categories": { categories: [] },
};

const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".svg": "image/svg+xml", ".json": "application/json", ".woff2": "font/woff2", ".png": "image/png" };
const srv = http.createServer((req, res) => {
  const u = req.url.split("?")[0];
  if (u.startsWith("/api/")) {
    res.setHeader("Content-Type", "application/json");
    return res.end(JSON.stringify(API[u] ?? {}));
  }
  let f = path.join(dist, u);
  if (!f.startsWith(dist) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) f = path.join(dist, "index.html");
  res.setHeader("Content-Type", MIME[path.extname(f)] || "application/octet-stream");
  fs.createReadStream(f).pipe(res);
});

const VIEWPORTS = [
  { nama: "1920", width: 1920, height: 1000, dpr: 1 },
  { nama: "1440", width: 1440, height: 900, dpr: 1 },
  { nama: "1280", width: 1280, height: 800, dpr: 1 },
  { nama: "1280-zoom150", width: 1280, height: 600, dpr: 1.5 },
  { nama: "853-zoom150", width: Math.round(1280 / 1.5), height: 600, dpr: 1.5 },
  { nama: "1840", width: 1840, height: 1000, dpr: 1 },
  { nama: "1600", width: 1600, height: 900, dpr: 1 },
  { nama: "1366", width: 1366, height: 768, dpr: 1 },
  { nama: "1100", width: 1100, height: 800, dpr: 1 },
  { nama: "390", width: 390, height: 844, dpr: 3, mobile: true },
];

// Dijalankan di halaman: ukur semua baris tabel Tagihan.
// Ekstensi kanan TEKS yang benar-benar tampak per sel: Range atas node teks, dipotong oleh ancestor ber-overflow (truncate/hidden)
// sampai batas <tr>. Sel pada table-fixed tidak pernah saling menimpa kotaknya — bug aslinya adalah TEKS yang meluber keluar sel.
function ukur() {
  const wrap = document.querySelector("[data-tier]") || document.querySelector("table")?.parentElement;
  const out = { tier: wrap?.dataset?.tier || (wrap ? "legacy" : undefined), barisTabel: 0, tumpang: [], pemotongan: [], scrollTabel: null, scrollHalaman: document.documentElement.scrollWidth - window.innerWidth, nomorPenuh: [] };
  const table = wrap?.querySelector("table");
  if (!table) return out;
  const tw = table.closest("div");
  out.scrollTabel = tw.scrollWidth - tw.clientWidth;
  const kananTampak = (td) => {
    let kanan = -Infinity;
    const w = document.createTreeWalker(td, NodeFilter.SHOW_TEXT);
    for (let n = w.nextNode(); n; n = w.nextNode()) {
      if (!n.textContent.trim()) continue;
      const r = document.createRange(); r.selectNodeContents(n);
      let x = r.getBoundingClientRect().right;
      for (let el = n.parentElement; el && el !== td.parentElement; el = el.parentElement) {
        if (getComputedStyle(el).overflowX !== "visible") x = Math.min(x, el.getBoundingClientRect().right);
      }
      kanan = Math.max(kanan, x);
    }
    return kanan;
  };
  const rows = [...table.querySelectorAll("tbody tr")];
  out.barisTabel = rows.length;
  rows.forEach((tr, ri) => {
    const tds = [...tr.children].filter((td) => td.getBoundingClientRect().width > 0);
    for (let i = 0; i + 1 < tds.length; i++) {
      const a = tds[i].getBoundingClientRect(), b = tds[i + 1].getBoundingClientRect();
      if (a.right > b.left + 0.5) out.tumpang.push({ baris: ri, sel: i, jenis: "sel", kanan: a.right, kiri: b.left });
      const teks = kananTampak(tds[i]);
      if (teks > b.left + 0.5) out.tumpang.push({ baris: ri, sel: i, jenis: "teks", kanan: Math.round(teks * 10) / 10, kiri: b.left });
    }
    for (const el of tr.querySelectorAll("[data-sel]")) {
      if (el.scrollWidth > el.clientWidth + 0.5 && !el.title) out.pemotongan.push({ baris: ri, alasan: "terpotong tanpa title" });
    }
    const nm = tr.querySelector('[data-sel="nomor"]');
    // nomor lengkap harus terbaca lewat title bila terpotong; bila muat penuh, tidak perlu terpotong sama sekali
    out.nomorPenuh.push(nm ? nm.title === nm.textContent : tr.children[0].textContent.trim().length > 0);
    // Nomor standar (BILL-DDMMYYYY-NNN) harus tampil UTUH, tanpa ellipsis
    const std = /^BILL-d{8}-d{3}$/.test(tr.children[0].textContent.trim());
    if (std && nm && nm.scrollWidth > nm.clientWidth + 0.5) out.pemotongan.push({ baris: ri, alasan: "nomor standar terpotong" });
  });
  return out;
}

(async () => {
  await new Promise((r) => srv.listen(0, r));
  const base = `http://127.0.0.1:${srv.address().port}`;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  let gagal = 0;
  const laporan = [];
  for (const vp of VIEWPORTS) {
    const page = await browser.newPage();
    await page.setViewport({ width: vp.width, height: vp.height, deviceScaleFactor: vp.dpr, isMobile: !!vp.mobile, hasTouch: !!vp.mobile });
    await page.evaluateOnNewDocument(() => {
      localStorage.setItem("token", "t");
      localStorage.setItem("user", JSON.stringify({ id: "u1", name: "Tester", email: "t@x.id", role: "ADMIN", roles: ["ADMIN"] }));
    });
    await page.goto(`${base}/finance/suppliers`, { waitUntil: "networkidle0" });
    await page.waitForSelector("[data-tier], table", { timeout: 15000 }).catch(() => {});
    await sleep(600);
    const r = await page.evaluate(ukur);
    if (shotsDir) { fs.mkdirSync(shotsDir, { recursive: true }); await ((await page.$("[data-tier]")) || page).screenshot({ path: path.join(shotsDir, `tagihan-${vp.nama.replace("@", "-").replace("%", "")}.png`) }); }
    let menuOk = null;
    const btn = await page.$('[data-tier] button[aria-label="Aksi lain"]');
    if (btn) {
      await btn.click();
      await sleep(300);
      menuOk = await page.evaluate(() => {
        const m = document.querySelector('[role="menu"]');
        const b = document.querySelector('[data-tier] button[aria-label="Aksi lain"][aria-expanded="true"]') || document.querySelector('[data-tier] button[aria-label="Aksi lain"]');
        if (!m) return { terbuka: false };
        const mr = m.getBoundingClientRect(), br = b.getBoundingClientRect();
        const dekat = Math.abs(mr.top - br.bottom) < 40 || Math.abs(mr.bottom - br.top) < 40;
        const dalamLayar = mr.left >= -1 && mr.right <= window.innerWidth + 1 && mr.top >= -1 && mr.bottom <= window.innerHeight + 1;
        return { terbuka: true, dekat, dalamLayar };
      });
      await page.keyboard.press("Escape");
    }
    const scrollDesktopOk = vp.width < 1280 || (r.scrollTabel ?? 0) <= 0;
    const ok = r.tier && r.tumpang.length === 0 && r.pemotongan.length === 0 && r.scrollHalaman <= 0 && scrollDesktopOk
      && (r.tier === "card" || (r.nomorPenuh.length > 0 && r.nomorPenuh.every(Boolean))) && (menuOk === null || (menuOk.terbuka && menuOk.dekat && menuOk.dalamLayar));
    if (!ok) gagal++;
    laporan.push({ viewport: vp.nama, tier: r.tier, baris: r.barisTabel, tumpang: r.tumpang.length, scrollTabel: r.scrollTabel, scrollHalaman: r.scrollHalaman, menu: menuOk ? `${menuOk.terbuka ? "buka" : "TIDAK"}/${menuOk.dekat ? "anchor" : "JAUH"}` : "-", hasil: ok ? "LULUS" : "GAGAL", detail: ok ? undefined : { tumpang: r.tumpang.slice(0, 3), pemotongan: r.pemotongan.slice(0, 3), menuOk } });
    await page.close();
  }
  console.table(laporan.map(({ detail, ...x }) => x));
  for (const l of laporan) if (l.detail) console.log(l.viewport, JSON.stringify(l.detail));
  await browser.close();
  srv.close();
  console.log(gagal === 0 ? "GEOMETRI: SEMUA LULUS" : `GEOMETRI: ${gagal} viewport GAGAL`);
  process.exit(gagal === 0 ? 0 : 1);
})().catch((e) => { console.error(e); process.exit(2); });
