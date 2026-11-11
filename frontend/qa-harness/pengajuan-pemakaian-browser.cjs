// QA browser NYATA (Chrome via puppeteer-core), ukuran HP — Pengajuan pemakaian bahan: operator (Aplikasi Meja V2 + Order Produksi V1), ADMIN (verifikasi massal), Finance (bukan penyetuju).
// Terhadap server + basis data TERISOLASI (pengajuan-pemakaian-server.mjs; bukan production).
//   BASE=http://127.0.0.1:5196 API=http://127.0.0.1:4041 OUT=C:/tmp/km-pp-qa node frontend/qa-harness/pengajuan-pemakaian-browser.cjs
const puppeteer = require("puppeteer-core");
const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://127.0.0.1:5196"; const API = process.env.API || "http://127.0.0.1:4041"; const OUT = process.env.OUT || "C:/tmp/km-pp-qa";
const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const T = JSON.parse(fs.readFileSync(path.join(OUT, "tokens.json"), "utf8")); const ID = JSON.parse(fs.readFileSync(path.join(OUT, "ids.json"), "utf8"));
const SHOTS = path.join(OUT, "shots"); fs.mkdirSync(SHOTS, { recursive: true });
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
let gagal = 0; const hasil = [];
const ok = (n, c, d = "") => { if (!c) gagal++; hasil.push({ n, ok: !!c, d: String(d).slice(0, 300) }); console.log(`${c ? "PASS" : "FAIL"}  ${n}${d ? " — " + String(d).slice(0, 240) : ""}`); };
const api = async (siapa, method, p, body) => { const r = await fetch(API + "/api" + p, { method, headers: { "Content-Type": "application/json", Authorization: `Bearer ${T[siapa].token}` }, body: body ? JSON.stringify(body) : undefined }); return { status: r.status, body: await r.json().catch(() => null) }; };
const galatSemua = [];
const HP = { lebar: 390, tinggi: 844, hp: true };

async function buka(browser, siapa, rute, { lebar = 390, tinggi = 844, hp = true } = HP) {
  const ctx = await browser.createBrowserContext(); const page = await ctx.newPage(); page.setDefaultTimeout(25000);
  await page.setViewport({ width: lebar, height: tinggi, isMobile: hp, hasTouch: hp, deviceScaleFactor: hp ? 2 : 1 });
  await page.evaluateOnNewDocument((token, user) => { try { localStorage.setItem("token", token); localStorage.setItem("user", JSON.stringify(user)); } catch (e) {} }, T[siapa].token, T[siapa].user);
  page.on("pageerror", (e) => galatSemua.push(`${siapa} ${rute}: ${String(e).slice(0, 200)}`));
  await page.goto(BASE + rute, { waitUntil: "domcontentloaded" });
  return page;
}
const foto = (page, nama) => page.screenshot({ path: path.join(SHOTS, nama + ".png"), fullPage: true });
const adaTeks = (page, t, ms = 20000) => page.waitForFunction((x) => document.body.textContent.includes(x), { timeout: ms }, t).then(() => true).catch(() => false);
const ada = (page, sel, ms = 20000) => page.waitForSelector(sel, { visible: true, timeout: ms }).then(() => true).catch(() => false);
const tanpaGulirMendatar = (page) => page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
async function klikTeks(page, sel, t) {
  await page.waitForFunction((s, x) => [...document.querySelectorAll(s)].some((e) => e.offsetParent !== null && e.textContent.includes(x)), { timeout: 20000 }, sel, t);
  const h = await page.evaluateHandle((s, x) => { const e = [...document.querySelectorAll(s)].filter((y) => y.offsetParent !== null && y.textContent.includes(x)).pop(); e.scrollIntoView({ block: "center" }); return e; }, sel, t);
  await h.asElement().click();
}
async function klik(page, sel) { await page.waitForSelector(sel, { visible: true }); const h = await page.$(sel); await h.evaluate((e) => e.scrollIntoView({ block: "center" })); await h.click(); }
async function ketik(page, sel, v) { await page.waitForSelector(sel, { visible: true }); await page.$eval(sel, (e) => { e.focus(); e.select?.(); }); await page.type(sel, String(v)); }
async function pilih(page, sel, v) { await page.waitForSelector(sel, { visible: true }); await page.select(sel, v); }

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox"] });
  try {
    // ── A. Operator (PIC Bahan) di Aplikasi Meja V2: racikan + bahan → pengajuan; pekerjaan tidak tertahan
    {
      const page = await buka(browser, "operator", "/produksi/bahan");
      await klikTeks(page, "button, a, [role=button], li, article", "NEW-QA-201");
      ok("A1 operator membuka pekerjaan NEW-QA-201 di HP", await ada(page, "[data-testid=open-material-record]"));
      await klik(page, "[data-testid=open-material-record]");
      await ketik(page, "input[aria-label='Racikan fondasi']", "Pocket spring 25 cm");
      await ketik(page, "input[aria-label='Racikan lapisan']", "Latex 3 cm + busa 2 cm");
      await pilih(page, "[data-testid=material-row-select]", ID.busa); await ketik(page, "[data-testid=material-row-qty]", "2");
      await foto(page, "A1-lembar-bahan-hp");
      ok("A1b lembar tanpa gulir mendatar", await tanpaGulirMendatar(page));
      await klik(page, "[data-testid=material-record-submit]");
      ok("A2 pesan: racikan tersimpan, pemakaian menunggu verifikasi ADMIN", await adaTeks(page, "menunggu verifikasi ADMIN"));
      ok("A3 daftar 'Sudah dilaporkan' tampil di bagian Bahan", await ada(page, "[data-testid=pemakaian-tertunda]"));
      ok("A3b kartu memuat ulang: racikan tampil tercatat", await page.waitForFunction(() => /Pocket spring 25 cm/.test(document.querySelector("[data-testid=build-racikan]")?.textContent || ""), { timeout: 20000 }).then(() => true).catch(() => false));
      await foto(page, "A3-tertunda-meja-hp");
      const db = await api("admin", "GET", `/production/pengajuan-pemakaian?runId=${ID.run201}`);
      ok("A4 server: satu pengajuan RUN_V2 DIAJUKAN, 1 baris BUSA 2", db.body?.pengajuan?.length === 1 && db.body.pengajuan[0].ringkasan.baris[0].qty === 2, JSON.stringify(db.body?.pengajuan?.map((p) => p.status)));
      const kartu = await api("lead", "GET", `/production-v2/runs/${ID.run201}/card`);
      ok("A5 PIC Meja tidak tertahan (racikan sudah tercatat → langkah EVIDENCE)", kartu.body?.next?.action === "EVIDENCE" && kartu.body?.build?.record?.materials?.length === 0, JSON.stringify(kartu.body?.next));
      // buka lagi: isian dibuka dari laporan tertunda
      await klik(page, "[data-testid=open-material-record]");
      ok("A6 lembar dibuka ulang memuat laporan tertunda", await ada(page, "[data-testid=material-tertunda-note]"));
      const qty = await page.$eval("[data-testid=material-row-qty]", (e) => e.value).catch(() => "");
      ok("A6b jumlah dari laporan tertunda (2)", qty === "2", qty);
      await page.browserContext().close();
    }
    // ── B. Operator di Order Produksi (unit V1): Catat bahan → "Laporkan pemakaian" → oranye menunggu verifikasi
    {
      const page = await buka(browser, "operator", `/bengkel/order-produksi?unit=${ID.u101}`);
      await tidur(2500);
      await klikTeks(page, "[role=tab], button", "Bahan").catch(() => {});
      ok("B1 daftar tertunda unit RES-QA-101 terlihat (pengajuan sebelumnya)", await ada(page, "[data-testid=pemakaian-tertunda]"));
      await klik(page, "[data-testid=tambah-pemakaian]");
      await ketik(page, "[data-testid=aktual-pemilih] input[type=search]", "LATEX");
      await page.waitForFunction(() => [...document.querySelectorAll("[data-testid=aktual-pemilih-baris]")].some((r) => r.textContent.includes("Latex QA")), { timeout: 20000 });
      await page.evaluate(() => { const r = [...document.querySelectorAll("[data-testid=aktual-pemilih-baris]")].find((x) => x.textContent.includes("Latex QA")); r.querySelector("button").click(); });
      await ketik(page, "[data-testid=aktual-qty]", "1");
      const tombol = await page.$eval("[data-testid=aktual-konfirmasi]", (e) => e.textContent);
      ok("B2 tombol untuk non-ADMIN = 'Laporkan pemakaian' (bukan 'kurangi stok')", /Laporkan pemakaian/.test(tombol), tombol);
      await foto(page, "B2-catat-bahan-operator-hp");
      await klik(page, "[data-testid=aktual-konfirmasi]");
      ok("B3 hasil oranye: dilaporkan, menunggu verifikasi ADMIN", await ada(page, "[data-testid=aktual-hasil-aju]"));
      await foto(page, "B3-hasil-aju-hp");
      ok("B3b tanpa gulir mendatar", await tanpaGulirMendatar(page));
      const st = await api("admin", "GET", `/production/pengajuan-pemakaian?unitId=${ID.u101}`);
      ok("B4 server: dua pengajuan menunggu untuk RES-QA-101", st.body?.pengajuan?.length === 2, st.body?.pengajuan?.length);
      await page.browserContext().close();
    }
    // ── C. Finance: tidak ada menu; halaman hanya-lihat; verifikasi ditolak server
    {
      const page = await buka(browser, "finance", "/bengkel/verifikasi-pemakaian");
      ok("C1 Finance: halaman hanya-lihat (bukan penyetuju)", await ada(page, "[data-testid=vp-bukan-admin]"));
      ok("C2 Finance: tidak ada kotak pilih", !(await page.$("[data-testid=vp-pilih]")));
      const r = await api("finance", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: ID.p1 }] });
      ok("C3 server menolak verifikasi Finance (403)", r.status === 403, r.status);
      await page.browserContext().close();
    }
    // ── H. PIC Meja (Nadya) di Aplikasi Meja: bukti tahap 6 dengan bahan → tertunda; UBAH langsung sebelum diverifikasi (tanpa ADMIN)
    {
      const page = await buka(browser, "nadya", "/produksi/meja");
      await klikTeks(page, "button, a, [role=button], li, article", "NEW-QA-202");
      ok("H1 daftar 'Sudah dilaporkan' tampil di detail pekerjaan", await ada(page, "[data-testid=pemakaian-tertunda]"));
      await klik(page, "[data-testid=tertunda-ubah]");
      await page.$eval("[data-testid=tertunda-ubah-qty]", (e) => { e.focus(); e.select(); }); await page.type("[data-testid=tertunda-ubah-qty]", "1.5");
      await ketik(page, "[data-testid=tertunda-ubah-alasan]", "Dihitung ulang di meja");
      await foto(page, "H1-ubah-sebelum-verifikasi-hp");
      await klik(page, "[data-testid=tertunda-ubah-kirim]");
      ok("H2 perubahan langsung tersimpan (tanpa verifikasi dulu)", await ada(page, "[data-testid=tertunda-info]"));
      const d = await api("admin", "GET", `/production/pengajuan-pemakaian?runId=${ID.run202}`);
      ok("H3 server: satu pengajuan bukti tertunda dengan jumlah baru 1,5", d.body?.pengajuan?.length === 1 && d.body.pengajuan[0].ringkasan.baris[0].qty === 1.5 && d.body.pengajuan[0].jalur === "BUKTI_V2", JSON.stringify(d.body?.pengajuan?.map((x) => [x.jalur, x.ringkasan?.baris?.[0]?.qty])));
      ok("H3b tanpa gulir mendatar", await tanpaGulirMendatar(page));
      await page.browserContext().close();
    }
    // ── D. ADMIN di HP: verifikasi massal; perbedaan keras tidak bisa disahkan dengan alasan; hasil per pengajuan
    {
      const page = await buka(browser, "admin", "/bengkel/verifikasi-pemakaian");
      ok("D1 ADMIN melihat antrean (5 pengajuan: 4 menunggu + 1 ditahan)", await page.waitForFunction(() => document.querySelectorAll("[data-testid=vp-kartu]").length === 5, { timeout: 20000 }).then(() => true).catch(() => false));
      ok("D2 kartu DITAHAN menampilkan alasan (catatan ganda)", await page.evaluate(() => [...document.querySelectorAll("[data-testid=vp-kartu][data-status=DITAHAN] [data-testid=vp-alasan-tahan]")].some((e) => /dua kali|berubah/.test(e.textContent))));
      await foto(page, "D2-antrean-admin-hp");
      ok("D2b tanpa gulir mendatar", await tanpaGulirMendatar(page));
      // rincian
      await page.evaluate(() => document.querySelector("[data-testid=vp-kartu] [data-testid=vp-rinci]").click());
      ok("D3 rincian & riwayat terbuka", await ada(page, "[data-testid=vp-rincian]"));
      await klik(page, "[data-testid=vp-pilih-semua]");
      await klik(page, "[data-testid=vp-verifikasi]");
      ok("D4 hasil per pengajuan tampil", await ada(page, "[data-testid=vp-hasil]"));
      const st = await page.$$eval("[data-testid=vp-hasil-baris]", (xs) => xs.map((x) => x.dataset.status).sort());
      ok("D5 4 disahkan, 1 tetap DITAHAN (tidak disahkan diam-diam)", JSON.stringify(st) === JSON.stringify(["DISETUJUI", "DISETUJUI", "DISETUJUI", "DISETUJUI", "DITAHAN"]), JSON.stringify(st));
      await foto(page, "D5-hasil-verifikasi-hp");
      // DITAHAN karena indikasi ganda (perbedaan keras): tidak ada kolom alasan untuk mengesahkan; ADMIN menolak
      await page.waitForFunction(() => document.querySelectorAll("[data-testid=vp-kartu]").length === 1, { timeout: 20000 });
      ok("D6 perbedaan keras: penjelasan tampil, tanpa kolom alasan pengesahan", (await ada(page, "[data-testid=vp-keras]")) && !(await page.$("[data-testid=vp-konfirmasi]")));
      await foto(page, "D6-keras-hp");
      await klik(page, "[data-testid=vp-pilih]"); await klik(page, "[data-testid=vp-tolak]");
      await ketik(page, "[data-testid=vp-alasan-tolak]", "Indikasi ganda, ajukan ulang bila memang dua lapis");
      await klik(page, "[data-testid=vp-kirim-tolak]");
      await ada(page, "[data-testid=vp-hasil]");
      const st2 = await page.$$eval("[data-testid=vp-hasil-baris]", (xs) => xs.map((x) => x.dataset.status));
      ok("D6b yang ditahan ditolak (stok tidak berubah)", JSON.stringify(st2) === JSON.stringify(["DITOLAK"]), JSON.stringify(st2));
      ok("D7 antrean kosong", await ada(page, "[data-testid=vp-kosong]"));
      await page.browserContext().close();
    }
    // ── I. Sesudah diverifikasi: Nadya mengubah pemakaian bukti; perubahan menunggu verifikasi ulang ADMIN; angka sah (1,5) tetap berlaku
    {
      const page = await buka(browser, "nadya", "/produksi/meja");
      await klikTeks(page, "button, a, [role=button], li, article", "NEW-QA-202");
      ok("I1 bagian 'sudah diverifikasi' tampil dengan tombol Ubah", await ada(page, "[data-testid=terverifikasi-ubah]"));
      await klik(page, "[data-testid=terverifikasi-ubah]");
      await page.$eval("[data-testid=tertunda-ubah-qty]", (e) => { e.focus(); e.select(); }); await page.type("[data-testid=tertunda-ubah-qty]", "2");
      await ketik(page, "[data-testid=tertunda-ubah-alasan]", "Tambahan rangka samping");
      await klik(page, "[data-testid=tertunda-ubah-kirim]");
      ok("I2 pesan: diajukan untuk verifikasi ulang, angka sah tetap berlaku", await adaTeks(page, "tetap berlaku"));
      await foto(page, "I2-ubah-sesudah-verifikasi-hp");
      const ov = await api("lead", "GET", `/production-v2/units/${ID.u202}/overview`);
      ok("I3 'terpakai' masih 1,5 sampai perubahan disahkan", (ov.body?.materials?.lines || []).find((m) => m.materialId === ID.busa)?.usedQty === 1.5, JSON.stringify(ov.body?.materials?.lines?.map((m) => [m.code, m.usedQty])));
      const q = await api("admin", "GET", `/production/pengajuan-pemakaian?runId=${ID.run202}`);
      const v = await api("admin2", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: q.body.pengajuan[0].id }] });
      const ov2 = await api("lead", "GET", `/production-v2/units/${ID.u202}/overview`);
      ok("I4 diverifikasi ulang → berlaku 2", v.body?.hasil?.[0]?.status === "DISETUJUI" && (ov2.body?.materials?.lines || []).find((m) => m.materialId === ID.busa)?.usedQty === 2, JSON.stringify(v.body?.hasil));
      await page.browserContext().close();
    }
    // ── E. Dampak server: pergerakan stok tepat sekali; V2 pemakaian tercatat atas nama PIC Bahan
    {
      const s101 = await api("admin", "GET", `/units/${ID.u101}/materials`);
      const mv = s101.body?.movements || [];
      ok("E1 RES-QA-101: 2 pergerakan (BUSA 2 + LATEX 1) atas nama Operator QA", mv.length === 2 && mv.every((m) => m.createdBy?.name === "Operator QA"), JSON.stringify(mv.map((m) => [m.material?.code, m.qty, m.createdBy?.name])));
      const kartu = await api("lead", "GET", `/production-v2/runs/${ID.run201}/card`);
      ok("E2 Aplikasi Meja: catatan bahan versi terbaru memuat BUSA 2", (kartu.body?.build?.record?.materials || []).some((m) => m.qty === 2), JSON.stringify(kartu.body?.build?.record));
      const ulang = await api("admin2", "POST", "/production/pengajuan-pemakaian/verifikasi", { item: [{ id: ID.p1 }] });
      const s101b = await api("admin", "GET", `/units/${ID.u101}/materials`);
      ok("E3 verifikasi ulang tidak menggandakan", ulang.body?.hasil?.[0]?.ulang === true && (s101b.body?.movements || []).length === 2, JSON.stringify(ulang.body?.hasil));
    }
    // ── F. Operator melihat daftar tertunda kosong sesudah verifikasi; desktop ADMIN juga rapi
    {
      const page = await buka(browser, "operator", `/bengkel/order-produksi?unit=${ID.u101}`);
      await tidur(3000); await klikTeks(page, "[role=tab], button", "Bahan").catch(() => {});
      await tidur(1500);
      ok("F1 sesudah verifikasi, tidak ada lagi pemakaian tertunda di unit", !(await page.$("[data-testid=pemakaian-tertunda]")));
      await foto(page, "F1-operator-sesudah-hp");
      await page.browserContext().close();
      const d = await buka(browser, "admin", "/bengkel/verifikasi-pemakaian", { lebar: 1280, tinggi: 900, hp: false });
      ok("F2 desktop ADMIN: menu 'Verifikasi Pemakaian' tampil", await adaTeks(d, "Verifikasi Pemakaian"));
      await foto(d, "F2-admin-desktop");
      await d.browserContext().close();
      const o = await buka(browser, "operator", "/bengkel/ringkasan", { lebar: 1280, tinggi: 900, hp: false });
      await tidur(2500);
      ok("F3 operator: tidak ada menu 'Verifikasi Pemakaian'", !(await o.evaluate(() => [...document.querySelectorAll("nav a, aside a")].some((a) => a.textContent.includes("Verifikasi Pemakaian")))));
      await o.browserContext().close();
    }
  } catch (e) { ok("TIDAK ADA GALAT SKRIP", false, e.stack || e.message); }
  finally { await browser.close(); }
  ok("tidak ada galat halaman (pageerror)", galatSemua.length === 0, galatSemua.join(" | "));
  fs.writeFileSync(path.join(OUT, "hasil.json"), JSON.stringify(hasil, null, 2));
  console.log(`\n${hasil.length - gagal}/${hasil.length} lulus`);
  process.exit(gagal ? 1 : 0);
})();
