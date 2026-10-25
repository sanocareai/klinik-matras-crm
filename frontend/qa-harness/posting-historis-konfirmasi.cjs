// QA browser (Chrome nyata) KONFIRMASI MANIFEST posting historis — server + DB TERISOLASI (salinan restore production), tidak menyentuh production.
// Menguji alur OWNER (boleh memulai) dan FINANCE/ADMIN (hanya memantau/menghentikan), replay insiden 25 Okt 2026, saldo bergeser setelah ditinjau, klik ganda, dua tab, refresh, klien lama, dan HP 390 px.
// Batas kontrol yang diuji: ini KONFIRMASI MANIFEST oleh Owner yang menjalankan, bukan persetujuan Owner terpisah — UI menyatakannya.
// Pakai: BASE=http://localhost:4020 DB=<db sandbox> KM_UI_DIR=C:/tmp/km-ui node posting-historis-konfirmasi.cjs   (tokens.json: owner, finance, admin)
const puppeteer = require("puppeteer-core"); const { execFileSync } = require("child_process"); const fs = require("fs"); const path = require("path");
const BASE = process.env.BASE || "http://localhost:4020"; const DB = process.env.DB || "ins_run1"; const DIR = process.env.KM_UI_DIR || "C:/tmp/km-ui";
const T = JSON.parse(fs.readFileSync(path.join(DIR, "tokens.json"), "utf8")); const CHROME = process.env.CHROME || "C:/Program Files/Google/Chrome/Application/chrome.exe";
const env = { ...process.env, MSYS_NO_PATHCONV: "1" };
const sql = (q) => execFileSync("docker", ["exec", "km-rekon-pg", "psql", "-U", "klinik", "-d", DB, "-At", "-F", "|", "-c", q], { encoding: "utf8", env }).trim();
const tidur = (ms) => new Promise((r) => setTimeout(r, ms));
const kosongkanCari = (e) => { Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value").set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); }; // React memantau nilai input
const ORDER5 = ["RES-09092026-047", "RES-12092026-067", "RES-16092026-092", "RES-01102026-005", "RES-02102026-010"]; const HASH5 = process.env.HASH5 || "3feb8310b3adad453bccd0655d96dfd3b84f887972ea1290fb9f100125022afc";
const RUJUKAN = "OWNER-QTY-5ORDER-20261025"; const NL = String.fromCharCode(10);
const hasil = []; let gagal = 0; const ok = (n, c, d = "") => { hasil.push({ n, ok: !!c, d }); if (!c) gagal++; console.log(c ? "  ✔" : "  ✖", n, d ? `— ${d}` : ""); };
const hitung = () => ({ batch: Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN'")), issue: Number(sql("select count(*) from stock_movements where note like 'Impor pemakaian historis Sep%'")), tolak: Number(sql("select count(*) from activity_events where entity_type='posting_historis_konfirmasi'")), mv: Number(sql("select count(*) from stock_movements")), jurnal: Number(sql("select count(*) from fin_journal_entries")) });
const saldo = (kode) => Number(sql(`select coalesce(sum(qty),0) from stock_movements where material_id=(select id from materials where code='${kode}')`));
const sidik = (daftar) => sql(`select md5(string_agg(n.id::text||n.state, ',' order by n.id)) from unit_usage_notes n join units u on u.id=n.unit_id join "Order" o on o.id=u.order_id where o."orderNumber" ${daftar ? "" : "not "}in ('${ORDER5.join("','")}')`);
const gl = () => sql("select coalesce(sum(l.debit-l.credit),0) from fin_journal_lines l join fin_accounts a on a.id=l.account_id where a.code in ('1-1400','5-1100')");
const tolakTerakhir = () => JSON.parse(sql("select metadata::text from activity_events where entity_type='posting_historis_konfirmasi' order by created_at desc limit 1"));

async function halaman(browser, akun, lebar = 1280) {
  const ctx = await browser.createBrowserContext(); const p = await ctx.newPage(); await p.setViewport({ width: lebar, height: 1100 });
  await p.evaluateOnNewDocument((t, u) => { try { if (!localStorage.getItem("token")) { localStorage.setItem("token", t); localStorage.setItem("user", JSON.stringify(u)); } } catch (e) {} window.__post = []; const f = window.fetch; window.fetch = async (...a) => { const r = await f(...a); try { const url = String(a[0]?.url ?? a[0]); if (/posting-historis\/(batch|jalankan)$/.test(url) && (a[1]?.method ?? "GET") === "POST") { const c = r.clone(); window.__post.push({ status: r.status, body: JSON.parse(a[1].body), res: await c.json().catch(() => null) }); } } catch (e) {} return r; }; }, T[akun].token, T[akun].user);
  await p.goto(BASE + "/warehouse/posting-historis", { waitUntil: "domcontentloaded" }); await p.waitForSelector('[data-testid="muat-ulang"]', { timeout: 60000 }); return p;
}
async function pilihOrder(p, nomor) {
  await p.$eval('[data-testid="cari-order"]', kosongkanCari); await p.type('[data-testid="cari-order"]', nomor);
  await p.waitForFunction((x) => document.querySelectorAll('[data-testid="baris-manifest"]').length === 1 && document.querySelector('[data-testid="baris-manifest"]').dataset.order === x, { timeout: 30000 }, nomor);
  await p.$eval('[data-testid="pilih-order"]', (e) => e.click());
}
async function tungguPilihan(p, n) { await p.$eval('[data-testid="cari-order"]', kosongkanCari); await p.waitForFunction((k) => new RegExp(`^${k} dari`).test(document.querySelector('[data-testid="jumlah-terpilih"]')?.textContent ?? "") && !document.querySelector('[data-testid="btn-mulai"]')?.disabled, { timeout: 60000 }, n); }
async function pilihLima(p) { await p.waitForSelector('[data-testid="kosongkan"]', { timeout: 90000 }); await p.$eval('[data-testid="kosongkan"]', (e) => e.click()); for (const o of ORDER5) await pilihOrder(p, o); await tungguPilihan(p, 5); await p.waitForFunction((h) => document.querySelector('[data-testid="hash-manifest"]')?.textContent.includes(h), { timeout: 40000 }, HASH5.slice(0, 10)); }
async function klikUrut(p, n) { await p.$eval('[data-testid="cari-order"]', kosongkanCari); await tidur(700); for (let i = 0; i < n; i++) { await p.evaluate((k) => document.querySelectorAll('[data-testid="pilih-order"]')[k].click(), i); await tidur(300); } } // satu per satu seperti pengguna
async function pilihSembarang(p, n) { await p.waitForSelector('[data-testid="kosongkan"]', { timeout: 90000 }); await p.$eval('[data-testid="kosongkan"]', (e) => e.click()); await klikUrut(p, n); await tungguPilihan(p, n); }
async function isi(p, tid, nilai) { await p.$eval(`[data-testid="${tid}"]`, kosongkanCari); if (nilai) await p.type(`[data-testid="${tid}"]`, nilai, { delay: 0 }); }
async function bukaDialog(p) { await p.$eval('[data-testid="btn-mulai"]', (e) => e.click()); await p.waitForSelector('[data-testid="dialog-mulai"]'); }
async function isiKonfirmasi(p, { hash = HASH5, orders = ORDER5, jo = "5", jt = "5", rujukan = RUJUKAN, saldo: sy = "" } = {}) {
  await isi(p, "input-hash-konfirmasi", hash); await p.$eval('[data-testid="input-order-konfirmasi"]', (e) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); }); if (orders.length) await p.type('[data-testid="input-order-konfirmasi"]', orders.join(", "));
  await isi(p, "input-jml-order", jo); await isi(p, "input-jml-trx", jt); await p.$eval('[data-testid="input-saldo-syarat"]', (e) => { Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(e, ""); e.dispatchEvent(new Event("input", { bubbles: true })); }); if (sy) await p.type('[data-testid="input-saldo-syarat"]', sy); await isi(p, "input-rujukan", rujukan);
  if (!(await p.$eval('[data-testid="cek-periksa"]', (e) => e.checked))) await p.$eval('[data-testid="cek-periksa"]', (e) => e.click());
}
const tombolAktif = (p) => p.$eval('[data-testid="konfirmasi-mulai"]', (e) => !e.disabled);
const teks = (p, tid) => p.$eval(`[data-testid="${tid}"]`, (e) => e.textContent).catch(() => null);
const api = async (akun, metode, url, badan) => { const r = await fetch(BASE + "/api/production/posting-historis" + url, { method: metode, headers: { Authorization: "Bearer " + T[akun].token, "Content-Type": "application/json" }, ...(badan ? { body: JSON.stringify(badan) } : {}) }); return { status: r.status, j: await r.json().catch(() => null) }; };
const konfirmasiDari = (pr, rujukan = RUJUKAN, tambah = {}) => ({ hash: pr.hash, unitIds: pr.unitIds, daftarOrder: pr.order.map((o) => o.orderNumber), jumlahOrder: pr.jumlahOrder, jumlahTrx: pr.jumlahTrx, rujukan, isiTransaksi: pr.order.flatMap((o) => o.trx.map((t) => ({ unitId: o.unitId, orderNumber: o.orderNumber, kodeBahan: t.kodeBahan, qty: t.qty, satuan: t.satuan, tanggal: t.tanggal }))), saldoManifest: pr.bahan.map((b) => ({ kode: b.kode, saldo: b.saldoSekarang })), ...tambah });
const idUnit = (daftar) => sql(`select u.id from units u join "Order" o on o.id=u.order_id where o."orderNumber" in ('${daftar.join("','")}')`).split(NL).filter(Boolean);

(async () => {
  const awal = hitung(); const sp0 = saldo("SPANBON-75GRAM"); const sg0 = saldo("SUDUT-GOLD"); const sidik5 = sidik(true); const sidikLain = sidik(false); const gl0 = gl();
  console.log("awal:", JSON.stringify(awal), "SPANBON", sp0, "SUDUT-GOLD", sg0);
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: true, args: ["--no-sandbox", "--disable-gpu"], defaultViewport: null, protocolTimeout: 240000 });
  try {
    // ── U1. OWNER: isi dialog
    console.log("U1. Owner: dialog menampilkan daftar order, isi transaksi, saldo ditinjau, dan batas kontrol yang jujur");
    const p = await halaman(browser, "owner"); await pilihLima(p); await bukaDialog(p);
    const daftar = await p.$$eval('[data-testid="dialog-daftar-order"] li', (l) => l.map((x) => ({ o: x.dataset.order, t: x.textContent }))); const saldoDlg = await p.$$eval('[data-testid="dialog-saldo-bahan"] li', (l) => l.map((x) => x.textContent));
    ok("U1a dialog memuat 5 order dengan isi transaksi (bahan, jumlah, satuan, tanggal)", daftar.length === 5 && ORDER5.every((o) => daftar.some((d) => d.o === o)) && daftar.every((d) => /(SPANBON-75GRAM|SUDUT-GOLD) [\d.,]+ (METER|PCS) \(\d{4}-\d{2}-\d{2}\)/.test(d.t)), daftar[0]?.t.slice(0, 90));
    ok("U1b dialog memuat saldo bahan sebelum → sesudah (SPANBON, SUDUT-GOLD)", saldoDlg.length === 2 && saldoDlg.some((x) => /SPANBON-75GRAM/.test(x) && /→/.test(x)) && saldoDlg.some((x) => /SUDUT-GOLD/.test(x)), saldoDlg.join(" | "));
    ok("U1c dialog: 5 order · 5 transaksi, 'BELUM DIKETAHUI (bukan Rp0)', hash penuh", /5 order/.test(await teks(p, "dialog-jumlah-order")) && /5 transaksi/.test(await teks(p, "dialog-jumlah-trx")) && /BELUM DIKETAHUI \(bukan Rp0\)/.test(await teks(p, "dialog-tanpa-harga")) && (await teks(p, "dialog-hash-layar")) === HASH5);
    const batas = await teks(p, "batas-kontrol"); ok("U1d batas kontrol dinyatakan jujur di UI: konfirmasi oleh Owner yang menjalankan, BUKAN persetujuan terpisah; hanya Owner memulai", /bukan persetujuan Owner yang tercatat terpisah/.test(batas) && /hanya akun Owner/.test(batas), batas.slice(0, 120));
    ok("U1e tombol terkunci sebelum konfirmasi; rujukan & kolom konfirmasi tidak terisi otomatis", !(await tombolAktif(p)) && (await p.$eval('[data-testid="input-rujukan"]', (e) => e.value)) === "" && (await p.$eval('[data-testid="input-hash-konfirmasi"]', (e) => e.value)) === "");
    await p.screenshot({ path: path.join(DIR, "shots", "konf-01-dialog-owner.png"), fullPage: true });

    // ── U2. FINANCE & ADMIN: memantau saja; memulai ditolak UI dan server
    console.log("U2. Finance/Admin: tidak dapat memulai (UI + server), jejak penolakan dengan peran");
    const pf = await halaman(browser, "finance"); await pf.waitForSelector('[data-testid="info-baca-saja"]', { timeout: 60000 });
    const infoF = await teks(pf, "info-baca-saja"); const adaCheckbox = await pf.$$eval('[data-testid="pilih-order"]', (l) => l.length); const mulaiMati = await pf.$eval('[data-testid="btn-mulai"]', (e) => e.disabled).catch(() => true); const alasanF = await teks(pf, "alasan-mulai");
    ok("U2a halaman Finance: info 'hanya akun Owner', tanpa kotak pilih, tombol Mulai mati dengan alasan", /hanya akun Owner/.test(infoF) && adaCheckbox === 0 && mulaiMati && /Owner/.test(alasanF ?? "Owner"), `${(alasanF ?? "").slice(0, 80)} · checkbox=${adaCheckbox}`);
    const prLima = (await api("owner", "GET", "/pratinjau?unitIds=" + idUnit(ORDER5).join(","))).j; const badan = { hashDisetujui: prLima.hash, rujukan: RUJUKAN, unitIds: prLima.unitIds, konfirmasiManifest: konfirmasiDari(prLima) };
    ok("U2b manifest tetap dapat dibaca Finance (pratinjau 200)", (await api("finance", "GET", "/pratinjau")).status === 200);
    const bf = await api("finance", "POST", "/batch", badan); const jf = await api("finance", "POST", "/jalankan", badan); const ba = await api("admin", "POST", "/batch", badan); const t2 = hitung();
    ok("U2c Finance memulai (batch/jalankan) → 403 HANYA_OWNER_MEMULAI; Admin → 403; nol batch/movement/jurnal", bf.status === 403 && bf.j?.code === "HANYA_OWNER_MEMULAI" && jf.status === 403 && jf.j?.code === "HANYA_OWNER_MEMULAI" && ba.status === 403 && t2.batch === awal.batch && t2.issue === awal.issue && t2.mv === awal.mv && t2.jurnal === awal.jurnal, `${bf.status}/${jf.status}/${ba.status}`);
    const jej = tolakTerakhir(); ok("U2d jejak penolakan memuat pelaku, peran FINANCE, jenis BUKAN_OWNER, mode kontrol", t2.tolak === awal.tolak + 2 && jej.jenis === "BUKAN_OWNER" && jej.aktorRoles.includes("FINANCE") && !jej.aktorRoles.includes("OWNER") && jej.aktorNama === "Natasha" && jej.mode === "OWNER_MENINJAU_SENDIRI", JSON.stringify({ jenis: jej.jenis, roles: jej.aktorRoles, nama: jej.aktorNama }));
    await pf.screenshot({ path: path.join(DIR, "shots", "konf-02-finance-baca-saja.png"), fullPage: false });

    // ── U3. REPLAY INSIDEN (UI + server)
    console.log("U3. replay insiden: 5 order BERBEDA dari yang dikonfirmasi");
    await p.keyboard.press("Escape"); await tidur(400); await pilihSembarang(p, 5); await bukaDialog(p);
    const pilSalah = await p.$$eval('[data-testid="dialog-daftar-order"] li', (l) => l.map((x) => x.dataset.order)); const hashSalah = await teks(p, "dialog-hash-layar"); await isiKonfirmasi(p); const sel = await teks(p, "selisih-konfirmasi");
    ok("U3a layar menunjukkan selisih hash + order di layar yang tidak ada di daftar + order di daftar yang tidak dipilih; tombol terkunci; klik tidak mengirim apa pun", !!sel && /BERBEDA dari manifest di layar/.test(sel) && /TIDAK ada di daftar Anda/.test(sel) && /TIDAK dipilih di layar/.test(sel) && hashSalah !== HASH5 && !(await tombolAktif(p)), (sel || "").slice(0, 140));
    await p.$eval('[data-testid="konfirmasi-mulai"]', (e) => e.click()); await tidur(500); ok("U3b klik pada tombol terkunci tidak mengirim POST", (await p.evaluate(() => window.__post.length)) === 0);
    const idSalah = idUnit(pilSalah); const prSalah = (await api("owner", "GET", "/pratinjau?unitIds=" + idSalah.join(","))).j;
    const rep = await api("owner", "POST", "/batch", { hashDisetujui: prSalah.hash, rujukan: RUJUKAN, unitIds: idSalah, konfirmasiManifest: konfirmasiDari(prLima, RUJUKAN, { unitIds: idSalah }) }); const t3 = hitung(); const j3 = tolakTerakhir();
    ok("U3c replay ke server: 409 KONFIRMASI_MANIFEST_TIDAK_COCOK dengan ≥ 4 selisih (hash, order, isi transaksi); nol batch/movement/jurnal; jejak pelaku Owner", rep.status === 409 && rep.j?.code === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && (rep.j?.penghalang ?? []).length >= 4 && t3.batch === awal.batch && t3.issue === awal.issue && t3.mv === awal.mv && t3.jurnal === awal.jurnal && j3.jenis === "TIDAK_COCOK" && j3.aktorRoles.includes("OWNER"), `${rep.status} ${(rep.j?.penghalang ?? []).length} selisih; transaksi pilihan salah ${prSalah.jumlahTrx}`);
    await p.screenshot({ path: path.join(DIR, "shots", "konf-03-selisih-insiden.png"), fullPage: true });

    // ── U4. SALDO BERGESER setelah ditinjau (dialog sudah terisi benar)
    console.log("U4. saldo bergeser setelah manifest ditinjau");
    await p.keyboard.press("Escape"); await tidur(400); await pilihLima(p); await bukaDialog(p); await isiKonfirmasi(p);
    ok("U4a konfirmasi benar: panel hijau cocok, rujukan yang akan dicatat tampil persis, tombol aktif", !!(await teks(p, "konfirmasi-cocok")) && (await teks(p, "rujukan-dicatat")).includes(RUJUKAN) && (await tombolAktif(p)));
    sql("insert into stock_movements (id, material_id, type, qty, reason, note) select gen_random_uuid(), id, 'ADJUSTMENT', 1, 'uji-qa', 'QA: saldo bergeser setelah ditinjau' from materials where code='SPANBON-75GRAM'");
    await p.$eval('[data-testid="konfirmasi-mulai"]', (e) => e.click()); await p.waitForSelector('[data-testid="galat-mulai"]', { timeout: 30000 }); const g4 = await teks(p, "galat-mulai"); const t4 = hitung();
    ok("U4b server menolak: 'TIDAK COCOK' + 'saldo SPANBON-75GRAM berubah sejak ditinjau'; nol batch, nol ISSUE (hanya 1 pergerakan uji)", /TIDAK COCOK/.test(g4) && /saldo SPANBON-75GRAM berubah sejak ditinjau/.test(g4) && t4.batch === awal.batch && t4.issue === awal.issue && t4.mv === awal.mv + 1, g4.slice(0, 190));
    await p.screenshot({ path: path.join(DIR, "shots", "konf-04-saldo-bergeser.png"), fullPage: true });

    // ── U5. OWNER benar: refresh, klik ganda, dua tab
    console.log("U5. Owner: refresh → manifest ditinjau ulang → klik ganda + tab kedua");
    await p.reload({ waitUntil: "domcontentloaded" }); await p.waitForSelector('[data-testid="muat-ulang"]', { timeout: 60000 });
    ok("U5a sesudah refresh: tidak ada rujukan/konfirmasi tersisa di penyimpanan tab (draf hanya pilihan)", !(await p.evaluate(() => JSON.stringify(sessionStorage) + JSON.stringify(localStorage))).includes("OWNER-QTY"));
    await pilihLima(p); await bukaDialog(p); const spBaru = saldo("SPANBON-75GRAM"); await isiKonfirmasi(p, { saldo: `SPANBON-75GRAM=${spBaru}${NL}SUDUT-GOLD=${sg0}` });
    const p2 = await halaman(browser, "owner"); const nPost0 = await p.evaluate(() => window.__post.length); const selesai0 = Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_SELESAI'"));
    await p.$eval('[data-testid="konfirmasi-mulai"]', (e) => { e.click(); e.click(); e.click(); });
    for (let i = 0; i < 120; i++) { if (Number(sql("select count(*) from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_SELESAI'")) >= selesai0 + 1) break; await tidur(1000); } await tidur(1500);
    const t5 = hitung(); const kiriman = (await p.evaluate(() => window.__post)).slice(nPost0);
    ok("U5b 3 klik cepat = 1 POST, 1 batch baru, 5 ISSUE", kiriman.length === 1 && t5.batch === awal.batch + 1 && t5.issue === awal.issue + 5, `post=${kiriman.length} batch=${t5.batch - awal.batch} issue=${t5.issue - awal.issue}`);
    ok("U5c SPANBON −8,8 dan SUDUT-GOLD −4 (hanya yang dikonfirmasi); jurnal & GL tidak berubah akibat batch", Math.abs(saldo("SPANBON-75GRAM") - (spBaru - 8.8)) < 1e-6 && saldo("SUDUT-GOLD") === sg0 - 4 && t5.jurnal === awal.jurnal && gl() === gl0);
    const rek = JSON.parse(sql("select metadata::text from activity_events where entity_type='posting_historis_batch' and event_type='BATCH_DIAJUKAN' order by created_at desc limit 1")); const kk = rek.konfirmasiManifest;
    ok("U5d rujukan tersimpan PERSIS; rekaman konfirmasi lengkap: 5 unit, 5 order, 5 baris isi, saldo ditinjau 2 bahan, peran OWNER, mode, syarat saldo", rek.rujukan === RUJUKAN && kk.rujukan === RUJUKAN && kk.hash === HASH5 && kk.unitIds.length === 5 && kk.daftarOrder.length === 5 && kk.isiTransaksi.length === 5 && kk.saldoManifest.length === 2 && kk.aktorRoles.includes("OWNER") && kk.mode === "OWNER_MENINJAU_SENDIRI" && kk.saldoSyarat.length === 2, JSON.stringify(kk.saldoManifest));
    ok("U5e lima catatan DIPOSTING; 15 catatan tertahan dan semua catatan lain tidak berubah (sidik)", Number(sql(`select count(*) from unit_usage_notes n join units u on u.id=n.unit_id join "Order" o on o.id=u.order_id where o."orderNumber" in ('${ORDER5.join("','")}') and n.state='DIPOSTING'`)) === 5 && sidikLain === sidik(false) && Number(sql(`select count(*) from unit_usage_notes n join units u on u.id=n.unit_id join "Order" o on o.id=u.order_id where o."orderNumber" in ('${ORDER5.join("','")}') and n.state='PERLU_DICEK'`)) === 15);
    ok("U5f valuasi 5 transaksi baru TANPA_HARGA (biaya belum diketahui, bukan Rp0)", Number(sql(`select count(*) from fin_stock_movement_valuations v join stock_movements s on s.id=v.movement_id join units u on u.id=s.unit_id join "Order" o on o.id=u.order_id where o."orderNumber" in ('${ORDER5.join("','")}') and v.status='TANPA_HARGA'`)) === 5);
    await p2.reload({ waitUntil: "domcontentloaded" }); await p2.waitForSelector('[data-testid="kartu-progres"]', { timeout: 60000 }); ok("U5g tab kedua + refresh melihat batch yang sama (Selesai)", /Selesai/.test(await p2.$eval('[data-testid="kartu-progres"]', (e) => e.textContent)));
    await p.screenshot({ path: path.join(DIR, "shots", "konf-05-selesai.png"), fullPage: true });

    // ── U6. PERCOBAAN ULANG sesudah batch ada: sama = nol tulisan; dampak berbeda = ditolak
    console.log("U6. percobaan ulang (klik ulang/tab lama) setelah batch ada");
    const kon = rek.konfirmasiManifest; const badanUlang = { hashDisetujui: HASH5, rujukan: RUJUKAN, unitIds: kon.unitIds, konfirmasiManifest: { hash: kon.hash, unitIds: kon.unitIds, daftarOrder: kon.daftarOrder, jumlahOrder: 5, jumlahTrx: 5, rujukan: RUJUKAN, isiTransaksi: kon.isiTransaksi, saldoManifest: kon.saldoManifest } };
    const t6a = hitung(); const sama = await api("owner", "POST", "/batch", badanUlang); const t6b = hitung();
    ok("U6a ulang dengan konfirmasi SAMA → 202 baru=false; nol tulisan", sama.status === 202 && sama.j?.baru === false && t6b.mv === t6a.mv && t6b.batch === t6a.batch);
    const beda = await api("owner", "POST", "/batch", { ...badanUlang, konfirmasiManifest: { ...badanUlang.konfirmasiManifest, saldoManifest: kon.saldoManifest.map((s) => ({ ...s, saldo: s.saldo + 3 })) } }); const t6c = hitung(); const j6 = tolakTerakhir();
    ok("U6b ulang dengan DAMPAK BERBEDA (saldo ditinjau lain) → 409; nol tulisan; jejak ULANG_DAMPAK_BERBEDA", beda.status === 409 && beda.j?.code === "KONFIRMASI_MANIFEST_TIDAK_COCOK" && t6c.mv === t6a.mv && t6c.batch === t6a.batch && j6.jenis === "ULANG_DAMPAK_BERBEDA", `${beda.status} ${(beda.j?.penghalang ?? [])[0] ?? ""}`);
    const lama = await api("owner", "POST", "/batch", { hashDisetujui: HASH5, rujukan: RUJUKAN, unitIds: kon.unitIds });
    ok("U6c klien/tab lama (tanpa konfirmasi) → 403 KONFIRMASI_MANIFEST_WAJIB; dicatat", lama.status === 403 && lama.j?.code === "KONFIRMASI_MANIFEST_WAJIB" && tolakTerakhir().jenis === "TANPA_KONFIRMASI");
    const hentikanF = await api("finance", "POST", `/batch/${HASH5 === kon.hash ? rek.hash : rek.hash}/hentikan`, {}); const hentikanA = await api("admin", "POST", `/batch/${rek.hash}/hentikan`, {});
    ok("U6d Finance boleh menghentikan/memantau batch yang ada (200); Admin tidak (403)", hentikanF.status === 200 && hentikanA.status === 403, `${hentikanF.status}/${hentikanA.status}`);

    // ── U7. HP 390 px
    console.log("U7. HP 390 px (dialog Owner)");
    const hp = await halaman(browser, "owner", 390); await hp.waitForSelector('[data-testid="kosongkan"]', { timeout: 90000 }); await hp.$eval('[data-testid="kosongkan"]', (e) => e.click()); await klikUrut(hp, 2); await tungguPilihan(hp, 2); await bukaDialog(hp);
    const lebar = await hp.evaluate(() => ({ sw: document.documentElement.scrollWidth, cw: document.documentElement.clientWidth, dlg: document.querySelector('[data-testid="dialog-mulai"]').scrollWidth, dlgc: document.querySelector('[data-testid="dialog-mulai"]').clientWidth }));
    ok("U7a dialog konfirmasi di HP 390 px tanpa scroll horizontal", lebar.sw <= lebar.cw + 1 && lebar.dlg <= lebar.dlgc + 1, JSON.stringify(lebar)); await hp.screenshot({ path: path.join(DIR, "shots", "konf-06-hp.png"), fullPage: false });
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(DIR, "hasil-konfirmasi.json"), JSON.stringify({ gagal, hasil }, null, 1)); console.log(gagal ? `\nGAGAL: ${gagal}` : `\nSEMUA LULUS (${hasil.length})`); process.exit(gagal ? 1 : 0);
})().catch((e) => { console.log("GALAT", e.stack || e.message); process.exit(1); });
