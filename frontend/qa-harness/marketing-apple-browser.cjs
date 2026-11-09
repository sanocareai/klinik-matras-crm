// QA browser redesain Apple tab Marketing (10 Nov 2026): bundel HASIL BUILD (serve-dist) + backend ASLI di database FIXTURE terisolasi (marketing-server.mjs). Bukan production.
//   BASE=http://127.0.0.1:5195 API=http://127.0.0.1:4020 OUT=C:/tmp/km-mkt-ap-qa node frontend/qa-harness/marketing-apple-browser.cjs
// Memeriksa: angka layar = API (KPI, tiap baris sumber, total), saringan/cari/kolom/Filter hanya mengubah tampilan, menu Ekspor memuat tiga format lama,
// strip status, rincian Meta (Per campaign/Per kreatif, bantuan), dialog Kelola biaya, panel chat, tema terang/gelap, HP tanpa gulir mendatar, tanpa galat konsol.
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:5195"; const API = process.env.API || "http://127.0.0.1:4020"; const OUT = process.env.OUT || "C:/tmp/km-mkt-ap-qa";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8"));
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const P = "dari=2026-10-01&sampai=2026-10-10";
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const api = async (p) => (await fetch(API + p, { headers: { Authorization: `Bearer ${T.admin.token}` } })).json();
const ribu = (n) => Number(n).toLocaleString("id-ID");
const ringkas = (n) => { if (n == null) return "—"; const a = Math.abs(n); const f = (x) => x.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 }); return a >= 1e9 ? `Rp${f(a / 1e9)} M` : a >= 1e6 ? `Rp${f(a / 1e6)} jt` : `Rp${Math.round(a).toLocaleString("id-ID")}`; };

async function buka(browser, rute, { lebar = 1440, tinggi = 900, hp = false, gelap = false } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: gelap ? "dark" : "light" }]);
  await page.evaluateOnNewDocument((token, user, g) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); localStorage.setItem("sano-theme", g ? "dark" : "light"); localStorage.removeItem("mk-kolom-sumber"); } catch (e) {} }, T.admin.token, T.admin.user, gelap);
  page.galat = []; page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|404|401|403|WebSocket|socket\.io/i.test(m.text())) page.galat.push("console: " + m.text().slice(0, 160)); });
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
const foto = async (page, nama) => { const vp = page.viewport(); await page.setViewport({ ...vp, height: vp.isMobile ? 3600 : 2800 }); await tidur(600); await page.screenshot({ path: path.join(SHOTS, nama + ".png") }); await page.setViewport(vp); };
const teks = (page, s) => page.$eval(s, (e) => e.textContent.replace(/\s+/g, " ").trim()).catch(() => null);
const klik = async (page, s) => { await page.waitForSelector(s, { visible: true }); await page.click(s); await tidur(250); };
const tanpaGulirMendatar = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const lap = await api(`/api/atribusi/iklan/sumber?${P}`);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    // ── Ringkasan, terang, desktop ──────────────────────────────────────────
    let page = await buka(browser, `/laporan?tab=Marketing&${P}`);
    await page.waitForSelector('[data-testid="tabel-sumber"]', { visible: true, timeout: 45000 });
    ok("judul halaman = Marketing", (await teks(page, ".page-title")) === "Marketing");
    ok("KPI Total lead = API", (await teks(page, '[data-testid="kartu-lead"] .mk-kpi-nilai')) === ribu(lap.total.lead), await teks(page, '[data-testid="kartu-lead"]'));
    ok("KPI Total lead menyebut termasuk spam", /termasuk spam/.test(await teks(page, '[data-testid="kartu-lead"]')));
    ok("KPI Customer ber-order = API", (await teks(page, '[data-testid="kartu-berOrder"] .mk-kpi-nilai')) === ribu(lap.total.berOrder));
    ok("KPI Nilai order = API (ringkas)", (await teks(page, '[data-testid="kartu-nilai"] .mk-kpi-nilai')) === ringkas(lap.total.nilaiOrderSaatIni), await teks(page, '[data-testid="kartu-nilai"] .mk-kpi-nilai'));
    ok("KPI Uang diterima = API (ringkas)", (await teks(page, '[data-testid="kartu-uang"] .mk-kpi-nilai')) === ringkas(lap.total.uangBersih));
    ok("nilai penuh tersedia di title", (await page.$eval('[data-testid="kartu-nilai"] .mk-kpi-nilai', (e) => e.title)) === "Rp" + Math.round(lap.total.nilaiOrderSaatIni).toLocaleString("id-ID"));
    ok("Nilai order ≠ uang diterima: keterangan tertulis", /bukan uang diterima/.test(await teks(page, '[data-testid="kartu-nilai"]')));
    for (const s of lap.sumber) {
      const lead = await page.$eval(`[data-testid="baris-sumber-${s.id}"] td:nth-of-type(1)`, (e) => e.querySelector(".mk-sel-nilai").textContent.trim()).catch(() => null);
      ok(`baris ${s.id}: lead = API`, lead === ribu(s.lead), `${lead} vs ${s.lead}`);
    }
    ok("baris total lead = API", (await page.$eval('[data-testid="baris-total"] td', (e) => e.querySelector(".mk-sel-nilai").textContent.trim())) === ribu(lap.total.lead));
    const kepala = await page.$$eval('[data-testid="tabel-sumber"] thead th:not(.mk-panah)', (els) => els.map((e) => e.textContent.trim()).filter(Boolean));
    ok("kolom awal = Sumber, Lead, Ber-order, Nilai order, Uang diterima, Biaya iklan", kepala.join("|") === "Sumber|Total lead (+spam)|Customer ber-order|Nilai order|Uang diterima bersih|Biaya iklan", kepala.join("|"));
    const organikBiaya = await page.$eval('[data-testid="baris-sumber-WHATSAPP"] td:nth-of-type(5)', (e) => [e.textContent.trim(), e.title]).catch(() => null);
    ok("biaya sumber tanpa iklan = — (bukan Rp0) dengan penjelasan", organikBiaya && organikBiaya[0] === "—" && /bukan Rp0/.test(organikBiaya[1]), JSON.stringify(organikBiaya));
    const kelompok = await page.$$eval('[data-testid^="kelompok-"]', (els) => els.map((e) => e.textContent));
    ok("WhatsApp tanpa jejak di kelompok 'Sumber belum diketahui', bukan organik", kelompok.some((k) => k.startsWith("Sumber belum diketahui")) && !(await teks(page, '[data-testid="baris-sumber-WHATSAPP"]')).match(/organik/i));
    ok("Website tidak disebut organik", !/organik\b(?! )/.test((await teks(page, '[data-testid="baris-sumber-WEBSITE"]')) || "") || /belum tentu organik/.test(await teks(page, '[data-testid="baris-sumber-WEBSITE"]')));
    ok("logo Google Ads bukan huruf G (svg tiga bentuk)", (await page.$$eval('[data-testid="baris-sumber-GOOGLE"] [data-logo="GOOGLE"] svg > *', (e) => e.length)) === 3);
    ok("strip status tampil", !!(await page.$('[data-testid="strip-status"]')));
    await klik(page, '[data-testid="strip-rincian"]');
    ok("rincian strip terbuka", !!(await page.$(".mk-strip-rincian")));
    ok("halaman desktop tanpa gulir mendatar", await tanpaGulirMendatar(page));
    await foto(page, "01-ringkasan-terang-desktop");

    // saringan & cari hanya menyaring tampilan; total disembunyikan saat tersaring
    await klik(page, '[data-testid="saring-sumber-berbayar"]');
    const berbayar = await page.$$eval('[data-testid^="baris-sumber-"]', (els) => els.map((e) => e.dataset.testid.replace("baris-sumber-", "")));
    const harap = lap.sumber.filter((s) => s.kelompok === "Iklan berbayar").map((s) => s.id);
    ok("saring Iklan berbayar = sumber kelompok Iklan berbayar", JSON.stringify([...berbayar].sort()) === JSON.stringify([...harap].sort()), berbayar.join(","));
    ok("baris total disembunyikan saat tersaring", !(await page.$('[data-testid="baris-total"]')));
    await klik(page, '[data-testid="saring-sumber-semua"]');
    await page.type('[data-testid="cari-sumber"]', "tiktok"); await tidur(300);
    ok("cari 'tiktok' → hanya TikTok", JSON.stringify(await page.$$eval('[data-testid^="baris-sumber-"]', (els) => els.map((e) => e.dataset.testid))) === JSON.stringify(["baris-sumber-TIKTOK"]));
    await page.click('[data-testid="cari-sumber"]'); await page.keyboard.down("Control"); await page.keyboard.press("KeyA"); await page.keyboard.up("Control"); await page.keyboard.press("Backspace"); await tidur(300);
    ok("cari dikosongkan → semua sumber kembali", (await page.$$eval('[data-testid^="baris-sumber-"]', (els) => els.length)) === lap.sumber.length);
    // pilihan kolom
    await klik(page, '[data-testid="toggle-kolom"]');
    await klik(page, '[data-testid="kolom-lunas"]');
    const kepala2 = await page.$$eval('[data-testid="tabel-sumber"] thead th', (els) => els.map((e) => e.textContent.trim()));
    ok("pilih kolom Customer lunas → kolom muncul", kepala2.includes("Customer lunas"), kepala2.join("|"));
    await klik(page, '[data-testid="kolom-lengkap"]'); await tidur(400);
    ok("Semua kolom → URL kolom=lengkap, 16 kolom", /kolom=lengkap/.test(page.url()) && (await page.$$eval('[data-testid="tabel-sumber"] thead th', (els) => els.length)) === 18, page.url());
    await page.keyboard.press("Escape"); await tidur(200);
    await klik(page, '[data-testid="toggle-kolom"]'); await klik(page, '[data-testid="kolom-awal"]'); await page.keyboard.press("Escape"); await tidur(300);
    ok("Kolom awal → kembali 6 kolom", (await page.$$eval('[data-testid="tabel-sumber"] thead th', (els) => els.length)) === 7);
    // Filter
    await klik(page, '[data-testid="filter-sumber"]');
    ok("Filter memuat Bandingkan periode", !!(await page.$('[data-testid="toggle-banding"]')));
    await page.keyboard.press("Escape"); await tidur(200);
    // baris membuka rincian; tombol info tidak
    await klik(page, '[data-testid="info-META"]');
    ok("tombol info tidak membuka rincian", !/sumber=META/.test(page.url()) && !!(await page.$('[data-testid="pakem-META"]')));
    // menu Ekspor
    await klik(page, '[data-testid="menu-ekspor"]');
    const menu = await page.$$eval('[role="menuitem"]', (els) => els.map((e) => e.textContent.trim()));
    ok("menu Ekspor memuat tiga format lama", menu.length === 3 && menu.some((m) => /daftar chat/i.test(m)) && menu.some((m) => /laporan Marketing/i.test(m)) && menu.some((m) => /CSV/i.test(m)), menu.join(" | "));
    await foto(page, "02-menu-ekspor");
    await page.keyboard.press("Escape"); await tidur(200);
    // Kelola biaya
    await klik(page, '[data-testid="kelola-biaya"]');
    await page.waitForSelector('[role="dialog"].mk-ap-portal', { visible: true });
    ok("dialog Kelola biaya iklan terbuka dengan gaya Marketing", true);
    await page.screenshot({ path: path.join(SHOTS, "03-kelola-biaya.png") });
    await page.keyboard.press("Escape"); await tidur(300);
    // panel chat
    await klik(page, '[data-testid="lihat-chat-META"]');
    await page.waitForSelector('[data-testid="panel-chat"]', { visible: true });
    await page.waitForSelector('[data-testid="baris-chat"]', { visible: true, timeout: 20000 });
    ok("panel chat Meta: jumlah baris = lead (≤ satu halaman)", (await page.$$eval('[data-testid="baris-chat"]', (e) => e.length)) === Math.min(lap.sumber.find((s) => s.id === "META").lead, 50));
    await page.screenshot({ path: path.join(SHOTS, "04-panel-chat.png") });
    await page.keyboard.press("Escape"); await tidur(300);
    // buka rincian lewat baris
    await page.click('[data-testid="baris-sumber-META"] .mk-sumber-kategori'); await tidur(500);
    ok("klik baris membuka rincian Meta", /sumber=META/.test(page.url()));
    ok("tanpa galat konsol (ringkasan)", page.galat.length === 0, page.galat.join(" | "));

    // ── Rincian Meta ────────────────────────────────────────────────────────
    await page.waitForSelector('[data-testid="tabel-meta"]', { visible: true, timeout: 40000 });
    const m = lap.sumber.find((s) => s.id === "META");
    ok("ringkasan sumber Meta: lead = API", (await page.$eval('[data-testid="ringkas-sumber"] dd', (e) => e.textContent.trim())) === ribu(m.lead));
    ok("judul Per campaign", (await teks(page, '[data-testid="meta-detail"] h3')).startsWith("Per campaign"));
    ok("ID campaign bisa disalin", !!(await page.$('[data-testid="tabel-meta"] button[aria-label^="Salin ID"]')));
    await foto(page, "05-rincian-meta-terang");
    await klik(page, '[data-testid="tampilan-kreatif"]'); await tidur(800);
    ok("tampilan Per kreatif → judul ikut berubah", (await teks(page, '[data-testid="meta-detail"] h3')).startsWith("Per kreatif"));
    ok("bantuan teknis ada di bagian yang bisa dibuka", !!(await page.$('[data-testid="bagian-bantuan-meta"]')));
    ok("rincian label CRM dibungkus bagian yang bisa dibuka", !!(await page.$('[data-testid="bagian-rincian-label"]')));
    ok("tanpa galat konsol (rincian)", page.galat.length === 0, page.galat.join(" | "));
    await page.close();

    // ── Tema gelap ──────────────────────────────────────────────────────────
    page = await buka(browser, `/laporan?tab=Marketing&${P}`, { gelap: true });
    await page.waitForSelector('[data-testid="tabel-sumber"]', { visible: true, timeout: 45000 });
    ok("tema gelap aktif", (await page.evaluate(() => document.documentElement.getAttribute("data-theme"))) === "dark");
    await foto(page, "06-ringkasan-gelap");
    await page.goto(`${BASE}/laporan?tab=Marketing&${P}&sumber=META`); await page.waitForSelector('[data-testid="tabel-meta"]', { visible: true, timeout: 45000 });
    await foto(page, "07-rincian-meta-gelap");
    ok("tanpa galat konsol (gelap)", page.galat.length === 0, page.galat.join(" | "));
    await page.close();

    // ── HP 390 px ───────────────────────────────────────────────────────────
    page = await buka(browser, `/laporan?tab=Marketing&${P}`, { lebar: 390, tinggi: 844, hp: true });
    await page.waitForSelector('[data-testid="tabel-sumber"]', { visible: true, timeout: 45000 });
    ok("HP: halaman tanpa gulir mendatar", await tanpaGulirMendatar(page));
    await foto(page, "08-ringkasan-hp");
    ok("tanpa galat konsol (HP)", page.galat.length === 0, page.galat.join(" | "));
    await page.close();

    // ── tab lain tidak memakai gaya Marketing ───────────────────────────────
    page = await buka(browser, `/laporan?tab=Sales&${P}`);
    await tidur(2500);
    ok("tab Sales: tanpa kelas/penanda Marketing", await page.evaluate(() => !document.querySelector(".mk-ap-halaman") && !document.documentElement.hasAttribute("data-mk-ap")));
    ok("tab Sales: judul tetap Laporan Analitik", (await teks(page, ".page-title")) === "Laporan Analitik");
    await page.close();
  } catch (e) { gagal++; console.log("FAIL  galat skrip — " + (e?.stack || e).toString().slice(0, 400)); }
  finally { await browser.close(); }
  console.log(`\nSELESAI: ${gagal ? `${gagal} GAGAL` : "semua lulus"}; foto di ${SHOTS}`);
  process.exit(gagal ? 1 : 0);
})();
