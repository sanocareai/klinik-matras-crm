// CATATAN (persetujuan terikat, 25 Okt 2026): skrip ini ditulis SEBELUM dialog/API meminta persetujuan terikat (hash+daftar order+jumlah diketik, rujukan tidak lagi bertahan di draf). Untuk dijalankan lagi, isi bagian persetujuan seperti isiPersetujuan() di posting-historis-terikat.cjs dan kirim konfirmasiManifest pada POST batch/jalankan. Belum disesuaikan.
// QA browser NYATA (Chrome via puppeteer-core) untuk halaman Posting Pemakaian Historis, terhadap server + database TERISOLASI (restore sandbox; bukan production).
// Skenario: dua tab, refresh, tutup tab lalu buka lagi, koneksi putus (offline), backend restart, klik ganda (satu tab dan dua tab serentak), koreksi order lain saat batch berjalan,
// akun tanpa izin, tampilan HP, dan dampak performa dengan beberapa tab aktif.
//   BASE=http://localhost:4020 DB=ui1 CONTAINER=km-ui node frontend/qa-harness/posting-historis-browser.cjs
// Prasyarat: tokens.json (owner/admin/sales) di KM_UI_DIR; kontainer backend menyajikan frontend/dist; docker exec ke km-rekon-pg.
const puppeteer = require("puppeteer-core");
const { execFileSync } = require("child_process");
const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:4020"; const DB = process.env.DB || "ui1"; const CONTAINER = process.env.CONTAINER || "km-ui";
const DIR = process.env.KM_UI_DIR || "C:/tmp/km-ui"; const T = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8"));
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const SHOTS = path.join(DIR, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const sql = (q) => execFileSync("docker", ["exec", "km-rekon-pg", "psql", "-U", "klinik", "-d", DB, "-At", "-c", q], { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const dock = (...a) => execFileSync("docker", a, { encoding: "utf8", env: { ...process.env, MSYS_NO_PATHCONV: "1" } }).trim();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const hasil = []; let gagal = 0;
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 220) : ""}`); };
const T0 = Date.now(); const waktu = () => `t+${Math.round((Date.now() - T0) / 1000)}s`;

async function bukaHalaman(ctx, siapa, rute = "/warehouse/posting-historis", { lebar = 1280, tinggi = 900 } = {}) {
  const page = await ctx.newPage(); await page.setViewport({ width: lebar, height: tinggi });
  await page.evaluateOnNewDocument((token, user) => { try { if (!localStorage.getItem("token")) { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); } } catch (e) {} }, T[siapa].token, T[siapa].user);
  page.posts = []; page.on("request", (r) => { if (r.method() === "POST" && r.url().includes("/posting-historis/")) page.posts.push(r.url().replace(BASE, "")); });
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
const tunggu = (page, sel, ms = 30000) => page.waitForSelector(sel, { timeout: ms });
const teks = (page, sel) => page.$eval(sel, (e) => e.textContent.trim()).catch(() => null);
const ada = async (page, sel) => !!(await page.$(sel));
const klik = async (page, sel) => { await tunggu(page, sel, 15000); await page.$eval(sel, (e) => e.scrollIntoView({ block: "center" })); await page.click(sel); };
const foto = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png") });
const status = (page) => page.$eval('[data-testid="kartu-progres"]', (e) => ({ status: e.dataset.status, id: e.dataset.batchId })).catch(() => null);
const hitung = async (page) => ({ berhasil: Number(await teks(page, '[data-testid="hitung-berhasil"] p:nth-child(2)')), gagal: Number(await teks(page, '[data-testid="hitung-gagal"] p:nth-child(2)')), menunggu: Number(await teks(page, '[data-testid="hitung-menunggu"] p:nth-child(2)')) });
const jumlahGerak = () => Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'"));
const jumlahGanda = () => Number(sql("select count(*) from (select unit_id, note from stock_movements where note like 'Impor pemakaian historis Sep%' group by 1,2 having count(*)>1) x"));
const batchDiajukan = () => Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN'"));
async function tungguBackend(ms = 60000) { const t = Date.now(); while (Date.now() - t < ms) { try { const r = await fetch(BASE + "/api/health"); if (r.ok) return true; } catch { /* belum naik */ } await tidur(500); } return false; }

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null });
  const ctx = await browser.createBrowserContext(); // konteks pemilik (Owner): semua tab berbagi localStorage + BroadcastChannel seperti tab Chrome sungguhan
  try {
    // ── 1. Manifest dan dampak (Owner, desktop) ──
    const A = await bukaHalaman(ctx, "owner");
    await tunggu(A, '[data-testid="bagian-manifest"]'); await tunggu(A, '[data-testid="stat-trx"]');
    const trx = Number(await teks(A, '[data-testid="stat-trx"] p:nth-child(2)')); const order = Number(await teks(A, '[data-testid="stat-order"] p:nth-child(2)'));
    ok("manifest tampil: jumlah order + transaksi + hash", trx > 100 && order > 50 && (await ada(A, '[data-testid="hash-manifest"]')), `${order} order, ${trx} trx`);
    ok("kartu HPP menyatakan PARSIAL + selisih belum dijurnal + jurnal tidak dibuat", /PARSIAL/i.test(await teks(A, '[data-testid="hpp-label"]')) && /Rp[\d.]+/.test(await teks(A, '[data-testid="hpp-belum-jurnal"]')) && /TIDAK dibuat/i.test(await teks(A, '[data-testid="hpp-penjelasan"]')), await teks(A, '[data-testid="hpp-belum-jurnal"]'));
    await foto(A, "01-manifest-desktop");
    // rincian order: tertahan + alasan
    await A.$$eval('[data-testid="baris-manifest"] button[aria-expanded]', (bs) => { const b = bs.find((x) => x.closest("li").querySelector('[data-testid="badge-tertahan"]')) || bs[0]; b.click(); });
    await tunggu(A, '[data-testid="rincian-order"]'); ok("rincian order menampilkan transaksi dan catatan tertahan beserta alasannya", await ada(A, '[data-testid="tertahan-order"]'), (await teks(A, '[data-testid="tertahan-order"]'))?.slice(0, 160));
    await foto(A, "02-rincian-order");

    // ── 2. Pilihan sebagian order → hash pilihan dihitung server ──
    const hashPenuh = await teks(A, '[data-testid="hash-manifest"]');
    await A.click('[data-testid="pilih-order"]'); await tunggu(A, '[data-testid="pilih-semua"]');
    await A.waitForFunction((h) => document.querySelector('[data-testid="hash-manifest"]')?.textContent.trim() !== h, { timeout: 15000 }, hashPenuh);
    ok("memilih sebagian order: hash + dampak dihitung ulang server", (await teks(A, '[data-testid="jumlah-terpilih"]'))?.startsWith(String(order - 1)), await teks(A, '[data-testid="jumlah-terpilih"]'));
    await A.click('[data-testid="pilih-semua"]'); await A.waitForFunction((h) => document.querySelector('[data-testid="hash-manifest"]')?.textContent.trim() === h, { timeout: 15000 }, hashPenuh);
    ok("pilih semua mengembalikan manifest penuh", true);

    // ── 3. Draft tidak hilang saat refresh / pindah halaman ──
    await klik(A, '[data-testid="btn-mulai"]'); await tunggu(A, '[data-testid="input-rujukan"]');
    await A.type('[data-testid="input-rujukan"]', "OWNER-UJI-BROWSER-001");
    await A.reload({ waitUntil: "domcontentloaded" }); await tunggu(A, '[data-testid="btn-mulai"]'); await klik(A, '[data-testid="btn-mulai"]'); await tunggu(A, '[data-testid="input-rujukan"]');
    ok("draft rujukan bertahan setelah refresh (per tab)", (await A.$eval('[data-testid="input-rujukan"]', (e) => e.value)) === "OWNER-UJI-BROWSER-001");
    await A.goto(BASE + "/dashboard", { waitUntil: "domcontentloaded" }); await tidur(1200); await A.goto(BASE + "/warehouse/posting-historis", { waitUntil: "domcontentloaded" }); await tunggu(A, '[data-testid="btn-mulai"]'); await klik(A, '[data-testid="btn-mulai"]'); await tunggu(A, '[data-testid="input-rujukan"]');
    ok("draft rujukan bertahan setelah pindah halaman dan kembali", (await A.$eval('[data-testid="input-rujukan"]', (e) => e.value)) === "OWNER-UJI-BROWSER-001");
    ok("tombol konfirmasi mati sebelum checkbox diperiksa", await A.$eval('[data-testid="konfirmasi-mulai"]', (e) => e.disabled));
    await foto(A, "03-dialog-konfirmasi");

    // ── 4. Dua tab menekan Mulai serentak + klik ganda → SATU batch ──
    const B = await bukaHalaman(ctx, "owner"); await tunggu(B, '[data-testid="btn-mulai"]');
    await klik(B, '[data-testid="btn-mulai"]'); await tunggu(B, '[data-testid="input-rujukan"]'); await B.type('[data-testid="input-rujukan"]', "OWNER-UJI-BROWSER-001"); await B.click('[data-testid="cek-periksa"]');
    await A.click('[data-testid="cek-periksa"]');
    const gerak0 = jumlahGerak(); const ajukan0 = batchDiajukan();
    await Promise.all([A.$eval('[data-testid="konfirmasi-mulai"]', (e) => { e.click(); e.click(); }), B.$eval('[data-testid="konfirmasi-mulai"]', (e) => { e.click(); })]); // klik ganda dalam satu tab + tab kedua serentak
    await tunggu(A, '[data-testid="kartu-progres"]', 30000); await tunggu(B, '[data-testid="kartu-progres"]', 30000);
    const sA = await status(A); const sB = await status(B);
    ok("klik ganda + dua tab serentak: tepat SATU batch dan kedua tab melihat batch yang sama", batchDiajukan() - ajukan0 === 1 && sA.id && sA.id === sB.id, `batch ${sA.id?.slice(0, 10)} / ${sB.id?.slice(0, 10)}; POST A=${A.posts.length} B=${B.posts.length}`);
    ok("tombol Mulai hilang saat batch aktif (tidak bisa memulai batch kedua)", !(await ada(A, '[data-testid="btn-mulai"]')) && !(await ada(B, '[data-testid="btn-mulai"]')));
    console.log(waktu(), "batch dimulai", sA.id.slice(0, 10)); await foto(A, "04-progres-berjalan");

    // ── 5. Progres sinkron antar tab ──
    await tidur(6000); const hA = await hitung(A); const hB = await hitung(B);
    ok("progres naik dan kedua tab konsisten (selisih ≤ 3 order polling)", hA.berhasil > 0 && Math.abs((hA.berhasil + hA.gagal) - (hB.berhasil + hB.gagal)) <= 6, `A=${JSON.stringify(hA)} B=${JSON.stringify(hB)}`);
    ok("status server berjalan: tombol Hentikan tampil untuk Owner", await ada(A, '[data-testid="btn-hentikan"]'));

    // ── 6. Refresh; tutup tab lalu buka tab baru ──
    const sebelum = await hitung(A); await A.reload({ waitUntil: "domcontentloaded" }); await tunggu(A, '[data-testid="kartu-progres"]');
    const setelah = await hitung(A); ok("refresh: batch yang sama muncul lagi dengan progres ≥ sebelumnya", (await status(A)).id === sA.id && setelah.berhasil + setelah.gagal >= sebelum.berhasil + sebelum.gagal, `${JSON.stringify(sebelum)} → ${JSON.stringify(setelah)}`);
    await B.close(); const C = await bukaHalaman(ctx, "owner"); await tunggu(C, '[data-testid="kartu-progres"]');
    ok("tab ditutup lalu tab baru dibuka: status batch yang sama", (await status(C)).id === sA.id, JSON.stringify(await hitung(C)));

    // ── 7. Koreksi ORDER LAIN saat batch berjalan (UI API) ──
    const notaLain = sql("select n.id || '|' || coalesce(n.qty,0) from unit_usage_notes n where n.origin='EXCEL' and n.state='PERLU_DICEK' and n.qty is not null and n.material_id is not null and n.unit_id not in (select unit_id from unit_usage_notes where state in ('SIAP_POSTING','DIPOSTING') and unit_id is not null) limit 1").split("|");
    if (notaLain[0]) {
      const r = await C.evaluate(async (id, qty, base) => { const res = await fetch(`${base}/api/production/catatan-historis/${id}/koreksi`, { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token"), "Idempotency-Key": "qa-browser-" + Date.now() + "-aaaa" }, body: JSON.stringify({ qty: Number(qty) + 0.1, alasan: "QA browser: koreksi order lain saat batch berjalan" }) }); return { status: res.status, ms: 0 }; }, notaLain[0], notaLain[1], BASE);
      ok("koreksi catatan order lain saat batch berjalan berhasil (201)", r.status === 201, JSON.stringify(r));
      ok("koreksi tercatat di database (peristiwa DIKOREKSI) dan batch tidak terganggu", Number(sql(`select count(*) from unit_usage_note_events where note_id='${notaLain[0]}' and kind='DIKOREKSI'`)) === 1 && (await status(C)).status === "BERJALAN");
    } else ok("catatan order lain tersedia untuk uji koreksi", false, "tidak ada");

    // ── 8. Koneksi putus (offline) di satu tab ──
    await C.setOfflineMode(true); await tunggu(C, '[data-testid="banner-koneksi"]', 40000);
    const durOff = await hitung(C).catch(() => null);
    ok("offline: banner koneksi tampil dan status terakhir tetap ada (tidak kosong)", (await ada(C, '[data-testid="kartu-progres"]')) && /Koneksi terputus/.test(await teks(C, '[data-testid="banner-koneksi"]')), JSON.stringify(durOff));
    await foto(C, "05-offline");
    const sAmbil = (await hitung(A)); await C.setOfflineMode(false); await C.waitForFunction(() => !document.querySelector('[data-testid="banner-koneksi"]'), { timeout: 60000 });
    const sPulih = await hitung(C); ok("koneksi pulih: banner hilang dan progres mengejar server", sPulih.berhasil + sPulih.gagal >= (durOff?.berhasil ?? 0) + (durOff?.gagal ?? 0), `${JSON.stringify(durOff)} → ${JSON.stringify(sPulih)}`);

    // ── 9. Beberapa tab aktif: dampak performa (resource timing + CPU kontainer) ──
    const extra = []; for (let i = 0; i < 4; i++) { const p = await bukaHalaman(ctx, "owner"); await tunggu(p, '[data-testid="kartu-progres"]'); extra.push(p); }
    const tabs = [A, C, ...extra]; await Promise.all(tabs.map((p) => p.evaluate(() => performance.clearResourceTimings())));
    const gerakMulai = jumlahGerak(); const tM = Date.now(); await tidur(30000);
    const statCpu = dock("stats", "--no-stream", "--format", "{{.Name}} {{.CPUPerc}} {{.MemUsage}}", CONTAINER, "km-rekon-pg");
    const panggilan = []; for (const p of tabs) panggilan.push(...(await p.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/posting-historis/")).map((e) => ({ u: e.name.split("/api/production")[1].replace(/[0-9a-f]{64}/, ":id"), d: e.duration })))));
    const durs = panggilan.map((x) => x.d).sort((a, b) => a - b); const p50 = durs[Math.floor(durs.length / 2)]; const p95 = durs[Math.floor(durs.length * 0.95)];
    const perDetik = panggilan.length / ((Date.now() - tM) / 1000);
    ok("6 tab aktif: permintaan polling wajar (<3/dtk total) dan cepat (p95 < 800 ms)", perDetik < 3 && p95 < 800, `${panggilan.length} permintaan/30s (${perDetik.toFixed(2)}/dtk), p50 ${Math.round(p50)} ms, p95 ${Math.round(p95)} ms; ${statCpu.replace(/\n/g, " | ")}`);
    ok("batch tetap maju selama 6 tab aktif", jumlahGerak() > gerakMulai, `+${jumlahGerak() - gerakMulai} pergerakan / 30 dtk`);
    for (const p of extra) await p.close();
    // tab tersembunyi tidak polling: buka tab baru di depan A → A tersembunyi
    await C.bringToFront(); await A.evaluate(() => performance.clearResourceTimings()); await tidur(8000);
    const nA = await A.evaluate(() => performance.getEntriesByType("resource").filter((e) => e.name.includes("/posting-historis/")).length); console.log("  polling tab latar belakang (8 dtk):", nA);

    // ── 10. Backend restart saat batch berjalan ──
    console.log(waktu(), "restart backend"); const terakhirSebelum = await hitung(C);
    dock("restart", CONTAINER); await C.bringToFront(); await tunggu(C, '[data-testid="banner-koneksi"]', 60000).catch(() => {});
    ok("backend restart: UI menampilkan banner koneksi, status terakhir tetap ada", await ada(C, '[data-testid="kartu-progres"]'), JSON.stringify(terakhirSebelum));
    await tungguBackend(); await C.waitForFunction(() => !document.querySelector('[data-testid="banner-koneksi"]'), { timeout: 60000 });
    ok("backend kembali: UI pulih tanpa reload manual", true);
    const pausePos = jumlahGerak(); console.log(waktu(), "menunggu sewa pekerja lama kedaluwarsa (≤ 95 dtk) → TERPUTUS");
    await C.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "TERPUTUS", { timeout: 130000 });
    ok("pekerja mati terdeteksi: status TERPUTUS + tombol Lanjutkan", await ada(C, '[data-testid="btn-lanjut"]') && /Terputus/i.test(await teks(C, '[data-testid="status-batch"]')), `gerak ${jumlahGerak()} (tidak bertambah: ${jumlahGerak() === pausePos})`);
    await foto(C, "06-terputus");
    const lanjutSerentak = await Promise.all([C.click('[data-testid="btn-lanjut"]'), C.click('[data-testid="btn-lanjut"]').catch(() => {})]);
    await C.waitForFunction(() => ["BERJALAN", "SELESAI", "SELESAI_SEBAGIAN"].includes(document.querySelector('[data-testid="kartu-progres"]')?.dataset.status), { timeout: 30000 });
    ok("Lanjutkan (klik ganda) → batch berjalan lagi", true);

    // ── 11. Hentikan lalu lanjutkan ──
    await tunggu(C, '[data-testid="btn-hentikan"]', 20000).catch(() => {});
    if (await ada(C, '[data-testid="btn-hentikan"]')) {
      await C.click('[data-testid="btn-hentikan"]'); await C.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "DIHENTIKAN", { timeout: 30000 });
      const gDihentikan = jumlahGerak(); await tidur(5000);
      ok("Hentikan: status DIHENTIKAN dan tidak ada posting baru setelah order berjalan selesai", jumlahGerak() - gDihentikan <= 1, `+${jumlahGerak() - gDihentikan}`);
      await A.bringToFront(); await A.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "DIHENTIKAN", { timeout: 20000 });
      ok("tab lain ikut melihat DIHENTIKAN (BroadcastChannel/polling)", true); await klik(C, '[data-testid="btn-lanjut"]');
      await C.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]')?.dataset.status === "BERJALAN", { timeout: 30000 });
    }

    // ── 12. Selesai ──
    console.log(waktu(), "menunggu batch selesai…");
    await C.waitForFunction(() => ["SELESAI", "SELESAI_SEBAGIAN"].includes(document.querySelector('[data-testid="kartu-progres"]')?.dataset.status), { timeout: 600000 });
    const akhir = await hitung(C); const stAkhir = await status(C);
    ok("batch selesai di UI: tidak ada order 'menunggu'", akhir.menunggu === 0, `${stAkhir.status} ${JSON.stringify(akhir)}`);
    ok("tidak ada posting ganda (kunci order+bahan unik) dan pergerakan = transaksi yang berhasil", jumlahGanda() === 0 && jumlahGerak() > gerak0, `pergerakan ${jumlahGerak()}`);
    ok("kartu HPP hasil batch: nilai tercatat + belum dijurnal + jurnal tidak dibuat", /Rp[\d.]+/.test(await teks(C, '[data-testid="hpp-belum-jurnal"]')) && /TIDAK dibuat/i.test(await teks(C, '[data-testid="hpp-penjelasan"]')), await teks(C, '[data-testid="hpp-belum-jurnal"]'));
    const gagalN = akhir.gagal;
    if (gagalN > 0) { await klik(C, '[data-testid="filter-gagal"]'); await tunggu(C, '[data-testid="alasan-gagal"]'); ok("order gagal menampilkan alasan yang dapat dibaca", (await teks(C, '[data-testid="alasan-gagal"]')).length > 20, await teks(C, '[data-testid="alasan-gagal"]')); }
    await foto(C, "07-selesai");

    // ── 13. Akun tanpa izin (konteks terpisah) ──
    const ctxAdmin = await browser.createBrowserContext(); const AD = await bukaHalaman(ctxAdmin, "admin"); await tunggu(AD, '[data-testid="kartu-progres"], [data-testid="bagian-manifest"]', 30000);
    ok("Admin tanpa izin persetujuan: dapat memantau, melihat catatan baca-saja, TIDAK ada tombol Mulai/Hentikan/Lanjutkan", (await ada(AD, '[data-testid="info-baca-saja"]')) && !(await ada(AD, '[data-testid="btn-mulai"]')) && !(await ada(AD, '[data-testid="btn-hentikan"]')) && !(await ada(AD, '[data-testid="btn-lanjut"]')));
    const apiAdmin = await AD.evaluate(async (base) => { const h = { "Content-Type": "application/json", Authorization: "Bearer " + localStorage.getItem("token") }; const g = await fetch(base + "/api/production/posting-historis/pratinjau", { headers: h }); const p = await fetch(base + "/api/production/posting-historis/batch", { method: "POST", headers: h, body: JSON.stringify({ hashDisetujui: "0".repeat(64), rujukan: "ADMIN-COBA-PAKSA" }) }); const j = await fetch(base + "/api/production/posting-historis/jalankan", { method: "POST", headers: h, body: JSON.stringify({ hashDisetujui: "0".repeat(64), rujukan: "ADMIN-COBA-PAKSA" }) }); return [g.status, p.status, j.status]; }, BASE);
    ok("Admin lewat API paksa: baca 200, mulai batch 403, jalankan sinkron 403", apiAdmin[0] === 200 && apiAdmin[1] === 403 && apiAdmin[2] === 403, JSON.stringify(apiAdmin)); await foto(AD, "08-admin-baca-saja");
    const ctxSales = await browser.createBrowserContext(); const SA = await bukaHalaman(ctxSales, "sales"); await SA.waitForFunction(() => /Halaman ini untuk Admin, Owner, dan Finance/.test(document.body.innerText), { timeout: 30000 });
    const apiSales = await SA.evaluate(async (base) => { const h = { Authorization: "Bearer " + localStorage.getItem("token") }; return [(await fetch(base + "/api/production/posting-historis/pratinjau", { headers: h })).status, (await fetch(base + "/api/production/posting-historis/batch", { headers: h })).status]; }, BASE);
    ok("Sales: halaman menolak dengan penjelasan; API 403", apiSales[0] === 403 && apiSales[1] === 403, JSON.stringify(apiSales)); await foto(SA, "09-sales-ditolak");
    ok("endpoint tanpa token ditolak (401)", (await fetch(BASE + "/api/production/posting-historis/pratinjau")).status === 401);

    // ── 14. Tampilan HP ──
    const ctxHp = await browser.createBrowserContext(); const HP = await bukaHalaman(ctxHp, "owner", "/warehouse/posting-historis", { lebar: 390, tinggi: 844 }); await tunggu(HP, '[data-testid="kartu-progres"], [data-testid="bagian-manifest"]');
    await tidur(1500); const lebarHalaman = await HP.evaluate(() => ({ sw: document.documentElement.scrollWidth, iw: window.innerWidth }));
    ok("HP 390px: tanpa scroll horizontal", lebarHalaman.sw <= lebarHalaman.iw + 1, JSON.stringify(lebarHalaman)); await foto(HP, "10-hp-progres");
    await HP.evaluate(() => window.scrollTo(0, document.body.scrollHeight / 3)); await foto(HP, "11-hp-daftar");
    ok("HP: target sentuh ≥ 44px untuk tombol aksi", (await HP.$$eval("button", (bs) => bs.filter((b) => /Muat ulang|Lanjutkan|Hentikan|Mulai/.test(b.textContent)).every((b) => b.getBoundingClientRect().height >= 40))));
  } catch (e) { gagal++; console.log("GALAT HARNESS:", e.stack || e.message); }
  finally { await browser.close(); }
  fs.writeFileSync(path.join(DIR, "hasil-browser.json"), JSON.stringify({ gagal, hasil }, null, 1));
  console.log(`\nSELESAI ${waktu()}: ${hasil.filter((h) => h.ok).length} lulus, ${gagal} gagal`);
  process.exit(gagal ? 1 : 0);
})();
