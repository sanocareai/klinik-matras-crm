// QA panel status sinkron di Chrome nyata: komponen asli, tiap keadaan server, desktop dan 390 px. BASE=http://localhost:5194 OUT=<folder foto> node qa-harness/panel-sinkron-qa.cjs
const puppeteer = require("puppeteer-core"); const path = require("path"); const fs = require("fs");
const BASE = process.env.BASE || "http://localhost:5194", OUT = process.env.OUT || "."; fs.mkdirSync(OUT, { recursive: true });
const dasar = { konfigurasiKurang: [], hariBelumRekonsiliasi: [], terakhirSukses: null, dataLengkapSampai: null, terakhirDicoba: null, hookRate: null };
const coba = (status, o = {}) => ({ waktu: "2026-11-08T05:00:00Z", status, alasanGagal: null, selisihSpend: 0, unmapped: 0, hariDitahan: 0, ...o });
const hook = { definisi: { versi: "HOOK_V1_3S_PER_IMPRESSION_VIDEO" }, total: { versi: "HOOK_V1_3S_PER_IMPRESSION_VIDEO", nilai: 36.11, coverage: { persen: 99.99 } } };
const K = [
  ["NONAKTIF", { ...dasar, keadaan: "NONAKTIF" }, /Nonaktif/],
  ["BELUM_DIKONFIGURASI", { ...dasar, keadaan: "BELUM_DIKONFIGURASI", konfigurasiKurang: ["COMPOSIO_API_KEY", "COMPOSIO_META_CONNECTED_ACCOUNT_ID"] }, /Konfigurasi belum ada: COMPOSIO_API_KEY/],
  ["GAGAL", { ...dasar, keadaan: "GAGAL", terakhirDicoba: coba("GAGAL", { alasanGagal: "AKSES_COMPOSIO_DITOLAK", selisihSpend: null }) }, /AKSES_COMPOSIO_DITOLAK/],
  ["BERJALAN", { ...dasar, keadaan: "BERJALAN", terakhirDicoba: coba("RUNNING", { selisihSpend: null }) }, /Sedang berjalan/],
  ["SUKSES", { ...dasar, keadaan: "SUKSES", terakhirDicoba: coba("SUKSES"), terakhirSukses: { waktu: "2026-11-08T05:00:00Z" }, dataLengkapSampai: "2026-11-07", hookRate: hook }, /36,11%.*HOOK_V1/s],
  ["SELISIH_KONTROL", { ...dasar, keadaan: "SELISIH_KONTROL", terakhirDicoba: coba("BELUM_DIREKONSILIASI", { selisihSpend: 1000, hariDitahan: 1 }), hariBelumRekonsiliasi: [{ tanggal: "2026-11-07", status: "BELUM_REKONSILIASI" }] }, /Selisih kontrol.*1000/s],
  ["DATA_TERLAMBAT", { ...dasar, keadaan: "DATA_TERLAMBAT", terakhirDicoba: coba("SUKSES"), dataLengkapSampai: "2026-11-01" }, /Data terlambat.*2026-11-01/s],
  ["TIDAK_TERBACA", { galatStatus: 403 }, /hanya untuk ADMIN/],
];
(async () => {
  const b = await puppeteer.launch({ executablePath: process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe", headless: "new", args: ["--no-sandbox"] }); let gagal = 0;
  for (const [vpNama, vp] of [["desktop", { width: 1440, height: 800 }], ["hp", { width: 390, height: 800, isMobile: true, hasTouch: true }]]) for (const [nama, s, re] of K) {
    const p = await b.newPage(); await p.setViewport(vp); const gal = []; p.on("pageerror", (e) => gal.push(String(e).slice(0, 120)));
    await p.goto(`${BASE}/qa-harness/panel-sinkron.html?s=${encodeURIComponent(JSON.stringify(s))}`, { waitUntil: "networkidle2", timeout: 60000 });
    await p.waitForSelector('[data-testid="status-sinkron-meta"]', { timeout: 30000 });
    const r = await p.evaluate(() => ({ k: document.querySelector('[data-testid="status-sinkron-meta"]').dataset.keadaan, t: document.body.innerText, lebar: document.documentElement.scrollWidth <= innerWidth + 1 }));
    const lulus = r.k === nama && re.test(r.t) && r.lebar && !gal.length && !/\bRp0\b|NaN|undefined/.test(r.t); if (!lulus) gagal++;
    console.log(`${lulus ? "PASS" : "FAIL"} ${vpNama} ${nama}${lulus ? "" : " " + JSON.stringify(r).slice(0, 200) + gal}`);
    await p.screenshot({ path: path.join(OUT, `${vpNama}-${nama}.png`) }); await p.close();
  }
  await b.close(); console.log(`gagal=${gagal}`); process.exit(gagal ? 1 : 0);
})();
