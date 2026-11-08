// QA panel status sinkron di HALAMAN LAPORAN PENUH: dist hasil build + backend asli + DB uji. Keadaan berasal dari server dan baris meta_sync_runs nyata.
//   B0 (tanpa konfigurasi), B1 (flag OFF), B2 (flag ON) = origin serve-dist; DB = nama database uji; OUT = folder tokens dan foto.
const U = require("./qa-util.cjs"); const { execFileSync } = require("child_process");
const { ok, buka, tidur, teks, urlKini } = U;
const DB = process.env.DB, B0 = process.env.B0, B1 = process.env.B1, B2 = process.env.B2; if (!/test/.test(DB)) throw new Error("DB uji");
const sql = (q) => execFileSync("docker", ["exec", "km_sanss-postgres-1", "psql", "-U", "klinik", "-d", DB, "-qAtc", q], { encoding: "utf8" });
const P = "dari=2026-10-01&sampai=2026-10-10";
const run = (status, kode = "null", selisih = "null", lengkap = "null", mode = "commit") => { sql(`truncate meta_sync_runs, meta_account_daily_control`); sql(`insert into meta_sync_runs (id,account_id,transport,mode,status,failure_code,selisih_spend,complete_through,started_at,finished_at) values (gen_random_uuid(),'2081614415911241','COMPOSIO','${mode}','${status}',${kode},${selisih},${lengkap},now(),${status === "RUNNING" ? "null" : "now()"})`); };
async function panel(browser, base, siapa, keadaan, vp = {}) {
  const page = await bukaDi(browser, base, siapa, `/laporan?tab=Marketing&${P}&sumber=META`, vp);
  await U.tunggu(page, '[data-testid="aksi-meta"]', 90000);
  await page.evaluate(() => [...document.querySelectorAll('[data-testid="aksi-meta"] button')].find((b) => b.textContent.includes("Kesehatan")).click());
  await U.tunggu(page, '[data-testid="status-sinkron-meta"]', 60000); await tidur(400);
  const k = await page.$eval('[data-testid="status-sinkron-meta"]', (e) => e.dataset.keadaan);
  ok(`${vp.hp ? "HP" : "Desktop"} ${keadaan}: keadaan panel dari server`, k === keadaan, k);
  return page;
}
const bukaDi = async (browser, base, siapa, rute, vp) => { process.env.BASE = base; const ctxPage = await U.bukaBase(browser, base, siapa, rute, vp); return ctxPage; };
(async () => {
  const b = await U.mulai();
  try {
    let p = await panel(b, B0, "admin", "BELUM_DIKONFIGURASI");
    ok("Belum dikonfigurasi: nama env tampil", /COMPOSIO_API_KEY/.test(await teks(p, '[data-testid="status-sinkron-meta"]')));
    ok("Panel berada di halaman Laporan penuh: tab, periode, detail Meta", (await p.$$('[data-testid="meta-detail"]')).length === 1 && /1 Okt 2026/.test(await teks(p, '[data-testid="banner-periode"]') || ""));
    await U.foto(p, "L-desktop-belum-dikonfigurasi");
    // navigasi: Back ke ringkasan lalu Forward, periode tetap
    await p.reload({ waitUntil: "domcontentloaded" }); await U.tunggu(p, '[data-testid="aksi-meta"]', 90000);
    ok("Refresh: URL dan periode tetap", urlKini(p).searchParams.get("dari") === "2026-10-01");
    await p.click('[data-testid="kembali-ringkasan"]'); await U.tunggu(p, '[data-testid="ringkasan-marketing"]', 90000);
    ok("Kembali ke ringkasan: periode tetap", urlKini(p).searchParams.get("dari") === "2026-10-01" && !urlKini(p).searchParams.get("sumber"));
    await p.goBack(); await U.tunggu(p, '[data-testid="aksi-meta"]', 90000);
    ok("Back browser kembali ke detail Meta", urlKini(p).searchParams.get("sumber") === "META");
    await p.click('button[aria-label="Periode sebelumnya"]'); await tidur(1500);
    ok("Ganti periode dari halaman: URL berubah, detail tetap", urlKini(p).searchParams.get("dari") !== "2026-10-01" && urlKini(p).searchParams.get("sumber") === "META", urlKini(p).search.slice(0, 80));
    ok("Tanpa galat halaman", p.galat.length === 0, p.galat.join("|")); await p.close();

    p = await panel(b, B1, "admin", "NONAKTIF"); await p.close();
    const K = [["BERJALAN", () => run("RUNNING")], ["GAGAL", () => run("GAGAL", "'AKSES_COMPOSIO_DITOLAK'")], ["SELISIH_KONTROL", () => run("BELUM_DIREKONSILIASI", "null", "1000")], ["DATA_TERLAMBAT", () => run("SUKSES", "null", "0", "'2026-10-01'")], ["SUKSES", () => run("SUKSES", "null", "0", "(now() at time zone 'Asia/Jakarta')::date - 1")]];
    for (const [nama, siap] of K) { siap(); p = await panel(b, B2, "admin", nama); await U.foto(p, `L-desktop-${nama}`, false); ok(`${nama}: tanpa galat`, p.galat.length === 0, p.galat.join("|")); await p.close(); }
    p = await panel(b, B2, "admin", "SUKSES", { lebar: 390, tinggi: 844, hp: true });
    ok("HP 390: tanpa gulir mendatar halaman", await p.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1)); await U.foto(p, "L-hp-SUKSES"); await p.close();
    p = await U.bukaBase(b, B2, "sales", `/laporan?tab=Marketing&${P}&sumber=META`, {}); await tidur(6000);
    const t = await p.evaluate(() => ({ url: location.pathname, panel: !!document.querySelector('[data-testid="status-sinkron-meta"]'), meta: !!document.querySelector('[data-testid="meta-detail"]') }));
    ok("SALES: panel dan detail Meta tidak tampil", !t.panel && !t.meta, JSON.stringify(t));
    const st = await fetch(`${B2}/api/atribusi/iklan/sync-meta/status`, { headers: { Authorization: `Bearer ${U.T.sales.token}` } }); ok("SALES: API 403", st.status === 403, st.status); await p.close();
  } finally { await b.close(); }
  U.selesai("hasil-laporan-sinkron.json"); process.exit(U.hasilRef().gagal ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
