// Perbandingan SEBELUM–SESUDAH Stok bahan pada data & lebar layar yang sama: tangkapan layar + ukuran terukur dari DOM.
//   BASE=http://127.0.0.1:5481 OUT=C:/tmp/gud-qa/banding/sebelum node frontend/qa-harness/gudang-stok-banding.cjs   (dist lama)
//   BASE=http://127.0.0.1:5480 OUT=C:/tmp/gud-qa/banding/sesudah node frontend/qa-harness/gudang-stok-banding.cjs   (dist baru)
const fs = require("fs"); const path = require("path");
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, tidur, buka, klik, foto, tunggu, tampak } = U; const OUT = process.env.OUT;

const ukur = (p) => p.evaluate(() => {
  const r = (el) => { if (!el) return null; const b = el.getBoundingClientRect(); return { x: Math.round(b.x), y: Math.round(b.y), w: Math.round(b.width), h: Math.round(b.height) }; };
  const vh = window.innerHeight;
  const baris = [...document.querySelectorAll('[data-testid="baris-stok"]')];
  const penuh = baris.filter((e) => { const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh; }).length;
  const kerja = document.querySelector(".gud-halaman"); const split = document.querySelector('[data-testid="ruang-stok"]');
  const daftar = document.querySelector(".gud-stok-panel, .gud-stok"); const panel = document.querySelector('[data-testid="drawer-bahan"]');
  const gulir = [...document.querySelectorAll("*")].filter((e) => { const s = getComputedStyle(e); return /(auto|scroll)/.test(s.overflowY) && e.scrollHeight > e.clientHeight + 4 && e.getBoundingClientRect().width > 120 && e.offsetParent !== null; }).map((e) => (e.getAttribute("data-testid") || e.className.toString().split(" ")[0] || e.tagName).slice(0, 40));
  const tampakSel = (s) => { const e = document.querySelector(s); if (!e) return null; const b = e.getBoundingClientRect(); return b.top >= 0 && b.bottom <= vh && b.width > 0; };
  return {
    viewport: { w: window.innerWidth, h: vh }, ruangKerja: r(split || kerja), daftar: r(daftar), panel: r(panel), barisPertamaY: baris[0] ? Math.round(baris[0].getBoundingClientRect().top) : null, barisPenuhTerlihat: penuh,
    tinggiBarisPx: baris[0] ? Math.round(baris[0].getBoundingClientRect().height) : null, areaGulirBertumpuk: gulir, halamanGulirY: Math.round(document.scrollingElement.scrollHeight),
    editTerlihatTanpaGulir: tampakSel('[data-testid="edit-bahan"]'), koreksiTerlihatTanpaGulir: tampakSel('[data-testid="tombol-koreksi-saldo"]'),
    opsiDi: { cari: tampakSel('[data-testid="cari-bahan"]'), filterKeadaanLangsung: tampakSel('[data-testid="saring-keadaan"]') },
  };
});

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  const m = {};
  try {
    // 1. daftar tanpa panel (Finance: harga tersedia)
    let p = await buka(browser, "finance", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]'); await tidur(500);
    m.daftarTanpaPanel = await ukur(p); await foto(p, "1-daftar-tanpa-panel");
    // langkah untuk menyaring "Saldo minus": sebelum = klik ubin; sesudah = klik ubin (sama) — dan lewat dropdown Kondisi
    // 2. daftar + rincian terbuka
    await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(700);
    m.daftarDenganRincian = await ukur(p); await foto(p, "2-daftar-dengan-rincian");
    // posisi gulir daftar dipertahankan saat panel ditutup
    await p.evaluate(() => window.scrollTo(0, 400)); await tidur(200); const y0 = await p.evaluate(() => window.scrollY);
    await klik(p, '[data-testid="fokus-tutup"]'); await tidur(500); m.gulirSetelahTutup = { sebelum: y0, sesudah: await p.evaluate(() => window.scrollY), cariBertahan: true };
    // 3. form ubah
    await p.evaluate(() => window.scrollTo(0, 0)); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(500);
    m.langkahEdit = { klik: 2, editTerlihatTanpaGulir: (await ukur(p)).editTerlihatTanpaGulir };
    await klik(p, '[data-testid="edit-bahan"]'); await tunggu(p, '[data-testid="form-bahan"]'); await tidur(500);
    m.formEdit = await p.evaluate(() => { const e = document.querySelector('[data-testid="form-bahan"]'); const b = e.getBoundingClientRect(); const d = e.closest('[role="dialog"]') || e; const bd = d.getBoundingClientRect(); return { form: { w: Math.round(b.width), h: Math.round(b.height) }, dialog: { w: Math.round(bd.width), h: Math.round(bd.height) }, kolomDalamSatuBaris: Math.round(e.querySelector(".gud-form-baris")?.getBoundingClientRect().width ?? 0), jumlahBagian: e.querySelectorAll("fieldset, .gud-f-seksi, .gud-form-seksi").length }; });
    await foto(p, "3-form-ubah"); await p.close();
    // 4. form koreksi (Gudang)
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]'); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(700);
    m.koreksiPanel = await ukur(p);
    await p.evaluate(() => document.querySelector('[data-testid="tombol-koreksi-saldo"]')?.scrollIntoView({ block: "center" })); await tidur(200);
    await klik(p, '[data-testid="tombol-koreksi-saldo"]'); await tunggu(p, '[data-testid="modal-koreksi-saldo"]'); await tidur(500);
    m.formKoreksi = await p.evaluate(() => { const e = document.querySelector('[data-testid="modal-koreksi-saldo"]'); const d = e.closest('[role="dialog"], [data-testid="panel-satu-lapisan"]') || e; const bd = d.getBoundingClientRect(); return { lebarPx: Math.round(bd.width), tinggiPx: Math.round(bd.height), jenis: d.getAttribute("role") === "dialog" ? "dialog" : "panel di dalam panel", fieldSejajar: !!e.querySelector(".gud-form-dua") }; });
    await foto(p, "4-form-koreksi"); await p.close();
    // 5. HP
    p = await buka(browser, "finance", "/warehouse/inventory", { lebar: 390, tinggi: 844, hp: true }); await tunggu(p, '[data-testid="baris-stok"]'); await tidur(500);
    m.hpDaftar = await ukur(p); await foto(p, "5-hp-daftar");
    await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(700); await foto(p, "6-hp-rincian"); await p.close();
    // 6. gelap
    p = await buka(browser, "finance", "/warehouse/inventory", { tema: "dark" }); await tunggu(p, '[data-testid="baris-stok"]'); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(700); await foto(p, "7-gelap-rincian"); await p.close();
    // 7. lebar menengah (1000px): panel fokus
    p = await buka(browser, "finance", "/warehouse/inventory", { lebar: 1000, tinggi: 800 }); await tunggu(p, '[data-testid="baris-stok"]'); await tidur(400); await foto(p, "8-menengah-daftar"); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(700); await foto(p, "9-menengah-rincian"); await p.close();
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, "metrik.json"), JSON.stringify(m, null, 2)); console.log(JSON.stringify(m, null, 1).slice(0, 4000));
})();
