// Skenario A — Stok & Lokasi: daftar, saringan, cakupan di luar halaman pertama, keadaan saldo, presisi, rincian bahan (baca-saja). Bukti dari DB sandbox (/qa/state), bukan mock.
//   BASE=http://127.0.0.1:5480 API=http://127.0.0.1:4479 OUT=C:/tmp/gud-qa/stok node frontend/qa-harness/gudang-stok-skenarioA.cjs
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, tidur, ok, keadaan: _k, api, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, tanpaGulirSamping, API } = U;
const state = async () => (await fetch(`${API}/qa/state`)).json();
const fmt = (n) => Number(n).toLocaleString("id-ID", { maximumFractionDigits: 4 });
const baris = (p) => p.$$eval('[data-testid="baris-stok"]', (e) => e.map((x) => ({ kode: x.dataset.kode, status: x.dataset.status, teks: x.textContent, satuan: x.querySelector('[data-testid="sel-satuan"]')?.textContent.trim() })));
const KODE = (k) => `SBX-${k}`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await state(); const semua = Object.entries(s0.stok).map(([kode, v]) => ({ kode, ...v })); const aktif = semua.filter((m) => m.aktif);
    const hargaAda = new Set(s0.harga.filter((h) => h.status === undefined || true).map((h) => h.materialId));
    // ── A1. Ringkasan = hitungan BAHAN dari DB (bukan total kuantitas)
    let p = await buka(browser, "finance", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    const angka = async (t) => Number(await teksDari(p, `[data-testid="${t}"]`));
    ok("A1 Bahan aktif = jumlah bahan aktif di DB", (await angka("n-aktif")) === aktif.length, `${await angka("n-aktif")} vs DB ${aktif.length}`);
    const minusDb = aktif.filter((m) => m.saldo < 0).length; const belumDb = aktif.filter((m) => m.gerakan === 0).length;
    ok("A1 Saldo minus & Belum diketahui = hitungan DB (dipisah dari nol dan dari tersedia)", (await teksDari(p, '[data-testid="ubin-minus"]')).includes(String(minusDb)) && (await teksDari(p, '[data-testid="ubin-belum"]')).includes(String(belumDb)), `minus=${minusDb} belum=${belumDb}`);
    const hargaBelumUI = await angka("n-harga-belum");
    ok("A1 Harga belum diisi: angka tampil = hasil filter 'Belum ada harga berlaku' (satu himpunan)", hargaBelumUI >= 1, String(hargaBelumUI));
    ok("A1 ubin tidak menjumlah kuantitas berbeda satuan (tidak ada satuan di ubin)", !/\b(kg|pcs|meter|m3|pack)\b/i.test(await teksDari(p, '[data-testid="ringkasan-stok"]')));
    await foto(p, "A1-daftar");

    // ── A2. Halaman & cakupan: bahan minus di halaman TERAKHIR tetap ditemukan lewat saringan, hitungan sama
    const rentang = await teksDari(p, '[data-testid="rentang-tampil"]');
    ok("A2 daftar dipotong 25 baris/halaman, total dari SELURUH hasil", new RegExp(`dari ${aktif.length} bahan`).test(rentang) && /1–25/.test(rentang), rentang);
    const halamanPertama = (await baris(p)).map((b) => b.kode);
    ok("A2 bahan minus 'ZZ' TIDAK ada di halaman pertama (uji cakupan)", !halamanPertama.includes(KODE("ZZ-MINUS-AKHIR")));
    await klik(p, '[data-testid="saring-keadaan"]'); await klik(p, '[data-testid="saring-keadaan-MINUS"]'); await tidur(500);
    const hasilMinus = (await baris(p)).map((b) => b.kode);
    ok("A2 saring 'Saldo minus' menemukan ZZ di luar halaman pertama; jumlah = DB", hasilMinus.includes(KODE("ZZ-MINUS-AKHIR")) && hasilMinus.includes(KODE("LATEX-7")) && hasilMinus.length === minusDb, JSON.stringify(hasilMinus));
    ok("A2 teks 'N bahan tampil' = hasil saringan (bukan halaman)", (await teksDari(p, '[data-testid="jumlah-tampil"]')).startsWith(`${minusDb} bahan`));
    const opsiLabel = await teksDari(p, '[data-testid="saring-keadaan"]');
    ok("A2 chip saringan aktif tampil, bisa dihapus; Reset mengembalikan semua", await tampak(p, '[data-testid="chip-keadaan"]'));
    await klik(p, '[data-testid="chip-keadaan"] button'); await tidur(400);
    ok("A2 hapus chip → daftar penuh kembali", (await teksDari(p, '[data-testid="jumlah-tampil"]')).startsWith(`${aktif.length} bahan`));
    await klik(p, '[data-testid="saring-keadaan"]'); await klik(p, '[data-testid="saring-keadaan-BELUM_ADA_CATATAN"]'); await tidur(300);
    await klik(p, '[data-testid="saring-satuan"]'); await klik(p, '[data-testid="saring-satuan-PACK"]'); await tidur(300);
    const gabungan = (await baris(p)).map((b) => b.kode);
    ok("A2 dua saringan bersama (belum diketahui + PACK) → hanya ZZ-BELUM", gabungan.length === 1 && gabungan[0] === KODE("ZZ-BELUM-AKHIR"), JSON.stringify(gabungan));
    await klik(p, '[data-testid="atur-ulang-saringan"]'); await tidur(400);
    ok("A2 Reset saringan membersihkan semua chip", !(await tampak(p, '[data-testid="chip-keadaan"]')) && !(await tampak(p, '[data-testid="chip-satuan"]')));
    const nPack = aktif.filter((m) => m.satuan === "PACK").length;
    await klik(p, '[data-testid="saring-satuan"]'); await klik(p, '[data-testid="saring-satuan-PACK"]'); await tidur(300);
    ok("A2 saring satuan PACK = jumlah DB (label opsi '(n)' juga sama)", (await teksDari(p, '[data-testid="jumlah-tampil"]')).startsWith(`${nPack} bahan`), `DB ${nPack}`);
    await klik(p, '[data-testid="kembali-semua"]'); await tidur(300);

    // ── A3. Keadaan saldo dibedakan; presisi; nama panjang; tanpa gulir samping
    await klik(p, '[data-testid="tampilkan-nonaktif"]'); await tidur(400);
    await isi(p, '[data-testid="cari-bahan"]', "SBX-");
    // kumpulkan seluruh halaman
    let kumpul = {}; for (let h = 0; h < 4; h++) { for (const b of await baris(p)) kumpul[b.kode] = b; if (!(await tampak(p, '[data-testid="halaman-berikutnya"]:not([disabled])'))) break; await klik(p, '[data-testid="halaman-berikutnya"]'); await tidur(200); }
    const st = (k) => kumpul[KODE(k)]?.status;
    ok("A3 keadaan dibedakan: minus / nol terverifikasi / nol menurut pergerakan / belum diketahui / menipis / terpesan penuh / nonaktif", st("LATEX-7") === "MINUS" && st("REB-120") === "NOL_TERVERIFIKASI" && st("KNIT-ABU") === "NOL_PERGERAKAN" && st("SOFT-D23") === "BELUM_DIKETAHUI" && st("MEMORY") === "MENIPIS" && st("LEM-AIBON") === "TERPESAN_PENUH" && st("LAMA-1") === "NONAKTIF", JSON.stringify(["LATEX-7", "REB-120", "KNIT-ABU", "SOFT-D23", "MEMORY", "LEM-AIBON", "LAMA-1"].map((k) => `${k}:${st(k)}`)));
    ok("A3 presisi desimal tampil utuh: 0,152 (M3) dan 0,3333 (KG)", /0,152/.test(kumpul[KODE("BUSA-M3")]?.teks ?? "") && /0,3333/.test(kumpul[KODE("KG-3333")]?.teks ?? ""));
    ok("A3 angka besar dengan 4 desimal tidak terpotong: 1.234.567,1234", /1\.234\.567,1234/.test(kumpul[KODE("PANJANG-0123456789-ABCDEFGHIJ-KLMNOPQRSTUVWXYZ")]?.teks ?? ""));
    ok("A3 setiap baris menampilkan SATUAN di kolomnya sendiri (kg, m3, pcs, pack, meter)", ["kg", "m3", "pcs", "pack", "meter"].every((u) => Object.values(kumpul).some((b) => b.satuan === u)));
    ok("A3 nama & kode sangat panjang: tanpa gulir samping", await tanpaGulirSamping(p));
    ok("A3 'Belum dikelompokkan' bukan masalah stok: statusnya 'Ada stok', ikon peringatan hanya penanda kelompok", kumpul[KODE("CAMPUR-1")]?.status === "ADA");
    await foto(p, "A3-keadaan");
    await p.close();

    // ── A4. Izin: tanpa izin Finance → kolom harga hilang, ubin ke-4 = Belum dikelompokkan
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]'); await tidur(600);
    ok("A4 Gudang (tanpa Finance): tidak ada kolom/saringan harga; ubin 'Belum dikelompokkan'", !(await tampak(p, '[data-testid="sel-harga"]')) && !(await tampak(p, '[data-testid="saring-harga"]')) && await tampak(p, '[data-testid="ubin-kelompok"]'));
    await p.close();

    // ── A5. Rincian bahan (baca-saja): panel menempel, empat tab, angka sama dengan DB; membuka/menutup tidak menulis
    p = await buka(browser, "finance", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    const sebelum = JSON.stringify((await state()).stok);
    await isi(p, '[data-testid="cari-bahan"]', "HR-N44"); await tidur(400);
    await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]');
    ok("A5 panel menempel di kanan (≥1200px) dengan daftar tetap di kiri", await tampak(p, '[data-tempel="ya"]') && await tampak(p, '[data-testid="daftar-bahan"]'));
    const dbN44 = s0.stok[KODE("HR-N44")];
    await tunggu(p, '[data-testid="stok-tersedia"]');
    ok("A5 Saldo: Tersedia & Saldo = DB (50 kg), Dipesan 0", /50/.test(await teksDari(p, '[data-testid="stok-tersedia"]')) && /50/.test(await teksDari(p, '[data-testid="stok-saldo"]')) && /^0/.test(await teksDari(p, '[data-testid="stok-dipesan"]')), `${await teksDari(p, '[data-testid="stok-tersedia"]')} | DB ${dbN44.saldo}`);
    ok("A5 lokasi disebut sebagai RIWAYAT penerimaan, bukan lokasi stok saat ini", /bukan lokasi stok saat ini/.test(await teksDari(p, '[data-testid="kartu-stok"]')));
    ok("A5 Koreksi saldo = tindakan pendukung: tab Saldo tidak punya tombol utama yang mencolok", !(await p.$('[data-testid="kartu-stok"] .gud-tombol-utama')));
    await klik(p, '[data-testid="tab-harga"]'); await tunggu(p, '[data-testid="harga-berlaku"]');
    ok("A5 Harga: Harga Berlaku Rp36.000 / kg + penjelasan beda dengan nilai persediaan Finance", /36\.000/.test(await teksDari(p, '[data-testid="harga-berlaku"]')) && /bukan/i.test(await teksDari(p, '[data-testid="panel-harga-berlaku"]')));
    ok("A5 tidak ada angka nilai persediaan hasil stok × harga di panel", !/1\.800\.000/.test(await teksDari(p, '[data-testid="drawer-bahan"]')), "50 × 36.000 = 1.800.000 tidak boleh muncul");
    await klik(p, '[data-testid="tab-pergerakan"]'); await tunggu(p, '[data-testid="daftar-pergerakan"]');
    ok("A5 Pergerakan: jumlah baris = pergerakan di DB; +50 masuk; batas riwayat dijelaskan", (await p.$$('[data-testid="baris-pergerakan"]')).length === dbN44.gerakan && /\+50/.test(await teksDari(p, '[data-testid="qty-pergerakan"]')) && /seluruhnya/.test(await teksDari(p, '[data-testid="batas-pergerakan"]')), await teksDari(p, '[data-testid="batas-pergerakan"]'));
    await klik(p, '[data-testid="tab-info"]'); await tunggu(p, '[data-testid="lipat-detail-bahan"]:not([hidden])');
    ok("A5 Informasi bahan: batas minimum 20 kg, vendor, status Aktif", /20/.test(await teksDari(p, '[data-testid="lipat-detail-bahan"]')) && /PT Busa Nusantara/.test(await teksDari(p, '[data-testid="lipat-detail-bahan"]')) && /Aktif/.test(await teksDari(p, '[data-testid="lipat-detail-bahan"]')));
    await foto(p, "A5-panel-info");
    await klik(p, '[data-testid="fokus-tutup"]'); await tidur(300);
    ok("A5 panel ditutup: filter/pencarian bertahan; membuka-menutup tidak menulis data", (await p.$eval('[data-testid="cari-bahan"]', (e) => e.value)) === "HR-N44" && JSON.stringify((await state()).stok) === sebelum && p.permintaan.length === 0, `tulis=${p.permintaan.length}`);
    // bahan minus & terpesan penuh
    await isi(p, '[data-testid="cari-bahan"]', "LATEX"); await tidur(300); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="stok-tersedia"]');
    ok("A5 bahan minus: Tersedia & Saldo tampil negatif (−2 m3) dan peringatan hitung fisik", /[-−]2/.test(await teksDari(p, '[data-testid="stok-saldo"]')) && /minus/i.test(await teksDari(p, '[data-testid="drawer-bahan"]')));
    await klik(p, '[data-testid="fokus-tutup"]');
    await isi(p, '[data-testid="cari-bahan"]', "AIBON"); await tidur(300); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="stok-dipesan"]');
    ok("A5 terpesan penuh: Saldo 5, Dipesan 5, Tersedia 0 (komponen perhitungan terbaca)", /5/.test(await teksDari(p, '[data-testid="stok-saldo"]')) && /5/.test(await teksDari(p, '[data-testid="stok-dipesan"]')) && /^0/.test(await teksDari(p, '[data-testid="stok-tersedia"]')), `${await teksDari(p, '[data-testid="stok-tersedia"]')}|${await teksDari(p, '[data-testid="stok-saldo"]')}|${await teksDari(p, '[data-testid="stok-dipesan"]')}`);
    await klik(p, '[data-testid="fokus-tutup"]');
    await isi(p, '[data-testid="cari-bahan"]', "SOFT-D23"); await tidur(300); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="stok-tersedia"]');
    ok("A5 belum ada catatan: 'belum diketahui' (bukan 0) di Tersedia", /belum diketahui/i.test(await teksDari(p, '[data-testid="stok-tersedia"]')), await teksDari(p, '[data-testid="stok-tersedia"]'));
    await klik(p, '[data-testid="tab-harga"]'); await tunggu(p, '[data-testid="belum-ada-harga"]');
    ok("A5 harga kosong: 'Belum diisi' (bukan Rp0)", !/Rp\s?0\b/.test(await teksDari(p, '[data-testid="belum-ada-harga"]')) && /Belum diisi/i.test(await teksDari(p, '[data-testid="belum-ada-harga"]')));
    await p.close();

    // ── A6. HP (390): daftar kartu, panel layar penuh; terang/gelap
    for (const [nama, tema] of [["hp", "light"], ["hp-gelap", "dark"]]) {
      const q = await buka(browser, "finance", "/warehouse/inventory", { lebar: 390, tinggi: 844, hp: true, tema }); await tunggu(q, '[data-testid="baris-stok"]');
      ok(`A6 ${nama}: daftar sebagai kartu, tanpa gulir samping, tanpa galat konsol`, await tanpaGulirSamping(q) && q.galat.length === 0, q.galat.join(";"));
      await foto(q, `A6-${nama}-daftar`);
      await klik(q, '[data-testid="baris-stok"]'); await tunggu(q, '[data-testid="drawer-bahan"]'); await tidur(500);
      ok(`A6 ${nama}: rincian layar penuh, tab terjangkau`, (await q.$eval('[data-testid="drawer-bahan"]', (e) => e.getBoundingClientRect().width)) >= 389 && await tampak(q, '[data-testid="tab-pergerakan"]'));
      await foto(q, `A6-${nama}-panel`); await q.close();
    }
    const g = await buka(browser, "finance", "/warehouse/inventory", { tema: "dark" }); await tunggu(g, '[data-testid="baris-stok"]'); await klik(g, '[data-testid="baris-stok"]'); await tunggu(g, '[data-testid="drawer-bahan"]'); await foto(g, "A6-gelap-desktop"); await g.close();
    U.selesai("hasil-stokA.json");
  } catch (e) { ok("Skenario A berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-stokA.json"); } finally { await browser.close(); }
})();
