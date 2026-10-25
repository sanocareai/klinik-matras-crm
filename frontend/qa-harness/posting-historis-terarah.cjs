// CATATAN (persetujuan terikat, 25 Okt 2026): skrip ini ditulis SEBELUM dialog/API meminta persetujuan terikat (hash+daftar order+jumlah diketik, rujukan tidak lagi bertahan di draf). Untuk dijalankan lagi, isi bagian persetujuan seperti isiPersetujuan() di posting-historis-terikat.cjs dan kirim persetujuanTerikat pada POST batch/jalankan. Belum disesuaikan.
// QA browser TERARAH (Chrome nyata) — jalur cepat: manifest → Mulai (dua tab serentak + klik ganda) → progres sinkron → refresh → tutup tab/buka tab baru → Hentikan/Lanjutkan → Admin baca-saja → HP.
// Versi penuh (restart backend, offline, 6 tab, koreksi order lain) = posting-historis-browser.cjs. Server + DB terisolasi; bukan production.
const puppeteer = require("puppeteer-core"); const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:4020"; const DB = process.env.DB || "ui1"; const DIR = process.env.KM_UI_DIR || "C:/tmp/km-ui"; const T = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8"));
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe"; const SHOTS = path.join(DIR, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execFileSync("docker", ["exec", "km-rekon-pg", "psql", "-U", "klinik", "-d", DB, "-At", "-c", q], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms)); const hasil = []; let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 250) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 200) : ""}`); };
async function buka(ctx, siapa, rute = "/warehouse/posting-historis", lebar = 1280, tinggi = 900) {
  const p = await ctx.newPage(); await p.setViewport({ width: lebar, height: tinggi });
  await p.evaluateOnNewDocument((t, u) => { try { if (!localStorage.getItem("token")) { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); } } catch (e) {} }, T[siapa].token, T[siapa].user);
  await p.goto(BASE + rute, { waitUntil: "domcontentloaded" }); return p;
}
const tunggu = (p, s, ms = 30000) => p.waitForSelector(s, { timeout: ms }); const teks = (p, s) => p.$eval(s, (e) => e.textContent.trim()).catch(() => null); const ada = async (p, s) => !!(await p.$(s));
const klik = async (p, s) => { await p.bringToFront(); await tunggu(p, s, 15000); await p.$eval(s, (e) => e.scrollIntoView({ block: "center" })); await p.click(s); };
const st = (p) => p.$eval('[data-testid="kartu-progres"]', (e) => ({ status: e.dataset.status, id: e.dataset.batchId })).catch(() => null);
const hit = async (p) => ({ ok: Number(await teks(p, '[data-testid="hitung-berhasil"] p:nth-child(2)')), gagal: Number(await teks(p, '[data-testid="hitung-gagal"] p:nth-child(2)')) });
const mv = () => Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'"));
const ganda = () => Number(sql("select count(*) from (select unit_id, note from stock_movements where note like 'Impor pemakaian historis Sep%' group by 1,2 having count(*)>1) x"));
const diajukan = () => Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN'"));
const foto = (p, n) => p.screenshot({ path: path.join(SHOTS, n + ".png") });
(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null, protocolTimeout: 45000 });
  const ctx = await browser.createBrowserContext();
  try {
    const A = await buka(ctx, "owner"); await tunggu(A, '[data-testid="stat-trx"]');
    ok("manifest + dampak + HPP PARSIAL + belum dijurnal", /PARSIAL/i.test(await teks(A, '[data-testid="hpp-label"]')) && /Rp[\d.]+/.test(await teks(A, '[data-testid="hpp-belum-jurnal"]')), `${await teks(A, '[data-testid="stat-order"] p:nth-child(2)')} order`); await foto(A, "t01-manifest");
    const B = await buka(ctx, "owner"); await tunggu(B, '[data-testid="btn-mulai"]');
    for (const p of [A, B]) { console.log('  dialog tab'); await klik(p, '[data-testid="btn-mulai"]'); await tunggu(p, '[data-testid="input-rujukan"]'); await p.type('[data-testid="input-rujukan"]', "OWNER-UJI-TERARAH-01"); await p.click('[data-testid="cek-periksa"]'); }
    const aj0 = diajukan(); const mv0 = mv();
    await Promise.all([A.$eval('[data-testid="konfirmasi-mulai"]', (e) => { e.click(); e.click(); }), B.$eval('[data-testid="konfirmasi-mulai"]', (e) => { e.click(); })]); // klik ganda dalam satu tab + tab kedua serentak
    await tunggu(A, '[data-testid="kartu-progres"]'); await tunggu(B, '[data-testid="kartu-progres"]');
    const sA = await st(A), sB = await st(B);
    ok("klik ganda + dua tab serentak → satu batch, dua tab melihat batch yang sama", diajukan() - aj0 === 1 && sA.id === sB.id, sA.id?.slice(0, 10)); await foto(A, "t02-progres");
    await tidur(7000); await A.bringToFront(); await tidur(1500); /* tab latar berhenti polling (hemat); saat terlihat langsung menyegarkan */ const a = await hit(A); await B.bringToFront(); await tidur(1500); const b = await hit(B);
    ok("progres naik dan dua tab konsisten", a.ok > 0 && a.ok > 0 && b.ok >= a.ok && b.ok - a.ok <= 8, `A=${JSON.stringify(a)} B=${JSON.stringify(b)}`);
    await A.bringToFront(); const sebelum = await hit(A); await A.reload({ waitUntil: "domcontentloaded" }); await tunggu(A, '[data-testid="kartu-progres"]'); const setelah = await hit(A);
    ok("refresh: batch yang sama, progres tidak mundur", (await st(A)).id === sA.id && setelah.ok >= sebelum.ok, `${JSON.stringify(sebelum)} → ${JSON.stringify(setelah)}`);
    await B.close(); const C = await buka(ctx, "owner"); await tunggu(C, '[data-testid="kartu-progres"]');
    ok("tab ditutup lalu tab baru: batch yang sama", (await st(C)).id === sA.id);
    await klik(C, '[data-testid="btn-hentikan"]'); await C.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "DIHENTIKAN", { timeout: 30000 });
    await A.bringToFront(); await A.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "DIHENTIKAN", { timeout: 20000 });
    ok("Hentikan di satu tab terlihat di tab lain", true); await tidur(4000); const m1 = mv(); await tidur(4000);
    ok("setelah dihentikan tidak ada posting baru", mv() === m1, `${mv()} pergerakan`); await foto(A, "t03-dihentikan");
    await klik(A, '[data-testid="btn-lanjut"]'); await A.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "BERJALAN", { timeout: 30000 });
    await C.bringToFront(); await C.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "BERJALAN", { timeout: 20000 });
    ok("Lanjutkan di satu tab → tab lain ikut BERJALAN; tanpa posting ganda", ganda() === 0 && mv() > mv0, `${mv()} pergerakan`);
    const ad = await browser.createBrowserContext(); const AD = await buka(ad, "admin"); await tunggu(AD, '[data-testid="kartu-progres"]');
    ok("Admin: melihat progres yang sama, tanpa tombol Hentikan/Lanjutkan/Mulai, ada penjelasan izin", (await st(AD)).id === sA.id && !(await ada(AD, '[data-testid="btn-hentikan"]')) && !(await ada(AD, '[data-testid="btn-lanjut"]')) && (await ada(AD, '[data-testid="info-baca-saja"]')), await teks(AD, '[data-testid="alasan-tanpa-aksi"]')); await foto(AD, "t04-admin");
    const sa = await browser.createBrowserContext(); const SA = await buka(sa, "sales"); await SA.waitForFunction(() => /Halaman ini untuk Admin, Owner, dan Finance/.test(document.body.innerText), { timeout: 30000 });
    ok("Sales: halaman menolak", true);
    const hp = await browser.createBrowserContext(); const HP = await buka(hp, "owner", "/warehouse/posting-historis", 390, 844); await tunggu(HP, '[data-testid="kartu-progres"]'); await tidur(1200);
    const w = await HP.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth })); ok("HP 390px: tanpa scroll horizontal", w.sw <= w.iw + 1, JSON.stringify(w)); await foto(HP, "t05-hp");
    await klik(C, '[data-testid="btn-hentikan"]'); await C.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "DIHENTIKAN", { timeout: 30000 });
  } catch (e) { gagal++; console.log("GALAT:", e.stack || e.message); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(DIR, "hasil-terarah.json"), JSON.stringify({ gagal, hasil }, null, 1)); console.log(`SELESAI: ${hasil.filter((h) => h.ok).length} lulus, ${gagal} gagal`); process.exit(gagal ? 1 : 0);
})();
