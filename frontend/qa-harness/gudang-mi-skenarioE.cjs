// Skenario E — Permintaan Bahan Produksi (V2/P4): daftar, saringan, rincian, Serahkan bahan / Batalkan, stok kurang, klik ganda, hubungan dengan pencatatan langsung Produksi. Backend + DB sandbox ASLI;
// permintaan dibangun lewat /qa/seed-v2 (HTTP ke backend asli, mengikuti tes integrasi P4). Jalankan SETELAH skenario C dan D (memakai server yang sama).
//   PUPPETEER=… BASE=http://127.0.0.1:5483 API=http://127.0.0.1:4481 OUT=C:/tmp/gud-qa/mi node frontend/qa-harness/gudang-mi-skenarioE.cjs
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, T, tidur, ok, api, buka, tampak, tunggu, klik, isi, teksDari, foto, tanpaGulirSamping, API } = U;
const state = async () => (await fetch(`${API}/qa/state`)).json();
const dobelKlik = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); e.click(); e.click(); }, sel);
const seed = async (tag, specs, extra = {}) => { const r = await fetch(`${API}/qa/seed-v2`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ tag, specs, ...extra }) }); const j = await r.json(); if (!r.ok) throw new Error(`seed ${tag}: ${JSON.stringify(j)}`); return j; };
const adj = (materialId, qty) => fetch(`${API}/qa/gerak-adj`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ materialId, qty }) });
const gerakDok = (s, id) => s.gerak.filter((m) => m.materialIssueId === id).map((m) => ({ ...m, qty: Number(m.qty) }));
const baris = (p) => p.$$eval('[data-testid="baris-permintaan"]', (e) => e.map((x) => ({ nomor: x.dataset.nomor, status: x.dataset.status })));
const bukaFilter = async (p) => { if (!(await tampak(p, '[data-testid="panel-filter"]'))) { await klik(p, '[data-testid="buka-filter"]'); await tunggu(p, '[data-testid="panel-filter"]'); } };
const tutupFilter = async (p) => { if (await tampak(p, '[data-testid="panel-filter"]')) { await klik(p, '[data-testid="selesai-filter"]'); await tidur(150); } };
const saring = async (p, kunci, nilai) => { await bukaFilter(p); await klik(p, `[data-testid="saring-${kunci}"]`); await klik(p, `[data-testid="saring-${kunci}-${nilai}"]`); await tidur(300); await tutupFilter(p); };
const bukaDok = async (p, id) => { await p.goto(`${process.env.BASE}/warehouse/material-pickup/${id}`, { waitUntil: "networkidle2" }); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500); };
const busa = "SBX-BUSA-A", kain = "SBX-KAIN-B";

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    // ── Penyiapan: 5 permintaan Produksi (BOM direservasi, diajukan) — lewat backend asli
    const R = []; for (const [i, specs] of [[1, [["busa", 5], ["kain", 2]]], [2, [["busa", 3]]], [3, [["busa", 5]]], [4, [["kain", 4]]], [5, [["busa", 2], ["kain", 1]]]]) R.push(await seed(`E${i}-${Date.now() % 100000}`, specs));
    const s0 = await state(); const v2 = Object.entries(s0.dokumen).filter(([, d]) => d.plan).map(([id, d]) => ({ id, ...d }));
    ok("E0 penyiapan: 5 permintaan Produksi V2 READY_TO_PICK terbentuk lewat backend asli; reservasi ACTIVE menambah 'dicadangkan' pada stok (saldo belum berkurang)", v2.length === 5 && v2.every((d) => d.status === "READY_TO_PICK") && s0.gerakTotal > 0, `${v2.length}`);
    const sBusa0 = s0.stok[busa], sKain0 = s0.stok[kain];

    // ── E1. Daftar & saringan
    let p = await buka(browser, "gudang", "/warehouse/material-pickup"); await tunggu(p, '[data-testid="baris-permintaan"]');
    const tabAngka = async (k) => Number(await teksDari(p, `[data-testid="tab-${k}"] .gud-tab-jumlah`));
    ok("E1 judul + tab: Perlu diserahkan 5 / Sudah diserahkan 0 / Dibatalkan 0 / Semua 5 = DB", (await teksDari(p, ".page-title")) === "Permintaan bahan produksi" && (await tabAngka("tindakan")) === 5 && (await tabAngka("selesai")) === 0 && (await tabAngka("semua")) === 5);
    ok("E1 kolom: Permintaan | Order / unit tujuan | Bahan | Tanggal | Tahap | Tindakan berikutnya; TIDAK ada kolom Peminta (tidak ada di kontrak)", JSON.stringify(await p.$$eval(".gud-dok-kepala > span", (e) => e.map((x) => x.textContent.trim()))) === JSON.stringify(["Permintaan", "Order / unit tujuan", "Bahan", "Tanggal", "Tahap", "Tindakan berikutnya"]));
    ok("E1 baris: 5 permintaan; 'N permintaan sesuai filter' + tiga hitungan terpisah (baris bahan 7 · unit produksi 5)", (await baris(p)).length === 5 && (await teksDari(p, '[data-testid="jumlah-tampil"]')).startsWith("5 permintaan sesuai filter") && /7 baris bahan · 5 unit produksi/.test(await teksDari(p, '[data-testid="rincian-hitungan"]')), await teksDari(p, '[data-testid="rincian-hitungan"]'));
    await saring(p, "bahan", ID.M.kain);
    ok("E1 saringan bahan KAIN-B = DB (permintaan yang memuat kain: 3)", (await baris(p)).length === v2.filter((d) => d.baris.some((b) => b.materialId === ID.M.kain)).length && (await baris(p)).length === 3);
    await klik(p, '[data-testid="chip-bahan"] button'); await tidur(300);
    await saring(p, "unit", (await (async () => { const r = R[0]; return r.unitId; })()));
    ok("E1 saringan unit = hanya permintaan unit itu; chip tampil; Reset mengembalikan semua", (await baris(p)).length === 1 && await tampak(p, '[data-testid="chip-unit"]') && await (async () => { await klik(p, '[data-testid="atur-ulang-saringan"]'); await tidur(300); return (await baris(p)).length === 5; })());
    await foto(p, "E1-daftar");
    await p.click('[data-testid="baris-permintaan"]'); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(600);
    const rasio = await p.evaluate(() => document.querySelector('[data-testid="fokus-permintaan"]').getBoundingClientRect().width / document.querySelector('[data-testid="ruang-pickup"]').getBoundingClientRect().width);
    ok("E1 rincian menempel di kanan ±40%; tiga tab Permintaan · Pengeluaran · Pemakaian; membuka tidak menulis data", rasio > 0.33 && rasio < 0.45 && await tampak(p, '[data-testid="tab-pakai"]') && p.permintaan.length === 0 && (await state()).gerakTotal === s0.gerakTotal, rasio.toFixed(2));
    ok("E1 tab Permintaan: bahan dari BOM — Rencana vs Direservasi; penjelasan: direservasi ≠ stok berkurang; menyatakan peminta tidak ada di kontrak", await tampak(p, '[data-testid="direservasi"]') && /DIRESERVASI \(belum mengurangi stok\)/.test(await teksDari(p, '[data-testid="penjelasan-status"]')) && /Peminta tidak tercatat/.test(await teksDari(p, '[data-testid="bagian-permintaan"]')));
    await p.close();

    // ── E2. Serahkan bahan: stok berkurang TEPAT sekali (klik ganda), reservasi dipakai, bertaut unit
    const r1 = v2.find((d) => d.nomor === R[0].issueNumber) ?? v2[0]; const id1 = Object.entries(s0.dokumen).find(([, d]) => d.nomor === R[0].issueNumber)[0];
    p = await buka(browser, "gudang", `/warehouse/material-pickup/${id1}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    await klik(p, '[data-testid="aksi-serahkan"]'); await tunggu(p, '[data-testid="konfirmasi-serahkan"]');
    ok("E2 konfirmasi di dalam aplikasi: 'Serahkan bahan dan kurangi stok?' + dampak per bahan (busa 5 kg, kain 2 m); menyatakan tidak ada serah sebagian", /SBX-BUSA-A: stok berkurang 5 kg/.test(await teksDari(p, '[data-testid="ringkasan-serahkan"]')) && /SBX-KAIN-B: stok berkurang 2 meter|SBX-KAIN-B: stok berkurang 2 m/.test(await teksDari(p, '[data-testid="ringkasan-serahkan"]')) && /Tidak ada serah sebagian/.test(await teksDari(p, '[data-testid="konfirmasi-serahkan"]')));
    await foto(p, "E2-konfirmasi-serahkan"); const mulai = p.permintaan.length;
    await dobelKlik(p, '[data-testid="ya-serahkan"]'); await tidur(3000); const s1 = await state(); const g1 = gerakDok(s1, id1);
    ok("E2 klik ganda Serahkan bahan → TEPAT satu POST /pick (kunci idempotensi); 2 pergerakan ISSUE (busa −5, kain −2) bertaut dokumen & unit; tidak lebih", p.permintaan.slice(mulai).filter((r) => /\/pick$/.test(r.u)).length === 1 && g1.length === 2 && g1.some((m) => m.qty === -5 && m.materialId === ID.M.busa) && g1.some((m) => m.qty === -2 && m.materialId === ID.M.kain) && g1.every((m) => m.unitId === R[0].unitId), JSON.stringify(g1.map((m) => m.qty)));
    ok("E2 DB: saldo busa −5 dan kain −2 tepat sekali; dicadangkan busa −5 & kain −2 (reservasi dipakai, bukan ditambah); status ISSUED; 1 peristiwa audit unit 'diserahkan'", s1.stok[busa].saldo === sBusa0.saldo - 5 && s1.stok[kain].saldo === sKain0.saldo - 2 && s1.stok[busa].dicadangkan === sBusa0.dicadangkan - 5 && s1.stok[kain].dicadangkan === sKain0.dicadangkan - 2 && s1.dokumen[id1].status === "ISSUED" && s1.aktivitasUnit.filter((a) => a.entityId === R[0].unitId && a.eventType === "PRODUCTION_MATERIAL_ISSUE_PICKED").length === 1, `busa ${sBusa0.saldo}→${s1.stok[busa].saldo}`);
    ok("E2 banner hasil + status Sudah diserahkan; tombol Serahkan/Batalkan hilang (tanpa Undo)", /diserahkan; stok fisik berkurang/.test(await teksDari(p, '[data-testid="banner-hasil"]')) && !(await tampak(p, '[data-testid="aksi-serahkan"]')) && /Sudah diserahkan/.test(await teksDari(p, '[data-testid="status-dokumen"]')));
    // pengulangan di jalur server
    const info1 = await api("gudang", "GET", `/api/production-planning/material-requests/${id1}`);
    const lagi = await api("gudang", "POST", `/api/production-planning/material-requests/${id1}/pick`, { expectedRevision: info1.json.revision }, { "Idempotency-Key": `qa-ulang-${Date.now()}-0001` });
    const s1b = await state();
    ok("E2 permintaan serah ulang dengan kunci baru ditolak (409 sudah diserahkan); pergerakan tetap 2, saldo tetap", lagi.status === 409 && gerakDok(s1b, id1).length === 2 && s1b.stok[busa].saldo === s1.stok[busa].saldo, `${lagi.status}`);
    await klik(p, '[data-testid="tab-keluar"]'); await tidur(300);
    ok("E2 tab Pengeluaran: Diserahkan busa 5 kg, kain 2 m; status reservasi CONSUMED", /5/.test(await teksDari(p, '[data-testid="baris-keluar"][data-kode="SBX-BUSA-A"] [data-testid="diserahkan"]')) && /CONSUMED/.test(await teksDari(p, '[data-testid="bagian-pengeluaran"]')));
    await klik(p, '[data-testid="tab-pakai"]'); await tunggu(p, '[data-testid="pemakaian-unit"]');
    const pakai = await api("lihat", "GET", `/api/units/${R[0].unitId}/materials`);
    ok("E2 Pemakaian pada unit: dua pencatatan dari dokumen ini (satu per bahan); total pemakaian menurut Produksi: busa 5, kain 2 (tidak ada pengurangan kedua)", (await p.$$('[data-testid="pemakaian-dokumen-ini"] [data-testid="baris-pemakaian"]')).length === 2 && (pakai.json.totals ?? []).find((t) => t.material.code === busa)?.usedQty === 5 && (pakai.json.totals ?? []).find((t) => t.material.code === kain)?.usedQty === 2);
    await foto(p, "E2-pemakaian"); await p.close();

    // ── E3. Hubungan dengan pencatatan langsung Produksi pada unit V2: ditolak server (tidak ada jalur kedua)
    const sLangsung = await state();
    const langsung = await api("produksi", "POST", `/api/units/${R[1].unitId}/materials`, { materialId: ID.M.busa, qty: 3, note: "coba catat langsung" }, { "Idempotency-Key": `qa-lgs-${Date.now()}-0001` });
    const sLangsung2 = await state();
    ok("E3 pencatatan langsung bahan pada unit yang dikelola alur Produksi V2 ditolak server (tidak ada pergerakan kedua untuk bahan yang sama); saldo & reservasi tidak berubah", langsung.status >= 400 && sLangsung2.gerakTotal === sLangsung.gerakTotal && sLangsung2.stok[busa].saldo === sLangsung.stok[busa].saldo && sLangsung2.stok[busa].dicadangkan === sLangsung.stok[busa].dicadangkan, `${langsung.status} ${JSON.stringify(langsung.json).slice(0, 120)}`);

    // ── E4. Stok kurang saat serah: ditolak, tidak ada yang berkurang; lalu berhasil setelah stok ada
    const id3 = Object.entries(s0.dokumen).find(([, d]) => d.nomor === R[2].issueNumber)[0]; await adj(ID.M.busa, -88); const sK = await state();
    p = await buka(browser, "gudang", `/warehouse/material-pickup/${id3}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    await klik(p, '[data-testid="aksi-serahkan"]'); await tunggu(p, '[data-testid="konfirmasi-serahkan"]'); await klik(p, '[data-testid="ya-serahkan"]'); await tidur(2500); const sK2 = await state();
    ok("E4 stok fisik kurang: server menolak ('Stok fisik tidak cukup'); galat tampil di panel yang tetap terbuka; TIDAK ada pergerakan; dokumen tetap menunggu; reservasi utuh", /Stok fisik tidak cukup/.test(await teksDari(p, '[data-testid="galat-aksi"]')) && await tampak(p, '[data-testid="konfirmasi-serahkan"]') && gerakDok(sK2, id3).length === 0 && sK2.dokumen[id3].status === "READY_TO_PICK" && sK2.stok[busa].saldo === sK.stok[busa].saldo && sK2.stok[busa].dicadangkan === sK.stok[busa].dicadangkan, await teksDari(p, '[data-testid="galat-aksi"]'));
    await foto(p, "E4-stok-kurang"); await adj(ID.M.busa, 88);
    await klik(p, '[data-testid="ya-serahkan"]'); await tidur(2800); const sK3 = await state();
    ok("E4 setelah stok tersedia, tombol yang sama berhasil: busa −5 sekali; status ISSUED (kunci idempotensi sama dipakai ulang untuk niat yang sama; server mengizinkan karena gagal sebelumnya tidak menulis)", gerakDok(sK3, id3).length === 1 && gerakDok(sK3, id3)[0].qty === -5 && sK3.dokumen[id3].status === "ISSUED");
    await p.close();

    // ── E5. Batalkan: alasan wajib, reservasi dilepas, stok tidak berubah, klik ganda sekali
    const id4 = Object.entries(s0.dokumen).find(([, d]) => d.nomor === R[3].issueNumber)[0]; const sC0 = await state();
    p = await buka(browser, "gudang", `/warehouse/material-pickup/${id4}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    await klik(p, '[data-testid="aksi-batalkan"]'); await tunggu(p, '[data-testid="konfirmasi-batalkan"]'); await klik(p, '[data-testid="ya-batalkan"]'); await tidur(400);
    ok("E5 alasan kosong → galat di kolom alasan (minimal 3 karakter); tanpa permintaan; isian tetap", /minimal 3 karakter/.test(await teksDari(p, '[data-testid="konfirmasi-batalkan"] .gud-f-galat')) && p.permintaan.filter((r) => /\/cancel$/.test(r.u)).length === 0);
    await p.type('[data-testid="alasan-batal"]', "Dibatalkan uji QA"); const mC = p.permintaan.length; await dobelKlik(p, '[data-testid="ya-batalkan"]'); await tidur(2800); const sC1 = await state();
    ok("E5 klik ganda Batalkan → TEPAT satu POST /cancel; status CANCELLED; reservasi kain dilepas (dicadangkan −4); saldo & pergerakan TIDAK berubah", p.permintaan.slice(mC).filter((r) => /\/cancel$/.test(r.u)).length === 1 && sC1.dokumen[id4].status === "CANCELLED" && sC1.stok[kain].dicadangkan === sC0.stok[kain].dicadangkan - 4 && sC1.stok[kain].saldo === sC0.stok[kain].saldo && sC1.gerakTotal === sC0.gerakTotal, `cad ${sC0.stok[kain].dicadangkan}→${sC1.stok[kain].dicadangkan}`);
    ok("E5 daftar: tab Dibatalkan 1, Sudah diserahkan 2, Perlu diserahkan 2 (DB)", await (async () => { await p.goto(`${process.env.BASE}/warehouse/material-pickup`, { waitUntil: "networkidle2" }); await tunggu(p, '[data-testid="tab-tindakan"]'); await tidur(500); const a = async (k) => Number(await teksDari(p, `[data-testid="tab-${k}"] .gud-tab-jumlah`)); return (await a("tindakan")) === 2 && (await a("selesai")) === 2 && (await a("batal")) === 1 && (await a("semua")) === 5; })());
    await p.close();

    // ── E6. Izin & HP & gelap
    const sIzin = await state(); const id5 = Object.entries(s0.dokumen).find(([, d]) => d.nomor === R[4].issueNumber)[0];
    const lihatPick = await api("lihat", "POST", `/api/production-planning/material-requests/${id5}/pick`, { expectedRevision: 1 }, { "Idempotency-Key": `qa-izin-${Date.now()}-0001` });
    const salesPick = await api("sales", "POST", `/api/production-planning/material-requests/${id5}/pick`, { expectedRevision: 1 }, { "Idempotency-Key": `qa-izin2-${Date.now()}-0001` });
    ok("E6 server menegakkan izin: peran hanya-lihat dan SALES tidak bisa menyerahkan bahan (403); tidak ada pergerakan", lihatPick.status === 403 && salesPick.status === 403 && (await state()).gerakTotal === sIzin.gerakTotal, `${lihatPick.status}/${salesPick.status}`);
    for (const [nama, opsi] of [["hp", { lebar: 390, tinggi: 844, hp: true }], ["hp-gelap", { lebar: 390, tinggi: 844, hp: true, tema: "dark" }]]) {
      const q = await buka(browser, "gudang", "/warehouse/material-pickup", opsi); await tunggu(q, '[data-testid="baris-permintaan"]');
      ok(`E6 ${nama}: daftar sebagai kartu, tanpa gulir samping, tanpa galat konsol`, await tanpaGulirSamping(q) && q.galat.length === 0, q.galat.join(";")); await foto(q, `E6-${nama}-daftar`);
      await q.click('[data-testid="baris-permintaan"]'); await tunggu(q, '[data-testid="status-dokumen"]'); await tidur(500);
      ok(`E6 ${nama}: rincian layar penuh; aksi di dasar`, (await q.$eval('[data-testid="fokus-permintaan"]', (e) => e.getBoundingClientRect().width)) >= 389 && await tampak(q, '[data-testid="kartu-aksi"]')); await foto(q, `E6-${nama}-rincian`); await q.close();
    }
    const g = await buka(browser, "gudang", `/warehouse/material-pickup/${id5}`, { tema: "dark" }); await tunggu(g, '[data-testid="status-dokumen"]'); await tidur(500); await klik(g, '[data-testid="aksi-batalkan"]'); await foto(g, "E6-gelap-batal"); await g.close();
    U.selesai("hasil-miE.json");
  } catch (e) { ok("Skenario E berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-miE.json"); } finally { await browser.close(); }
})();
