// QA navigasi tab Marketing (Chrome nyata, komponen + backend ASLI di atas database terisolasi): Back/Forward lintas tab shell, dua halaman Laporan, URL langsung, refresh,
// ganti periode saat request berjalan, hasil lama tidak menimpa hasil terbaru, coba ulang 429 terbatas.
//   BASE=http://localhost:5192 API=http://127.0.0.1:4021 OUT=C:/tmp/km-mkt-prodcopy DARI=2026-10-01 SAMPAI=2026-10-29 node frontend/qa-harness/marketing-navigasi.cjs
const U = require("./qa-util.cjs"); const { ok, num, tidur, tunggu, teks, buka, urlKini, fs, path } = U;
const DARI = process.env.DARI || "2026-10-01", SAMPAI = process.env.SAMPAI || "2026-10-29"; const P = `dari=${DARI}&sampai=${SAMPAI}`;
const KEY = "open-tabs:v1";

// Intersepsi permintaan: aturan {cocok: RegExp, tunda: ms, status: 429, kali: n (jumlah pertama saja)}. Tanpa aturan → lanjut.
async function atur(page) {
  page.aturan = []; page.hitung = new Map();
  await page.setRequestInterception(true);
  page.on("request", (req) => {
    const u = req.url(); const a = page.aturan.find((x) => x.cocok.test(u) && (x.kali == null || (x.dipakai = (x.dipakai || 0) + 1) <= x.kali));
    page.hitung.set(u.replace(/^https?:\/\/[^/]+/, ""), (page.hitung.get(u.replace(/^https?:\/\/[^/]+/, "")) || 0) + 1);
    if (!a) return req.continue();
    if (a.status) return req.respond({ status: a.status, contentType: "application/json", headers: { "access-control-allow-origin": "*" }, body: JSON.stringify({ error: "SEDANG_DIHITUNG", message: "Laporan sedang dihitung." }) });
    setTimeout(() => { try { req.continue(); } catch { /* halaman ditutup */ } }, a.tunda);
  });
}
const jumlahMinta = (page, re) => [...page.hitung.entries()].filter(([u]) => re.test(u)).reduce((a, [, n]) => a + n, 0);
const tabsTersimpan = (page) => page.evaluate((k) => { try { return JSON.parse(localStorage.getItem(k)); } catch { return null; } }, KEY);
const tungguMarketing = async (page) => { await tunggu(page, '[data-testid="ringkasan-marketing"], [data-testid="detail-marketing"]', 90000); };
const kartuLead = async (page) => num(await teks(page, '[data-testid="kartu-lead"] span:nth-child(2)'));
const tabStrip = (page) => page.$$eval('[role="tablist"][aria-label="Tab yang terbuka"] [role="tab"]', (t) => t.map((x) => ({ teks: x.textContent.trim(), aktif: x.getAttribute("aria-selected") === "true" })));
const klikTabShell = async (page, indeks) => { const h = await page.$$('[role="tablist"][aria-label="Tab yang terbuka"] [role="tab"]'); await h[indeks].click({ offset: { x: 8, y: 8 } }); };
const sumberAPI = async (dari, sampai) => (await U.apiGet("admin", `/api/atribusi/iklan/sumber?dari=${dari}&sampai=${sampai}`)).json;

(async () => {
  const meta = (await U.apiGet("admin", `/api/atribusi/iklan?${P}&level=campaign`)).json;
  const camp = meta.grup.filter((g) => g.status === "MAPPED").sort((a, b) => (b.lead?.unik || 0) - (a.lead?.unik || 0))[0];
  const campId = camp.campaign.id;
  const adsets = (await U.apiGet("admin", `/api/atribusi/iklan?${P}&level=adset&campaignId=${campId}`)).json;
  const adset = adsets.grup.filter((g) => g.status === "MAPPED")[0]; const adsetId = adset?.adSet?.id;
  const S1 = await sumberAPI(DARI, SAMPAI);
  const browser = await U.mulai();
  try {
    // ═══ N1. URL langsung + refresh ═══
    let page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}&sumber=META&level=ad&campaign=${campId}&adset=${adsetId}`);
    await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(800);
    const baca = async () => ({ url: urlKini(page).search, judul: await teks(page, '[data-testid="meta-detail"] h3'), baris: (await page.$$('[data-testid^="baris-meta-"]')).length, jejak: await teks(page, 'nav[aria-label="Jejak"]') });
    const a1 = await baca();
    ok("N1 URL langsung ke level Ad: breadcrumb memuat Marketing › Meta › campaign › ad set; tabel level Ad", /Per ad/i.test(a1.judul || "") && /Marketing/.test(a1.jejak || "") && a1.baris > 0, `${a1.judul} | ${a1.jejak} | ${a1.baris} baris`);
    await page.reload({ waitUntil: "domcontentloaded" }); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(800);
    const a2 = await baca();
    ok("N1 Refresh: URL, level, jumlah baris, dan jejak identik", a1.url === a2.url && a1.baris === a2.baris && a1.jejak === a2.jejak && a1.judul === a2.judul, `${a2.url.slice(0, 120)}`);
    ok("N1 Periode tidak berubah setelah refresh", urlKini(page).searchParams.get("dari") === DARI && urlKini(page).searchParams.get("sampai") === SAMPAI);
    // ═══ N2. Back/Forward dalam Marketing ═══
    await page.goto(U.BASE + `/laporan?tab=Marketing&${P}`, { waitUntil: "domcontentloaded" }); await tunggu(page, '[data-testid="tabel-sumber"]', 90000);
    await page.click('[data-testid="baris-sumber-META"]'); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000);
    ok("N2 klik sumber META → URL sumber=META", urlKini(page).searchParams.get("sumber") === "META");
    await page.click('[data-testid^="baris-meta-"][data-status="MAPPED"]'); await U.tungguUrl(page, /level=adset/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000);
    ok("N2 drilldown campaign → ad set (URL level=adset&campaign=…)", urlKini(page).searchParams.get("level") === "adset" && !!urlKini(page).searchParams.get("campaign"));
    await page.goBack(); await U.tungguUrl(page, /^(?!.*level=adset)/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(500);
    ok("N2 Back → kembali ke level campaign (breadcrumb ikut)", (await teks(page, '[data-testid="meta-detail"] h3') || "").startsWith("Per campaign") && !urlKini(page).searchParams.get("level"));
    await page.goBack(); await tunggu(page, '[data-testid="tabel-sumber"]', 90000);
    ok("N2 Back lagi → ringkasan semua sumber (tanpa sumber di URL), periode tetap", !urlKini(page).searchParams.get("sumber") && urlKini(page).searchParams.get("dari") === DARI);
    await page.goForward(); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000);
    ok("N2 Forward → detail Meta lagi", urlKini(page).searchParams.get("sumber") === "META");
    await page.goForward(); await U.tungguUrl(page, /level=adset/); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000);
    ok("N2 Forward → ad set lagi", urlKini(page).searchParams.get("level") === "adset");
    await page.close();

    // ═══ N3. Back/Forward lintas tab shell + N4. dua halaman Laporan (dua tab shell, state masing-masing) ═══
    const periodeB = { dari: "2026-09-02", sampai: "2026-09-30" };
    const pathA0 = `/laporan?tab=Marketing&${P}`;
    const pathB0 = `/laporan?tab=Marketing&dari=${periodeB.dari}&sampai=${periodeB.sampai}&sumber=TIKTOK`;
    const awal = JSON.stringify({ tabs: [{ id: "tA", path: pathA0, title: "Laporan" }, { id: "tB", path: pathB0, title: "Laporan" }], activeId: "tA" });
    page = await buka(browser, "admin", pathA0, { awal });
    await tunggu(page, '[data-testid="tabel-sumber"]', 90000); await tidur(1500);
    ok("N4 dua tab Laporan terpasang bersamaan (A aktif); state tab B tidak tercampur ke A", (await tabStrip(page)).length === 2 && urlKini(page).searchParams.get("sumber") == null && urlKini(page).searchParams.get("dari") === DARI);
    const cekTabs = async (ket) => { const st = await tabsTersimpan(page); const A = st.tabs.find((t) => t.id === "tA"), B = st.tabs.find((t) => t.id === "tB"); return { A, B, st, ket }; };
    await page.click('[data-testid="baris-sumber-META"]'); await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000);     // A → META (pushState)
    await page.click('[data-testid^="baris-meta-"][data-status="MAPPED"]'); await U.tungguUrl(page, /level=adset/); await tidur(500);   // A → ad set (pushState)
    let c = await cekTabs();
    ok("N4 tab A: path tersimpan = META › ad set; tab B tidak berubah", /sumber=META/.test(c.A.path) && /level=adset/.test(c.A.path) && c.B.path === pathB0, `A=${c.A.path.slice(0, 110)}`);
    const pathAkhirA = c.A.path;
    await klikTabShell(page, 1); await tidur(2500);
    let u = urlKini(page); const contentB = await tunggu(page, '[data-testid="detail-marketing"]', 30000).then(() => true).catch(() => false);
    if (!contentB) console.log("DEBUG B:", await page.evaluate(() => [...document.querySelectorAll("[data-testid]")].map((e) => e.dataset.testid + (e.offsetParent ? "+" : "-")).filter((x) => /marketing|detail|galat|memuat|ringkasan|akses|sumber/.test(x)).join(",")), page.galat.join("|"), JSON.stringify(page.permintaan.filter((r) => /atribusi/.test(r.url)).map((r) => r.url.slice(0, 80))));
    ok("N4 pindah ke tab B (strip): URL = state B (TikTok, periode Sep) dan detail TikTok tampil", u.searchParams.get("sumber") === "TIKTOK" && u.searchParams.get("dari") === periodeB.dari && contentB, u.search.slice(0, 110));
    await page.goBack(); await tidur(2500);
    c = await cekTabs();
    const aUtuh = c.A.path === pathAkhirA, bUtuh = c.B.path === pathB0;
    ok("N3 Back dari tab B (entri riwayat milik tab A → tab A diaktifkan): aplikasi tetap hidup tanpa galat", page.galat.length === 0, page.galat.join(" | "));
    ok("N3 Back tidak merusak penyimpanan: path tab A tetap META › ad set dan path tab B tetap TikTok periode Sep", aUtuh && bUtuh, `A=${aUtuh ? "utuh" : c.A.path.slice(0, 90)} | B=${bUtuh ? "utuh" : c.B.path.slice(0, 90)}`);
    const tampil = await page.evaluate(() => ({ url: location.pathname + location.search, detail: !!document.querySelector('[data-testid="detail-marketing"]'), ringkas: !!document.querySelector('[data-testid="ringkasan-marketing"]') }));
    const aktifSetelahBack = (await tabStrip(page)).findIndex((t) => t.aktif);
    const urlAktif = (await tabsTersimpan(page)).tabs.find((t) => t.id === (aktifSetelahBack === 0 ? "tA" : "tB")).path;
    ok("N3 Setelah Back: URL browser = path tab yang aktif (tidak ada tab yang menampilkan state tab lain)", tampil.url === urlAktif, `URL=${tampil.url.slice(0, 100)} | tab aktif[${aktifSetelahBack}]=${urlAktif.slice(0, 100)}`);
    await page.goForward(); await tidur(2500);
    c = await cekTabs(); const aktifF = (await tabStrip(page)).findIndex((t) => t.aktif); const urlAktifF = c.st.tabs.find((t) => t.id === (aktifF === 0 ? "tA" : "tB")).path;
    ok("N3 Forward: tab tetap dua, path A dan B tetap utuh, URL = path tab aktif", (await tabStrip(page)).length === 2 && c.A.path === pathAkhirA && c.B.path === pathB0 && (urlKini(page).pathname + urlKini(page).search) === urlAktifF, `URL=${(urlKini(page).pathname + urlKini(page).search).slice(0, 100)}`);
    await klikTabShell(page, 0); await tidur(2500);
    const ua = urlKini(page); ok("N4 kembali ke tab A: URL = state A terakhir (META › ad set, periode awal)", ua.searchParams.get("sumber") === "META" && ua.searchParams.get("level") === "adset" && ua.searchParams.get("dari") === DARI, ua.search.slice(0, 120));
    ok("N4 konten tab A tetap tabel Meta level ad set", (await teks(page, '[data-testid="meta-detail"] h3') || "").startsWith("Per ad set"));
    await klikTabShell(page, 1); await tidur(2000);
    const ub = urlKini(page); ok("N4 kembali ke tab B: tetap TikTok periode Sep (tidak terpengaruh navigasi A)", ub.searchParams.get("sumber") === "TIKTOK" && ub.searchParams.get("dari") === periodeB.dari, ub.search.slice(0, 120));
    await page.close();

    // ═══ N5. Laporan di tab BACKGROUND dengan URL lama tidak membajak tab aktif ═══
    const awal5 = JSON.stringify({ tabs: [{ id: "t1", path: "/customers", title: "Customers" }, { id: "t2", path: `/laporan?tab=Iklan&${P}`, title: "Laporan" }], activeId: "t1" });
    page = await buka(browser, "admin", `/customers`, { awal: awal5 });
    await tidur(6000);
    let s5 = await tabsTersimpan(page);
    ok("N5 Laporan (URL lama ?tab=Iklan) di tab background TIDAK menulis ke tab aktif (/customers tetap)", s5.tabs.find((t) => t.id === "t1")?.path === "/customers" && urlKini(page).pathname === "/customers", s5.tabs.map((t) => t.path.slice(0, 60)).join(" || "));
    await klikTabShell(page, 1); await page.waitForFunction(() => location.pathname === "/laporan", { timeout: 20000 }); await tunggu(page, '[data-testid="detail-marketing"]', 90000); await tidur(800);
    const u5 = urlKini(page); s5 = await tabsTersimpan(page);
    ok("N5 setelah tab Laporan aktif: URL lama dikanonikalkan → tab=Marketing&sumber=META, periode dipertahankan", u5.searchParams.get("tab") === "Marketing" && u5.searchParams.get("sumber") === "META" && u5.searchParams.get("dari") === DARI && u5.searchParams.get("sampai") === SAMPAI, u5.search.slice(0, 100));
    ok("N5 tab /customers tidak berubah", s5.tabs.find((t) => t.id === "t1")?.path === "/customers");
    await page.close();

    // ═══ N6. ganti periode saat request berjalan; hasil lama tidak menimpa ═══
    page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`, { prasiap: async (pg) => {
      await atur(pg);   // intersepsi dipasang SEBELUM halaman dimuat: respons periode awal sengaja tertahan
      pg.aturan.push({ cocok: new RegExp(`atribusi/iklan/sumber\\?dari=${DARI}&sampai=${SAMPAI}`), tunda: 7000 });
      pg.aturan.push({ cocok: new RegExp(`analytics/traffic\\?.*from=${DARI}.*to=${SAMPAI}|analytics/traffic\\?.*to=${SAMPAI}.*from=${DARI}`), tunda: 9000 });
    } });
    const t0 = Date.now();



    await tunggu(page, '[data-testid="memuat-marketing"]', 20000); await tidur(500);
    ok("N6 permintaan periode lama sedang berjalan: tampil 'Memuat…' (bukan angka lama)", !!(await page.$('[data-testid="memuat-marketing"]')));
    await page.click('button[aria-label="Periode sebelumnya"]');       // ganti periode saat request pertama masih tertahan
    const u6 = urlKini(page).searchParams; const d2 = u6.get("dari"), s2 = u6.get("sampai");
    ok("N6 periode berganti di URL saat request lama masih berjalan", d2 !== DARI && s2 !== SAMPAI, `${d2}→${s2}`);
    const S2 = await sumberAPI(d2, s2);
    await page.waitForFunction((n) => { const e = document.querySelector('[data-testid="kartu-lead"] span:nth-child(2)'); return e && Number(e.textContent.replace(/\D/g, "")) === n; }, { timeout: 60000 }, S2.total.lead);
    const tHasil2 = Date.now() - t0;
    ok("N6 hasil periode BARU tampil (total lead = API periode baru)", (await kartuLead(page)) === S2.total.lead, `${await kartuLead(page)} vs ${S2.total.lead}`);
    await tidur(Math.max(0, 11000 - tHasil2));                          // tunggu SEMUA respons lama (sumber 7 dtk, traffic 9 dtk) tiba
    ok("N6 respons lama (periode awal) tiba kemudian TIDAK menimpa: kartu tetap periode baru", (await kartuLead(page)) === S2.total.lead && S2.total.lead !== S1.total.lead, `${await kartuLead(page)} vs baru ${S2.total.lead} lama ${S1.total.lead}`);
    const banner = await teks(page, '[data-testid="banner-periode"]');
    ok("N6 banner periode = periode baru", /Sep 2026|Okt 2026/.test(banner || "") && !/1 Okt 2026 – 29 Okt 2026/.test(banner || ""), banner);
    const trafficBaru = (await U.apiGet("admin", `/api/analytics/traffic?from=${d2}&to=${s2}`)).json;
    await page.click('[data-testid="bagian-kualitas"] button'); await tunggu(page, '[data-butir="rekonLead"]', 90000);
    const rl = await teks(page, '[data-butir="rekonLead"]');
    ok("N6 tren/traffic juga periode baru (rekonsiliasi lead memakai tren periode baru dan Cocok)", new RegExp(`tren harian ${trafficBaru.totalLeads.toLocaleString("id-ID")}`).test(rl || "") && /Cocok/.test(rl || ""), rl);
    ok("N6 permintaan laporan Meta periode lama TIDAK dikirim (basi dilewati)", jumlahMinta(page, new RegExp(`atribusi/iklan\\?dari=${DARI}&sampai=${SAMPAI}`)) === 0, `kirim: ${jumlahMinta(page, new RegExp(`atribusi/iklan\\?dari=${DARI}`))}`);
    ok("N6 tanpa galat halaman", page.galat.length === 0, page.galat.join(" | "));
    await page.close();

    // ═══ N7. coba ulang 429: terbatas, tanpa loop ═══
    page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`, { prasiap: async (pg) => { await atur(pg); pg.aturan.push({ cocok: /atribusi\/iklan\/sumber\?/, status: 429 }); } });


    await tunggu(page, '[data-testid="galat-marketing"]', 40000);
    const n1 = jumlahMinta(page, /atribusi\/iklan\/sumber\?/);
    ok("N7 429 terus-menerus: tepat 4 percobaan lalu pesan galat jelas + tombol 'Coba lagi'", n1 === 4 && /sedang dihitung/i.test(await teks(page, '[data-testid="galat-marketing"]') || ""), `percobaan=${n1}`);
    await tidur(9000);
    ok("N7 tidak ada loop: tidak ada permintaan tambahan 9 detik kemudian", jumlahMinta(page, /atribusi\/iklan\/sumber\?/) === n1, `${jumlahMinta(page, /atribusi\/iklan\/sumber\?/)}`);
    ok("N7 laporan Meta/sekunder tidak ditembakkan saat laporan sumber gagal (tidak ada antrean menumpuk)", jumlahMinta(page, /atribusi\/iklan\?/) === 0);
    page.aturan.length = 0; page.aturan.push({ cocok: /atribusi\/iklan\/sumber\?/, status: 429, kali: 2 });
    await U.klikTeks(page, "button", "Coba lagi"); await tunggu(page, '[data-testid="kartu-ringkas"]', 60000);
    ok("N7 'Coba lagi' + 429 hanya 2× → berhasil pada percobaan ke-3 dan data tampil", (await kartuLead(page)) === S1.total.lead, `${await kartuLead(page)} vs ${S1.total.lead}`);
    ok("N7 galat 429 hilang setelah berhasil", !(await page.$('[data-testid="galat-marketing"]')));
    await page.close();

    // ═══ N8. drilldown Meta: respons lama (ad set) tertunda lalu Back → tidak menimpa tampilan campaign ═══
    page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}&sumber=META`, { prasiap: atur });
    await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(800);
    const barisCamp = (await page.$$('[data-testid^="baris-meta-"]')).length;
    page.aturan.push({ cocok: /atribusi\/iklan\?.*level=adset/, tunda: 6000 });
    await page.click('[data-testid^="baris-meta-"][data-status="MAPPED"]'); await U.tungguUrl(page, /level=adset/); await tidur(300);
    await page.goBack(); await tidur(300);
    await tidur(8000);
    ok("N8 Back saat ad set masih dimuat: tabel tetap level Campaign dengan baris sama setelah respons lama tiba", (await teks(page, '[data-testid="meta-detail"] h3') || "").startsWith("Per campaign") && (await page.$$('[data-testid^="baris-meta-"]')).length === barisCamp && !urlKini(page).searchParams.get("level"), `${await teks(page, '[data-testid="meta-detail"] h3')} ${(await page.$$('[data-testid^="baris-meta-"]')).length}/${barisCamp}`);
    ok("N8 tanpa galat halaman", page.galat.length === 0, page.galat.join(" | "));
    await page.close();
  } finally { await browser.close(); }
  U.selesai("hasil-navigasi.json"); process.exit(U.hasilRef().gagal ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
