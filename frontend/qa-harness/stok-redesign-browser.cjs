// QA browser NYATA redesain Stok & Lokasi (Chrome via puppeteer-core): komponen ASLI (Vite) + backend ASLI di atas database SANDBOX terisolasi (stok-redesign-server.mjs; semua bahan berkode SBX-… = data sandbox).
//   BASE=http://127.0.0.1:5191 API=http://127.0.0.1:4010 OUT=C:/tmp/km-stok-redesign-qa DB=km_stok_redesign_qa_test PGPORT=55443 node frontend/qa-harness/stok-redesign-browser.cjs
const puppeteer = require("puppeteer-core"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:5191"; const OUT = process.env.OUT || "C:/tmp/km-stok-redesign-qa";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0; const hasil = [];
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const sql = (q) => require("child_process").execFileSync(process.execPath, [path.join(__dirname, "qa-sql.cjs"), q], { encoding: "utf8", env: { ...process.env, QA_DB_URL: `postgresql://klinik:klinik123@localhost:${process.env.PGPORT || 55443}/${process.env.DB || "km_stok_redesign_qa_test"}` } }).trim();
const stokDb = (kode) => Number(sql(`select coalesce(sum(qty),0) from stock_movements s join materials m on m.id=s.material_id where m.code='${kode}'`));

const tampakAda = (page, s) => page.waitForFunction((x) => [...document.querySelectorAll(x)].some((e) => e.getClientRects().length > 0), { timeout: 30000 }, s);
const tungguBaris = (page) => tampakAda(page, '[data-testid="baris-stok"]');
async function buka(browser, siapa, rute, { lebar = 1440, tinggi = 900, hp = false, tema = "" } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(30000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((t, u, th) => { try { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); if (th) localStorage.setItem("sano-theme", th); } catch (e) { /* abaikan */ } }, T[siapa].token, T[siapa].user, tema);
  page.galat = []; page.on("pageerror", (e) => page.galat.push(String(e).slice(0, 200)));
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  await tungguBaris(page).catch(() => {});
  return page;
}
const teks = (page, s) => page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0) ?? document.querySelector(x); return e ? e.textContent.trim() : null; }, s).catch(() => null);
const foto = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png") });
const klikTampak = async (page, s) => { await tampakAda(page, s); await page.evaluate((x) => { const e = [...document.querySelectorAll(x)].find((y) => y.getClientRects().length > 0); e.scrollIntoView({ block: "center" }); e.click(); }, s); };
const isi = async (page, s, v) => { await page.$eval(s, (el, val) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : el.tagName === "SELECT" ? HTMLSelectElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); }, v); };
const kodeBaris = (page) => page.$$eval('[data-testid="baris-stok"]', (b) => b.filter((x) => x.getClientRects().length > 0).map((x) => x.dataset.kode));
const barisInfo = (page, kode) => page.$eval(`[data-testid="baris-stok"][data-kode="${kode}"]`, (b) => ({ teks: b.textContent.replace(/\s+/g, " ").trim(), status: b.dataset.status, jenis: b.querySelector('[data-testid="sel-saldo"]')?.dataset.jenis })).catch(() => null);
const tanpaGulirMendatar = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
const urlQ = (page) => new URL(page.url()).search;
const tinggiTombol = (page, s) => page.$$eval(s, (els) => els.filter((e) => e.getClientRects().length > 0).map((e) => Math.round(e.getBoundingClientRect().height)));
const bukaBahan = async (page, kode) => { await page.goto(BASE + `/warehouse/inventory?q=${kode}`, { waitUntil: "domcontentloaded" }); await tungguBaris(page); return barisInfo(page, kode); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null });
  try {
    // ── 1. Daftar langsung terlihat; angka dari data yang sama ──
    const F = await buka(browser, "finance", "/warehouse/inventory");
    ok("daftar langsung terlihat tanpa memilih kelompok (25 baris pertama)", (await kodeBaris(F)).length === 25, `${(await kodeBaris(F)).length} baris`);
    const semuaAktif = Number(sql("select count(*) from materials where active"));
    ok("ringkasan 'Bahan aktif' = jumlah bahan aktif di database", Number(await teks(F, '[data-testid="n-aktif"]')) === semuaAktif, `${await teks(F, '[data-testid="n-aktif"]')} vs ${semuaAktif}`);
    ok("jumlah tampil 55 + kontrol halaman (>25)", /55 bahan tampil/.test(await teks(F, '[data-testid="jumlah-tampil"]')) && !!(await F.$('[data-testid="halaman-berikutnya"]')));
    ok("rentang halaman jujur: 1–25 dari 55", /1–25 dari 55/.test(await teks(F, '[data-testid="rentang-tampil"]')), await teks(F, '[data-testid="rentang-tampil"]'));
    await foto(F, "01-daftar-desktop");
    const totalKelompok = await F.$$eval('[data-testid^="kelompok-"][data-total]', (b) => b.reduce((n, x) => n + Number(x.dataset.total), 0));
    ok("jumlah per kategori dari data yang sama: total semua kelompok = bahan aktif", totalKelompok === semuaAktif, String(totalKelompok));
    await klikTampak(F, '[data-testid="halaman-berikutnya"]'); await tidur(300);
    ok("halaman berikutnya menampilkan 26–50 (25 baris)", /26–50 dari 55/.test(await teks(F, '[data-testid="rentang-tampil"]')) && (await kodeBaris(F)).length === 25);

    // ── 2. Keadaan stok + harga (angka dan izin) ──
    const belum = await bukaBahan(F, "SBX-SOFT-D23"); const nolG = await bukaBahan(F, "SBX-KNIT-ABU"); const nolV = await bukaBahan(F, "SBX-REB-120"); const minus = await bukaBahan(F, "SBX-LATEX-7");
    const guard = await bukaBahan(F, "SBX-SANO-GUARD-150"); const n44 = await bukaBahan(F, "SBX-HR-N44");
    ok("stok BELUM ADA CATATAN tampil 'belum diketahui' (bukan 0)", belum?.jenis === "BELUM_DIKETAHUI" && /belum diketahui/i.test(belum.teks) && !/\b0\s*kg/.test(belum.teks), belum?.teks);
    ok("nol menurut pergerakan: status 'Nol menurut pergerakan'", nolG?.status === "NOL_PERGERAKAN" && /Nol menurut pergerakan/.test(nolG.teks), nolG?.teks);
    ok("nol TERVERIFIKASI: status 'Nol terverifikasi'", nolV?.status === "NOL_TERVERIFIKASI" && /Nol terverifikasi/.test(nolV.teks), nolV?.teks);
    ok("saldo minus: angka minus + status 'Saldo minus'", minus?.status === "MINUS" && /-2/.test(minus.teks), minus?.teks);
    ok("tiga keadaan (belum diketahui / nol gerak / nol verifikasi) saling berbeda", new Set([belum?.status, nolG?.status, nolV?.status]).size === 3);
    ok("harga ada: 'Rp36.000 / kg'; belum ada: 'Belum ada harga berlaku' (BUKAN Rp0)", /Rp36\.000 \/ kg/.test(n44?.teks ?? "") && /Belum ada harga berlaku/.test(belum?.teks ?? "") && !/Rp\s?0\b/.test(belum?.teks ?? ""), `${n44?.teks} | ${belum?.teks}`);
    ok("stok belum diketahui tetapi ada harga: kedua informasi tampil, tidak tertukar", /belum diketahui/i.test(guard?.teks ?? "") && /Rp101\.000/.test(guard?.teks ?? ""), guard?.teks);
    const G = await buka(browser, "gudang", "/warehouse/inventory?q=SBX-HR");
    ok("Gudang (tanpa finance:read): tidak ada kolom harga dan tidak ada ubin 'Harga belum diisi'", (await G.$$('[data-testid="sel-harga"]')).length === 0 && !(await G.$('[data-testid="ubin-harga"]')) && !/Harga \/ satuan/i.test(await G.evaluate(() => document.body.innerText)));

    // ── 3. Pencarian + Filter + chip + URL ──
    await F.goto(BASE + "/warehouse/inventory", { waitUntil: "domcontentloaded" }); await tungguBaris(F);
    await isi(F, '[data-testid="cari-bahan"]', "paku 1"); await tidur(500);
    const hasilCari = await kodeBaris(F);
    ok("pencarian 'paku 1' = Paku 1 dan 10–19 (11 bahan); URL memuat q", hasilCari.length === 11 && /q=paku/.test(urlQ(F)), `${hasilCari.length} ${urlQ(F)}`);
    await isi(F, '[data-testid="cari-bahan"]', ""); await tidur(300);
    ok("tanpa saringan: tombol Filter tanpa lencana", !(await F.$('[data-testid="jumlah-filter"]')));
    await klikTampak(F, '[data-testid="tombol-filter"]'); await tampakAda(F, '[data-testid="panel-saringan"]');
    await foto(F, "02-filter-terbuka-desktop");
    ok("panel Filter terbuka (aria-expanded) dan fokus pindah ke isi panel", (await F.$eval('[data-testid="tombol-filter"]', (e) => e.getAttribute("aria-expanded"))) === "true" && (await F.evaluate(() => document.querySelector('[data-testid="panel-saringan"]').contains(document.activeElement))));
    await isi(F, '[data-testid="saring-keadaan"]', "MINUS"); await tidur(300); await isi(F, '[data-testid="saring-satuan"]', "M3"); await tidur(300);
    ok("dua saringan: lencana = 2; URL memuat keadaan & satuan; daftar = Busa Latex (minus)", (await teks(F, '[data-testid="jumlah-filter"]')) === "2" && /keadaan=MINUS/.test(urlQ(F)) && /satuan=M3/.test(urlQ(F)) && (await kodeBaris(F)).join() === "SBX-LATEX-7", `${urlQ(F)} ${(await kodeBaris(F)).join()}`);
    await F.keyboard.press("Escape"); await tidur(300);
    ok("Esc menutup panel dan fokus kembali ke tombol Filter", !(await F.$('[data-testid="panel-saringan"]')) && (await F.evaluate(() => document.activeElement?.dataset.testid)) === "tombol-filter");
    ok("saringan aktif menjadi chip (keadaan + satuan)", !!(await F.$('[data-testid="chip-keadaan"]')) && !!(await F.$('[data-testid="chip-satuan"]')));
    await foto(F, "03-chip-aktif-desktop");
    await F.evaluate(() => document.querySelector('[data-testid="chip-keadaan"] button').click()); await tidur(300);
    ok("hapus chip keadaan: hanya itu hilang; satuan tetap; URL ikut", !(await F.$('[data-testid="chip-keadaan"]')) && !!(await F.$('[data-testid="chip-satuan"]')) && !/keadaan=/.test(urlQ(F)) && /satuan=M3/.test(urlQ(F)));
    await F.evaluate(() => document.querySelector('[data-testid="chip-satuan"] button').click()); await tidur(300);
    ok("semua chip dihapus: daftar kembali 55", /55 bahan tampil/.test(await teks(F, '[data-testid="jumlah-tampil"]')) && !(await F.$('[data-testid="chip-saringan"]')));
    await F.goto(BASE + "/warehouse/inventory?keadaan=ADA&harga=BELUM&kelompok=AKSESORI", { waitUntil: "domcontentloaded" }); await tungguBaris(F);
    ok("URL lama tetap berfungsi (keadaan+harga+kelompok): kategori Aksesori terpilih, chip harga, 9 baris", (await F.$eval('[data-testid="kelompok-AKSESORI"]', (e) => e.getAttribute("aria-pressed"))) === "true" && !!(await F.$('[data-testid="chip-harga"]')) && (await kodeBaris(F)).length === 9, `${(await kodeBaris(F)).length} baris`);
    await F.goto(BASE + "/warehouse/inventory?q=tidak-ada-bahan-ini", { waitUntil: "domcontentloaded" }); await tampakAda(F, '[data-testid="daftar-kosong"]');
    ok("hasil kosong: pesan jelas", /Tidak ada bahan yang cocok/.test(await teks(F, '[data-testid="daftar-kosong"]')));
    await F.goto(BASE + "/warehouse/inventory", { waitUntil: "domcontentloaded" }); await tungguBaris(F);
    await klikTampak(F, '[data-testid="perhatian-minus"]'); await tidur(300);
    ok("tombol 'saldo minus' di ringkasan menyaring ke keadaan MINUS (1 bahan)", /keadaan=MINUS/.test(urlQ(F)) && (await kodeBaris(F)).length === 1);

    // ── 4. Drawer ──
    await F.goto(BASE + "/warehouse/inventory?q=SBX-HR-N44", { waitUntil: "domcontentloaded" }); await tungguBaris(F);
    await F.evaluate(() => [...document.querySelectorAll('[data-testid="baris-stok"]')].find((e) => e.getClientRects().length > 0).focus()); await F.keyboard.press("Enter"); await tampakAda(F, '[data-testid="drawer-bahan"]');
    ok("baris dibuka dengan keyboard (Enter) → drawer bahan", (await teks(F, '[data-testid="drawer-nama"]')) === "Busa HR Foam N44");
    ok("drawer: tersedia 50 kg; harga di header Rp36.000 / kg; kelompok Busa", /50\s*kg/.test(await teks(F, '[data-testid="stok-tersedia"]')) && /Rp36\.000 \/ kg/.test(await teks(F, '[data-testid="header-harga"]')) && /Busa/.test(await teks(F, '[data-testid="drawer-kelompok"]')));
    ok("drawer: Stok, Harga, Detail bahan, Riwayat tersusun; tambahan terlipat", !!(await F.$('[data-testid="kartu-stok"]')) && !!(await F.$('[data-testid="panel-harga-berlaku"]')) && (await F.$eval('[data-testid="lipat-detail-bahan"]', (d) => d.open)) === false && (await F.$eval('[data-testid="lipat-pergerakan"]', (d) => d.open)) === false);
    await F.evaluate(() => { document.querySelector('[data-testid="lipat-detail-bahan"] summary').click(); }); await tidur(300);
    const det = await teks(F, '[data-testid="lipat-detail-bahan"]');
    ok("Detail bahan memuat Kelompok, Riwayat penerimaan, Batas minimum, Vendor", /Kelompok/.test(det) && /Riwayat penerimaan/.test(det) && /Batas minimum/.test(det) && /PT Busa Nusantara/.test(det), det.slice(0, 120));
    await foto(F, "04-drawer-desktop");
    await F.evaluate(() => document.querySelector('[data-testid="tombol-riwayat-harga"]').click()); await tampakAda(F, '[data-testid="riwayat-harga"]'); await F.waitForFunction(() => /Rp36.000/.test(document.querySelector('[data-testid="riwayat-harga"]')?.textContent ?? ""), { timeout: 15000 }).catch(() => {});
    ok("Riwayat harga tetap ada (Rp36.000)", /Rp36\.000/.test(await teks(F, '[data-testid="riwayat-harga"]')));
    ok("Finance: tombol Ubah harga ada; Koreksi saldo tidak ada (tanpa inventory:write)", !!(await F.$('[data-testid="tombol-ubah-harga"]')) && !(await F.$('[data-testid="tombol-koreksi-saldo"]')));
    await F.keyboard.press("Escape"); await tidur(400);
    ok("Esc menutup drawer", !(await F.$('[data-testid="drawer-bahan"]')));
    await F.goto(BASE + "/warehouse/inventory?q=SBX-SOFT-D23", { waitUntil: "domcontentloaded" }); await tungguBaris(F); await klikTampak(F, '[data-testid="baris-stok"]'); await tampakAda(F, '[data-testid="drawer-bahan"]'); await tidur(700);
    const tTersedia = await teks(F, '[data-testid="stok-tersedia"]'); const tSaldo = await teks(F, '[data-testid="stok-saldo"]');
    ok("drawer stok belum diketahui: 'Belum diketahui' di Tersedia dan Saldo (bukan 0)", /belum diketahui/i.test(tTersedia) && /belum diketahui/i.test(tSaldo), `${tTersedia} | ${tSaldo}`);
    await tampakAda(F, '[data-testid="belum-ada-harga"]').catch(() => {});
    ok("drawer tanpa harga: 'Belum diisi' (bukan Rp0)", /Belum (diisi|ada harga)/i.test((await teks(F, '[data-testid="belum-ada-harga"]')) ?? "") && !/(?<!bukan )Rp\s?0\b/.test(await F.evaluate(() => document.querySelector('[data-testid="drawer-bahan"]').innerText))); // kalimat penjelas "(bukan Rp0)" tidak dihitung
    await foto(F, "05-drawer-belum-diketahui-desktop"); await F.keyboard.press("Escape");

    // ── 5. Formulir pratinjau Koreksi saldo (Gudang, sandbox) — TANPA mengajukan ──
    await G.goto(BASE + "/warehouse/inventory?q=SBX-HR-N44", { waitUntil: "domcontentloaded" }); await tungguBaris(G);
    await klikTampak(G, '[data-testid="baris-stok"]'); await tampakAda(G, '[data-testid="tombol-koreksi-saldo"]');
    ok("Gudang: tombol Koreksi saldo ada; Ubah harga tidak ada (tanpa izin Finance)", !!(await G.$('[data-testid="tombol-koreksi-saldo"]')) && !(await G.$('[data-testid="tombol-ubah-harga"]')));
    await klikTampak(G, '[data-testid="tombol-koreksi-saldo"]'); await tampakAda(G, '[data-testid="modal-koreksi-saldo"]');
    await isi(G, "#ks-jumlah", "45"); await isi(G, "#ks-alasan", "Hitung fisik sandbox: sisa 45 kg"); await klikTampak(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tampakAda(G, '[data-testid="pratinjau-koreksi"]');
    ok("pratinjau: saldo 50, fisik 45, selisih -5; stok DB tetap 50; tidak ada pengajuan", /50/.test(await teks(G, '[data-testid="pra-saldo-sebelum"]')) && /-5/.test(await teks(G, '[data-testid="pra-selisih"]')) && stokDb("SBX-HR-N44") === 50 && Number(sql("select count(*) from stock_adjustment_requests")) === 0);
    await foto(G, "06-form-pratinjau-desktop"); await G.keyboard.press("Escape"); await tidur(300);

    // ── 6. HP 390×844 ──
    const H = await buka(browser, "finance", "/warehouse/inventory", { lebar: 390, tinggi: 844, hp: true });
    ok("HP: daftar tanpa gulir horizontal halaman", await tanpaGulirMendatar(H));
    const tinggiBaris = await tinggiTombol(H, 'button[data-testid="baris-stok"]');
    ok("HP: 25 baris langsung terlihat; tiap baris ≥ 44px", (await kodeBaris(H)).length === 25 && tinggiBaris.every((h) => h >= 44), `${Math.min(...tinggiBaris)}px`);
    ok("HP: tombol Filter dan pilihan kategori ≥ 44px", (await tinggiTombol(H, '[data-testid="tombol-filter"]')).every((h) => h >= 44) && (await tinggiTombol(H, '[data-testid="kelompok-semua"]')).every((h) => h >= 44));
    await foto(H, "07-daftar-hp");
    ok("HP: baris pertama daftar sudah terlihat tanpa gulir (ringkasan tidak mendominasi)", await H.evaluate(() => document.querySelector('button[data-testid="baris-stok"]').getBoundingClientRect().top < window.innerHeight));
    await klikTampak(H, '[data-testid="tombol-filter"]'); await tampakAda(H, '[data-testid="panel-saringan"]'); await tidur(300);
    ok("HP: panel Filter = lembar bawah, terjangkau (kontrol ≥ 44px, tombol Selesai terlihat)", await H.evaluate(() => { const p = document.querySelector('[data-testid="panel-saringan"]').getBoundingClientRect(); const s = document.querySelector('[data-testid="selesai-saringan"]').getBoundingClientRect(); return p.bottom <= window.innerHeight + 1 && s.height >= 44 && s.bottom <= window.innerHeight + 1; }) && (await tinggiTombol(H, '[data-testid="saring-keadaan"]')).every((h) => h >= 44));
    await foto(H, "08-filter-hp");
    await isi(H, '[data-testid="saring-keadaan"]', "ADA"); await klikTampak(H, '[data-testid="selesai-saringan"]'); await tidur(400);
    ok("HP: chip saringan tampil dengan tombol hapus ≥ 44px; tanpa gulir horizontal", (await tinggiTombol(H, '[data-testid="chip-keadaan"] button')).every((h) => h >= 44) && await tanpaGulirMendatar(H));
    await H.goto(BASE + "/warehouse/inventory?q=SBX-HR-N44", { waitUntil: "domcontentloaded" }); await tungguBaris(H);
    await klikTampak(H, 'button[data-testid="baris-stok"]'); await tampakAda(H, '[data-testid="drawer-bahan"]'); await tidur(700);
    ok("HP: drawer lembar bawah; tombol Ubah harga/Riwayat ≥ 44px; tanpa gulir horizontal", (await tinggiTombol(H, '[data-testid="tombol-ubah-harga"]')).every((h) => h >= 44) && (await tinggiTombol(H, '[data-testid="tombol-riwayat-harga"]')).every((h) => h >= 44) && await tanpaGulirMendatar(H));
    await foto(H, "09-drawer-hp");
    const HG = await buka(browser, "gudang", "/warehouse/inventory?q=SBX-HR-N44", { lebar: 390, tinggi: 844, hp: true });
    await klikTampak(HG, 'button[data-testid="baris-stok"]'); await tampakAda(HG, '[data-testid="tombol-koreksi-saldo"]'); await klikTampak(HG, '[data-testid="tombol-koreksi-saldo"]'); await tampakAda(HG, '[data-testid="modal-koreksi-saldo"]');
    await isi(HG, "#ks-jumlah", "4,5"); await isi(HG, "#ks-alasan", "Hitung fisik sandbox HP"); await klikTampak(HG, '[data-testid="lihat-pratinjau-koreksi"]'); await tampakAda(HG, '[data-testid="pratinjau-koreksi"]');
    await tidur(700); // modal beranimasi masuk (zoom): ukur setelah selesai
    ok("HP: formulir pratinjau — koma desimal dibaca (4,5 → selisih -45,5); tombol Ajukan ≥ 44px; tanpa gulir horizontal", /-45,5/.test(await teks(HG, '[data-testid="pra-selisih"]')) && (await tinggiTombol(HG, '[data-testid="ajukan-koreksi"]')).every((h) => h >= 44) && await tanpaGulirMendatar(HG));
    await foto(HG, "10-form-pratinjau-hp");
    ok("QA tidak menyimpan pengajuan apa pun; stok sandbox tetap", Number(sql("select count(*) from stock_adjustment_requests")) === 0 && stokDb("SBX-HR-N44") === 50);

    // ── 7. Keyboard + tema gelap ──
    const K = await buka(browser, "finance", "/warehouse/inventory");
    await K.evaluate(() => document.querySelector('[data-testid="cari-bahan"]').focus());
    const urutan = []; for (let i = 0; i < 2; i++) { await K.keyboard.press("Tab"); urutan.push(await K.evaluate(() => document.activeElement?.dataset?.testid || document.activeElement?.getAttribute("aria-label") || document.activeElement?.tagName)); }
    ok("Tab dari pencarian → Filter → pilihan kategori (urutan logis)", urutan[0] === "tombol-filter" && /kelompok-semua/.test(urutan[1]), urutan.join(" > "));
    const D = await buka(browser, "finance", "/warehouse/inventory", { tema: "dark" });
    const gelap = await D.evaluate(() => document.documentElement.getAttribute("data-theme")); await foto(D, "11-daftar-tema-gelap");
    ok("tema gelap yang sudah ada dihormati (data-theme=dark) dan daftar tampil", gelap === "dark" && (await kodeBaris(D)).length === 25, String(gelap));
    ok("tidak ada galat JS tak tertangani", [F, G, H, HG, K, D].every((p) => p.galat.length === 0), [F, G, H, HG, K, D].flatMap((p) => p.galat).join(" | "));
  } catch (e) { gagal++; console.log("FAIL  SKRIP BERHENTI: " + (e.stack || e).toString().slice(0, 700)); }
  finally { await browser.close(); fs.writeFileSync(path.join(OUT, "hasil-qa.json"), JSON.stringify({ gagal, hasil }, null, 2)); console.log(`\n${hasil.filter((h) => h.ok).length}/${hasil.length} PASS, ${gagal} gagal`); process.exit(gagal ? 1 : 0); }
})();
