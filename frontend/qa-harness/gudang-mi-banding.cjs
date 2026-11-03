// Perbandingan SEBELUM–SESUDAH Pengeluaran Material & Permintaan Bahan pada data & lebar layar yang sama: tangkapan layar + ukuran terukur dari DOM.
//   BASE=http://127.0.0.1:5482 OUT=C:/tmp/gud-qa/mi-banding/sebelum node frontend/qa-harness/gudang-mi-banding.cjs   (dist lama)
//   BASE=http://127.0.0.1:5483 OUT=C:/tmp/gud-qa/mi-banding/sesudah node frontend/qa-harness/gudang-mi-banding.cjs   (dist baru)
const fs = require("fs"); const path = require("path");
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, tidur, buka, klik, foto, tunggu, tampak } = U; const OUT = process.env.OUT; const BARU = !/5482/.test(process.env.BASE);
const klikTeksUmum = async (p, teks) => p.evaluate((t) => { const b = [...document.querySelectorAll("button")].find((x) => x.textContent.trim().startsWith(t) && x.offsetParent !== null); if (b) { b.click(); return true; } return false; }, teks);

const ukurDaftar = (p) => p.evaluate(() => {
  const vh = innerHeight; const baris = [...document.querySelectorAll('[data-testid="baris-dokumen"], [data-testid="baris-permintaan"]')]; const r = (e) => { if (!e) return null; const b = e.getBoundingClientRect(); return { w: Math.round(b.width), h: Math.round(b.height), y: Math.round(b.top) }; };
  const penuh = baris.filter((e) => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }).length;
  const panelAtas = baris[0] ? Math.round(baris[0].getBoundingClientRect().top) : null;
  return { viewport: { w: innerWidth, h: vh }, barisPertamaY: panelAtas, barisPenuhTerlihat: penuh, kontrolFilterTampilLangsung: document.querySelectorAll("select, [data-testid^='saring-'], [role='tablist']").length, tinggiBarisPx: r(baris[0])?.h ?? null };
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] }); const m = {};
  try {
    const D = ID.D; const BAGIAN = process.env.PART || "mi";
    let p;
    if (BAGIAN !== "v2") {
    // 1. daftar tanpa panel
    p = await buka(browser, "gudang", "/warehouse/material-issue"); await tunggu(p, '[data-testid="baris-dokumen"]'); await tidur(600);
    m.daftarTanpaPanel = await ukurDaftar(p); await foto(p, "1-daftar-tanpa-panel");
    // 2. daftar + rincian (dokumen Sudah diambil)
    await p.goto(`${process.env.BASE}/warehouse/material-issue/${D.diambil.id}`, { waitUntil: "networkidle2" }); await tidur(1500);
    m.daftarDenganRincian = await p.evaluate(() => { const d = document.querySelector('[data-testid="fokus-dokumen"]'); const b = d?.getBoundingClientRect(); const dlg = document.querySelector('[role="dialog"]'); const rb = dlg?.getBoundingClientRect(); return { panel: b ? { w: Math.round(b.width), h: Math.round(b.height) } : null, dialog: rb ? { w: Math.round(rb.width), h: Math.round(rb.height) } : null, daftarTerlihat: !!document.querySelector('[data-testid="baris-dokumen"]') }; });
    await foto(p, "2-daftar-dengan-rincian");
    // 3. langkah pengeluaran: aksi → konfirmasi
    if (BARU) { await klik(p, '[data-testid="tab-keluar"]'); await tidur(300); }
    await klik(p, '[data-testid="aksi-KONFIRMASI_KELUAR"]'); await tidur(500); m.langkahKeluar = { dampakTampil: await tampak(p, '[data-testid="ringkasan-KONFIRMASI_KELUAR"]'), jumlahKlikDariDaftar: BARU ? 3 : 2 };
    await foto(p, "3-konfirmasi-keluar"); await p.close();
    // 4. form permintaan baru
    p = await buka(browser, "gudang", "/warehouse/material-issue"); await tunggu(p, '[data-testid="baris-dokumen"]'); await tidur(400);
    if (BARU) await klik(p, '[data-testid="permintaan-baru"]'); else await klikTeksUmum(p, "Permintaan Baru");
    await tidur(900);
    m.form = await p.evaluate(() => { const d = document.querySelector('[role="dialog"]'); const b = d.getBoundingClientRect(); return { dialog: { w: Math.round(b.width), h: Math.round(b.height) }, kolomBahan: document.querySelector(".gud-katalog-grid") ? getComputedStyle(document.querySelector(".gud-katalog-grid")).gridTemplateColumns.split(" ").length : 1, pilihBahanAdalahSelectBawaan: !!d.querySelector("select"), adaKatalogPencarian: !!d.querySelector('[data-testid="cari-katalog"]') }; });
    await foto(p, "4-form-baru"); await p.close();
    // 5. HP
    p = await buka(browser, "gudang", "/warehouse/material-issue", { lebar: 390, tinggi: 844, hp: true }); await tunggu(p, '[data-testid="baris-dokumen"]'); await tidur(500);
    m.hpDaftar = await ukurDaftar(p); await foto(p, "5-hp-daftar"); await p.evaluate(() => [...document.querySelectorAll('[data-testid="baris-dokumen"]')].find((e) => e.offsetParent !== null).click()); await tidur(1200); await foto(p, "6-hp-rincian"); await p.close();
    // 6. gelap rincian
    p = await buka(browser, "gudang", `/warehouse/material-issue/${D.diambil.id}`, { tema: "dark" }); await tidur(1500); await foto(p, "7-gelap-rincian"); await p.close();
    }
    if (BAGIAN === "v2") {
    // 7. Permintaan Bahan (V2): daftar
    p = await buka(browser, "gudang", "/warehouse/material-pickup"); await tidur(1500);
    m.pickupDaftar = await p.evaluate(() => ({ kartu: document.querySelectorAll("div.grid > div").length, barisDaftar: document.querySelectorAll('[data-testid="baris-permintaan"]').length, adaSaringan: !!document.querySelector('[data-testid="buka-filter"]'), adaRincianTempel: false })); await foto(p, "8-pickup-daftar");
    if (BARU) { await p.click('[data-testid="baris-permintaan"]'); await tidur(1200); await foto(p, "9-pickup-rincian"); }
    else { await klikTeksUmum(p, "Serahkan Bahan"); await tidur(700); await foto(p, "9-pickup-rincian"); }
    await p.close();
    }
  } finally { await browser.close(); }
  fs.mkdirSync(OUT, { recursive: true }); fs.writeFileSync(path.join(OUT, `metrik-${process.env.PART || "mi"}.json`), JSON.stringify(m, null, 2)); console.log(JSON.stringify(m, null, 1).slice(0, 3000));
})();
