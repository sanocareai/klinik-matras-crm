// QA Gelombang 2 (B2B, Komplain, halaman Delivery lain): bundel hasil build + backend QA sandbox untuk sesi/rute umum; /api/complaints* dan /api/b2b/orders DIISI DATA UJI lewat intersepsi
// (backend QA tidak memasang rute itu). Memeriksa: tampilan terisi, filter tahap, ikon info (klik/keyboard/sentuh), gelap, HP tanpa gulir samping, tanpa galat skrip, dan perubahan tipografi tidak bocor ke Sales.
//   BASE=http://localhost:5492 OUT=C:/tmp/nilai-apple-qa node frontend/qa-harness/wave2-browser.cjs
const U = require("./gudang-qa-util.cjs"); const { puppeteer, CHROME, T, BASE, tidur } = U; const path = require("path"); const fs = require("fs");
const OUT = path.join(process.env.OUT || "C:/tmp/nilai-apple-qa", "wave2"); fs.mkdirSync(OUT, { recursive: true }); let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const hari = (n) => new Date(Date.now() - n * 86400000).toISOString();
const KASUS = [
  { id: "c1", caseNumber: "KMP-0001", category: "KUALITAS", severity: "TINGGI", status: "INVESTIGASI", currentOwner: "QC", description: "Kasur melendut di sisi kiri setelah dua minggu dipakai.", createdAt: hari(5), targetCompletionAt: hari(1), order: { orderNumber: "ORD-1001", customer: { name: "Ibu Sari" } }, unit: { unitCode: "U-77" } },
  { id: "c2", caseNumber: "KMP-0002", category: "PENGIRIMAN", severity: "SEDANG", status: "DALAM_PENANGANAN", currentOwner: "PRODUKSI", description: "Ukuran tidak sesuai pesanan.", createdAt: hari(3), targetCompletionAt: hari(-2), order: { orderNumber: "ORD-1002", customer: { name: "Pak Budi" } } },
  { id: "c3", caseNumber: "KMP-0003", category: "KUALITAS", severity: "RENDAH", status: "KONFIRMASI_CUSTOMER", currentOwner: "SALES", description: "Jahitan sudah diperbaiki, menunggu konfirmasi.", createdAt: hari(9), order: { orderNumber: "ORD-1003", customer: { name: "Bu Dewi" } } },
];
const RINGKASAN = { aktif: 3, riwayat: 12, lewatTarget: 1, prioritas: 1, perStatus: { INVESTIGASI: 1, DALAM_PENANGANAN: 1, KONFIRMASI_CUSTOMER: 1 } };
const B2B = [{ id: "b1", orderNumber: "B2B-0001", customer: { name: "PT Maju Jaya", tags: [] }, category: "KORPORAT", productType: "Kasur", merkKasur: "Sano", items: [], status: "CONFIRMED", paymentStatus: "UNPAID", createdAt: hari(2), notes: "" }];

(async () => {
  const b = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const buka = async (rute, { w = 1440, h = 900, hp = false, tema = "light", daftar = [] } = {}) => {
    const p = await b.newPage(); await p.setViewport({ width: w, height: h, isMobile: hp, hasTouch: hp }); p.galat = []; p.param = [];
    await p.evaluateOnNewDocument((token, user, t) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("pwa-install-dismissed", "1"); localStorage.setItem("sano-theme", t); } catch {} }, T.owner.token, { ...T.owner.user, role: "ADMIN", roles: ["ADMIN", "OWNER", "FINANCE", "WAREHOUSE", "SALES"] }, tema);
    await p.setBypassServiceWorker(true).catch(() => {}); // bundel produksi mendaftarkan SW: permintaan /api harus lewat intersepsi halaman
    await p.setRequestInterception(true);
    p.on("request", (r) => {
      const u = new URL(r.url()); const j = (o) => r.respond({ status: 200, contentType: "application/json", body: JSON.stringify(o) });
      if (u.pathname === "/api/complaints/ringkasan") return j(RINGKASAN);
      if (u.pathname === "/api/complaints") { p.param.push(u.search); const st = u.searchParams.get("statuses"); const d = st ? KASUS.filter((k) => st.split(",").includes(k.status)) : KASUS; return j({ cases: d, total: d.length, hasMore: false }); }
      if (u.pathname === "/api/b2b/orders") return j({ items: B2B });
      return r.continue();
    });
    p.on("pageerror", (e) => p.galat.push(String(e).slice(0, 120)));
    await p.goto(BASE + rute, { waitUntil: "networkidle2", timeout: 40000 }); await tidur(1200); return p;
  };
  const adaGulirSamping = (p) => p.evaluate(() => document.scrollingElement.scrollWidth > window.innerWidth + 1);

  // ── Komplain
  let p = await buka("/komplain"); await p.screenshot({ path: path.join(OUT, "komplain-terang.png") });
  ok("Komplain: 3 kartu kasus tampil", (await p.$$('[data-testid="kartu-komplain"]')).length === 3);
  ok("Komplain: 4 widget tahap berwarna", (await p.$$('[data-testid^="filter-tahap-"].ap-widget')).length === 4);
  ok("Komplain: angka tahap sesuai ringkasan (1/0/1/1... tahap1=1, tahap3=1, tahap4=1)", await p.evaluate(() => [1, 2, 3, 4].map((n) => document.querySelector(`[data-testid="filter-tahap-${n}"] .ap-w-angka`)?.textContent).join(",") === "1,0,1,1"));
  ok("Komplain: kasus lewat target & prioritas tetap diperingatkan", await p.evaluate(() => /lewat target/.test(document.querySelector('[data-testid="peringatan"]')?.textContent || "")));
  ok("Komplain: judul memakai kepala Apple", await p.evaluate(() => !!document.querySelector("header.ap-kepala h1.page-title")));
  await p.click('[data-testid="filter-tahap-3"]'); await tidur(700);
  ok("Komplain: klik tahap 3 → permintaan memakai statuses tahap 3 & kartu tersaring", p.param.some((q) => /statuses=/.test(q) && /DALAM_PENANGANAN/.test(q)) && (await p.$$('[data-testid="kartu-komplain"]')).length === 1, p.param.join(" "));
  ok("Komplain: tombol tahap menandai aria-pressed", await p.evaluate(() => document.querySelector('[data-testid="filter-tahap-3"]').getAttribute("aria-pressed") === "true"));
  ok("Komplain: tanpa galat skrip", p.galat.length === 0, p.galat.join("|")); await p.close();

  p = await buka("/komplain", { tema: "dark" }); await p.screenshot({ path: path.join(OUT, "komplain-gelap.png") }); ok("Komplain gelap: tanpa galat", p.galat.length === 0, p.galat.join("|")); await p.close();
  p = await buka("/komplain", { w: 390, h: 844, hp: true }); await p.screenshot({ path: path.join(OUT, "komplain-hp.png") });
  ok("Komplain HP: tanpa gulir samping", !(await adaGulirSamping(p))); ok("Komplain HP: tanpa galat", p.galat.length === 0, p.galat.join("|")); await p.close();

  // ── B2B
  p = await buka("/b2b"); await p.screenshot({ path: path.join(OUT, "b2b-terang.png") });
  ok("B2B: kerangka Apple aktif (ap-skin)", await p.evaluate(() => !!document.querySelector(".app-shell.ap-skin")));
  ok("B2B: ringkasan 3 widget berwarna", await p.evaluate(() => document.querySelectorAll(".ap-hero .ap-widget").length === 3));
  ok("B2B: angka ringkasan tampil (order aktif = 1)", await p.evaluate(() => document.querySelector(".ap-hero .ap-widget .ap-w-angka")?.textContent.trim() === "1"));
  // ikon info judul halaman: klik / Esc / keyboard
  const adaInfo = await p.$('header.ap-kepala [data-testid="ap-info"]'); ok("B2B: penjelasan panjang ada di ikon info (bukan teks tetap)", !!adaInfo && await p.evaluate(() => !/Hanya Gilang, Juri/.test(document.querySelector("header.ap-kepala").textContent)));
  if (adaInfo) {
    await adaInfo.click(); await tidur(200); ok("B2B: klik ikon info membuka penjelasan", await p.evaluate(() => /Hanya Gilang, Juri, dan Kemal/.test(document.querySelector('[data-testid="ap-info-isi"]')?.textContent || "")));
    await p.keyboard.press("Escape"); await tidur(150); ok("B2B: Esc menutup", !(await p.$('[data-testid="ap-info-isi"]')));
    await p.focus('header.ap-kepala [data-testid="ap-info"]'); await p.keyboard.press("Enter"); await tidur(200); ok("B2B: keyboard (Enter) membuka", !!(await p.$('[data-testid="ap-info-isi"]')));
  }
  ok("B2B: tanpa galat skrip", p.galat.length === 0, p.galat.join("|")); await p.close();
  p = await buka("/b2b", { w: 390, h: 844, hp: true }); await p.screenshot({ path: path.join(OUT, "b2b-hp.png") });
  ok("B2B HP: tanpa gulir samping halaman", !(await adaGulirSamping(p))); await p.close();
  p = await buka("/b2b", { tema: "dark" }); await p.screenshot({ path: path.join(OUT, "b2b-gelap.png") }); ok("B2B gelap: tanpa galat", p.galat.length === 0, p.galat.join("|")); await p.close();

  // ── Delivery: halaman yang memakai komponen bersama
  for (const [nama, rute] of [["jobs", "/armada/jobs"], ["orders", "/armada/orders"], ["pod", "/armada/pod"], ["kendali-rute", "/armada/kendali-rute"], ["ringkasan", "/armada/ringkasan"], ["laporan", "/armada/reports"]]) {
    p = await buka(rute); const info = await p.evaluate(() => ({ kepala: !!document.querySelector("header.ap-kepala"), widget: document.querySelectorAll(".ap-widget").length, skin: !!document.querySelector(".app-shell.ap-skin") }));
    await p.screenshot({ path: path.join(OUT, `delivery-${nama}.png`) });
    ok(`Delivery ${nama}: kepala Apple + widget berwarna`, info.skin && info.kepala && info.widget >= 4, JSON.stringify(info)); ok(`Delivery ${nama}: tanpa galat skrip`, p.galat.length === 0, p.galat.join("|")); await p.close();
  }
  p = await buka("/armada/jobs", { w: 390, h: 844, hp: true }); await p.screenshot({ path: path.join(OUT, "delivery-jobs-hp.png") }); ok("Delivery jobs HP: tanpa gulir samping", !(await adaGulirSamping(p))); await p.close();
  p = await buka("/armada/jobs", { tema: "dark" }); await p.screenshot({ path: path.join(OUT, "delivery-jobs-gelap.png") }); ok("Delivery jobs gelap: tanpa galat", p.galat.length === 0, p.galat.join("|")); await p.close();

  // ── tidak bocor: Sales (Dashboard/Order) dan Gudang tetap tanpa kepala/ widget Apple dari komponen bersama
  for (const [nama, rute] of [["sales-order", "/orders"], ["sales-laporan", "/laporan"], ["gudang-stok", "/warehouse/inventory"], ["finance-dashboard", "/finance/dashboard"]]) {
    p = await buka(rute); const info = await p.evaluate(() => ({ skin: !!document.querySelector(".app-shell.ap-skin"), kepala: !!document.querySelector("header.ap-kepala"), hero: !!document.querySelector(".ap-hero") }));
    ok(`Tidak bocor: ${nama} tidak memakai kerangka/kepala/hero Apple`, !info.skin && !info.kepala && !info.hero, JSON.stringify(info)); await p.close();
  }
  await b.close(); console.log(`\n${gagal ? gagal + " GAGAL" : "semua lulus"}`); process.exit(gagal ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
