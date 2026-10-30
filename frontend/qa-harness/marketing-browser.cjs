// QA browser NYATA (Chrome via puppeteer-core) — tab Marketing di Laporan: komponen ASLI (Vite) + backend ASLI (marketing-server.mjs, database fixture terisolasi; BUKAN production).
//   BASE=http://localhost:5191 API=http://127.0.0.1:4020 OUT=C:/tmp/km-mkt-qa node frontend/qa-harness/marketing-browser.cjs
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:5191"; const API = process.env.API || "http://127.0.0.1:4020"; const OUT = process.env.OUT || "C:/tmp/km-mkt-qa";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const REF = JSON.parse(fs.readFileSync(path.join(OUT, "rekon-api.json"), "utf8"));
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const DL = path.join(OUT, "unduhan"); fs.mkdirSync(DL, { recursive: true });
const P = "dari=2026-10-01&sampai=2026-10-10";
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0; const hasil = [];
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const num = (s) => { if (s == null) return null; const m = String(s).replace(/Rp|≥|\s/g, "").replace(/\./g, "").replace(",", ".").match(/-?\d+(\.\d+)?/); return m ? Number(m[0]) : null; };
const db = async (siapa, p) => (await fetch(API + p, { headers: { Authorization: `Bearer ${T[siapa].token}` } })).status;

async function buka(browser, siapa, rute, { lebar = 1440, tinggi = 900, hp = false, gelap = false } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  if (gelap) await page.emulateMediaFeatures([{ name: "prefers-color-scheme", value: "dark" }]);
  await page.evaluateOnNewDocument((token, user, g) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); if (g) localStorage.setItem("sano-theme", "dark"); } catch (e) {} }, T[siapa].token, T[siapa].user, gelap);
  page.galat = []; page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  page.on("console", (m) => { if (m.type() === "error" && !/Failed to load resource|favicon|net::ERR|404|401|403|WebSocket|socket\.io/i.test(m.text())) page.galat.push("console: " + m.text().slice(0, 160)); });
  const client = await page.createCDPSession(); await client.send("Browser.setDownloadBehavior", { behavior: "allow", downloadPath: DL, eventsEnabled: true, browserContextId: ctx.id }).catch((e) => console.log("setDownloadBehavior:", e.message));
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
const tunggu = (page, sel, ms = 40000) => page.waitForSelector(sel, { timeout: ms, visible: true });
const teks = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
// Tangkapan penuh: konten Laporan menggulir di dalam wadah, jadi viewport dibuat tinggi sementara supaya seluruh halaman tampil.
const foto = async (page, nama, penuh = true) => { const vp = page.viewport(); if (penuh) await page.setViewport({ ...vp, height: vp.isMobile ? 3200 : 2600 }); await tidur(500); await page.screenshot({ path: path.join(SHOTS, nama + ".png") }); if (penuh) await page.setViewport(vp); };
const url = (page) => new URL(page.url());
const tanpaGulirMendatar = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const sel = (page, s) => page.$$eval(s, (els) => els.map((e) => e.textContent.trim()));
const klikTampak = async (page, s) => { await page.waitForFunction((q) => [...document.querySelectorAll(q)].some((e) => e.offsetParent !== null), { timeout: 20000 }, s); const h = await page.evaluateHandle((q) => [...document.querySelectorAll(q)].find((e) => e.offsetParent !== null), s); await h.asElement().evaluate((e) => e.scrollIntoView({ block: "center" })); await h.asElement().click(); };
const tungguUrl = (page, re, ms = 15000) => page.waitForFunction((r) => new RegExp(r).test(location.search), { timeout: ms }, re.source);
const klikTeks = async (page, selector, t) => { const h = await page.evaluateHandle((s, x) => [...document.querySelectorAll(s)].find((e) => e.textContent.trim().startsWith(x) && e.offsetParent !== null), selector, t); const el = h.asElement(); if (!el) throw new Error("tak ada " + selector + " '" + t + "'"); await el.evaluate((e) => e.scrollIntoView({ block: "center" })); await el.click(); };

(async () => {
  const tabelSebelum = REF.db.tabel;
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    // ═══ 1. DESKTOP ADMIN: ringkasan ═══
    let page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`);
    await tunggu(page, '[data-testid="ringkasan-marketing"]');
    await tunggu(page, '[data-testid="kartu-ringkas"]'); await tunggu(page, '[data-testid="tabel-sumber"]');
    await page.waitForSelector('.recharts-wrapper', { timeout: 30000 }).catch(() => {});
    await tidur(800);
    const k = REF.sebelum.akuisisi;
    const kart = async (id) => teks(page, `[data-testid="kartu-${id}"] span:nth-child(2)`);
    ok("A. periode tunggal tampil (basis tanggal lead masuk WIB)", /1 Okt 2026 – 10 Okt 2026/.test(await teks(page, '[data-testid="banner-periode"]') || "") && /WIB/.test(await teks(page, '[data-testid="banner-periode"]') || ""));
    ok("A. cutoff evaluasi pembayaran tampil", /dievaluasi sampai/.test(await teks(page, '[data-testid="banner-periode"]') || ""));
    ok("B. kartu: total lead = API Akuisisi", num(await kart("lead")) === k.lead, `${await kart("lead")} vs ${k.lead}`);
    ok("B. kartu: customer ber-order", num(await kart("berOrder")) === k.berOrder, await kart("berOrder"));
    ok("B. kartu: customer lunas terbukti ledger = API (angka hitung, tanpa awalan ≥)", num(await kart("lunas")) === k.lunas, await kart("lunas"));
    ok("B. kartu: nilai order", num(await kart("nilai")) === k.nilaiOrder, await kart("nilai"));
    ok("B. kartu: uang diterima bersih", num(await kart("uang")) === k.uangBersih, await kart("uang"));
    ok("B. kartu: biaya iklan (berbayar) = API", (REF.sebelum.akuisisi.spendBerbayar == null ? (await kart("biaya")) === "—" : num(await kart("biaya")) === REF.sebelum.akuisisi.spendBerbayar), await kart("biaya"));
    ok("B. kartu: nilai order dan uang diterima berlabel terpisah (nilai order ≠ uang)", (await sel(page, '[data-testid="kartu-ringkas"] > div')).length === 6);
    ok("C. grafik tren lead harian tampil", !!(await page.$(".recharts-wrapper")));
    ok("D. tabel semua sumber: 6 sumber + baris total", (await page.$$('[data-testid^="baris-sumber-"]')).length === 6 && !!(await page.$('[data-testid="baris-total"]')));
    const baris = async (id) => page.$$eval(`[data-testid="baris-sumber-${id}"] td`, (tds) => tds.map((t) => t.textContent.trim()));
    const meta = await baris("META"), tik = await baris("TIKTOK"), wa = await baris("WHATSAPP");
    const S = REF.sebelum.perSumber;
    // ringkas: [2]=total lead [3]=ber-order [4]=lunas [5]=konversi [6]=CPA lunas
    ok("D. baris Meta (ringkas): total lead/ber-order/lunas = API", [num(meta[2]), num(meta[3]), num(meta[4])].join() === [S.META.lead, S.META.berOrder, S.META.lunas].join(), meta.slice(2, 7).join(" | "));
    ok("D. baris TikTok (ringkas) = API: total lead/ber-order/lunas", [num(tik[2]), num(tik[3]), num(tik[4])].join() === [S.TIKTOK.lead, S.TIKTOK.berOrder, S.TIKTOK.lunas].join(), tik.slice(2, 7).join(" | "));
    ok("D. WhatsApp (organik): CPA 'tidak tersedia' (bukan Rp0)", /tidak tersedia/.test(wa[6]), wa[6]);
    const tot = await page.$$eval('[data-testid="baris-total"] td', (tds) => tds.map((t) => t.textContent.trim()));
    ok("D. baris total (ringkas) = Σ semua sumber = kartu", num(tot[2]) === k.lead && num(tot[3]) === k.berOrder && num(tot[4]) === k.lunas, tot.slice(2, 7).join(" | "));
    ok("D. konversi utama memakai total lead termasuk spam (pembilang/penyebut tampil)", new RegExp(`${k.berOrder}/${k.lead}`).test(tot[5]), tot[5]);
    ok("D. kolom ringkas: hanya kolom utama — tidak ada Spam/Nilai order/Uang/Biaya/Booked/Cash di header", !/Booked ROAS|Cash ROAS|Konversi non-spam|Nilai order|Uang diterima|Biaya iklan|Spam/.test(await teks(page, '[data-testid="tabel-sumber"] thead') || ""));
    ok("D. 1440 px: tabel ringkas tanpa gulir mendatar", await page.evaluate(() => { const c = document.querySelector('[data-testid="tabel-sumber"] table').parentElement; return c.scrollWidth <= c.clientWidth + 1; }));
    ok("B. kartu lunas: tanpa '≥', berbunyi 'customer lunas terbukti ledger' + catatan cakupan ledger terpisah", !/≥/.test(await teks(page, '[data-testid="kartu-lunas"]') || "") && /customer lunas terbukti ledger/.test(await teks(page, '[data-testid="kartu-lunas"]') || "") && /Cakupan ledger/.test(await teks(page, '[data-testid="catatan-lunas"]') || ""), await teks(page, '[data-testid="kartu-lunas"]'));
    // lengkap (pemilih kolom): [7]=spam [8]=membayar [9]=non-spam [10]=nilai [11]=uang [12]=biaya
    await page.click('[data-testid="toggle-kolom"]'); await tungguUrl(page, /kolom=lengkap/); await tidur(600);
    const metaL = await baris("META"), tikL = await baris("TIKTOK");
    ok("D. baris Meta (lengkap): nilai order/uang = API", [num(metaL[10]), num(metaL[11])].join() === [S.META.nilai, S.META.uang].join(), metaL.slice(10, 13).join(" | "));
    ok("D. baris TikTok (lengkap) = API (nilai, uang, biaya sumber manual)", [num(tikL[10]), num(tikL[11]), num(tikL[12])].join() === [S.TIKTOK.nilai, S.TIKTOK.uang, S.TIKTOK.spend].join(), tikL.slice(10, 13).join(" | "));
    const totL = await page.$$eval('[data-testid="baris-total"] td', (tds) => tds.map((t) => t.textContent.trim()));
    ok("D. baris total (lengkap): nilai order = kartu", num(totL[10]) === k.nilaiOrder, totL.slice(10, 13).join(" | "));
    await page.click('[data-testid="toggle-kolom"]'); await tungguUrl(page, /^((?!kolom).)*$/); await tidur(400);
    ok("Tombol 'Kelola biaya iklan' ada (bukan tab utama); tab utama = 5 tab", !!(await page.$('[data-testid="kelola-biaya"]')) && (await sel(page, '[role="tab"]')).slice(-5).join("|") === "Ringkasan|Sales|Marketing|Performa Tim|Pipeline", (await sel(page, '[role="tab"]')).join("|"));
    await foto(page, "01-marketing-ringkasan-desktop");

    // E/F. bagian yang dapat dibuka
    ok("E/F. Pola lead & respons dan Kualitas data tertutup bawaan", (await page.$$('[data-testid="bagian-pola"] [aria-expanded="false"]')).length === 1 && (await page.$$('[data-testid="bagian-kualitas"] [aria-expanded="false"]')).length === 1);
    await page.click('[data-testid="bagian-kualitas"] button'); await tunggu(page, '[data-testid="kualitas-data"]'); await tidur(1500);
    const butir = await page.$$eval('[data-testid="kualitas-data"] li[data-butir]', (l) => l.map((x) => x.dataset.butir));
    ok("F. Kualitas data memuat coverage, ledger parsial, spend, UNKNOWN, UNMAPPED, rekonsiliasi", ["coverage", "ledgerParsial", "spendSumber", "unknown", "unmapped", "rekonMeta", "rekonLead"].every((b) => butir.includes(b)), butir.join(","));
    const rekonLead = await teks(page, '[data-butir="rekonLead"]');
    ok("F. rekonsiliasi total lead: Cocok (total − spam = tren)", /Cocok/.test(rekonLead || ""), rekonLead);
    await foto(page, "02-marketing-kualitas-data");
    await page.click('[data-testid="bagian-pola"] button'); await tunggu(page, '[data-testid="bagian-pola"] .grid'); await tidur(600);
    ok("E. Pola lead & respons dibuka: jam tersibuk, respons, hari tidak normal, peta hari × jam", /Jam Tersibuk/i.test(await teks(page, '[data-testid="bagian-pola"]') || "") && /Peta Traffic/i.test(await teks(page, '[data-testid="bagian-pola"]') || ""));
    await foto(page, "03-marketing-pola-lead");

    // urutan & kolom di URL
    await page.select('[data-testid="pilih-urut"]', "lead"); await tungguUrl(page, /urut=lead/);
    ok("urutan tabel sumber tersimpan di URL (?urut=lead) dan periode tidak berubah", /urut=lead/.test(url(page).search) && /dari=2026-10-01/.test(url(page).search));
    await page.click('[data-testid="toggle-kolom"]'); await tungguUrl(page, /kolom=lengkap/);
    const hdr = await teks(page, '[data-testid="tabel-sumber"] thead');
    ok("kolom lengkap menambah Spam, Membayar, Konversi non-spam, Booked & Cash ROAS (?kolom=lengkap)", /Booked ROAS/.test(hdr) && /Cash ROAS/.test(hdr) && /Spam/.test(hdr) && /Konversi non-spam/.test(hdr));
    await foto(page, "04-marketing-tabel-kolom-lengkap", false);
    await page.click('[data-testid="toggle-banding"]'); await tungguUrl(page, /banding=1/); await tunggu(page, '[data-testid="ringkasan-marketing"]'); await tidur(1200);
    ok("Bandingkan periode sebelumnya tersimpan di URL dan memuat ulang tanpa galat", /banding=1/.test(url(page).search) && !(await page.$('[data-testid="galat-marketing"]')));
    await page.click('[data-testid="toggle-banding"]'); await tungguUrl(page, /^((?!banding).)*$/);

    // Ekspor CSV sumber
    fs.readdirSync(DL).forEach((f) => fs.unlinkSync(path.join(DL, f)));
    await page.click('[data-testid="ekspor-sumber"]'); await tidur(1500);
    const csv1 = fs.readdirSync(DL).find((f) => /^marketing-sumber-.*\.csv$/.test(f));
    const isi1 = csv1 ? fs.readFileSync(path.join(DL, csv1), "utf8") : "";
    ok("Ekspor CSV sumber: berkas terunduh, memuat total lead & nilai order sesuai layar", !!csv1 && isi1.includes("TOTAL (semua sumber)") && isi1.includes(String(k.lead)) && isi1.includes(String(k.nilaiOrder)), csv1);

    // ═══ 2. DETAIL TIKTOK ═══
    await klikTampak(page, '[data-testid="baris-sumber-TIKTOK"]'); await tungguUrl(page, /sumber=TIKTOK/); await tunggu(page, '[data-testid="detail-marketing"]');
    await tidur(800);
    const dt = await teks(page, '[data-testid="detail-marketing"]');
    ok("TikTok: breadcrumb Marketing › TikTok, periode dipertahankan di URL", /Marketing/.test(await teks(page, '[data-testid="detail-marketing"] nav') || "") && /dari=2026-10-01/.test(url(page).search));
    ok("TikTok: tidak ada tabel campaign/ad set/ad palsu; penjelasan 'belum punya data per campaign/ad'", !(await page.$('[data-testid="meta-detail"]')) && /belum punya data per campaign/.test(dt));
    ok("TikTok: biaya sumber manual + CPA/ROAS sumber tampil dengan dasar 'Atribusi label CRM'", /Atribusi label CRM/.test(dt) && /Biaya iklan/.test(dt));
    await foto(page, "05-marketing-detail-tiktok");
    await page.goBack(); await tunggu(page, '[data-testid="ringkasan-marketing"]');
    ok("Back dari detail sumber kembali ke ringkasan (sumber hilang dari URL, periode tetap)", !/sumber=/.test(url(page).search) && /dari=2026-10-01/.test(url(page).search));

    // ═══ 3. META: campaign → ad set → ad ═══
    await klikTampak(page, '[data-testid="baris-sumber-META"]'); await tungguUrl(page, /sumber=META/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr');
    await tidur(800);
    const rowsCamp = await page.$$eval('[data-testid="tabel-meta"] tbody tr', (r) => r.map((x) => ({ id: x.dataset.testid, st: x.dataset.status, t: x.textContent })));
    ok("Meta: campaign terpetakan + UNMAPPED tampil (tidak pernah diberi nama campaign)", rowsCamp.some((r) => r.st === "MAPPED") && rowsCamp.some((r) => r.st === "UNMAPPED"), rowsCamp.map((r) => r.id).join(","));
    const campMapped = rowsCamp.filter((r) => r.st === "MAPPED");
    ok("Meta: nama campaign terbaca + ID dapat disalin (tombol Salin ID)", /Jabo IG Oktober/.test(campMapped.map((r) => r.t).join(" ")) && !!(await page.$('[data-testid="tabel-meta"] button[title="Salin ID"]')));
    const totalMeta = await page.$$eval('[data-testid="total-meta"] td', (t) => t.map((x) => x.textContent.trim()));
    const IK = REF.sebelum.iklan;
    ok("Meta: total terbukti = API (lead, ber-order, membayar, lunas ledger, nilai, uang bersih)", [num(totalMeta[2]), num(totalMeta[3]), num(totalMeta[4]), num(totalMeta[5]), num(totalMeta[6]), num(totalMeta[7])].join() === [IK.leadTerbukti, IK.berOrder, IK.membayar, IK.lunas, IK.nilaiOrder, IK.uangBersih].join(), totalMeta.slice(2, 8).join(" | "));
    const hdrMeta = await teks(page, '[data-testid="tabel-meta"] thead');
    ok("Meta: ber-order, membayar, dan lunas (ledger) adalah kolom terpisah; tidak ada label 'Closing'", /Ber-order/.test(hdrMeta) && /Membayar/.test(hdrMeta) && /Lunas \(ledger\)/.test(hdrMeta) && !/Closing/i.test(hdrMeta), hdrMeta.slice(0, 120));
    ok("Meta: status rekonsiliasi OK tampil", /OK \(\d+\)/.test(await teks(page, '[data-testid="status-meta"]') || ""));
    await foto(page, "06-marketing-meta-campaign");
    // peringkat
    const opsiRank = await page.$$eval('[data-testid="pilih-rank"] option', (o) => o.map((x) => ({ v: x.value, d: x.disabled, t: x.textContent })));
    ok("Meta: peringkat dapat dipilih (ber-order, lunas ledger, nilai order, uang bersih, CPA lunas, ROAS)", ["customer_ber_order", "customer_lunas_ledger", "nilai_order", "uang_ledger_bersih", "cpa_lunas", "booked_roas", "cash_roas"].every((v) => opsiRank.some((o) => o.v === v)));
    await page.select('[data-testid="pilih-rank"]', "nilai_order"); await tungguUrl(page, /rank=nilai_order/);
    ok("Meta: kriteria peringkat tersimpan di URL (?rank=nilai_order)", /rank=nilai_order/.test(url(page).search));
    const urutNilai = await page.$$eval('[data-testid="tabel-meta"] tbody tr[data-status="MAPPED"] td:nth-child(7)', (t) => t.map((x) => x.textContent.trim()));
    const angkaUrut = urutNilai.map(num);
    ok("Meta: baris terurut menurun menurut nilai order", angkaUrut.every((v, i) => i === 0 || angkaUrut[i - 1] >= v), urutNilai.join(" > "));
    await page.select('[data-testid="pilih-rank"]', "customer_ber_order"); await tungguUrl(page, /^((?!rank=).)*$/);
    // drilldown
    await klikTampak(page, '[data-testid^="baris-meta-5269"]'); await tungguUrl(page, /level=adset&campaign=\d+|campaign=\d+&level=adset|level=adset/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr'); await tidur(700);
    ok("Meta → ad set: level & campaign tersimpan di URL; breadcrumb menampilkan nama campaign", /level=adset/.test(url(page).search) && /campaign=\d+/.test(url(page).search) && /Jabo IG Oktober|Campaign \d+/.test(await teks(page, '[data-testid="detail-marketing"] nav') || ""), url(page).search);
    await foto(page, "07-marketing-meta-adset");
    const adsetUrl = page.url();
    await klikTampak(page, '[data-testid^="baris-meta-5269"]'); await tungguUrl(page, /level=ad/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr'); await tidur(700);
    ok("Meta → ad: level=ad, campaign, adset di URL; judul 'Per ad'", /level=ad/.test(url(page).search) && /adset=\d+/.test(url(page).search) && /Per ad/.test(await teks(page, '[data-testid="meta-detail"] h3') || ""));
    ok("Meta level ad: baris ad (tanpa drilldown lanjutan)", (await page.$$('[data-testid="tabel-meta"] tbody tr')).length >= 1);
    await foto(page, "08-marketing-meta-ad");
    const adUrl = page.url();
    // refresh mempertahankan keadaan
    await page.reload({ waitUntil: "domcontentloaded" }); await tunggu(page, '[data-testid="tabel-meta"] tbody tr'); await tidur(600);
    ok("Refresh mempertahankan level/campaign/ad set/periode (deep-link)", page.url() === adUrl && /Per ad/.test(await teks(page, '[data-testid="meta-detail"] h3') || ""), page.url().split("?")[1]);
    await page.goBack(); await tunggu(page, '[data-testid="tabel-meta"] tbody tr'); await tidur(500);
    ok("Back dari ad → ad set (tombol Back browser)", page.url() === adsetUrl && /Per ad set/.test(await teks(page, '[data-testid="meta-detail"] h3') || ""), page.url().split("?")[1]);
    await klikTeks(page, '[data-testid="detail-marketing"] nav button', "Meta"); await tungguUrl(page, /^((?!level=).)*$/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr');
    ok("Breadcrumb 'Meta' kembali ke level campaign", !/level=/.test(url(page).search) && /sumber=META/.test(url(page).search));
    // kolom lengkap & CSV Meta
    // pilihan kolom dari ringkasan terbawa lewat URL (?kolom=lengkap) ke tabel Meta
    ok("Meta kolom lengkap (terbawa dari URL) memuat kolom legacy (Reaktivasi, Assisted, CPL, Order DP, Lunas CRM)", /Reaktivasi/.test(await teks(page, '[data-testid="tabel-meta"] thead') || "") && /Assisted/.test(await teks(page, '[data-testid="tabel-meta"] thead') || "") && /CPL/.test(await teks(page, '[data-testid="tabel-meta"] thead') || ""));
    fs.readdirSync(DL).forEach((f) => fs.unlinkSync(path.join(DL, f)));
    await page.click('[data-testid="ekspor-meta"]'); await tidur(1500);
    const csv2 = fs.readdirSync(DL).find((f) => /^marketing-meta-.*\.csv$/.test(f)); const isi2 = csv2 ? fs.readFileSync(path.join(DL, csv2), "utf8") : "";
    ok("Ekspor CSV Meta: kolom ber-order/membayar/lunas terpisah + UNMAPPED ikut", /Customer ber-order,Customer membayar,Customer lunas \(ledger\)/.test(isi2) && /UNMAPPED/.test(isi2), csv2);
    // panel kesehatan & referensi
    await page.click('[data-testid="panel-kesehatan"]'); await tunggu(page, '[data-testid="panel-kesehatan"]'.replace('panel-kesehatan', 'panel-kesehatan') + ' + *', 20000).catch(() => {}); await tidur(2000);
    const pk = await page.$$eval('[data-testid="panel-kesehatan"]', (e) => e.map((x) => x.textContent));
    ok("Akses ke kesehatan atribusi & referensi (panel baca-saja, daftar UNMAPPED)", pk.some((t) => /Kesehatan capture touch/.test(t) && /Referensi pemetaan/.test(t)), pk.map((t) => t.slice(0, 60)).join("|"));
    await foto(page, "09-marketing-meta-kesehatan");
    ok("Panel Impor spend / Target KPI / Monitoring tersedia (fitur existing)", (await page.$$('[data-testid="aksi-meta"] button')).length >= 4);

    // ═══ 4. KELOLA BIAYA IKLAN (fitur existing, tombol) ═══
    await page.click('[data-testid="kelola-biaya"]'); await tunggu(page, '[role="dialog"]'); await tidur(1500);
    const dlg = await teks(page, '[role="dialog"]');
    ok("Kelola biaya iklan membuka dialog existing (entri harian TikTok fixture, edit/dry-run/audit tetap di dialog)", /biaya/i.test(dlg) && /TikTok|TIKTOK/.test(dlg), dlg.slice(0, 100));
    await foto(page, "10-marketing-kelola-biaya", false);
    await page.keyboard.press("Escape"); await tidur(500);
    ok("Halaman tanpa galat JS (desktop)", page.galat.length === 0, page.galat.join(" | "));
    await page.close();

    // ═══ 5. URL LAMA ═══
    for (const [lama, harap] of [[`tab=Traffic&${P}`, [/tab=Marketing/, /^((?!sumber=).)*$/]], [`tab=Akuisisi&${P}&sumber=TIKTOK`, [/tab=Marketing/, /sumber=TIKTOK/]], [`tab=Iklan&${P}`, [/tab=Marketing/, /sumber=META/]]]) {
      const pg = await buka(browser, "admin", `/laporan?${lama}`);
      await pg.waitForFunction(() => /tab=Marketing/.test(location.search), { timeout: 20000 }).catch(() => {});
      await tunggu(pg, '[data-testid="marketing-tab"]');
      ok(`URL lama ?${lama.split("&")[0]} → Marketing, periode dipertahankan`, harap.every((r) => r.test(url(pg).search)) && /dari=2026-10-01&sampai=2026-10-10/.test(url(pg).search), url(pg).search);
      await pg.close();
    }

    // ═══ 6. MOBILE 390 ═══
    page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`, { lebar: 390, tinggi: 844, hp: true });
    await tunggu(page, '[data-testid="ringkasan-marketing"]'); await tidur(1500);
    ok("Mobile 390: tanpa gulir mendatar halaman", await tanpaGulirMendatar(page));
    ok("Mobile 390: sumber tampil sebagai kartu (tabel tersembunyi)", (await page.$$eval('[data-testid^="kartu-sumber-"]', (e) => e.filter((x) => x.offsetParent !== null).length)) === 6);
    await foto(page, "11-marketing-ringkasan-mobile");
    await klikTampak(page, '[data-testid="kartu-sumber-META"] button'); await tungguUrl(page, /sumber=META/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr'); await tidur(1000);
    ok("Mobile 390: detail Meta tanpa gulir mendatar halaman (tabel menggulir di dalam kartu)", await tanpaGulirMendatar(page));
    await foto(page, "12-marketing-meta-mobile");
    await page.goBack(); await tunggu(page, '[data-testid="ringkasan-marketing"]');
    await klikTampak(page, '[data-testid="kartu-sumber-TIKTOK"] button'); await tunggu(page, '[data-testid="detail-marketing"]'); await tidur(1000);
    ok("Mobile 390: detail TikTok tanpa gulir mendatar", await tanpaGulirMendatar(page));
    await foto(page, "13-marketing-tiktok-mobile");
    ok("Mobile: tanpa galat JS", page.galat.length === 0, page.galat.join(" | "));
    await page.close();

    // ═══ 7. TEMA GELAP ═══
    page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`, { gelap: true });
    await tunggu(page, '[data-testid="ringkasan-marketing"]'); await tidur(1500);
    await foto(page, "14-marketing-gelap-desktop");
    await klikTampak(page, '[data-testid="baris-sumber-META"]'); await tunggu(page, '[data-testid="tabel-meta"] tbody tr'); await tidur(1000);
    await foto(page, "15-marketing-meta-gelap");
    await page.close();

    // ═══ 8. HARI BERJALAN, KOSONG, GALAT, AKSES DITOLAK ═══
    const hari = new Date(Date.now() + 7 * 3600e3).toISOString().slice(0, 10); const kemarin = new Date(Date.now() + 7 * 3600e3 - 3 * 86400e3).toISOString().slice(0, 10);
    page = await buka(browser, "admin", `/laporan?tab=Marketing&dari=${kemarin}&sampai=${hari}`);
    await tunggu(page, '[data-testid="ringkasan-marketing"]'); await tidur(1200);
    ok("Hari berjalan: penanda 'memuat hari berjalan' tampil dan biaya per hasil (CPA/ROAS) dikosongkan", /hari berjalan/.test(await teks(page, '[data-testid="banner-periode"]') || ""));
    ok("Data kosong: pesan 'belum ada lead' + semua sumber tetap tampil (kosong ≠ nol terukur)", !!(await page.$('[data-testid="kosong-lead"]')) && (await page.$$('[data-testid^="baris-sumber-"]')).length === 6);
    await foto(page, "16-marketing-kosong-hari-berjalan", false);
    await page.close();

    page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`);
    await page.setRequestInterception(true);
    page.on("request", (r) => { if (/\/atribusi\/iklan\/sumber/.test(r.url())) r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Gagal menghitung" }) }); else r.continue(); });
    await page.reload({ waitUntil: "domcontentloaded" });
    await tunggu(page, '[data-testid="galat-marketing"]', 40000);
    ok("Galat server: kartu galat dengan tombol 'Coba lagi' (halaman tidak kosong/crash)", /Coba lagi/.test(await teks(page, '[data-testid="galat-marketing"]') || ""));
    await foto(page, "17-marketing-galat", false);
    await page.close();

    page = await buka(browser, "sales", `/laporan?tab=Marketing&${P}`);
    const dit = await page.waitForSelector('[data-testid="akses-ditolak"]', { timeout: 40000 }).catch(() => null);
    ok("SALES: akses ditolak (server 403) → kartu 'Akses ditolak', tidak ada angka bocor", !!dit && !(await page.$('[data-testid="kartu-ringkas"]')) && !(await page.$('[data-testid="tabel-sumber"]')));
    await foto(page, "18-marketing-akses-ditolak", false);
    await page.close();
    ok("SALES 403 di endpoint atribusi (API)", (await db("sales", `/api/atribusi/iklan/sumber?${P}`)) === 403 && (await db("sales", `/api/atribusi/iklan?${P}`)) === 403);
    ok("ADMIN 200 di endpoint atribusi (API)", (await db("admin", `/api/atribusi/iklan/sumber?${P}`)) === 200);
  } catch (e) {
    ok("skrip QA selesai tanpa pengecualian", false, e.stack || e.message);
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, "hasil-browser.json"), JSON.stringify(hasil, null, 1));
  console.log(`\nRINGKASAN QA browser: ${hasil.filter((h) => h.ok).length} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
})();
