// QA browser Nilai Persediaan (Chrome via puppeteer-core): bundel produksi + backend ASLI + DB sandbox terisolasi.
//   DIST=C:/tmp/nilai-dist QA_API=http://127.0.0.1:4490 PORT=5491 node frontend/qa-harness/serve-dist.mjs
//   BASE=http://localhost:5491 API=http://127.0.0.1:4490 OUT=C:/tmp/nilai-qa node frontend/qa-harness/nilai-persediaan-browser.cjs
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, T, API, tidur, ok, buka, tampak, tunggu, klik, teksDari, foto, tanpaGulirSamping } = U;
const hitung = async () => (await fetch(`${API}/qa/hitung`)).json();
const api = async (siapa, rute) => { const r = await fetch(API + rute, { headers: { Authorization: `Bearer ${T[siapa].token}` } }); return { status: r.status, body: await r.json().catch(() => ({})) }; };
const barisTabel = (p) => p.$$eval('[data-testid="np-baris"]', (l) => l.map((e) => { const td = [...e.querySelectorAll("td")].map((x) => x.innerText.trim()); return { status: e.dataset.status, kode: e.dataset.kode, teks: e.innerText, saldo: td[1], harga: td[2], nilai: td[3] }; }));
const klikFilter = async (p, kode) => { await p.evaluate((k) => document.querySelector(`[data-testid="np-filter-${k}"]`).click(), kode); await tidur(250); };

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const sebelum = await hitung(); const ref = (await api("finance", "/api/inventory/nilai-persediaan")).body;
    // ── 1. Finance, desktop terang ──
    let p = await buka(browser, "finance", "/warehouse/nilai-persediaan", { lebar: 1440, tinggi: 1000 }); await tunggu(p, '[data-testid="np-k1"]');
    const k1 = await teksDari(p, '[data-testid="np-k1-nilai"]'), k2 = await teksDari(p, '[data-testid="np-k2-nilai"]'), k3 = await teksDari(p, '[data-testid="np-k3-jumlah"]');
    const rp = (v) => `Rp${Math.round(v).toLocaleString("id-ID")}`;
    ok("D1 kartu 1 = estimasi dari server (dihitung dari API)", k1 === rp(ref.kartu.estimasi.nilai), `${k1} vs ${rp(ref.kartu.estimasi.nilai)}`);
    ok("D2 kartu 2 = saldo akun Finance + chip 'Belum direkonsiliasi', terpisah dari kartu 1", k2 === rp(ref.kartu.finance.saldo) && k2 !== k1 && /Belum direkonsiliasi/.test(await teksDari(p, '[data-testid="np-k2"]')), `${k2}`);
    ok("D3 kartu 3 = jumlah pengecualian dari server", k3 === String(ref.kartu.belumDinilai.jumlah), k3);
    const waktu = await teksDari(p, '[data-testid="np-waktu"]'); ok("D4 waktu data & penjelasan satu waktu acuan tampil (WIB)", /Data per .* WIB/.test(waktu) && /waktu yang sama/.test(waktu), waktu.slice(0, 120));
    const cak = await teksDari(p, '[data-testid="np-cakupan"]'); ok("D5 cakupan jumlah bahan: 'x dari y bahan relevan dinilai' + total bahan", new RegExp(`${ref.cakupan.dinilai} dari ${ref.cakupan.relevan} bahan relevan dinilai`).test(cak) && new RegExp(`${ref.cakupan.universe} bahan dalam laporan`).test(cak), cak.slice(0, 160));
    let br = await barisTabel(p); ok("D6 saringan bawaan = SEMUA pengecualian dan hanya pengecualian", br.length === ref.kartu.belumDinilai.jumlah && br.every((b) => !["DINILAI", "SALDO_NOL"].includes(b.status)), `${br.length}`);
    ok("D7 stok belum diketahui (32 bahan: 30 + 2 benang) tampil 'belum diketahui' di kolom saldo, dan kolom Estimasi nilai pengecualian TIDAK pernah Rp0", br.filter((b) => b.status === "STOK_BELUM_DIKETAHUI").length === 32 && br.filter((b) => b.status === "STOK_BELUM_DIKETAHUI").every((b) => /belum diketahui/.test(b.saldo)) && br.every((b) => !/Rp0\b/.test(b.nilai) && /tidak dinilai/.test(b.nilai)), JSON.stringify(br.filter((b) => /Rp0\b/.test(b.nilai) || !/tidak dinilai/.test(b.nilai)).map((b) => b.kode)));
    const lava = br.find((b) => b.kode === "KAIN-LAVA-QA"), tab = br.find((b) => b.kode === "KAI-003-QA");
    ok("D8 Lava 13,5 roll & Tabeng 1 roll = Pengamatan fisik: saldo sistem apa adanya, estimasi 'tidak dinilai', tanpa konversi/nilai rekaan", lava?.status === "PENGAMATAN_FISIK" && /13,5 ROLL/.test(lava.teks) && /^0 METER/.test(lava.saldo) && tab?.status === "PENGAMATAN_FISIK" && /1 ROLL/.test(tab.teks) && /122 METER/.test(tab.saldo) && /tidak dinilai/.test(lava.nilai) && /tidak dinilai/.test(tab.nilai) && !/Rpd/.test(lava.nilai + tab.nilai), `${lava?.saldo} | ${lava?.nilai} || ${tab?.saldo} | ${tab?.nilai}`);
    ok("D9 saldo minus, harga kosong, satuan tidak cocok semuanya tampil sebagai pengecualian", ["SALDO_MINUS", "HARGA_KOSONG", "SATUAN_TIDAK_COCOK"].every((s) => br.some((b) => b.status === s)));
    ok("D10 bagian bukti Finance TERLIPAT secara bawaan", await p.$eval('[data-testid="np-bukti"]', (e) => !e.open));
    await foto(p, "d-terang-pengecualian");
    await klikFilter(p, "SEMUA"); br = await barisTabel(p); ok("D11 saringan SEMUA memuat yang dinilai (+ saldo nol) dan pengecualian", br.some((b) => b.status === "DINILAI") && br.some((b) => b.status === "SALDO_NOL") && br.length === Math.min(300, ref.cakupan.universe), `${br.length}`);
    const busa = br.find((b) => b.kode === "BUSA-ROLL-QA"); ok("D12 baris dinilai: saldo, harga/satuan, nilai = saldo × harga, status", busa && /320,2 KG/.test(busa.teks) && /Rp36\.000 \/ KG/.test(busa.teks) && new RegExp(rp(320.2 * 36000)).test(busa.teks) && /Dinilai/.test(busa.teks), busa?.teks.replace(/\n/g, " | "));
    const vel = br.find((b) => b.kode === "VEL-QA"); ok("D13 harga dari PO ditandai 'Dari PO … belum tentu diterima'", /Dari PO/.test(vel.teks) && /belum tentu diterima/.test(vel.teks));
    ok("D14 nol sah (habis) = Rp0 + 'Saldo nol'; bukan pengecualian", /Saldo nol/.test(br.find((b) => b.kode === "SUDUT-QA").teks) && /Rp0/.test(br.find((b) => b.kode === "SUDUT-QA").teks));
    await p.type('[data-testid="np-cari"]', "RODA"); await tidur(250); br = await barisTabel(p); ok("D15 pencarian kode/nama", br.length === 1 && br[0].kode === "RODA-QA");
    await p.$eval('[data-testid="np-cari"]', (e) => { e.value = ""; e.dispatchEvent(new Event("input", { bubbles: true })); });
    await p.evaluate(() => { document.querySelector('[data-testid="np-bukti"]').open = true; }); await tidur(300);
    const alasan = await teksDari(p, '[data-testid="np-alasan"]'); ok("D16 rincian Finance: penyebab belum direkonsiliasi (PSA belum diposting, tanpa bukti harga, tidak dialokasikan ke bahan)", /Persediaan Awal belum diposting/.test(alasan) && /tanpa bukti harga/.test(alasan) && /tidak dialokasikan ke bahan/i.test(alasan), alasan.slice(0, 200));
    const bukti = await teksDari(p, '[data-testid="np-bukti-tabel"]'); ok("D17 tabel bukti per bahan memuat qty tanpa bukti & biaya rata-rata; Harga Berlaku ditandai bukan bukti Finance", /Qty tanpa bukti/.test(bukti) && /Biaya rata-rata/.test(bukti) && /\*Harga Berlaku/.test(await teksDari(p, '[data-testid="np-bukti"]')));
    await foto(p, "d-terang-bukti-terbuka");
    ok("D18 tanpa galat skrip, tanpa permintaan tulis", p.galat.length === 0 && p.permintaan.length === 0, JSON.stringify({ galat: p.galat, tulis: p.permintaan }));
    await p.close();
    // ── 2. Finance, desktop gelap ──
    p = await buka(browser, "finance", "/warehouse/nilai-persediaan", { lebar: 1440, tinggi: 1000, tema: "dark" }); await tunggu(p, '[data-testid="np-k1"]'); await foto(p, "d-gelap");
    const kontras = await p.evaluate(() => { const luma = (c) => { const m = c.match(/\d+(\.\d+)?/g).map(Number); const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(m[0]) + 0.7152 * f(m[1]) + 0.0722 * f(m[2]); };
      const alas = (e) => { while (e) { const b = getComputedStyle(e).backgroundColor; if (b && !/rgba\(0, 0, 0, 0\)|transparent/.test(b)) return b; e = e.parentElement; } return "rgb(0,0,0)"; };
      const r = (el) => { const a = luma(getComputedStyle(el).color), b = luma(alas(el)); return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05); };
      return ["np-k1 .nip-besar", "np-k1 p", "np-tabel .nip-kode", "np-tabel .nip-nama"].map((s) => { const [t, c] = s.split(" "); const el = document.querySelector(`[data-testid="${t}"] ${c}`) ; return el ? Math.round(r(el) * 10) / 10 : null; }); });
    ok("D19 gelap: kontras teks utama & sekunder ≥ 4,5:1", kontras.every((v) => v === null || v >= 4.5), JSON.stringify(kontras)); await p.close();
    // ── 3. Gudang tanpa izin finance: tanpa nominal ──
    p = await buka(browser, "gudang", "/warehouse/nilai-persediaan", { lebar: 1440, tinggi: 1000 }); await tunggu(p, '[data-testid="np-k1"]');
    const isi = await p.evaluate(() => document.querySelector(".nip-kartu").parentElement.innerText); await klikFilter(p, "SEMUA"); const isi2 = await p.evaluate(() => document.querySelector(".nip-tabelbox").innerText);
    ok("G1 tanpa finance:read: kartu nominal '—' + penjelasan izin; tidak ada 'Rp' di kartu maupun tabel (kecuali nol sah Rp0)", await teksDari(p, '[data-testid="np-k1-nilai"]') === "—" && await teksDari(p, '[data-testid="np-k2-nilai"]') === "—" && await tampak(p, '[data-testid="np-tanpa-nominal"]') && !/Rp[1-9]/.test(isi + isi2), (isi.match(/Rp\S*/g) || []).join(","));
    ok("G2 jumlah bahan, status, dan cakupan tetap terlihat", /\d+ dari \d+ bahan relevan dinilai/.test(await teksDari(p, '[data-testid="np-cakupan"]')) && (await barisTabel(p)).some((b) => b.status === "DINILAI"));
    await foto(p, "g-tanpa-nominal"); ok("G3 tanpa galat", p.galat.length === 0 && p.permintaan.length === 0, JSON.stringify(p.galat)); await p.close();
    // ── 4. Peran tanpa izin inventory ──
    p = await buka(browser, "sales", "/warehouse/nilai-persediaan", { lebar: 1280, tinggi: 800 }); await tidur(1500);
    ok("S1 peran tanpa inventory:read tidak melihat angka (galat/ditolak, tanpa kartu nominal)", !(await tampak(p, '[data-testid="np-k1"]'))); await p.close();
    // ── 5. HP ──
    p = await buka(browser, "finance", "/warehouse/nilai-persediaan", { lebar: 390, tinggi: 844, hp: true }); await tunggu(p, '[data-testid="np-k1"]');
    ok("H1 HP 390px: tanpa gulir samping (kartu menumpuk)", await tanpaGulirSamping(p)); await foto(p, "h-atas");
    const kartuKolom = await p.evaluate(() => [...document.querySelectorAll(".nip-k")].map((e) => Math.round(e.getBoundingClientRect().width))); ok("H2 tiga kartu satu kolom penuh", kartuKolom.length === 3 && kartuKolom.every((w) => w >= 330 && w <= 390), JSON.stringify(kartuKolom));
    const tinggiBtn = await p.evaluate(() => [...document.querySelectorAll(".nip-filter button")].map((e) => Math.round(e.getBoundingClientRect().height))); ok("H3 tombol saringan mudah disentuh (≥ 28px)", tinggiBtn.every((h) => h >= 28), JSON.stringify(tinggiBtn));
    await klikFilter(p, "SEMUA"); const tampilanBaris = await p.evaluate(() => { const tr = document.querySelector('[data-testid="np-baris"]'); return { display: getComputedStyle(tr).display, thead: getComputedStyle(document.querySelector('[data-testid="np-tabel"] thead')).display }; });
    ok("H4 HP: tabel berubah jadi kartu per bahan (header disembunyikan, baris blok)", tampilanBaris.display === "block" && tampilanBaris.thead === "none", JSON.stringify(tampilanBaris)); ok("H5 HP setelah SEMUA: tetap tanpa gulir samping", await tanpaGulirSamping(p));
    await p.evaluate(() => document.querySelector('[data-testid="np-tabel"]').scrollIntoView()); await foto(p, "h-tabel");
    await p.evaluate(() => { document.querySelector('[data-testid="np-bukti"]').open = true; }); await tidur(300); ok("H6 HP: bagian bukti Finance terbuka tanpa gulir samping halaman", await tanpaGulirSamping(p)); await p.evaluate(() => document.querySelector('[data-testid="np-bukti"]').scrollIntoView()); await foto(p, "h-bukti");
    ok("H7 HP tanpa galat", p.galat.length === 0, JSON.stringify(p.galat)); await p.close();
    // ── 6. KPI lama & navigasi ──
    p = await buka(browser, "finance", "/warehouse/reports", { lebar: 1440, tinggi: 900 }); await tidur(1500); const lap = await p.evaluate(() => document.body.innerText);
    ok("K1 KPI lama dibedakan: label 'Nilai parsial (biaya penerimaan terakhir)', label lama 'Inventory Value (Partial)' sudah tidak ada, arahkan ke Nilai Persediaan", /Nilai parsial \(biaya penerimaan terakhir\)/.test(lap) && !/Inventory Value \(Partial\)/.test(lap) && /lihat Nilai Persediaan/.test(lap), lap.match(/Nilai parsial[^\n]*/)?.[0]);
    await foto(p, "k-laporan-lama"); const nav = await p.evaluate(() => [...document.querySelectorAll('a[href="/warehouse/nilai-persediaan"]')].length); ok("K2 menu 'Nilai Persediaan' ada di navigasi Gudang", nav >= 1, String(nav)); await p.close();
    // ── 7. baca-saja ──
    const sesudah = await hitung(); ok("R1 BACA-SAJA: stok/harga/jurnal/GR/penyesuaian/PSA/setelan di DB tidak berubah setelah seluruh QA", JSON.stringify(sebelum) === JSON.stringify(sesudah), JSON.stringify({ sebelum, sesudah }));
  } catch (e) { console.error("GAGAL SKRIP", e); U.ok("skrip tanpa pengecualian", false, e.message); } finally { await browser.close(); }
  U.selesai && U.selesai("nilai-persediaan-browser");
})();
