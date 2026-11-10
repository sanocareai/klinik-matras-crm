// QA browser NYATA (Chrome via puppeteer-core) — HPP per Order: PIC (Produksi) dan Finance, desktop + HP, terhadap server + database TERISOLASI (hpp-order-server.mjs; bukan production).
//   BASE=http://127.0.0.1:5195 API=http://127.0.0.1:4031 OUT=C:/tmp/km-hpp-qa QA_DB_URL=postgresql://klinik:...@localhost:5432/km_hppqa_test node frontend/qa-harness/hpp-order-browser.cjs
const puppeteer = require("puppeteer-core");
const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:5195"; const API = process.env.API || "http://127.0.0.1:4031"; const OUT = process.env.OUT || "C:/tmp/km-hpp-qa";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const ID = JSON.parse(fs.readFileSync(path.join(OUT, "ids.json"), "utf8"));
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execFileSync(process.execPath, [path.join(__dirname, "qa-sql.cjs"), q], { encoding: "utf8", env: process.env }).trim();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0; const hasil = [];
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const api = async (siapa, method, p, body, headers = {}) => { const r = await fetch(API + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[siapa].token}`, ...headers }, body: body ? JSON.stringify(body) : undefined }); let j = null; try { j = await r.json(); } catch {} return { status: r.status, body: j }; };
const galatSemua = [];

async function buka(browser, siapa, rute, { lebar = 1280, tinggi = 900, hp = false } = {}) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(25000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((token, user) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); } catch (e) {} }, T[siapa].token, T[siapa].user);
  page.on("pageerror", (e) => galatSemua.push(`${siapa} ${rute}: ${String(e).slice(0, 200)}`));
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
const foto = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png"), fullPage: true });
const adaTeks = (page, t, ms = 20000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout: ms }, t).then(() => true).catch(() => false);
const tanpaGulirMendatar = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// Klik elemen TAMPAK pertama yang cocok selektor + memuat teks.
async function klikTeks(page, sel, t) {
  await page.waitForFunction((s, x) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null && e.textContent.includes(x)), { timeout: 20000 }, sel, t);
  const h = await page.evaluateHandle((s, x) => { const e = [...document.querySelectorAll(s)].find((y) => y.offsetParent !== null && y.textContent.includes(x)); e.scrollIntoView({ block: "center" }); return e; }, sel, t);
  await h.asElement().click(); // klik mouse sungguhan (tab Radix aktif pada pointerdown, bukan .click() sintetis)
}
// Isi kontrol di dalam Field berlabel (label → div induk → input/select), lewat setter bawaan + event (dibaca React seperti ketikan).
async function isi(page, label, v, akar = "body") {
  const r = await page.evaluate((lab, val, a) => {
    const L = [...document.querySelectorAll(`${a} label`)].find((l) => l.offsetParent !== null && l.textContent.trim().startsWith(lab)); if (!L) return "label tidak ada: " + lab;
    const el = L.parentElement.querySelector("input,select,textarea"); if (!el) return "kontrol tidak ada: " + lab;
    const proto = el.tagName === "SELECT" ? HTMLSelectElement.prototype : el.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value").set.call(el, val); el.dispatchEvent(new Event(el.tagName === "SELECT" ? "change" : "input", { bubbles: true })); return "ok";
  }, label, v, akar);
  if (r !== "ok") throw new Error(r);
}
const barisUnit = (page) => page.evaluate(() => [...document.querySelectorAll("tbody tr")].filter((r) => r.offsetParent !== null).map((r) => r.innerText.replace(/\s+/g, " ")));
async function bukaUnit(page, kode) {
  await page.waitForFunction((k) => [...document.querySelectorAll("tbody tr")].some((r) => r.innerText.includes(k)), { timeout: 20000 }, kode);
  await page.evaluate((k) => { const r = [...document.querySelectorAll("tbody tr")].find((x) => x.innerText.includes(k)); [...r.querySelectorAll("button")].find((b) => b.textContent.includes("Buka")).click(); }, kode);
  await tidur(1500);
}

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null });
  const awal = { mv: Number(sql("select count(*) from stock_movements")), jurnal: Number(sql("select count(*) from fin_journal_entries")) };
  try {
    // ── 1. PIC desktop: menu Produksi → antrean ──
    const P = await buka(browser, "pic", "/bengkel/ringkasan");
    const menu = await P.waitForSelector('a[href="/bengkel/hpp-order"]', { timeout: 30000, visible: true }).then(() => true).catch(() => false);
    const teksMenu = menu ? await P.$eval('a[href="/bengkel/hpp-order"]', (e) => e.textContent.trim()) : null;
    ok("PIC: menu 'Lengkapi HPP Order' tampil di sidebar Produksi", menu && /Lengkapi HPP Order/.test(teksMenu), teksMenu);
    if (menu) await P.click('a[href="/bengkel/hpp-order"]'); else await P.goto(BASE + "/bengkel/hpp-order");
    ok("PIC: antrean termuat", await adaTeks(P, "Unit terkirim") && await adaTeks(P, "RES-QA-005"));
    await tidur(800);
    const rows = await barisUnit(P);
    ok("PIC: 5 unit terkirim tampil dengan status masing-masing", rows.length === 5 && rows.some((r) => /RES-QA-001.*Belum ada pemakaian/.test(r)) && rows.some((r) => /RES-QA-002.*Siap dikonfirmasi/.test(r)) && rows.some((r) => /RES-QA-003.*Menunggu persetujuan/.test(r)) && rows.some((r) => /RES-QA-004.*belum lengkap/.test(r)), rows.join(" | "));
    ok("PIC: tanpa kolom nominal (tanpa izin Finance)", !(await P.evaluate(() => [...document.querySelectorAll("th")].some((t) => t.textContent.includes("Bahan diketahui")))));
    await foto(P, "01-pic-antrean-desktop");
    await isi(P, "Status", "BELUM_ADA_PEMAKAIAN"); await tidur(1500);
    const tersaring = await barisUnit(P);
    ok("PIC: filter status bekerja (Pilihan → onChange nilai)", tersaring.length === 2 && tersaring.every((r) => /Belum ada pemakaian/.test(r)), tersaring.join(" | "));
    await isi(P, "Status", ""); await tidur(1200);

    // ── 2. Biaya kosong: konfirmasi tidak ditawarkan dan ditolak server ──
    await bukaUnit(P, "RES-QA-004");
    ok("PIC: unit tanpa harga menampilkan 'Tanpa harga (belum diketahui)'", await adaTeks(P, "Tanpa harga (belum diketahui)"));
    ok("PIC: tombol konfirmasi tidak ditawarkan bila masih ada biaya kosong", await adaTeks(P, "Konfirmasi lengkap belum tersedia") && !(await P.evaluate(() => [...document.querySelectorAll("button")].some((b) => b.offsetParent !== null && b.textContent.includes("Konfirmasi pemakaian lengkap")))));
    const unit4 = await api("pic", "GET", `/api/finance/hpp-order/unit/${ID["RES-QA-004"]}`);
    const tolak = await api("pic", "POST", `/api/finance/hpp-order/unit/${ID["RES-QA-004"]}/konfirmasi`, { sidik: unit4.body.status.sidik, alasan: "Coba konfirmasi QA" }, { "Idempotency-Key": `qa-konf-${Date.now()}` });
    ok("server: konfirmasi unit berbiaya kosong ditolak 409 BELUM_SIAP_DIKONFIRMASI", tolak.status === 409 && tolak.body?.code === "BELUM_SIAP_DIKONFIRMASI" && tolak.body?.detail?.biayaKosong === 1, JSON.stringify(tolak.body).slice(0, 200));
    await foto(P, "02-pic-panel-biaya-kosong");
    await P.keyboard.press("Escape"); await tidur(800);

    // ── 3. PIC mencatat biaya tanpa stok lewat formulir ──
    await bukaUnit(P, "RES-QA-001");
    await klikTeks(P, "button", "Catat biaya tanpa stok"); await tidur(1500);
    await P.waitForFunction(() => [...document.querySelectorAll("option")].some((o) => o.textContent.includes("KAIN-QA")), { timeout: 20000 }).catch(() => {});
    await isi(P, "Bahan", ID.kain); await isi(P, "Jumlah", "1.5"); await isi(P, "Tanggal pemakaian", ID.H8);
    await isi(P, "Rujukan sumber", "Lap PIC QA 001  Baris 1"); await isi(P, "Bukti", "Buku kerja meja 3 (QA)"); await isi(P, "Alasan", "Pemakaian pra-SO belum tercatat");
    await klikTeks(P, "button", "Lihat dampak");
    ok("PIC: pratinjau menampilkan jalur biaya tanpa stok + dasar harga", await adaTeks(P, "Biaya per order tanpa stok") && await adaTeks(P, "harga awal hari sama dengan harga sepanjang hari"));
    await foto(P, "03-pic-form-pratinjau");
    await klikTeks(P, "button", "Ajukan");
    ok("PIC: pengajuan tersimpan", await adaTeks(P, "Biaya tanpa stok diajukan"));
    const e1 = sql(`select status || '|' || sumber_ref || '|' || status_harga from order_biaya_tanpa_stok where unit_id='${ID["RES-QA-001"]}'`);
    ok("DB: entri DIAJUKAN, rujukan dinormalkan, DINILAI", e1 === "DIAJUKAN|lap pic qa 001 baris 1|DINILAI", e1);
    const ulang = await api("pic", "POST", "/api/finance/hpp-order/biaya-tanpa-stok", { unitId: ID["RES-QA-001"], materialId: ID.kain, qty: 0.5, tanggalPemakaian: ID.H7, sumberJenis: "LAPORAN_PIC", sumberRef: "LAP PIC QA 001 BARIS 1", bukti: "Buku kerja meja 3", alasan: "Uji sumber sama" }, { "Idempotency-Key": `qa-ulang-${Date.now()}` });
    ok("server: sumber yang sama ditolak 409 SUMBER_SUDAH_DIPAKAI", ulang.status === 409 && ulang.body?.code === "SUMBER_SUDAH_DIPAKAI", JSON.stringify(ulang.body).slice(0, 160));
    await P.keyboard.press("Escape"); await tidur(800);

    // ── 4. Operator (tanpa izin rute unit): menu ada; pernyataan tanpa bahan tidak ditawarkan ──
    const O = await buka(browser, "operator", "/bengkel/hpp-order");
    ok("Operator: antrean termuat", await adaTeks(O, "RES-QA-005"));
    await bukaUnit(O, "RES-QA-005");
    ok("Operator: pernyataan tanpa bahan baru tidak ditawarkan (izin rute unit)", await adaTeks(O, "hanya oleh pemegang izin rute unit"));

    // ── 5. PIC: pernyataan tanpa bahan baru (diaudit) ──
    await P.goto(BASE + "/bengkel/hpp-order", { waitUntil: "domcontentloaded" }); await adaTeks(P, "RES-QA-005");
    await bukaUnit(P, "RES-QA-005");
    await isi(P, "Keterangan (hanya bila memang tanpa bahan baru)", "Servis jahit ulang tanpa bahan baru (QA)");
    await klikTeks(P, "button", "Nyatakan tanpa bahan baru");
    ok("PIC: pernyataan tersimpan dan tampil dengan pelaku", await adaTeks(P, "Pernyataan tanpa bahan baru tersimpan") && await adaTeks(P, "PIC Produksi QA"));
    ok("DB: pernyataan + jejak aktivitas tercatat", sql(`select count(*) from unit_material_declarations where unit_id='${ID["RES-QA-005"]}' and status='ACTIVE'`) === "1" && sql(`select count(*) from activity_events where entity_id='${ID["RES-QA-005"]}' and event_type='PRODUCTION_PERNYATAAN_TANPA_BAHAN'`) === "1");
    await P.keyboard.press("Escape"); await tidur(600);

    // ── 6. Finance desktop: persetujuan dengan keputusan harga ──
    const F = await buka(browser, "finance", "/finance/hpp-order");
    await klikTeks(F, "button,[role=tab]", "Persetujuan biaya");
    ok("Finance: antrean persetujuan memuat 2 entri", await adaTeks(F, "RES-QA-003") && await adaTeks(F, "RES-QA-001"));
    ok("Finance: entri harga berubah di hari itu menampilkan pilihan harga", await adaTeks(F, "Harga berubah di hari itu"));
    const opsi = await F.$$eval('select[aria-label="Harga RES-QA-003-U1"] option', (os) => os.map((o) => ({ v: o.value, t: o.textContent })));
    ok("Finance: dua kandidat harga (awal hari & mulai 13:00 WIB)", opsi.length === 3 && opsi.some((o) => /Awal hari/.test(o.t)) && opsi.some((o) => /13[.:]00 WIB/.test(o.t)), JSON.stringify(opsi));
    await F.evaluate(() => { const r = [...document.querySelectorAll("tbody tr")].find((x) => x.innerText.includes("RES-QA-003")); r.querySelector('input[type="checkbox"]').click(); });
    await klikTeks(F, "button", "Setujui terpilih");
    ok("Finance: tanpa pilihan harga persetujuan ditolak di layar", await adaTeks(F, "pilih harga + alasan dulu"));
    const siang = opsi.find((o) => /13[.:]00/.test(o.t)).v;
    await F.select('select[aria-label="Harga RES-QA-003-U1"]', siang);
    await F.evaluate(() => { const r = [...document.querySelectorAll("tbody tr")].find((x) => x.innerText.includes("RES-QA-003")); const i = r.querySelector('input[placeholder="Alasan pilihan harga"]'); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(i, "PIC: dipakai sore sesudah harga naik"); i.dispatchEvent(new Event("input", { bubbles: true })); });
    await F.evaluate(() => { for (const r of document.querySelectorAll("tbody tr")) if (r.innerText.includes("RES-QA-001") || r.innerText.includes("RES-QA-003")) { const c = r.querySelector('input[type="checkbox"]'); if (c && !c.checked) c.click(); } });
    await foto(F, "04-finance-persetujuan");
    await klikTeks(F, "button", "Setujui terpilih");
    ok("Finance: dua biaya disetujui", await adaTeks(F, "2 biaya disetujui"));
    const e3 = sql(`select status || '|' || status_harga || '|' || basis_harga || '|' || nilai::text from order_biaya_tanpa_stok where id='${ID.entriKeputusan}'`);
    ok("DB: keputusan harga tercatat (DISETUJUI, KEPUTUSAN_PENYETUJU, 2 × 16.000)", e3 === "DISETUJUI|DINILAI|KEPUTUSAN_PENYETUJU|32000.00", e3);

    // ── 7. Finance: laporan + jembatan ──
    await klikTeks(F, "button,[role=tab]", "Laporan berdampingan");
    ok("Finance: jembatan laba jurnal tampil dan kontrol cocok", await adaTeks(F, "Jembatan dari laba jurnal") && await adaTeks(F, "Kontrol cocok"));
    ok("Finance: selisih opname sesudah SO tetap dihitung (perlu klasifikasi), sebelum SO = saldo lama", await adaTeks(F, "Selisih stok sesudah SO: tetap dihitung") && await adaTeks(F, "Selisih opname bertanggal pada/sebelum SO bertaut"));
    await foto(F, "05-finance-laporan-desktop");

    // ── 8. PIC: konfirmasi massal ──
    await P.goto(BASE + "/bengkel/hpp-order", { waitUntil: "domcontentloaded" }); await adaTeks(P, "RES-QA-001");
    await P.waitForSelector('input[aria-label="Pilih semua yang siap"]', { visible: true });
    await P.click('input[aria-label="Pilih semua yang siap"]');
    await isi(P, "Konfirmasi lengkap", "Diperiksa PIC QA dari buku kerja");
    await klikTeks(P, "button", "Konfirmasi terpilih");
    ok("PIC: tiga unit dikonfirmasi lengkap sekaligus", await adaTeks(P, "3 unit dikonfirmasi"));
    ok("DB: tiga konfirmasi aktif", sql("select count(*) from unit_hpp_konfirmasi where status='ACTIVE'") === "3");
    await tidur(1200); await foto(P, "06-pic-sesudah-konfirmasi");

    // ── 9. HP (390×844): PIC dan Finance ──
    const PH = await buka(browser, "pic", "/bengkel/hpp-order", { lebar: 390, tinggi: 844, hp: true });
    await adaTeks(PH, "RES-QA-004"); await tidur(1200);
    ok("HP PIC: antrean tanpa gulir mendatar halaman", await tanpaGulirMendatar(PH));
    await foto(PH, "07-hp-pic-antrean");
    await bukaUnit(PH, "RES-QA-004");
    ok("HP PIC: panel unit terbuka", await adaTeks(PH, "Baris biaya tercatat"));
    await foto(PH, "08-hp-pic-panel");
    const FH = await buka(browser, "finance", "/finance/hpp-order", { lebar: 390, tinggi: 844, hp: true });
    await klikTeks(FH, "button,[role=tab]", "Laporan berdampingan");
    ok("HP Finance: laporan + jembatan termuat", await adaTeks(FH, "Jembatan dari laba jurnal"));
    await tidur(800);
    ok("HP Finance: tanpa gulir mendatar halaman", await tanpaGulirMendatar(FH));
    await foto(FH, "09-hp-finance-laporan");

    // ── 10. Sales: ditolak; tidak ada tulisan stok/jurnal ──
    ok("Sales: API antrean 403", (await api("sales", "GET", `/api/finance/hpp-order/antrean?from=${ID.H8}&to=${ID.H6}`)).status === 403);
    const akhir = { mv: Number(sql("select count(*) from stock_movements")), jurnal: Number(sql("select count(*) from fin_journal_entries")) };
    ok("tidak ada pergerakan stok atau jurnal baru dari seluruh alur", akhir.mv === awal.mv && akhir.jurnal === awal.jurnal, JSON.stringify({ awal, akhir }));
    ok("tidak ada galat JavaScript di halaman", galatSemua.length === 0, galatSemua.join(" | "));
  } catch (e) { ok("skenario selesai tanpa pengecualian", false, e.stack || e.message); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(OUT, "hasil.json"), JSON.stringify(hasil, null, 2));
  console.log(`\n${hasil.length - gagal}/${hasil.length} PASS`); process.exit(gagal ? 1 : 0);
})();
