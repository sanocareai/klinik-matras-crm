// Skenario C — Pengeluaran Material (V1) + Permintaan Bahan: struktur, daftar, saringan & cakupan, rincian (baca-saja). Bukti dari DB sandbox (/qa/state), bukan mock.
//   PUPPETEER=… BASE=http://127.0.0.1:5483 API=http://127.0.0.1:4481 OUT=C:/tmp/gud-qa/mi node frontend/qa-harness/gudang-mi-skenarioC.cjs
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, tidur, ok, api, buka, tampak, tunggu, klik, isi, teksDari, foto, tanpaGulirSamping, API } = U;
const state = async () => (await fetch(`${API}/qa/state`)).json();
const baris = (p) => p.$$eval('[data-testid="baris-dokumen"]', (e) => e.map((x) => ({ nomor: x.dataset.nomor, status: x.dataset.status, teks: x.textContent })));
const nomorSet = async (p) => (await baris(p)).map((b) => b.nomor);
const bukaFilter = async (p) => { if (!(await tampak(p, '[data-testid="panel-filter"]'))) { await klik(p, '[data-testid="buka-filter"]'); await tunggu(p, '[data-testid="panel-filter"]'); } };
const tutupFilter = async (p) => { if (await tampak(p, '[data-testid="panel-filter"]')) { await klik(p, '[data-testid="selesai-filter"]'); await tidur(150); } };
const saring = async (p, kunci, nilai) => { await bukaFilter(p); await klik(p, `[data-testid="saring-${kunci}"]`); await klik(p, `[data-testid="saring-${kunci}-${nilai}"]`); await tidur(300); await tutupFilter(p); };
const AKTIF = ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"];
const lokal = (v) => { const d = new Date(v); const q = (n) => String(n).padStart(2, "0"); return `${d.getFullYear()}-${q(d.getMonth() + 1)}-${q(d.getDate())}`; };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await state(); const docs = Object.entries(s0.dokumen).map(([id, d]) => ({ id, ...d })); const hit = (f) => docs.filter(f);
    // ── C1. Struktur & tab (hitungan dokumen = DB)
    let p = await buka(browser, "gudang", "/warehouse/material-issue"); await tunggu(p, '[data-testid="baris-dokumen"]');
    ok("C1 judul 'Pengeluaran material'; satu panel (pencarian + Filter + tab + daftar); Filter tertutup bawaan", (await teksDari(p, ".page-title")) === "Pengeluaran material" && !(await tampak(p, '[data-testid="panel-filter"]')) && await tampak(p, '[data-testid="cari-dokumen"]') && await tampak(p, '[data-testid="tab-dokumen"]'));
    const tabAngka = async (k) => Number((await teksDari(p, `[data-testid="tab-${k}"] .gud-tab-jumlah`)));
    ok("C1 hitungan tab = DB (Perlu tindakan / Sudah dikeluarkan / Dibatalkan / Semua)", (await tabAngka("tindakan")) === hit((d) => AKTIF.includes(d.status)).length && (await tabAngka("selesai")) === hit((d) => d.status === "ISSUED").length && (await tabAngka("batal")) === hit((d) => d.status === "CANCELLED").length && (await tabAngka("semua")) === s0.dokumenTotal, `${await tabAngka("tindakan")}/${await tabAngka("selesai")}/${await tabAngka("batal")}/${await tabAngka("semua")}`);
    const awal = await baris(p);
    ok("C1 daftar bawaan = hanya dokumen yang masih berjalan; jumlah baris = DB (tanpa pagination palsu)", awal.length === hit((d) => AKTIF.includes(d.status)).length && awal.every((b) => AKTIF.includes(b.status)), String(awal.length));
    ok("C1 kolom: Dokumen | Order / unit tujuan | Peminta | Tanggal | Tahap | Tindakan berikutnya", JSON.stringify(await p.$$eval(".gud-dok-kepala > span", (e) => e.map((x) => x.textContent.trim()))) === JSON.stringify(["Dokumen", "Order / unit tujuan", "Peminta", "Tanggal", "Tahap", "Tindakan berikutnya"]));
    ok("C1 'N dokumen sesuai filter' + tiga hitungan terpisah (baris bahan · unit produksi), tanpa total kuantitas lintas satuan", (await teksDari(p, '[data-testid="jumlah-tampil"]')).startsWith(`${awal.length} dokumen sesuai filter`) && /\d+ baris bahan · \d+ unit produksi/.test(await teksDari(p, '[data-testid="rincian-hitungan"]')) && !/\b(kg|pcs|meter|pack)\b/i.test(await teksDari(p, '[data-testid="rincian-hitungan"]')));
    const barisBahanDb = hit((d) => AKTIF.includes(d.status)).reduce((n, d) => n + d.baris.length, 0); const unitDb = new Set(hit((d) => AKTIF.includes(d.status) && d.unitId).map((d) => d.unitId)).size;
    ok("C1 hitungan baris bahan & unit produksi = DB", (await teksDari(p, '[data-testid="rincian-hitungan"]')).startsWith(`${barisBahanDb} baris bahan · ${unitDb} unit produksi`), `${barisBahanDb}/${unitDb}`);
    const a = awal.find((b) => b.status === "DRAFT");
    ok("C1 tiap baris: tahap + tindakan berikutnya dari server (Draf → Ajukan persetujuan; Menunggu → Setujui; Siap → Tandai sudah diambil; Diambil → Konfirmasi keluar)", await p.evaluate(() => { const t = (n, s) => { const r = document.querySelector(`[data-testid="baris-dokumen"][data-status="${s}"] [data-testid="tindakan-berikutnya"]`); return r?.textContent.trim(); }; return t(0, "DRAFT") === "Ajukan persetujuan" && t(0, "WAITING_APPROVAL") === "Setujui" && /Siap diambil|Tandai/.test(t(0, "APPROVED") + t(0, "READY_TO_PICK")) && t(0, "PICKED") === "Konfirmasi keluar"; }));
    await foto(p, "C1-daftar");

    // ── C2. Saringan & cakupan (kumpulan LENGKAP, termasuk dokumen paling tua di ujung daftar)
    await klik(p, '[data-testid="tab-semua"]'); await tidur(300);
    ok("C2 tab Semua: jumlah baris = seluruh dokumen di DB (64), dokumen tertua ada", (await baris(p)).length === s0.dokumenTotal && (await nomorSet(p)).includes(s0.dokumen[ID.D.tua.id].nomor));
    const nomorDb = (f) => hit(f).map((d) => d.nomor).sort();
    await saring(p, "status", "WAITING_APPROVAL"); ok("C2 status 'Menunggu persetujuan' = DB", JSON.stringify((await nomorSet(p)).sort()) === JSON.stringify(nomorDb((d) => d.status === "WAITING_APPROVAL")));
    await klik(p, '[data-testid="chip-status"] button'); await tidur(300);
    await saring(p, "sumber", "MANUAL"); ok("C2 sumber 'Input Manual' = DB", JSON.stringify((await nomorSet(p)).sort()) === JSON.stringify(nomorDb((d) => d.sumber === "MANUAL")));
    await klik(p, '[data-testid="chip-sumber"] button'); await tidur(300);
    await saring(p, "prioritas", "URGENT"); ok("C2 prioritas 'Mendesak' = DB", JSON.stringify((await nomorSet(p)).sort()) === JSON.stringify(nomorDb((d) => d.prioritas === "URGENT")));
    await klik(p, '[data-testid="chip-prioritas"] button'); await tidur(300);
    // kombinasi yang hanya cocok dengan dokumen paling tua: peminta Gudang Dua + bahan KAYU-G + unit D + status Draf
    const gudang2 = (await (async () => JSON.parse(require("fs").readFileSync(OUTPATH, "utf8")))()).gudang2.user.id;
    await saring(p, "peminta", gudang2); await saring(p, "bahan", ID.M.kayu); await saring(p, "unit", ID.U.d); await saring(p, "status", "DRAFT");
    const dbKombinasi = hit((d) => d.peminta === gudang2 && d.baris.some((b) => b.materialId === ID.M.kayu) && d.unitId === ID.U.d && d.status === "DRAFT").map((d) => d.nomor).sort();
    const uiKombinasi = (await nomorSet(p)).sort();
    ok("C2 empat saringan bersama (peminta + bahan + unit + status) menemukan dokumen di ujung daftar; hasil = DB", dbKombinasi.length >= 1 && JSON.stringify(uiKombinasi) === JSON.stringify(dbKombinasi) && uiKombinasi.includes(s0.dokumen[ID.D.tua.id].nomor), `${uiKombinasi.length} vs DB ${dbKombinasi.length}`);
    ok("C2 teks 'N dokumen sesuai filter' = hasil saringan; empat chip tampil", (await teksDari(p, '[data-testid="jumlah-tampil"]')).startsWith(`${dbKombinasi.length} dokumen`) && (await p.$$('[data-testid="chip-saringan"] .gud-chip')).length === 4);
    await klik(p, '[data-testid="atur-ulang-saringan"]'); await tidur(300);
    ok("C2 Reset saringan membersihkan chip dan mengembalikan seluruh dokumen (Semua)", !(await tampak(p, '[data-testid="chip-status"]')) && (await baris(p)).length === s0.dokumenTotal);
    // periode via URL (dasar tanggal jelas) + pencarian kata
    const dari = lokal(Date.now() - 6 * 86400000); const sampai = lokal(Date.now() - 2 * 86400000);
    await p.goto(`${process.env.BASE}/warehouse/material-issue?tab=semua&dasar=dibuat&dari=${dari}&sampai=${sampai}`, { waitUntil: "networkidle2" }); await tunggu(p, '[data-testid="baris-dokumen"]');
    const dbPeriode = hit((d) => { const t = lokal(d.dibuat); return t >= dari && t <= sampai; }).map((d) => d.nomor).sort();
    ok("C2 periode (dasar 'Tanggal diajukan', dari–sampai) = DB; chip menyebut dasarnya", JSON.stringify((await nomorSet(p)).sort()) === JSON.stringify(dbPeriode) && /Tanggal diajukan/.test(await teksDari(p, '[data-testid="chip-periode"]')), `${(await nomorSet(p)).length} vs ${dbPeriode.length}`);
    await p.goto(`${process.env.BASE}/warehouse/material-issue?tab=semua&dasar=dibutuhkan&dari=${lokal(Date.now())}`, { waitUntil: "networkidle2" }); await tidur(600);
    const dbButuh = hit((d) => d.dibutuhkan && String(d.dibutuhkan).slice(0, 10) >= lokal(Date.now())).map((d) => d.nomor).sort();
    ok("C2 periode berdasar 'Tanggal dibutuhkan': dokumen tanpa tanggal itu tidak ikut; = DB", JSON.stringify((await nomorSet(p)).sort()) === JSON.stringify(dbButuh), `${(await nomorSet(p)).length} vs ${dbButuh.length}`);
    await p.goto(`${process.env.BASE}/warehouse/material-issue?tab=semua`, { waitUntil: "networkidle2" }); await tunggu(p, '[data-testid="baris-dokumen"]');
    await isi(p, '[data-testid="cari-dokumen"]', "Pelanggan Empat KAYU"); await tidur(400);
    const dbCari = hit((d) => d.unitId === ID.U.d && d.baris.some((b) => b.materialId === ID.M.kayu)).map((d) => d.nomor).sort();
    ok("C2 pencarian kata (pelanggan + bahan) = DB; chip kata kunci tampil", JSON.stringify((await nomorSet(p)).sort()) === JSON.stringify(dbCari) && await tampak(p, '[data-testid="chip-q"]'), `${(await nomorSet(p)).length} vs ${dbCari.length}`);
    await isi(p, '[data-testid="cari-dokumen"]', "zzzz-tidak-ada"); await tidur(300);
    ok("C2 tidak ada hasil: keadaan kosong menyebut penyebab + tombol Reset (bukan angka nol palsu)", await tampak(p, '[data-testid="daftar-kosong"]') && /Tidak ada permintaan yang cocok/.test(await teksDari(p, '[data-testid="daftar-kosong"]')));
    await isi(p, '[data-testid="cari-dokumen"]', ""); await tidur(200);

    // ── C3. Ruang kerja: panel ±40%, konteks daftar tetap
    await isi(p, '[data-testid="cari-dokumen"]', "SBX-ORD-3"); await tidur(300);
    const noSiap = s0.dokumen[ID.D.siap.id].nomor;
    await p.click(`[data-testid="baris-dokumen"][data-nomor="${noSiap}"]`); await tunggu(p, '[data-testid="fokus-dokumen"]'); await tidur(600);
    const rasio = await p.evaluate(() => document.querySelector('[data-testid="fokus-dokumen"]').getBoundingClientRect().width / document.querySelector('[data-testid="ruang-material-issue"]').getBoundingClientRect().width);
    ok("C3 rincian menempel di kanan ±40% (33–45%), tanpa latar diredupkan, daftar tetap di kiri", rasio > 0.33 && rasio < 0.45 && !(await p.$('[role="dialog"]')) && await tampak(p, '[data-testid="daftar-dokumen"]'), rasio.toFixed(2));
    ok("C3 URL memuat id dokumen + saringan; header: nomor, sumber · unit, status, alur, empat tab", await p.evaluate((n) => /\/warehouse\/material-issue\/[0-9a-f-]{36}\?/.test(location.pathname + location.search) && document.querySelector('[data-testid="id-nomor"]').textContent === n && ["tab-minta", "tab-keluar", "tab-pakai", "tab-riwayat"].every((t) => document.querySelector(`[data-testid="${t}"]`)), noSiap));
    await klik(p, '[data-testid="fokus-tutup"]'); await tidur(500);
    ok("C3 panel ditutup: pencarian & saringan bertahan, daftar kembali ke lebar penuh", (await p.$eval('[data-testid="cari-dokumen"]', (e) => e.value)) === "SBX-ORD-3" && await p.evaluate(() => document.querySelector(".gud-stok-panel").getBoundingClientRect().width / document.querySelector('[data-testid="ruang-material-issue"]').getBoundingClientRect().width > 0.9));
    await isi(p, '[data-testid="cari-dokumen"]', ""); await tidur(200);
    // posisi gulir daftar bertahan saat rincian ditutup (ukuran: baris pertama yang terlihat — bukan angka scrollTop, karena browser menjangkar ulang saat lebar kolom berubah)
    const baris1 = () => p.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 100 && e.contains(document.querySelector('[data-testid="daftar-dokumen"]'))); if (!el) return null; el.scrollTop = 500; const t = el.getBoundingClientRect().top; const r = [...document.querySelectorAll('[data-testid="baris-dokumen"]')].find((x) => x.getBoundingClientRect().bottom > t + 5); return r ? { nomor: r.dataset.nomor, atas: Math.round(r.getBoundingClientRect().top - t) } : null; });
    const lihat1 = () => p.evaluate(() => { const el = [...document.querySelectorAll("*")].find((e) => /(auto|scroll)/.test(getComputedStyle(e).overflowY) && e.scrollHeight > e.clientHeight + 100 && e.contains(document.querySelector('[data-testid="daftar-dokumen"]'))); const t = el.getBoundingClientRect().top; const r = [...document.querySelectorAll('[data-testid="baris-dokumen"]')].find((x) => x.getBoundingClientRect().bottom > t + 5); return r ? { nomor: r.dataset.nomor, atas: Math.round(r.getBoundingClientRect().top - t) } : null; });
    const pos = await baris1(); await tidur(200);
    const noTengah = (await baris(p))[(await baris(p)).findIndex((b) => b.nomor === pos?.nomor) + 3]?.nomor;
    if (noTengah) { await p.evaluate((n) => document.querySelector(`[data-testid="baris-dokumen"][data-nomor="${n}"]`).click(), noTengah); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500); await p.evaluate(() => document.querySelector('[data-testid="fokus-tutup"]').click()); await tidur(600); }
    const pos2 = await lihat1();
    ok("C3 posisi gulir daftar bertahan setelah membuka-menutup rincian (baris yang sama tetap di tempatnya)", !!pos && !!pos2 && pos.nomor === pos2.nomor && Math.abs(pos.atas - pos2.atas) <= 40, JSON.stringify(pos) + " → " + JSON.stringify(pos2));
    ok("C3 membuka/menutup rincian tidak menulis data (tanpa permintaan tulis, stok & dokumen sama)", p.permintaan.length === 0 && JSON.stringify((await state()).stok) === JSON.stringify(s0.stok));

    // ── C4. Rincian: PERMINTAAN · PENGELUARAN · PEMAKAIAN dipisah
    const nomor = (k) => s0.dokumen[ID.D[k].id].nomor; const bukaDok = async (k) => { await p.goto(`${process.env.BASE}/warehouse/material-issue/${ID.D[k].id}`, { waitUntil: "networkidle2" }); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500); };
    await bukaDok("keluarSebagian");
    ok("C4 dokumen sudah dikeluarkan: tab Pengeluaran terbuka sendiri; Dikeluarkan 5 kg dari Diminta 10 kg; selisih & peringatan 'dikeluarkan sebagian' (tanpa pengeluaran susulan otomatis)", /5/.test(await teksDari(p, '[data-testid="dikeluarkan"]')) && /Kurang dikeluarkan 5/.test(await teksDari(p, '[data-testid="selisih-keluar"]')) && await tampak(p, '[data-testid="peringatan-sebagian"]'));
    ok("C4 tab Permintaan memuat identitas (sumber, unit, peminta, dibutuhkan, disetujui) tanpa angka pengeluaran; tab Pemakaian terpisah", await (async () => { await klik(p, '[data-testid="tab-minta"]'); return /Work Order Produksi/.test(await teksDari(p, '[data-testid="kartu-identitas"]')) && /Pelanggan Dua/.test(await teksDari(p, '[data-testid="id-unit"]')) && !(await tampak(p, '[data-testid="dikeluarkan"]')); })());
    await klik(p, '[data-testid="tab-pakai"]'); await tunggu(p, '[data-testid="pemakaian-unit"]');
    ok("C4 Pemakaian: pergerakan pada unit dipisah — dokumen ini / dokumen Gudang lain / dicatat langsung Produksi; satu pencatatan (tanpa ganda)", await tampak(p, '[data-testid="pemakaian-dokumen-ini"]') && await tampak(p, '[data-testid="pemakaian-dokumen-lain"]') && await tampak(p, '[data-testid="pemakaian-langsung"]') && (await p.$$('[data-testid="pemakaian-dokumen-ini"] [data-testid="baris-pemakaian"]')).length === 1);
    ok("C4 Pemakaian menyatakan batas: tidak ada langkah 'diterima Produksi'; bahan keluar otomatis tercatat pada unit", /Sistem belum punya langkah “diterima Produksi”/.test(await teksDari(p, '[data-testid="penjelasan-pemakaian"]')) && /tidak ada pencatatan kedua/.test(await teksDari(p, '[data-testid="penjelasan-pemakaian"]')));
    await bukaDok("keluar"); await klik(p, '[data-testid="tab-pakai"]'); await tunggu(p, '[data-testid="pemakaian-unit"]');
    ok("C4 unit A: ada pencatatan langsung Produksi untuk bahan yang sama (KAYU) → peringatan kemungkinan ganda, BUKAN pemblokiran", await tampak(p, '[data-testid="peringatan-ganda"]') && /KAYU-G/.test(await teksDari(p, '[data-testid="peringatan-ganda"]')) && (await p.$$('[data-testid="pemakaian-langsung"] [data-testid="baris-pemakaian"]')).length >= 1);
    await foto(p, "C4-pemakaian");
    await bukaDok("manual"); await klik(p, '[data-testid="tab-pakai"]');
    ok("C4 dokumen tanpa unit produksi: Pemakaian menyatakan tidak ada pemakaian unit", await tampak(p, '[data-testid="pemakaian-tanpa-unit"]'));
    await bukaDok("diambil2"); await klik(p, '[data-testid="tab-keluar"]');
    ok("C4 Sudah diambil: jumlah keluar per baris + satuan; Dicadangkan terisi, Dikeluarkan '—' (belum berkurang); kondisi stok per baris dari server", /—/.test(await teksDari(p, '[data-testid="dikeluarkan"]')) && /pcs/.test(await teksDari(p, '[data-testid="dicadangkan"]')) && await tampak(p, '[data-testid="ketersediaan-keluar"]'));
    ok("C4 stok kurang: kalimat ketersediaan menyebut saldo/dicadangkan/tersedia (perkiraan, bukan jaminan)", /Saldo total .* tersedia/.test(await teksDari(p, '[data-testid="ketersediaan-keluar"]')));
    await foto(p, "C4-pengeluaran");
    await bukaDok("belum"); ok("C4 bahan belum punya catatan stok: ketersediaan 'Saldo belum diketahui' atau nol dinyatakan jujur (bukan angka karangan)", /belum diketahui|Saldo total 0/.test(await teksDari(p, '[data-testid="ketersediaan"]')), await teksDari(p, '[data-testid="ketersediaan"]'));
    await p.close();

    // ── C5. Izin: peran hanya-lihat melihat tanpa aksi; Sales tak punya akses
    p = await buka(browser, "lihat", `/warehouse/material-issue/${ID.D.draf.id}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    ok("C5 peran hanya-lihat: dokumen terbuka, TANPA tombol aksi (pesan 'hanya dapat melihat')", await tampak(p, '[data-testid="tanpa-aksi"]') && /hanya dapat melihat/.test(await teksDari(p, '[data-testid="tanpa-aksi"]')) && !(await tampak(p, '[data-testid="aksi-dokumen"]')));
    const sales = await api("sales", "POST", "/api/inventory/material-issues", { sourceType: "MANUAL", lines: [{ materialId: ID.M.kayu, requestedQty: 1 }] });
    const lihat = await api("lihat", "PATCH", `/api/inventory/material-issues/${ID.D.draf.id}`, { status: "WAITING_APPROVAL", revisi: "x" });
    ok("C5 server menolak: SALES membuat permintaan 403; peran hanya-lihat mengubah 403", sales.status === 403 && lihat.status === 403, `${sales.status}/${lihat.status}`);
    await p.close();

    // ── C6. HP & gelap & lebar menengah
    for (const [nama, opsi] of [["hp", { lebar: 390, tinggi: 844, hp: true }], ["hp-gelap", { lebar: 390, tinggi: 844, hp: true, tema: "dark" }]]) {
      const q = await buka(browser, "gudang", "/warehouse/material-issue", opsi); await tunggu(q, '[data-testid="baris-dokumen"]');
      ok(`C6 ${nama}: daftar sebagai kartu, tanpa gulir samping, tanpa galat konsol`, await tanpaGulirSamping(q) && q.galat.length === 0 && (await q.$eval('[data-testid="baris-dokumen"]', (e) => getComputedStyle(e).gridTemplateAreas)).includes("nomor"), q.galat.join(";"));
      await foto(q, `C6-${nama}-daftar`); await q.click('[data-testid="baris-dokumen"]'); await tunggu(q, '[data-testid="status-dokumen"]'); await tidur(500);
      ok(`C6 ${nama}: rincian layar penuh; empat tab terjangkau; tombol aksi di dasar`, (await q.$eval('[data-testid="fokus-dokumen"]', (e) => e.getBoundingClientRect().width)) >= 389 && await tampak(q, '[data-testid="tab-riwayat"]') && await tampak(q, '[data-testid="kartu-aksi"]'));
      await foto(q, `C6-${nama}-rincian`); await q.close();
    }
    const g = await buka(browser, "gudang", `/warehouse/material-issue/${ID.D.diambil.id}`, { tema: "dark" }); await tunggu(g, '[data-testid="status-dokumen"]'); await tidur(500); await foto(g, "C6-gelap-rincian"); await g.close();
    const m = await buka(browser, "gudang", `/warehouse/material-issue/${ID.D.diambil.id}`, { lebar: 1000, tinggi: 800 }); await tunggu(m, '[data-testid="status-dokumen"]'); await tidur(500);
    ok("C6 lebar menengah (1000px): rincian = panel fokus (dialog) yang nyaman (≥ 640px)", await m.evaluate(() => { const d = document.querySelector('[role="dialog"]'); return !!d && d.getBoundingClientRect().width >= 640; })); await foto(m, "C6-menengah-rincian"); await m.close();
    U.selesai("hasil-miC.json");
  } catch (e) { ok("Skenario C berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-miC.json"); } finally { await browser.close(); }
})();
const OUTPATH = require("path").join(process.env.OUT, "tokens.json");
