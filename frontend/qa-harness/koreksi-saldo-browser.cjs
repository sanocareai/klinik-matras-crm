// QA browser NYATA (Chrome via puppeteer-core) — Koreksi Saldo per bahan di Stok & Lokasi, desktop + HP, terhadap server + database TERISOLASI (koreksi-saldo-server.mjs; bukan production).
//   BASE=http://127.0.0.1:5190 API=http://127.0.0.1:4010 OUT=C:/tmp/km-koreksi-qa PGC=km-koreksi-saldo-pg DB=km_koreksi_saldo_qa_test node frontend/qa-harness/koreksi-saldo-browser.cjs
const puppeteer = require("puppeteer-core");
const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:5190"; const API = process.env.API || "http://127.0.0.1:4010"; const OUT = process.env.OUT || "C:/tmp/km-koreksi-qa";
const PGC = process.env.PGC || "km-koreksi-saldo-pg"; const DB = process.env.DB || "km_koreksi_saldo_qa_test"; const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const ID = JSON.parse(fs.readFileSync(path.join(OUT, "ids.json"), "utf8"));
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execFileSync(process.execPath, [path.join(__dirname, "qa-sql.cjs"), q], { encoding: "utf8", env: { ...process.env, QA_DB_URL: process.env.QA_DB_URL || `postgresql://klinik:klinik123@localhost:${process.env.PGPORT || 55442}/${DB}` } }).trim(); // lewat TCP, tanpa docker CLI
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0; const hasil = [];
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const api = async (siapa, method, p, body, headers = {}) => { const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[siapa].token}`, ...headers }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const nReq = () => Number(sql("select count(*) from stock_adjustment_requests")); const nCtx = () => Number(sql("select count(*) from koreksi_saldo_bahan"));
const saldoDb = (kode) => Number(sql(`select coalesce(sum(qty),0) from stock_movements s join materials m on m.id=s.material_id where m.code='${kode}'`));

async function buka(browser, siapa, rute, { lebar = 1280, tinggi = 900, hp = false } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(25000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((token, user) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); } catch (e) {} }, T[siapa].token, T[siapa].user);
  page.galatKonsol = []; page.on("pageerror", (e) => page.galatKonsol.push(String(e).slice(0, 200)));
  page.posts = []; page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/koreksi-saldo/ajukan")) page.posts.push(r.url()); });
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
const tunggu = (page, sel, ms = 30000) => page.waitForSelector(sel, { timeout: ms, visible: true });
const teks = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
const foto = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png") });
// Klik elemen tampak pertama (daftar punya versi tabel desktop dan kartu HP berdampingan di DOM).
async function klikTampak(page, sel) {
  await page.waitForFunction((s) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null), { timeout: 20000 }, sel);
  const h = await page.evaluateHandle((s) => [...document.querySelectorAll(s)].find((e) => e.offsetParent !== null), sel);
  await h.asElement().evaluate((e) => e.scrollIntoView({ block: "center" })); await h.asElement().click();
}
const klik = async (page, sel) => { await tunggu(page, sel, 15000); await page.$eval(sel, (e) => e.scrollIntoView({ block: "center" })); await page.click(sel); };
// Isi nilai lewat setter bawaan + event input (React membaca ini seperti ketikan; menghindari kelemahan klik-tiga-kali/Ctrl+A pada input yang dirender ulang).
const ketik = async (page, sel, v) => { await tunggu(page, sel); await page.$eval(sel, (el, val) => { const proto = el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype; Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val); el.dispatchEvent(new Event("input", { bubbles: true })); }, v); };
const bukaBahan = async (page, kode) => { await page.goto(`${BASE}/warehouse/inventory?q=${encodeURIComponent(kode)}`, { waitUntil: "domcontentloaded" }); await tunggu(page, `[data-testid="baris-stok"][data-kode="${kode}"]`).catch(() => {}); await klikTampak(page, `[data-testid="baris-stok"][data-kode="${kode}"]`); await tunggu(page, '[data-testid="panel-koreksi-saldo"]'); };
const tanpaGulirMendatar = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null });
  try {
    // ── 1. Daftar Stok & Lokasi (Gudang, desktop): tiga "nol" berbeda, tanpa kolom harga (tanpa izin Finance) ──
    const G = await buka(browser, "gudang", "/warehouse/inventory?q=QA");
    await tunggu(G, '[data-testid="baris-stok"]'); await tidur(1200);
    const jenis = await G.$$eval('tr[data-testid="baris-stok"]', (rs) => Object.fromEntries(rs.map((r) => [r.dataset.kode, { j: r.querySelector('[data-testid="sel-saldo"]')?.dataset.jenis, t: r.querySelector('[data-testid="sel-saldo"]')?.textContent.trim() }])));
    ok("daftar: belum ada catatan = 'belum diketahui' (BUKAN 0)", jenis["BUSA-QA-KOSONG"]?.j === "BELUM_DIKETAHUI" && /belum diketahui/.test(jenis["BUSA-QA-KOSONG"].t), JSON.stringify(jenis["BUSA-QA-KOSONG"]));
    ok("daftar: nol menurut pergerakan tampil '0 menurut pergerakan'", jenis["KAIN-QA-NOL-GERAK"]?.j === "NOL" && /menurut pergerakan/.test(jenis["KAIN-QA-NOL-GERAK"].t), JSON.stringify(jenis["KAIN-QA-NOL-GERAK"]));
    ok("daftar: nol TERVERIFIKASI hitung fisik tampil '0 terverifikasi'", jenis["KAIN-QA-NOL-VERIF"]?.j === "NOL_TERVERIFIKASI" && /terverifikasi/.test(jenis["KAIN-QA-NOL-VERIF"].t), JSON.stringify(jenis["KAIN-QA-NOL-VERIF"]));
    ok("daftar: saldo minus tampil minus", jenis["PEGAS-QA-MINUS"]?.j === "MINUS", JSON.stringify(jenis["PEGAS-QA-MINUS"]));
    ok("daftar: tiga keadaan nol berbeda satu sama lain", new Set([jenis["BUSA-QA-KOSONG"]?.j, jenis["KAIN-QA-NOL-GERAK"]?.j, jenis["KAIN-QA-NOL-VERIF"]?.j]).size === 3);
    ok("Gudang (tanpa finance:read): kolom Harga berlaku tidak tampil, tidak ada galat", (await G.$$('[data-testid="sel-harga"]')).length === 0 && G.galatKonsol.length === 0, G.galatKonsol.join("|"));
    await foto(G, "01-daftar-gudang-desktop");

    // ── 2. Finance: kolom Harga berlaku per satuan; tanpa harga = 'Belum ada harga berlaku' (bukan Rp0) ──
    const F = await buka(browser, "finance", "/warehouse/inventory?q=QA");
    await tunggu(F, '[data-testid="baris-stok"]'); await F.waitForSelector('[data-testid="sel-harga"]', { timeout: 15000 }).catch(() => {});
    const harga = await F.$$eval('tr[data-testid="baris-stok"]', (rs) => Object.fromEntries(rs.map((r) => [r.dataset.kode, r.querySelector('[data-testid="sel-harga"]')?.textContent.trim().replace(/\s+/g, " ")])));
    ok("Finance: harga berlaku per satuan stok di daftar (Rp36.000 / kg)", /Rp36\.000.*kg/.test(harga["BUSA-QA-10"] ?? ""), harga["BUSA-QA-10"]);
    ok("Finance: bahan tanpa harga = 'Belum ada harga berlaku', bukan Rp0", /Belum ada harga berlaku/.test(harga["BUSA-QA-KOSONG"] ?? "") && !/Rp0/.test(harga["BUSA-QA-KOSONG"] ?? ""), harga["BUSA-QA-KOSONG"]);
    await foto(F, "02-daftar-finance-harga-desktop");
    // Finance: drawer — tanpa tombol Koreksi saldo (tidak punya inventory:write), tetap melihat keadaan saldo + izin
    await klikTampak(F, '[data-testid="baris-stok"][data-kode="BUSA-QA-10"]'); await tunggu(F, '[data-testid="panel-koreksi-saldo"]');
    ok("Finance: tidak ada tombol Koreksi saldo; teks izin menjelaskan", (await F.$('[data-testid="tombol-koreksi-saldo"]')) === null && /hanya dapat melihat/.test((await teks(F, '[data-testid="izin-koreksi"]')) ?? ""), await teks(F, '[data-testid="izin-koreksi"]'));
    await F.waitForSelector('[data-testid="nilai-persediaan-finance"]', { timeout: 15000 }).catch(() => {});
    ok("Finance: nilai persediaan Finance tampil terpisah dari Harga Berlaku (belum ada Persediaan Awal = bukan Rp0)", /BUKAN Rp0/.test((await teks(F, '[data-testid="nilai-persediaan-finance"]')) ?? ""), await teks(F, '[data-testid="nilai-persediaan-finance"]'));
    await foto(F, "03-drawer-finance");

    // ── 3. Gudang: alur lengkap di drawer BUSA-QA-10 (saldo 10, fisik 7) ──
    await bukaBahan(G, "BUSA-QA-10");
    ok("drawer: keadaan saldo 'ada stok' + tombol Koreksi saldo tersedia", (await G.$eval('[data-testid="keadaan-saldo"]', (e) => e.dataset.keadaan)) === "POSITIF" && !!(await G.$('[data-testid="tombol-koreksi-saldo"]')));
    await klik(G, '[data-testid="tombol-koreksi-saldo"]'); await tunggu(G, '[data-testid="modal-koreksi-saldo"]');
    await foto(G, "04-modal-kosong-desktop");
    await klik(G, '[data-testid="lihat-pratinjau-koreksi"]');
    ok("validasi: jumlah kosong BUKAN nol + alasan wajib (tidak ada panggilan pratinjau)", /isi 0 bila memang kosong/.test(await G.$eval("#ks-jumlah", (e) => e.closest("div.flex-col").textContent)) && !(await G.$('[data-testid="pratinjau-koreksi"]')));
    await ketik(G, "#ks-jumlah", "-2"); await ketik(G, "#ks-alasan", "abc"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]');
    ok("validasi: minus ditolak; alasan terlalu pendek ditolak", /minus/.test(await G.$eval("#ks-jumlah", (e) => e.closest("div.flex-col").textContent)) && /minimal 5/.test(await G.$eval("#ks-alasan", (e) => e.closest("div.flex-col").textContent)));
    await ketik(G, "#ks-jumlah", "7"); await ketik(G, "#ks-alasan", "Hitung fisik 26 Okt: sisa 7 kg"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(G, '[data-testid="pratinjau-koreksi"]');
    ok("pratinjau: saldo sebelum 10, fisik 7, selisih -3 (turun)", /10/.test(await teks(G, '[data-testid="pra-saldo-sebelum"]')) && /7/.test(await teks(G, '[data-testid="pra-jumlah-fisik"]')) && /-3/.test(await teks(G, '[data-testid="pra-selisih"]')) && (await G.$eval('[data-testid="pra-selisih"]', (e) => e.dataset.arah)) === "TURUN", await teks(G, '[data-testid="pra-selisih"]'));
    ok("pratinjau: stok belum berubah (DB tetap 10) dan tidak ada pengajuan tersimpan", saldoDb("BUSA-QA-10") === 10 && nReq() === 0 && nCtx() === 0);
    await G.$eval('[data-testid="pra-dampak-data"] summary', (e) => e.click()); await tidur(200);
    ok("pratinjau memuat dampak: ditulis saat ajukan/posting + tidak menyentuh Harga Berlaku/jurnal", /Harga Berlaku/.test(await teks(G, '[data-testid="pra-dampak-data"]')) && /jurnal/i.test(await teks(G, '[data-testid="pra-dampak-data"]')));
    await foto(G, "05-pratinjau-desktop");
    // klik ganda cepat pada Ajukan
    await G.$eval('[data-testid="ajukan-koreksi"]', (e) => { e.click(); e.click(); e.click(); });
    await tunggu(G, '[data-testid="hasil-koreksi"]');
    const nomor = await teks(G, '[data-testid="hasil-nomor"]');
    ok("klik ganda: tepat SATU pengajuan + SATU konteks tercatat", nReq() === 1 && nCtx() === 1 && G.posts.length <= 3, `req=${nReq()} ctx=${nCtx()} posts=${G.posts.length}`);
    ok("hasil: nomor ADJ + status 'Menunggu persetujuan orang lain' + 'Stok belum berubah'", /^ADJ-\d{6}-\d{2}$/.test(nomor) && /Menunggu persetujuan/.test(await teks(G, '[data-testid="hasil-status"]')) && /Stok belum berubah/.test(await teks(G, '[data-testid="hasil-stok-belum-berubah"]')), `${nomor}`);
    ok("setelah diajukan stok di DB masih 10", saldoDb("BUSA-QA-10") === 10);
    await foto(G, "06-hasil-desktop");
    const reqId = sql("select id from stock_adjustment_requests limit 1");
    await klik(G, '[data-testid="tutup-hasil"]'); await tidur(600);
    ok("drawer: koreksi aktif ditandai + tombol Koreksi saldo dinonaktifkan", (await G.$('[data-testid="koreksi-aktif"]')) !== null && (await G.$eval('[data-testid="tombol-koreksi-saldo"]', (e) => e.disabled)));
    await klik(G, '[data-testid="tombol-riwayat-koreksi"]'); await tunggu(G, '[data-testid="baris-riwayat-koreksi"]');
    ok("riwayat koreksi bahan menampilkan pengajuan (fisik 7, selisih -3, alasan)", /7/.test(await teks(G, '[data-testid="baris-riwayat-koreksi"]')) && /-3/.test(await teks(G, '[data-testid="baris-riwayat-koreksi"]')) && /Hitung fisik 26 Okt/.test(await teks(G, '[data-testid="baris-riwayat-koreksi"]')));
    await foto(G, "07-drawer-riwayat-desktop");

    // ── 4. Persetujuan orang lain di halaman Penyesuaian (Owner) memuat konteks koreksi; pengaju tak bisa menyetujui ──
    const selfOk = await api("gudang", "PATCH", `/api/inventory/adjustments/${reqId}`, { status: "APPROVED" });
    ok("pengaju (Gudang) tidak bisa menyetujui koreksinya sendiri", selfOk.status === 403, `status ${selfOk.status}`);
    const O = await buka(browser, "owner", `/warehouse/adjustments/stock/${reqId}`);
    await tunggu(O, '[data-testid="kartu-koreksi-saldo"]');
    ok("halaman Penyesuaian memuat kartu Koreksi saldo: fisik 7, saldo dilihat 10", /7/.test(await teks(O, '[data-testid="ks-fisik"]')) && /10/.test(await teks(O, '[data-testid="ks-dilihat"]')));
    await foto(O, "08-penyesuaian-owner-desktop");
    // saldo bergeser SETELAH diajukan: kartu menandai kedaluwarsa dan server menolak persetujuan
    sql("insert into stock_movements (id, material_id, type, qty, note) select gen_random_uuid(), id, 'ISSUE', -1, 'pemakaian setelah pengajuan' from materials where code='BUSA-QA-10'");
    await O.reload({ waitUntil: "domcontentloaded" }); await tunggu(O, '[data-testid="ks-kedaluwarsa"]');
    ok("saldo bergeser setelah diajukan: kartu menandai KEDALUWARSA", /bergeser/.test(await teks(O, '[data-testid="ks-kedaluwarsa"]')), await teks(O, '[data-testid="ks-kedaluwarsa"]'));
    const setuju = await api("owner", "PATCH", `/api/inventory/adjustments/${reqId}`, { status: "APPROVED" });
    ok("persetujuan ditolak 409 SALDO_BERGESER (saldo 10 -> 9)", setuju.status === 409 && setuju.body.code === "SALDO_BERGESER", JSON.stringify(setuju.body).slice(0, 160));
    await foto(O, "09-kedaluwarsa-desktop");
    // batalkan lalu ajukan ulang dari saldo terbaru lewat UI, lalu setujui (Owner) + posting (Gudang) via API
    await api("gudang", "PATCH", `/api/inventory/adjustments/${reqId}/cancel`, { reason: "Saldo bergeser, ajukan ulang" });
    await bukaBahan(G, "BUSA-QA-10");
    await klik(G, '[data-testid="tombol-riwayat-koreksi"]'); await tunggu(G, '[data-testid="baris-riwayat-koreksi"]');
    await klik(G, '[data-testid="tombol-koreksi-saldo"]'); await ketik(G, "#ks-jumlah", "7"); await ketik(G, "#ks-alasan", "Hitung ulang setelah pemakaian 1 kg"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(G, '[data-testid="pratinjau-koreksi"]');
    ok("ajukan ulang dari saldo terbaru: saldo 9 -> selisih -2", /9/.test(await teks(G, '[data-testid="pra-saldo-sebelum"]')) && /-2/.test(await teks(G, '[data-testid="pra-selisih"]')));
    await klik(G, '[data-testid="ajukan-koreksi"]'); await tunggu(G, '[data-testid="hasil-koreksi"]');
    const reqId2 = sql("select id from stock_adjustment_requests where status='WAITING_APPROVAL' limit 1");
    ok("api: Owner lain menyetujui lalu Gudang memposting; stok menjadi 7 dengan SATU pergerakan ADJUSTMENT", (await api("owner", "PATCH", `/api/inventory/adjustments/${reqId2}`, { status: "APPROVED" })).status === 200 && (await api("gudang", "POST", `/api/inventory/adjustments/${reqId2}/post`, {})).status === 200 && saldoDb("BUSA-QA-10") === 7 && Number(sql(`select count(*) from stock_movements where stock_adjustment_request_id='${reqId2}'`)) === 1, `saldo=${saldoDb("BUSA-QA-10")}`);
    ok("Harga Berlaku, jurnal Finance, dan valuasi tidak berubah oleh koreksi", Number(sql("select count(*) from material_harga_berlaku")) === 1 && Number(sql("select count(*) from fin_journal_entries")) === 0 && Number(sql("select count(*) from fin_stock_movement_valuations")) === 0);
    await klik(G, '[data-testid="tutup-hasil"]'); await tidur(500);
    await G.goto(`${BASE}/warehouse/inventory?q=BUSA-QA-10`, { waitUntil: "domcontentloaded" }); await tunggu(G, '[data-testid="baris-stok"]'); await tidur(800);
    ok("daftar menampilkan saldo baru 7 setelah diposting", /7/.test(await G.$eval('tr[data-testid="baris-stok"][data-kode="BUSA-QA-10"] [data-testid="sel-saldo"]', (e) => e.textContent)));

    // ── 5. Saldo bergeser SAAT pratinjau terbuka (di UI): pesan + pratinjau dimuat ulang; tidak tersimpan sampai dikonfirmasi lagi ──
    const sebelumReq = nReq();
    await bukaBahan(G, "BUSA-QA-04");
    await klik(G, '[data-testid="tombol-koreksi-saldo"]'); await ketik(G, "#ks-jumlah", "2"); await ketik(G, "#ks-alasan", "Hitung fisik: sisa 2"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(G, '[data-testid="pratinjau-koreksi"]');
    sql("insert into stock_movements (id, material_id, type, qty, note) select gen_random_uuid(), id, 'RECEIPT', 1, 'penerimaan saat pratinjau terbuka' from materials where code='BUSA-QA-04'");
    await klik(G, '[data-testid="ajukan-koreksi"]'); await tunggu(G, '[data-testid="info-bergeser"]');
    // Pesan tampil lebih dulu daripada pratinjau baru: tunggu pratinjau yang dimuat ulang (saldo 5) dan tombol aktif lagi.
    await G.waitForFunction(() => /5/.test(document.querySelector('[data-testid="pra-saldo-sebelum"]')?.textContent ?? "") && !document.querySelector('[data-testid="ajukan-koreksi"]')?.disabled, { timeout: 15000 });
    ok("saldo bergeser saat pratinjau: pesan jelas, pratinjau dimuat ulang (saldo 5, selisih -3), BELUM tersimpan", /berubah sejak pratinjau/.test(await teks(G, '[data-testid="info-bergeser"]')) && /5/.test(await teks(G, '[data-testid="pra-saldo-sebelum"]')) && /-3/.test(await teks(G, '[data-testid="pra-selisih"]')) && nReq() === sebelumReq, `req ${sebelumReq}->${nReq()}`);
    await foto(G, "10-saldo-bergeser-desktop");
    await klik(G, '[data-testid="ajukan-koreksi"]'); await tunggu(G, '[data-testid="hasil-koreksi"]');
    ok("setelah konfirmasi ulang dari saldo terbaru: tersimpan (selisih -3 terhadap saldo 5)", nReq() === sebelumReq + 1 && Number(sql("select selisih from koreksi_saldo_bahan order by created_at desc limit 1")) === -3);
    await klik(G, '[data-testid="tutup-hasil"]');

    // ── 6. Belum ada catatan, nol, terpesan, minus ──
    await bukaBahan(G, "BUSA-QA-KOSONG");
    ok("drawer belum ada catatan: 'belum diketahui', bukan nol", (await G.$eval('[data-testid="keadaan-saldo"]', (e) => e.dataset.keadaan)) === "BELUM_ADA_CATATAN" && /BUKAN nol/.test(await teks(G, '[data-testid="teks-keadaan-saldo"]')));
    await klik(G, '[data-testid="tombol-koreksi-saldo"]'); await ketik(G, "#ks-jumlah", "0"); await ketik(G, "#ks-alasan", "Fisik memang kosong"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(G, '[data-testid="pratinjau-koreksi"]');
    ok("belum ada catatan + fisik 0: saldo 'belum diketahui', tidak ada selisih, Ajukan nonaktif", /belum diketahui/.test(await teks(G, '[data-testid="pra-saldo-sebelum"]')) && /tidak ada selisih/.test(await teks(G, '[data-testid="pra-selisih"]')) && (await G.$eval('[data-testid="ajukan-koreksi"]', (e) => e.disabled)));
    await G.evaluate(() => [...document.querySelectorAll("button")].find((x) => x.textContent.trim() === "Ubah isian")?.click()); // Ubah isian
    await ketik(G, "#ks-jumlah", "5"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(G, '[data-testid="pratinjau-koreksi"]');
    ok("belum ada catatan + fisik 5: peringatan 'catatan stok pertama'", /catatan stok pertamanya/.test(await teks(G, '[data-testid="pratinjau-koreksi"]')));
    await foto(G, "11-belum-ada-catatan-desktop"); await G.keyboard.press("Escape"); await tidur(300);
    await bukaBahan(G, "LEM-QA-TERPESAN"); await klik(G, '[data-testid="tombol-koreksi-saldo"]'); await ketik(G, "#ks-jumlah", "5"); await ketik(G, "#ks-alasan", "Hitung fisik: sisa 5"); await klik(G, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(G, '[data-testid="pratinjau-koreksi"]');
    ok("terpesan: Tersedia 2 -> -3 dengan peringatan pesanan tidak ikut berubah", /2.*-3/.test(await teks(G, '[data-testid="pra-tersedia"]')) && /tidak ikut berubah/.test(await teks(G, '[data-testid="pratinjau-koreksi"]')), await teks(G, '[data-testid="pra-tersedia"]'));
    await foto(G, "12-terpesan-desktop"); await G.keyboard.press("Escape"); await tidur(300);
    await bukaBahan(G, "PEGAS-QA-MINUS");
    ok("drawer minus: keadaan catatan minus", (await G.$eval('[data-testid="keadaan-saldo"]', (e) => e.dataset.keadaan)) === "MINUS");
    await bukaBahan(G, "KAIN-QA-NOL-VERIF");
    ok("drawer nol terverifikasi: menyebut nomor Stock Count", (await G.$eval('[data-testid="keadaan-saldo"]', (e) => e.dataset.keadaan)) === "NOL_TERVERIFIKASI" && /CC-QA-0001/.test(await teks(G, '[data-testid="teks-keadaan-saldo"]')), await teks(G, '[data-testid="teks-keadaan-saldo"]'));
    ok("desktop: tidak ada galat JS tak tertangani", G.galatKonsol.length === 0, G.galatKonsol.join("|"));

    // ── 7. HP (390×844): daftar kartu, drawer, modal terjangkau, tombol ≥44px, tanpa gulir mendatar ──
    const H = await buka(browser, "gudang", "/warehouse/inventory?q=QA", { lebar: 390, tinggi: 844, hp: true });
    await tunggu(H, 'button[data-testid="baris-stok"]'); await tidur(1000);
    ok("HP: daftar kartu tanpa gulir mendatar", await tanpaGulirMendatar(H));
    const kartu = await H.$$eval('button[data-testid="baris-stok"]', (bs) => Object.fromEntries(bs.map((b) => [b.dataset.kode, b.textContent.replace(/\s+/g, " ")])));
    ok("HP: kartu menampilkan 'belum diketahui' dan '0 terverifikasi' berbeda", /belum diketahui/.test(kartu["BUSA-QA-KOSONG"] ?? "") && /terverifikasi/.test(kartu["KAIN-QA-NOL-VERIF"] ?? "") && !/habis menurut pergerakan/.test(kartu["KAIN-QA-NOL-VERIF"] ?? "") && /menurut pergerakan/.test(kartu["KAIN-QA-NOL-GERAK"] ?? ""), (kartu["KAIN-QA-NOL-VERIF"] ?? "").slice(0, 120));
    await foto(H, "13-daftar-hp");
    await H.goto(`${BASE}/warehouse/inventory?q=BUSA-QA-06`, { waitUntil: "domcontentloaded" }); await tunggu(H, 'button[data-testid="baris-stok"][data-kode="BUSA-QA-06"]'); await H.click('button[data-testid="baris-stok"][data-kode="BUSA-QA-06"]'); await tunggu(H, '[data-testid="panel-koreksi-saldo"]');
    await foto(H, "14-drawer-hp");
    const tinggiTombol = await H.$eval('[data-testid="tombol-koreksi-saldo"]', (e) => Math.round(e.getBoundingClientRect().height));
    ok("HP: tombol Koreksi saldo ≥ 44px", tinggiTombol >= 44, `${tinggiTombol}px`);
    await klik(H, '[data-testid="tombol-koreksi-saldo"]'); await tunggu(H, '[data-testid="modal-koreksi-saldo"]'); await ketik(H, "#ks-jumlah", "4,5"); await ketik(H, "#ks-alasan", "Hitung fisik HP: sisa 4,5 kg"); await foto(H, "15-modal-hp");
    await klik(H, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(H, '[data-testid="pratinjau-koreksi"]');
    ok("HP: koma desimal dibaca (4,5) -> selisih -1,5", /-1,5/.test(await teks(H, '[data-testid="pra-selisih"]')), await teks(H, '[data-testid="pra-selisih"]'));
    const tombolAjukan = await H.$eval('[data-testid="ajukan-koreksi"]', (e) => { const r = e.getBoundingClientRect(); return { h: Math.round(r.height), dalam: r.bottom <= window.innerHeight && r.top >= 0 }; });
    ok("HP: tombol Ajukan terjangkau tanpa gulir halaman dan ≥44px", tombolAjukan.dalam && tombolAjukan.h >= 44, JSON.stringify(tombolAjukan));
    await foto(H, "16-pratinjau-hp");
    await klik(H, '[data-testid="ajukan-koreksi"]'); await tunggu(H, '[data-testid="hasil-koreksi"]');
    ok("HP: diajukan; status menunggu persetujuan; stok BUSA-QA-06 tetap 6", /Menunggu persetujuan/.test(await teks(H, '[data-testid="hasil-status"]')) && saldoDb("BUSA-QA-06") === 6 && (await tanpaGulirMendatar(H)));
    await foto(H, "17-hasil-hp");
    ok("HP: tidak ada galat JS tak tertangani", H.galatKonsol.length === 0, H.galatKonsol.join("|"));
  } catch (e) { gagal++; console.log("FAIL  SKRIP BERHENTI: " + (e.stack || e).toString().slice(0, 600)); }
  finally { await browser.close(); fs.writeFileSync(path.join(OUT, "hasil-qa.json"), JSON.stringify({ gagal, hasil }, null, 2)); console.log(`\n${hasil.filter((h) => h.ok).length}/${hasil.length} PASS, ${gagal} gagal`); process.exit(gagal ? 1 : 0); }
})();
