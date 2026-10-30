// QA singkat polesan akhir Stok & Lokasi: kontras teks sekunder (terukur dari warna terhitung, terang + gelap), rincian hasil menghitung SELURUH hasil saringan, status dibedakan, harga kosong ≠ Rp0, HP tanpa gulir horizontal.
//   BASE=http://127.0.0.1:5191 OUT=C:/tmp/km-stok-redesign-qa node frontend/qa-harness/stok-polesan-browser.cjs
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:5191"; const OUT = process.env.OUT || "C:/tmp/km-stok-redesign-qa";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const SHOTS = path.join(OUT, "shots-final"); fs.mkdirSync(SHOTS, { recursive: true });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0; const hasil = [];
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const ada = (page, s) => page.waitForFunction((x) => [...document.querySelectorAll(x)].some((e) => e.getClientRects().length > 0), { timeout: 30000 }, s);
async function buka(browser, siapa, rute, { lebar = 1440, tinggi = 900, hp = false, tema = "" } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((t, u, th) => { try { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); if (th) localStorage.setItem("sano-theme", th); } catch (e) { /* abaikan */ } }, T[siapa].token, T[siapa].user, tema);
  page.galat = []; page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" }); await ada(page, '[data-testid="baris-stok"]').catch(() => {}); await tidur(800);
  return page;
}
const teks = (page, s) => page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); return e ? e.textContent.trim() : null; }, s);
const foto = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png") });
const klik = async (page, s) => { await ada(page, s); await page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); e.scrollIntoView({ block: "center" }); e.click(); }, s); };
const tanpaGulir = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

// Rasio kontras dari WARNA TERHITUNG peramban: warna teks (rgba) dikomposit di atas latar efektif terdekat yang tidak transparan.
const UKUR = `(sel, ph) => {
  const parse = (c) => { const m = c.match(/rgba?\\(([^)]+)\\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return { r: p[0], g: p[1], b: p[2], a: p[3] === undefined ? 1 : p[3] }; };
  const lum = (c) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4); }; return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b); };
  const el = [...document.querySelectorAll(sel)].find((e) => e.getClientRects().length > 0); if (!el) return null;
  let bg = { r: 255, g: 255, b: 255, a: 1 }; const kumpul = []; for (let n = el; n; n = n.parentElement) { const c = parse(getComputedStyle(n).backgroundColor); if (c && c.a > 0) { kumpul.push(c); if (c.a >= 0.99) break; } }
  for (const c of kumpul.reverse()) bg = { r: c.r * c.a + bg.r * (1 - c.a), g: c.g * c.a + bg.g * (1 - c.a), b: c.b * c.a + bg.b * (1 - c.a), a: 1 };
  const cs = getComputedStyle(el); const fg = parse(cs.color); const warna = ph ? parse(getComputedStyle(el, "::placeholder").color) : fg;
  const f2 = { r: warna.r * warna.a + bg.r * (1 - warna.a), g: warna.g * warna.a + bg.g * (1 - warna.a), b: warna.b * warna.a + bg.b * (1 - warna.a) };
  const [a, b] = [lum(f2), lum(bg)].sort((x, y) => y - x); return Math.round(((a + 0.05) / (b + 0.05)) * 100) / 100;
}`;
const rasio = (page, sel, ph = false) => page.evaluate(`(${UKUR})(${JSON.stringify(sel)}, ${ph})`);

(async () => {
  const browser = await puppeteer.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null });
  try {
    for (const tema of ["", "dark"]) {
      const nm = tema ? "gelap" : "terang";
      const F = await buka(browser, "finance", "/warehouse/inventory?q=SBX", { tema });
      const kode = await rasio(F, '[data-testid="kode-bahan"]'); const kolom = await rasio(F, '[data-testid="kepala-kolom"]'); const ph = await rasio(F, '[data-testid="cari-bahan"]', true);
      const satuan = await rasio(F, '[data-testid="tersedia-angka"] span'); const harga = await rasio(F, '[data-testid="harga-daftar"][data-ada="1"] span:last-child');
      ok(`kontras ${nm}: kode bahan ≥ 4.5`, kode >= 4.5, String(kode)); ok(`kontras ${nm}: judul kolom ≥ 4.5`, kolom >= 4.5, String(kolom));
      ok(`kontras ${nm}: placeholder pencarian ≥ 4.5`, ph >= 4.5, String(ph)); ok(`kontras ${nm}: satuan di samping stok ≥ 4.5`, satuan >= 4.5, String(satuan)); ok(`kontras ${nm}: '/ satuan' pada harga ≥ 4.5`, harga >= 4.5, String(harga));
      await F.goto(BASE + "/warehouse/inventory?q=SBX-SOFT-D23", { waitUntil: "domcontentloaded" }); await ada(F, '[data-testid="baris-stok"]'); await tidur(600);
      const hk = await rasio(F, '[data-testid="harga-daftar"][data-ada="0"]'); ok(`kontras ${nm}: 'Belum ada harga berlaku' ≥ 4.5 (tetap miring, bukan Rp0)`, hk >= 4.5 && /Belum ada harga berlaku/.test(await teks(F, '[data-testid="sel-harga"]')) && !/Rp\s?0\b/.test(await teks(F, '[data-testid="sel-harga"]')), String(hk));
      await klik(F, '[data-testid="baris-stok"]'); await ada(F, '[data-testid="drawer-bahan"]'); await tidur(900);
      const dk = await rasio(F, '[data-testid="drawer-kode-satuan"]'); const dh = await rasio(F, '[data-testid="belum-ada-harga"]');
      ok(`kontras ${nm}: drawer kode·satuan ≥ 4.5`, dk >= 4.5, String(dk)); ok(`kontras ${nm}: drawer 'Belum diisi' ≥ 4.5`, dh >= 4.5, String(dh));
      await foto(F, `d-drawer-${nm}`);
      await F.goto(BASE + "/warehouse/inventory", { waitUntil: "domcontentloaded" }); await ada(F, '[data-testid="baris-stok"]'); await tidur(700); await foto(F, `a-daftar-${nm}`);
      if (!tema) { ok("tanpa galat JS (terang)", F.galat.length === 0, F.galat.join("|")); }
    }

    // ── rincian hasil = SELURUH hasil saringan, konsisten antarhalaman ──
    const F = await buka(browser, "finance", "/warehouse/inventory");
    const r1 = await teks(F, '[data-testid="rincian-hasil"]'); const j1 = await teks(F, '[data-testid="jumlah-tampil"]');
    ok("rincian hasil menyebut minus 1, belum diketahui 2, nol terverifikasi 1, nol menurut pergerakan 1 dari seluruh 55 bahan (bukan 25 baris halaman)", /1 saldo minus/.test(r1) && /2 belum diketahui/.test(r1) && /1 nol terverifikasi/.test(r1) && /1 nol menurut pergerakan/.test(r1) && /55 bahan tampil/.test(j1), `${j1} | ${r1}`);
    await klik(F, '[data-testid="halaman-berikutnya"]'); await tidur(300);
    ok("pindah halaman: jumlah dan rincian hasil tidak berubah", (await teks(F, '[data-testid="rincian-hasil"]')) === r1 && (await teks(F, '[data-testid="jumlah-tampil"]')) === j1);
    await F.goto(BASE + "/warehouse/inventory?kelompok=AKSESORI", { waitUntil: "domcontentloaded" }); await ada(F, '[data-testid="baris-stok"]'); await tidur(600);
    const ak = await teks(F, '[data-testid="jumlah-tampil"]'); const rk = await teks(F, '[data-testid="rincian-hasil"]');
    ok("saringan kelompok Aksesori: 39 bahan tampil (25 per halaman; halaman 2 berisi 14)", /39 bahan tampil/.test(ak), `${ak} | ${rk}`);
    const exp = Number(require("child_process").execFileSync(process.execPath, [path.join(__dirname, "qa-sql.cjs"), "select count(*) from materials m where m.active and m.item_group='PAKU' and not exists (select 1 from material_harga_berlaku h where h.material_id=m.id and h.effective_from <= now())"], { encoding: "utf8", env: { ...process.env, QA_DB_URL: "postgresql://klinik:klinik123@localhost:55443/km_stok_redesign_qa_test" } }).trim());
    ok(`rincian 'belum ada harga' pada Aksesori = hitungan database (${exp})`, new RegExp(`${exp} belum ada harga`).test(rk ?? "") || exp === 0, `${rk} vs ${exp}`);
    await F.goto(BASE + "/warehouse/inventory?keadaan=MINUS", { waitUntil: "domcontentloaded" }); await ada(F, '[data-testid="baris-stok"]'); await tidur(500);
    ok("saringan Saldo minus: 1 bahan tampil, rincian '1 saldo minus'", /1 bahan tampil/.test(await teks(F, '[data-testid="jumlah-tampil"]')) && /1 saldo minus/.test((await teks(F, '[data-testid="rincian-hasil"]')) ?? ""));
    const G = await buka(browser, "gudang", "/warehouse/inventory");
    ok("Gudang (tanpa izin harga): rincian hasil tidak memuat hitungan harga; izin harga tidak berubah", !/belum ada harga/.test((await teks(G, '[data-testid="rincian-hasil"]')) ?? "") && (await G.$$('[data-testid="sel-harga"]')).length === 0);
    await klik(G, 'button[data-testid="baris-stok"]'); await ada(G, '[data-testid="tombol-koreksi-saldo"]');
    ok("Koreksi saldo tetap ada untuk Gudang; Ubah harga tetap tidak ada", !!(await G.$('[data-testid="tombol-koreksi-saldo"]')) && !(await G.$('[data-testid="tombol-ubah-harga"]')));

    // ── HP ──
    const H = await buka(browser, "finance", "/warehouse/inventory", { lebar: 390, tinggi: 844, hp: true });
    ok("HP: tanpa gulir horizontal; baris pertama terlihat", await tanpaGulir(H) && await H.evaluate(() => document.querySelector('button[data-testid="baris-stok"]').getBoundingClientRect().top < window.innerHeight));
    await foto(H, "b-daftar-hp");
    await H.goto(BASE + "/warehouse/inventory?q=SBX-HR-N44", { waitUntil: "domcontentloaded" }); await ada(H, 'button[data-testid="baris-stok"]'); await klik(H, 'button[data-testid="baris-stok"]'); await ada(H, '[data-testid="drawer-bahan"]'); await tidur(900);
    ok("HP: drawer tanpa gulir horizontal", await tanpaGulir(H)); await foto(H, "c-drawer-hp");
    const D = await buka(browser, "finance", "/warehouse/inventory", { lebar: 390, tinggi: 844, hp: true, tema: "dark" }); await foto(D, "e-daftar-hp-gelap");
    ok("tanpa galat JS tak tertangani", [F, G, H, D].every((p) => p.galat.length === 0), [F, G, H, D].flatMap((p) => p.galat).join("|"));
  } catch (e) { gagal++; console.log("FAIL  SKRIP BERHENTI: " + (e.stack || e).toString().slice(0, 700)); }
  finally { await browser.close(); fs.writeFileSync(path.join(OUT, "hasil-polesan.json"), JSON.stringify({ gagal, hasil }, null, 2)); console.log(`\n${hasil.filter((h) => h.ok).length}/${hasil.length} PASS, ${gagal} gagal`); process.exit(gagal ? 1 : 0); }
})();
