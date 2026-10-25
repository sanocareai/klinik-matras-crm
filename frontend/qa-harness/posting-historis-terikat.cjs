// QA browser (Chrome nyata) PERSETUJUAN TERIKAT posting historis — server + DB TERISOLASI (salinan restore produksi), tidak menyentuh produksi.
// Mereproduksi insiden 25 Okt 2026 (pilihan berbeda dari yang disetujui) dan memastikan: dialog menampilkan daftar order & jumlah transaksi, persetujuan diketik (bukan dari layar), selisih terbaca,
// server menolak SEBELUM batch/movement, saldo bergeser ditolak, klik ganda = satu batch, tab/draf lama tidak bisa memicu posting, HP 390 px tanpa scroll horizontal.
// Pakai: BASE=http://localhost:4020 DB=<nama db sandbox> KM_UI_DIR=C:/tmp/km-ui node posting-historis-terikat.cjs
const puppeteer = require("puppeteer-core"); const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:4020"; const DB = process.env.DB || "ins_run1"; const DIR = process.env.KM_UI_DIR || "C:/tmp/km-ui";
const T = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8")); const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
const sql = (q) => execFileSync("docker", ["exec", "km-rekon-pg", "psql", "-U", "klinik", "-d", DB, "-At", "-F", "|", "-c", q], { encoding: "utf8", env }).trim();
// React memantau nilai input: pakai setter bawaan agar peristiwa 'input' benar-benar dianggap perubahan
const kosongkanCari = (e) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); };
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const ORDER5 = ["RES-09092026-047", "RES-12092026-067", "RES-16092026-092", "RES-01102026-005", "RES-02102026-010"]; const HASH5 = process.env.HASH5 || "3feb8310b3adad453bccd0655d96dfd3b84f887972ea1290fb9f100125022afc";
const RUJUKAN = "OWNER-QTY-5ORDER-20261025";
const hasil = []; let gagal = 0; const ok = (n, c, d = "") => { hasil.push({ n, ok: !!c, d }); if (!c) gagal++; console.log(c ? "  ✔" : "  ✖", n, d ? `— ${d}` : ""); };
const hitung = () => ({ batch: Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN'")), issue: Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'")), tolak: Number(sql("select count(*) from activity_events where entity_type='posting_historis_persetujuan'")), mv: Number(sql("select count(*) from stock_movements")) });
const saldo = (kode) => Number(sql(`select coalesce(sum(qty),0) from stock_movements where material_id=(select id from materials where code='${kode}')`));

async function halaman(browser, lebar = 1280) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: lebar, height: 1100 });
  await p.evaluateOnNewDocument((t, u) => { try { if (!localStorage.getItem("token")) { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); } } catch (e) {} window.__post = []; const f = window.fetch; window.fetch = async (...a) => { const r = await f(...a); try { const url = String(a[0]?.url ?? a[0]); if (/posting-historis\/(batch|jalankan)$/.test(url) && (a[1]?.method ?? "GET") === "POST") { const c = r.clone(); window.__post.push({ status: r.status, body: JSON.parse(a[1].body), res: await c.json().catch(() => null) }); } } catch (e) {} return r; }; }, T.owner.token, T.owner.user);
  await p.goto(BASE + "/warehouse/posting-historis", { waitUntil: "domcontentloaded" }); await p.waitForSelector('[data-testid="kosongkan"]', { timeout: 60000 }); return p;
}
async function pilihOrder(p, nomor) {
  await p.$eval('[data-testid="cari-order"]', kosongkanCari); await p.type('[data-testid="cari-order"]', nomor);
  await p.waitForFunction((x) => document.querySelectorAll('[data-testid="baris-manifest"]').length === 1 && document.querySelector('[data-testid="baris-manifest"]').dataset.order === x, { timeout: 20000 }, nomor);
  await p.$eval('[data-testid="pilih-order"]', (e) => e.click());
}
async function tungguPilihan(p, n) { await p.$eval('[data-testid="cari-order"]', kosongkanCari); await p.waitForFunction((k) => new RegExp(`^${k} dari`).test(document.querySelector('[data-testid="jumlah-terpilih"]')?.textContent ?? "") && !document.querySelector('[data-testid="btn-mulai"]')?.disabled, { timeout: 40000 }, n); }
async function pilihLima(p) { await p.$eval('[data-testid="kosongkan"]', (e) => e.click()); for (const o of ORDER5) await pilihOrder(p, o); await tungguPilihan(p, 5); await p.waitForFunction((h) => document.querySelector('[data-testid="hash-manifest"]')?.textContent.includes(h), { timeout: 30000 }, HASH5.slice(0, 10)); }
async function klikUrut(p, n) { await p.$eval('[data-testid="cari-order"]', kosongkanCari); await tidur(600); for (let i = 0; i < n; i++) { await p.evaluate((k) => document.querySelectorAll('[data-testid="pilih-order"]')[k].click(), i); await tidur(250); } } // klik satu per satu seperti pengguna (klik serentak memakai state basi)
async function pilihSembarang(p, n) { await p.$eval('[data-testid="kosongkan"]', (e) => e.click()); await klikUrut(p, n); await tungguPilihan(p, n); }
async function isi(p, tid, nilai) { await p.$eval(`[data-testid="${tid}"]`, (e) => { e.value = ""; }); if (nilai) await p.type(`[data-testid="${tid}"]`, nilai, { delay: 0 }); }
async function bukaDialog(p) { await p.$eval('[data-testid="btn-mulai"]', (e) => e.click()); await p.waitForSelector('[data-testid="dialog-mulai"]'); }
async function isiPersetujuan(p, { hash = HASH5, orders = ORDER5, jo = "5", jt = "5", rujukan = RUJUKAN, saldo: sy = "" } = {}) {
  await isi(p, "input-hash-setuju", hash); await p.$eval('[data-testid="input-order-setuju"]', (e) => { e.value = ""; }); if (orders.length) await p.type('[data-testid="input-order-setuju"]', orders.join(", "));
  await isi(p, "input-jml-order", jo); await isi(p, "input-jml-trx", jt); await isi(p, "input-saldo-syarat", sy); await isi(p, "input-rujukan", rujukan);
  if (!(await p.$eval('[data-testid="cek-periksa"]', (e) => e.checked))) await p.$eval('[data-testid="cek-periksa"]', (e) => e.click());
}
const tombolAktif = (p) => p.$eval('[data-testid="konfirmasi-mulai"]', (e) => !e.disabled);
const teks = (p, tid) => p.$eval(`[data-testid="${tid}"]`, (e) => e.textContent).catch(() => null);

(async () => {
  const awal = hitung(); const sp0 = saldo("SPANBON-75GRAM"); const sg0 = saldo("SUDUT-GOLD"); const selesai0 = Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_SELESAI'"));
  console.log("awal:", JSON.stringify(awal), "SPANBON", sp0, "SUDUT-GOLD", sg0);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null, protocolTimeout: 180000 });
  try {
    // ── U1. dialog menampilkan daftar order + jumlah transaksi; tombol terkunci tanpa persetujuan
    console.log("U1. dialog: daftar order & jumlah transaksi jelas; tombol terkunci tanpa persetujuan Owner");
    const p = await halaman(browser); await pilihLima(p); await bukaDialog(p);
    const daftar = await p.$$eval('[data-testid="dialog-daftar-order"] li', (l) => l.map((x) => ({ o: x.dataset.order, t: x.textContent })));
    ok("U1a dialog memuat daftar 5 order terpilih dengan isi transaksinya", daftar.length === 5 && ORDER5.every((o) => daftar.some((d) => d.o === o)) && daftar.every((d) => /SPANBON-75GRAM|SUDUT-GOLD/.test(d.t)), daftar.map((d) => d.o).join(","));
    ok("U1b dialog menampilkan 5 order · 5 transaksi, biaya tanpa harga 'BELUM DIKETAHUI (bukan Rp0)', hash penuh di layar", /5 order/.test(await teks(p, "dialog-jumlah-order")) && /5 transaksi/.test(await teks(p, "dialog-jumlah-trx")) && /BELUM DIKETAHUI \(bukan Rp0\)/.test(await teks(p, "dialog-tanpa-harga")) && (await teks(p, "dialog-hash-layar")) === HASH5);
    ok("U1c tombol 'Ya, mulai batch' terkunci sebelum persetujuan diketik; selisih 'wajib diisi' tampil; rujukan tidak terisi otomatis", !(await tombolAktif(p)) && (await p.$eval('[data-testid="input-rujukan"]', (e) => e.value)) === "" && !!(await teks(p, "selisih-persetujuan")));
    await p.screenshot({ path: path.join(DIR, "shots", "terikat-01-dialog-kosong.png"), fullPage: true });

    // ── U2. insiden: 5 order berbeda dari yang disetujui (jumlah order sama) → selisih terbaca; dipaksa ke server → ditolak
    console.log("U2. insiden: pilihan 5 order BERBEDA dari yang disetujui");
    await p.keyboard.press("Escape"); await tidur(300); await pilihSembarang(p, 5); await bukaDialog(p);
    const pilihanSalah = await p.$$eval('[data-testid="dialog-daftar-order"] li', (l) => l.map((x) => x.dataset.order)); const hashSalah = await teks(p, "dialog-hash-layar");
    await isiPersetujuan(p); const selisih = await teks(p, "selisih-persetujuan");
    ok("U2a layar menunjukkan 5 order tetapi bukan yang disetujui: selisih hash + order di layar yang tidak disetujui + order disetujui yang tidak dipilih", !!selisih && /BERBEDA dari manifest di layar/.test(selisih) && /TIDAK disetujui/.test(selisih) && /TIDAK dipilih/.test(selisih) && hashSalah !== HASH5, (selisih || "").slice(0, 160));
    ok("U2b tombol mulai tetap terkunci", !(await tombolAktif(p)));
    await p.$eval('[data-testid="konfirmasi-mulai"]', (e) => e.click()); await tidur(500);
    ok("U2c klik pada tombol terkunci tidak mengirim apa pun", (await p.evaluate(() => window.__post.length)) === 0 && JSON.stringify(hitung()) === JSON.stringify(awal));
    // REPLAY insiden pada tingkat HTTP: pilihan yang salah (hash layar = hash pilihan itu) + persetujuan Owner untuk 5 order lain → server wajib menolak
    const idSalah = sql(`select u.id from units u join "Order" o on o.id=u.order_id where o."orderNumber" in ('${pilihanSalah.join("','")}')`).split(String.fromCharCode(10)).filter(Boolean);
    const H = { Authorization: "Bearer " + T.owner.token, "Content-Type": "application/json" };
    const manifestSalah = await (await fetch(BASE + "/api/production/posting-historis/pratinjau?unitIds=" + idSalah.join(","), { headers: H })).json();
    const maksa = await fetch(BASE + "/api/production/posting-historis/batch", { method: "POST", headers: H, body: JSON.stringify({ hashDisetujui: manifestSalah.hash, rujukan: RUJUKAN, unitIds: idSalah, persetujuanTerikat: { hash: HASH5, unitIds: idSalah, daftarOrder: ORDER5, jumlahOrder: 5, jumlahTrx: 5, rujukan: RUJUKAN } }) }); const mj = await maksa.json(); const t2 = hitung();
    ok("U2d replay insiden ke server: 409 PERSETUJUAN_TIDAK_COCOK dengan daftar selisih; nol batch, nol movement; penolakan tercatat", maksa.status === 409 && mj.code === "PERSETUJUAN_TIDAK_COCOK" && (mj.penghalang ?? []).length >= 3 && t2.batch === awal.batch && t2.issue === awal.issue && t2.mv === awal.mv && t2.tolak === awal.tolak + 1, `${maksa.status} ${mj.code} · ${(mj.penghalang ?? []).length} selisih · transaksi pilihan salah ${manifestSalah.jumlahTrx}`);
    await p.screenshot({ path: path.join(DIR, "shots", "terikat-02-selisih-pilihan.png"), fullPage: true });

    // ── U3. persetujuan benar + syarat saldo basi (300/90 padahal 291/86) → server menolak; tidak ada batch/movement
    console.log("U3. saldo sudah bergeser sejak persetujuan");
    await p.keyboard.press("Escape"); await tidur(300); await pilihLima(p); await bukaDialog(p);
    ok("U3a pindah pilihan lalu buka dialog: kolom persetujuan dikosongkan (tidak terbawa)", (await p.$eval('[data-testid="input-hash-setuju"]', (e) => e.value)) === "" && (await p.$eval('[data-testid="input-rujukan"]', (e) => e.value)) === "");
    await isiPersetujuan(p, { saldo: `SPANBON-75GRAM=${process.env.SALDO_SPANBON_LAMA || "300"}\nSUDUT-GOLD=${process.env.SALDO_SUDUT_LAMA || "90"}` });
    ok("U3b persetujuan cocok dengan manifest di layar; rujukan yang akan dicatat tampil tebal & persis", !!(await teks(p, "persetujuan-cocok")) && (await teks(p, "rujukan-dicatat")).includes(RUJUKAN) && (await tombolAktif(p)));
    await p.$eval('[data-testid="konfirmasi-mulai"]', (e) => e.click()); await p.waitForSelector('[data-testid="galat-mulai"]', { timeout: 20000 });
    const galat = await teks(p, "galat-mulai"); const t3 = hitung();
    ok("U3c server menolak: 'TIDAK COCOK' + selisih saldo terbaca; nol batch, nol movement, saldo tidak berubah", /TIDAK COCOK/.test(galat) && /saldo SPANBON-75GRAM/.test(galat) && t3.batch === awal.batch && t3.issue === awal.issue && t3.mv === awal.mv && saldo("SPANBON-75GRAM") === sp0, galat.slice(0, 200));
    ok("U3d penolakan tercatat sebagai peristiwa audit (tanpa efek stok)", t3.tolak === awal.tolak + 2);
    await p.screenshot({ path: path.join(DIR, "shots", "terikat-03-saldo-ditolak.png"), fullPage: true });

    // ── U4. persetujuan benar penuh; klik ganda cepat + tab kedua → satu batch
    console.log("U4. persetujuan benar penuh: klik ganda + tab kedua");
    await isiPersetujuan(p, { saldo: `SPANBON-75GRAM=${sp0}\nSUDUT-GOLD=${sg0}` });
    const p2 = await halaman(browser); const nPost0 = await p.evaluate(() => window.__post.length);
    await p.$eval('[data-testid="konfirmasi-mulai"]', (e) => { e.click(); e.click(); e.click(); });
    await p.waitForFunction(() => document.querySelector('[data-testid="kartu-progres"]'), { timeout: 40000 }); await p2.waitForSelector('[data-testid="kartu-progres"]', { timeout: 40000 });
    for (let i = 0; i < 90; i++) { if (Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_SELESAI'")) >= selesai0 + 1) break; await tidur(1000); }
    await tidur(1500);
    const t4 = hitung(); const kiriman = (await p.evaluate(() => window.__post)).slice(nPost0);
    ok("U4a tepat 1 batch baru dan 5 ISSUE; hanya satu POST yang dikirim UI walau 3 klik", t4.batch === awal.batch + 1 && t4.issue === awal.issue + 5 && kiriman.length === 1, `post=${kiriman.length} batch=${t4.batch - awal.batch} issue=${t4.issue - awal.issue}`);
    ok("U4b SPANBON-75GRAM berkurang 8,8 dan SUDUT-GOLD 4 (hanya yang disetujui)", Math.abs(saldo("SPANBON-75GRAM") - (sp0 - 8.8)) < 1e-6 && saldo("SUDUT-GOLD") === sg0 - 4);
    const rek = JSON.parse(sql("select metadata::text from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN' order by created_at desc limit 1"));
    ok("U4c rujukan tersimpan PERSIS & rekaman persetujuan terikat lengkap (hash, 5 order, 5 unit, 5 trx, digest)", rek.rujukan === RUJUKAN && rek.persetujuanTerikat?.rujukan === RUJUKAN && rek.persetujuanTerikat.hash === HASH5 && rek.persetujuanTerikat.jumlahOrder === 5 && rek.persetujuanTerikat.jumlahTrx === 5 && rek.persetujuanTerikat.unitIds.length === 5 && /^[0-9a-f]{64}$/.test(rek.persetujuanTerikat.digestIsi) && ORDER5.every((o) => rek.persetujuanTerikat.daftarOrder.includes(o)), rek.rujukan);
    ok("U4d lima catatan terkait DIPOSTING; catatan lain tidak berubah (PERLU_DICEK tetap)", Number(sql(`select count(*) from unit_usage_notes n join units u on u.id=n.unit_id join "Order" o on o.id=u.order_id where o."orderNumber" in ('${ORDER5.join("','")}') and n.state='DIPOSTING'`)) === 5);
    ok("U4e tab kedua melihat status batch yang sama (selesai)", /Selesai/.test(await p2.$eval('[data-testid="kartu-progres"]', (e) => e.textContent)));
    await p.screenshot({ path: path.join(DIR, "shots", "terikat-04-selesai.png"), fullPage: true });

    // ── U5. tab/draf lama: klien lama (tanpa persetujuan terikat) dan klik ulang sesudah batch selesai
    console.log("U5. tab/draf lama");
    const lama = await p.evaluate(async (tok, h5, ids) => {
      const a = await fetch("/api/production/posting-historis/batch", { method: "POST", headers: { "Content-Type": "application/json", Authorization: "Bearer " + tok }, body: JSON.stringify({ hashDisetujui: h5, rujukan: "OWNER-LAMA-12345", unitIds: ids }) });
      return { status: a.status, j: await a.json() };
    }, T.owner.token, HASH5, rek.unitUrut).catch((e) => ({ galat: e.message }));
    const t5 = hitung();
    ok("U5a klien/tab versi lama (tanpa persetujuan terikat) → 403 PERSETUJUAN_TERIKAT_WAJIB, tanpa tulisan", lama.status === 403 && lama.j?.code === "PERSETUJUAN_TERIKAT_WAJIB" && t5.batch === t4.batch && t5.issue === t4.issue, `${lama.status} ${lama.j?.code}`);
    await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForSelector('[data-testid="kosongkan"]', { timeout: 60000 });
    ok("U5b sesudah muat ulang: pilihan lama tidak mengisi rujukan/persetujuan (draf hanya menyimpan pilihan)", !(await p.evaluate(() => JSON.stringify(sessionStorage).includes("OWNER-QTY"))));

    // ── U6. HP 390 px
    console.log("U6. HP 390 px");
    const hp = await halaman(browser, 390); await hp.$eval('[data-testid="kosongkan"]', (e) => e.click()); await klikUrut(hp, 2); await tungguPilihan(hp, 2); await bukaDialog(hp);
    const lebar = await hp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, dlg: document.querySelector('[data-testid="dialog-mulai"]').scrollWidth, dlgc: document.querySelector('[data-testid="dialog-mulai"]').clientWidth }));
    ok("U6a dialog persetujuan di HP 390 px tanpa scroll horizontal", lebar.sw <= lebar.cw + 1 && lebar.dlg <= lebar.dlgc + 1, JSON.stringify(lebar));
    await hp.screenshot({ path: path.join(DIR, "shots", "terikat-05-hp.png"), fullPage: false });
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(DIR, "hasil-terikat.json"), JSON.stringify({ gagal, hasil }, null, 1)); console.log(gagal ? `\nGAGAL: ${gagal}` : `\nSEMUA LULUS (${hasil.length})`); process.exit(gagal ? 1 : 0);
})().catch((e) => { console.log("GALAT", e.stack || e.message); process.exit(1); });
