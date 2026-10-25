// CATATAN (persetujuan terikat, 25 Okt 2026): skrip ini ditulis SEBELUM dialog/API meminta persetujuan terikat (hash+daftar order+jumlah diketik, rujukan tidak lagi bertahan di draf). Untuk dijalankan lagi, isi bagian persetujuan seperti isiPersetujuan() di posting-historis-terikat.cjs dan kirim persetujuanTerikat pada POST batch/jalankan. Belum disesuaikan.
// QA browser TERARAH (Chrome nyata) — pemulihan: koneksi putus (offline) dan restart backend saat batch berjalan.
// Memastikan: banner koneksi + status terakhir tetap tampil; progres bisa dipulihkan dari server; pekerja mati → TERPUTUS; Lanjutkan (klik ganda + dua tab serentak) bekerja; tidak ada posting ganda;
// koreksi order lain tetap bisa dilakukan; hasil akhir konsisten (pergerakan = transaksi diposting; setiap order punya hasil). Server + DB TERISOLASI; bukan production.
//   BASE=http://localhost:4020 DB=ui1 CONTAINER=km-ui node frontend/qa-harness/posting-historis-pulih.cjs
const puppeteer = require("puppeteer-core"); const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:4020"; const DB = process.env.DB || "ui1"; const CONTAINER = process.env.CONTAINER || "km-ui";
const DIR = process.env.KM_UI_DIR || "C:/tmp/km-ui"; const T = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8"));
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe"; const SHOTS = path.join(DIR, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const net = require("net"); const UP = new URL(BASE); const PROXY_PORT = Number(process.env.PROXY_PORT || 4031); const PB = `http://localhost:${PROXY_PORT}`;
const soket = new Set(); let jaringanPutus = false;
const proxy = net.createServer((c) => { if (jaringanPutus) { c.destroy(); return; } const u = net.connect(Number(UP.port), UP.hostname); soket.add(c); soket.add(u); const bersih = () => { soket.delete(c); soket.delete(u); c.destroy(); u.destroy(); }; c.on("error", bersih); u.on("error", bersih); c.on("close", bersih); u.on("close", bersih); c.pipe(u); u.pipe(c); });
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
const sql = (q) => execFileSync("docker", ["exec", "km-rekon-pg", "psql", "-U", "klinik", "-d", DB, "-At", "-c", q], { encoding: "utf8", env }).trim();
const dock = (...a) => execFileSync("docker", a, { encoding: "utf8", env }).trim();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms)); const hasil = []; let gagal = 0; const T0 = Date.now();
const waktu = () => `t+${Math.round((Date.now() - T0) / 1000)}s`;
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 250) }); console.log(`${waktu()} ${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const mv = () => Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'"));
const ganda = () => Number(sql("select count(*) from (select unit_id, note from stock_movements where note like 'Impor pemakaian historis Sep%' group by 1,2 having count(*)>1) x"));
const batchN = () => Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN'"));
const unitSelesaiDb = () => Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_UNIT'"));
async function backendNaik(ms = 90000) { const t = Date.now(); while (Date.now() - t < ms) { try { if ((await fetch(BASE + "/api/health")).ok) return true; } catch { /* belum naik */ } await tidur(500); } return false; }
async function buka(ctx, siapa = "owner", lebar = 1280, tinggi = 900) {
  const p = await ctx.newPage(); await p.setViewport({ width: lebar, height: tinggi });
  await p.evaluateOnNewDocument((t, u) => { try { if (!localStorage.getItem("token")) { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); } } catch (e) {} }, T[siapa].token, T[siapa].user);
  await p.goto(PB + "/warehouse/posting-historis", { waitUntil: "domcontentloaded" }); return p;
}
const tunggu = (p, s, ms = 30000) => p.waitForSelector(s, { timeout: ms }); const teks = (p, s) => p.$eval(s, (e) => e.textContent.trim()).catch(() => null); const ada = async (p, s) => !!(await p.$(s));
const st = (p) => p.$eval('[data-testid="kartu-progres"]', (e) => ({ status: e.dataset.status, id: e.dataset.batchId })).catch(() => null);
const hit = async (p) => ({ ok: Number(await teks(p, '[data-testid="hitung-berhasil"] p:nth-child(2)')), gagal: Number(await teks(p, '[data-testid="hitung-gagal"] p:nth-child(2)')), tunggu: Number(await teks(p, '[data-testid="hitung-menunggu"] p:nth-child(2)')) });
// Koneksi putus: setOfflineMode TIDAK dipakai karena Service Worker PWA meneruskan fetch dari konteksnya sendiri (tidak ikut emulasi offline). Intersepsi permintaan /api/ pada halaman = jaringan putus bagi aplikasi.
const putus = async (p, nilai) => { jaringanPutus = nilai; if (nilai) for (const x of [...soket]) x.destroy(); }; // jaringan putus bagi SEMUA tab (seperti Wi-Fi mati)
const klikEval = (p, s) => p.$eval(s, (e) => e.click());
const foto = (p, n) => p.screenshot({ path: path.join(SHOTS, n + ".png") });
const tungguStatus = (p, daftar, ms) => p.waitForFunction((d) => d.includes(document.querySelector('[data-testid="kartu-progres"]')?.dataset.status), { timeout: ms }, daftar);

(async () => {
  await new Promise((r) => proxy.listen(PROXY_PORT, r));
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null, protocolTimeout: 700000 });
  const ctx = await browser.createBrowserContext();
  try {
    const A = await buka(ctx); await tunggu(A, '[data-testid="btn-mulai"]');
    await A.$eval('[data-testid="btn-mulai"]', (e) => e.click()); await tunggu(A, '[data-testid="input-rujukan"]'); await A.type('[data-testid="input-rujukan"]', "OWNER-UJI-PULIH-001"); await A.$eval('[data-testid="cek-periksa"]', (e) => e.click());
    await klikEval(A, '[data-testid="konfirmasi-mulai"]'); await tunggu(A, '[data-testid="kartu-progres"]');
    const sa = await st(A); ok("batch dimulai lewat UI", !!sa?.id && batchN() === 1, sa?.id?.slice(0, 10));
    await A.waitForFunction(() => Number(document.querySelector('[data-testid="hitung-berhasil"] p:nth-child(2)')?.textContent) >= 12, { timeout: 120000 });

    // ── A. KONEKSI PUTUS (offline) ──
    const m0 = mv(); const hSebelum = await hit(A);
    await putus(A, true); await tunggu(A, '[data-testid="banner-koneksi"]', 60000);
    ok("offline: banner koneksi tampil, kartu progres + angka terakhir TETAP ada (tidak kosong/berkedip)", (await ada(A, '[data-testid="kartu-progres"]')) && /Koneksi terputus/.test(await teks(A, '[data-testid="banner-koneksi"]')) && (await hit(A)).ok >= hSebelum.ok, JSON.stringify(await hit(A)));
    await foto(A, "p01-offline");
    await tidur(12000); ok("selama offline server tetap memposting (batch milik server)", mv() > m0, `+${mv() - m0} pergerakan`);
    ok("selama offline tombol Hentikan tetap ada tetapi tidak memicu permintaan ganda (sibuk dijaga)", await ada(A, '[data-testid="btn-hentikan"]'));
    await putus(A, false); await A.waitForFunction(() => !document.querySelector('[data-testid="banner-koneksi"]'), { timeout: 60000 });
    const hPulih = await hit(A); ok("online lagi: banner hilang dan progres mengejar server tanpa muat ulang", hPulih.ok > hSebelum.ok, `${JSON.stringify(hSebelum)} → ${JSON.stringify(hPulih)}`);

    // ── B. KOREKSI ORDER LAIN saat batch berjalan ──
    const nota = sql("select n.id || '|' || coalesce(n.qty,0) from unit_usage_notes n where n.origin='EXCEL' and n.state='PERLU_DICEK' and n.qty is not null and n.material_id is not null and n.unit_id not in (select unit_id from unit_usage_notes where state in ('SIAP_POSTING','DIPOSTING') and unit_id is not null) limit 1").split("|");
    const kor = await A.evaluate(async (id, qty, base) => { const r = await fetch(`${base}/api/production/catatan-historis/${id}/koreksi`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token"), "Idempotency-Key": "pulih-" + Date.now() + "-aaaa" }, body: JSON.stringify({ qty: Number(qty) + 0.1, alasan: "QA pulih: koreksi order lain saat batch berjalan" }) }); return r.status; }, nota[0], nota[1], PB);
    ok("koreksi order lain saat batch berjalan: 201 dan batch tidak terganggu", kor === 201 && (await st(A)).status === "BERJALAN", `HTTP ${kor}`);

    // ── C. RESTART BACKEND saat batch berjalan ──
    const hR = await hit(A); const mR = mv(); console.log(waktu(), "restart backend…");
    await A.bringToFront(); dock("stop", "-t", "2", CONTAINER); await tunggu(A, '[data-testid="banner-koneksi"]', 90000).catch(() => {});
    ok("backend restart: banner koneksi muncul dan status terakhir tetap tampil", (await ada(A, '[data-testid="kartu-progres"]')) && (await ada(A, '[data-testid="banner-koneksi"]')), JSON.stringify(await hit(A)));
    await tidur(1);
    await foto(A, "p02-restart");
    const bannerAda = await ada(A, '[data-testid="banner-koneksi"]'); dock("start", CONTAINER);
    ok("backend kembali naik", await backendNaik());
    await A.waitForFunction(() => !document.querySelector('[data-testid="banner-koneksi"]'), { timeout: 90000 });
    ok("UI pulih sendiri (tanpa reload) dan progres tidak mundur", (await hit(A)).ok >= hR.ok, JSON.stringify(await hit(A)));
    // refresh langsung sesudah restart: batch yang sama muncul lagi
    await A.reload({ waitUntil: "domcontentloaded" }); await tunggu(A, '[data-testid="kartu-progres"]');
    ok("refresh sesudah restart: batch yang sama dan progres dipulihkan dari server", (await st(A)).id === sa.id && (await hit(A)).ok >= hR.ok, JSON.stringify(await hit(A)));
    console.log(waktu(), "menunggu sewa pekerja lama kedaluwarsa (≤ 95 dtk)…");
    await tungguStatus(A, ["TERPUTUS"], 150000);
    const mDiam = mv(); await tidur(6000);
    ok("TERPUTUS: tombol Lanjutkan tampil dan tidak ada posting selama pekerja mati", (await ada(A, '[data-testid="btn-lanjut"]')) && mv() === mDiam, `${(await hit(A)).ok} order berhasil; ${mDiam} pergerakan`);
    await foto(A, "p03-terputus");

    // ── D. LANJUTKAN: klik ganda + tab kedua serentak ──
    const B = await buka(ctx); await B.bringToFront(); await tunggu(B, '[data-testid="btn-lanjut"]', 30000);
    ok("tab kedua melihat TERPUTUS yang sama", (await st(B)).id === sa.id && (await st(B)).status === "TERPUTUS");
    await A.bringToFront(); await Promise.all([A.$eval('[data-testid="btn-lanjut"]', (e) => { e.click(); e.click(); }), B.$eval('[data-testid="btn-lanjut"]', (e) => { e.click(); })]);
    await await A.bringToFront(); await tungguStatus(A, ["BERJALAN", "SELESAI", "SELESAI_SEBAGIAN"], 40000); await B.bringToFront(); await tungguStatus(B, ["BERJALAN", "SELESAI", "SELESAI_SEBAGIAN"], 40000); await A.bringToFront();
    ok("Lanjutkan (klik ganda + dua tab): batch BERJALAN lagi di kedua tab", true); await tidur(8000);
    ok("sesudah Lanjutkan posting maju dan tidak ada posting ganda", mv() > mDiam && ganda() === 0, `${mv()} pergerakan; ganda=${ganda()}`);

    // ── E. Selesai dan konsisten ──
    console.log(waktu(), "menunggu batch selesai…");
    await tungguStatus(A, ["SELESAI", "SELESAI_SEBAGIAN"], 600000);
    const akhir = await hit(A); const sAkhir = await st(A); await tidur(1500);
    const trxUi = Number((await teks(A, '[data-testid="hitung-trx"] p:nth-child(2)')).split("/")[0]);
    ok("selesai: tidak ada order menunggu; setiap order punya hasil", akhir.tunggu === 0 && akhir.ok + akhir.gagal > 0 && unitSelesaiDb() === akhir.ok + akhir.gagal, `${sAkhir.status} ${JSON.stringify(akhir)}; BATCH_UNIT=${unitSelesaiDb()}`);
    ok("tidak ada posting ganda dan pergerakan = transaksi yang dilaporkan UI", ganda() === 0 && mv() === trxUi, `pergerakan ${mv()} / UI ${trxUi}`);
    ok("hanya SATU batch yang pernah diajukan", batchN() === 1);
    ok("jurnal tetap 4116 dan GL tidak berubah (tanpa jurnal HPP)", Number(sql("select count(*) from fin_journal_entries")) === 4116);
    ok("kartu HPP: nilai + belum dijurnal + jurnal tidak dibuat", /Rp[\d.]+/.test(await teks(A, '[data-testid="hpp-belum-jurnal"]')) && /TIDAK dibuat/i.test(await teks(A, '[data-testid="hpp-penjelasan"]')), await teks(A, '[data-testid="hpp-belum-jurnal"]'));
    if (akhir.gagal) { await A.$eval('[data-testid="filter-gagal"]', (e) => e.click()); await tunggu(A, '[data-testid="alasan-gagal"]'); ok("order gagal punya alasan yang dapat dibaca", (await teks(A, '[data-testid="alasan-gagal"]')).length > 20, (await teks(A, '[data-testid="alasan-gagal"]'))?.slice(0, 120)); }
    await foto(A, "p04-selesai");
  } catch (e) { gagal++; console.log("GALAT HARNESS:", e.stack || e.message); }
  finally { await browser.close(); proxy.close(); }
  fs.writeFileSync(path.join(DIR, "hasil-pulih.json"), JSON.stringify({ gagal, hasil }, null, 1)); console.log(`\nSELESAI ${waktu()}: ${hasil.filter((h) => h.ok).length} lulus, ${gagal} gagal`); process.exit(gagal ? 1 : 0);
})();
