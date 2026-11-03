// Skenario D — Pengeluaran Material (V1): form & tindakan yang MENULIS, di atas backend + DB sandbox ASLI. Bukti dari /qa/state (DB): saldo, pencadangan, pergerakan, status dokumen, audit.
//   PUPPETEER=… BASE=http://127.0.0.1:5483 API=http://127.0.0.1:4481 OUT=C:/tmp/gud-qa/mi node frontend/qa-harness/gudang-mi-skenarioD.cjs
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, T, tidur, ok, api, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, tanpaGulirSamping, API } = U;
const state = async () => (await fetch(`${API}/qa/state`)).json();
const tulis = (p, re, m = "POST") => p.permintaan.filter((r) => r.m === m && re.test(r.u));
const dobelKlik = (p, sel) => p.evaluate((s) => { const e = document.querySelector(s); e.click(); e.click(); }, sel);
const klikLangsung = (p, sel) => p.evaluate((s) => document.querySelector(s).click(), sel);
const KODE = (k) => `SBX-${k}`;
const issueDoc = (s, id) => s.dokumen[id]; const acara = (s, id, tipe) => s.aktivitas.filter((a) => a.entityId === id && a.eventType === tipe).length;
const gerakDoc = (s, id) => s.gerak.filter((m) => m.materialIssueId === id).map((m) => ({ ...m, qty: Number(m.qty) }));
const bukaDok = async (p, id) => { await p.goto(`${process.env.BASE}/warehouse/material-issue/${id}`, { waitUntil: "networkidle2" }); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500); };
const batalModal = (p) => p.evaluate(() => [...document.querySelectorAll('[role="dialog"] button')].find((b) => b.textContent.trim() === "Batal").click());
const batalPanel = (p, kode) => p.evaluate((k) => [...document.querySelectorAll(`[data-testid="panel-${k}"] button`)].find((b) => b.textContent.trim() === "Batal").click(), kode);
const statusUI = (p) => p.$eval('[data-testid="status-dokumen"]', (e) => e.dataset.kode);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await state(); const M = ID.M; const Un = ID.U;
    // ── D1. Form permintaan baru
    let p = await buka(browser, "gudang", "/warehouse/material-issue"); await tunggu(p, '[data-testid="baris-dokumen"]');
    await klik(p, '[data-testid="permintaan-baru"]'); await tunggu(p, '[data-testid="form-permintaan"]'); await tidur(600);
    const tata = await p.evaluate(() => { const g = document.querySelector(".gud-katalog-grid"); const d = g.closest('[role="dialog"]'); const kol = getComputedStyle(g).gridTemplateColumns.split(" ").length; return { kol, lebar: Math.round(d.getBoundingClientRect().width), bagian: document.querySelectorAll('[data-testid="form-permintaan"] fieldset').length, katalogKiri: document.querySelector('[data-testid="katalog-bahan"]').getBoundingClientRect().left < document.querySelector('[data-testid="daftar-diminta"]').getBoundingClientRect().left }; });
    ok("D1 form = dialog lebar (≥ 900px) dengan dua bagian; katalog bahan DI SISI daftar diminta (dua kolom), bukan baris select satu-satu", tata.lebar >= 900 && tata.kol === 2 && tata.bagian === 2 && tata.katalogKiri, JSON.stringify(tata));
    await foto(p, "D1-form-kosong");
    ok("D1 katalog menampilkan ketersediaan dari server per bahan; 'belum diketahui' ≠ 0", await (async () => { await isi(p, '[data-testid="cari-katalog"]', "BELUM-E"); const t = await teksDari(p, '[data-testid="katalog-item"]'); await isi(p, '[data-testid="cari-katalog"]', "BUSA-A"); const t2 = await teksDari(p, '[data-testid="katalog-item"]'); return /stok belum diketahui/.test(t) && t2.includes(`tersedia ${Number(s0.stok[KODE("BUSA-A")].tersedia).toLocaleString("id-ID", { maximumFractionDigits: 4 })} kg`); })(), await teksDari(p, '[data-testid="katalog-item"]'));
    await klikLangsung(p, '[data-testid="simpan-permintaan"]'); await tidur(300);
    ok("D1 simpan kosong → galat dekat kolom Unit & daftar bahan; tanpa permintaan ke server", await tampak(p, '#mi-unit[aria-invalid="true"]') && await tampak(p, '[data-testid="galat-baris"]') && p.permintaan.length === 0, await teksDari(p, ".gud-f-galat"));
    await klik(p, '[data-testid="katalog-item"][data-kode="SBX-BUSA-A"]'); await tidur(300);
    await klikLangsung(p, '[data-testid="simpan-permintaan"]'); await tidur(300);
    ok("D1 jumlah kosong → galat di kolom jumlah bahan itu; nol ditolak ('lebih dari 0')", await tampak(p, '[data-testid="qty-SBX-BUSA-A"][aria-invalid="true"]') && await (async () => { await isi(p, '[data-testid="qty-SBX-BUSA-A"]', "0"); await klikLangsung(p, '[data-testid="simpan-permintaan"]'); await tidur(300); return /lebih dari 0/.test(await teksDari(p, ".gud-f-galat")); })() && p.permintaan.length === 0);
    await isi(p, '[data-testid="qty-SBX-BUSA-A"]', "500"); await tidur(200);
    ok("D1 jumlah melebihi tersedia: diperingatkan tetapi Draf tetap boleh (pencadangan baru saat disetujui)", await tampak(p, '[data-testid="peringatan-kurang"]'));
    await isi(p, '[data-testid="qty-SBX-BUSA-A"]', "12,5");
    await isi(p, '[data-testid="cari-unit"]', "SBX-UA"); await tunggu(p, '[data-testid="pilih-unit"]'); await klik(p, '[data-testid="pilih-unit"]');
    await isi(p, '[data-testid="input-departemen"]', "Line Uji"); await isi(p, '[data-testid="input-catatan"]', "Permintaan uji QA");
    // gagal simpan → isian & daftar bertahan, tidak ada dokumen
    await p.setRequestInterception(true); const gagal = (r) => { if (r.method() === "POST" && /\/inventory\/material-issues$/.test(r.url())) r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulasi gagal simpan" }) }); else r.continue(); };
    p.on("request", gagal); await klikLangsung(p, '[data-testid="simpan-permintaan"]'); await tidur(1200);
    const sGagal = await state();
    ok("D1 gagal simpan: pesan tampil; unit, bahan, jumlah 12.5, departemen, catatan TETAP; tidak ada dokumen baru", /Simulasi gagal simpan/.test(await teksDari(p, '[data-testid="galat-permintaan"]')) && (await p.$eval('[data-testid="qty-SBX-BUSA-A"]', (e) => e.value)) === "12.5" && (await p.$eval('[data-testid="input-departemen"]', (e) => e.value)) === "Line Uji" && await tampak(p, '[data-testid="unit-terpilih"]') && sGagal.dokumenTotal === s0.dokumenTotal);
    p.off("request", gagal); await p.setRequestInterception(false); const mulai = p.permintaan.length;
    await dobelKlik(p, '[data-testid="simpan-permintaan"]'); await tidur(2500);
    const post = p.permintaan.slice(mulai).filter((r) => r.m === "POST" && /\/inventory\/material-issues$/.test(r.u)); const s1 = await state();
    const baru = Object.entries(s1.dokumen).find(([id, d]) => !s0.dokumen[id])?.[0];
    ok("D1 klik ganda Simpan → TEPAT satu POST; payload sesuai kontrak (sumber WO, unit, 1 baris busa 12.5)", post.length === 1 && post[0].b.sourceType === "PRODUCTION_WORK_ORDER" && post[0].b.unitId === Un.a && post[0].b.lines.length === 1 && Number(post[0].b.lines[0].requestedQty) === 12.5, JSON.stringify(post[0]?.b));
    ok("D1 DB: tepat +1 dokumen berstatus DRAFT dengan baris busa 12.5; saldo & stok dicadangkan TIDAK berubah (Draf tidak memengaruhi stok); tidak ada pergerakan baru", s1.dokumenTotal === s0.dokumenTotal + 1 && s1.dokumen[baru].status === "DRAFT" && s1.dokumen[baru].baris[0].diminta === 12.5 && s1.stok[KODE("BUSA-A")].saldo === s0.stok[KODE("BUSA-A")].saldo && s1.stok[KODE("BUSA-A")].dicadangkan === s0.stok[KODE("BUSA-A")].dicadangkan && s1.gerakTotal === s0.gerakTotal);
    ok("D1 setelah simpan rincian dokumen baru langsung terbuka (panel kanan) dengan status Draf", await tampak(p, '[data-testid="status-dokumen"]') && (await tunggu(p, '[data-testid="status-dokumen"]').then(() => statusUI(p))) === "DRAF");
    // buka & batal tidak menulis
    const sblm = await state(); const n0 = p.permintaan.length;
    await klik(p, '[data-testid="permintaan-baru"]'); await tunggu(p, '[data-testid="form-permintaan"]'); await klik(p, '[data-testid="katalog-item"]'); await batalModal(p); await tidur(400);
    ok("D1 membuka form, memilih bahan, lalu Batal: tidak ada permintaan tulis; DB sama", p.permintaan.length === n0 && JSON.stringify((await state()).stok) === JSON.stringify(sblm.stok) && (await state()).dokumenTotal === sblm.dokumenTotal);
    // Perlengkapan Stok untuk unit produksi → ditolak server, isian bertahan
    await klik(p, '[data-testid="permintaan-baru"]'); await tunggu(p, '[data-testid="form-permintaan"]');
    await isi(p, '[data-testid="cari-katalog"]', "PERLENG-F"); await klik(p, '[data-testid="katalog-item"]'); await isi(p, '[data-testid="qty-SBX-PERLENG-F"]', "2");
    await isi(p, '[data-testid="cari-unit"]', "SBX-UB"); await tunggu(p, '[data-testid="pilih-unit"]'); await klik(p, '[data-testid="pilih-unit"]');
    await klikLangsung(p, '[data-testid="simpan-permintaan"]'); await tidur(1800);
    ok("D1 Perlengkapan Stok untuk unit produksi: server menolak (422), pesan tampil, isian bertahan, tidak ada dokumen", /Perlengkapan Stok/.test(await teksDari(p, '[data-testid="galat-permintaan"]')) && (await p.$eval('[data-testid="qty-SBX-PERLENG-F"]', (e) => e.value)) === "2" && (await state()).dokumenTotal === s1.dokumenTotal);
    await batalModal(p); await tidur(300);
    await p.close();

    // ── D2. Siklus dokumen baru: Ajukan → Setujui (cadang) → Siap → Diambil → Keluarkan SEBAGIAN (stok berkurang tepat sekali)
    p = await buka(browser, "gudang", `/warehouse/material-issue/${baru}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    const busa = KODE("BUSA-A"); let sa = await state(); const cad0 = sa.stok[busa].dicadangkan, saldo0 = sa.stok[busa].saldo;
    await klik(p, '[data-testid="aksi-AJUKAN"]'); await tidur(1500); sa = await state();
    ok("D2 Ajukan persetujuan → Menunggu persetujuan; stok & pencadangan TIDAK berubah", sa.dokumen[baru].status === "WAITING_APPROVAL" && sa.stok[busa].dicadangkan === cad0 && sa.stok[busa].saldo === saldo0 && (await statusUI(p)) === "MENUNGGU");
    await klik(p, '[data-testid="aksi-SETUJUI"]'); await tunggu(p, '[data-testid="panel-SETUJUI"]');
    ok("D2 Setujui membuka panel dampak di dalam aplikasi: 'Stok yang dicadangkan: SBX-BUSA-A 12,5 kg'; tombol menyebut dampaknya", /12,5/.test(await teksDari(p, '[data-testid="ringkasan-SETUJUI"]')) && /Setujui & cadangkan stok/.test(await teksDari(p, '[data-testid="kirim-SETUJUI"]')));
    await foto(p, "D2-konfirmasi-setujui");
    const awalS = p.permintaan.length; await dobelKlik(p, '[data-testid="kirim-SETUJUI"]'); await tidur(2200); sa = await state();
    ok("D2 klik ganda Setujui → TEPAT satu PATCH; dicadangkan +12,5; saldo tetap; persetujuan tercatat (1 peristiwa audit)", tulis({ permintaan: p.permintaan.slice(awalS) }, /material-issues\/[0-9a-f-]{36}$/, "PATCH").length === 1 && sa.stok[busa].dicadangkan === cad0 + 12.5 && sa.stok[busa].saldo === saldo0 && !!sa.dokumen[baru].approvedById && acara(sa, baru, "DOCUMENT_APPROVED") === 1, `cad ${cad0}→${sa.stok[busa].dicadangkan}`);
    await klik(p, '[data-testid="aksi-SIAPKAN"]'); await tidur(1500); await klik(p, '[data-testid="aksi-TANDAI_DIAMBIL"]'); await tidur(1500); sa = await state();
    ok("D2 Siap diambil → Sudah diambil: status PICKED; saldo BELUM berkurang; pencadangan tetap", sa.dokumen[baru].status === "PICKED" && sa.stok[busa].saldo === saldo0 && sa.stok[busa].dicadangkan === cad0 + 12.5 && gerakDoc(sa, baru).length === 0);
    await klik(p, '[data-testid="tab-keluar"]'); await tidur(300);
    ok("D2 tab Pengeluaran: Diminta 12,5 · Dicadangkan 12,5 · Dikeluarkan '—'; isian 'Jumlah yang dikeluarkan' terisi 12.5 (bawaan = diminta)", /12,5/.test(await teksDari(p, '[data-testid="dicadangkan"]')) && /—/.test(await teksDari(p, '[data-testid="dikeluarkan"]')) && (await p.$eval('[data-testid="keluar-SBX-BUSA-A"]', (e) => e.value)) === "12.5");
    await isi(p, '[data-testid="keluar-SBX-BUSA-A"]', "0"); await klik(p, '[data-testid="aksi-KONFIRMASI_KELUAR"]'); await tunggu(p, '[data-testid="panel-KONFIRMASI_KELUAR"]'); await tidur(300);
    ok("D2 jumlah keluar 0 ditolak dini ('lebih dari 0'); tombol Keluarkan nonaktif; stok tidak berubah", /lebih dari 0/.test(await teksDari(p, '[data-testid="galat-isian"]')) && await p.$eval('[data-testid="kirim-KONFIRMASI_KELUAR"]', (e) => e.disabled));
    await batalPanel(p, "KONFIRMASI_KELUAR"); await tidur(200); await isi(p, '[data-testid="keluar-SBX-BUSA-A"]', "7,5"); await klik(p, '[data-testid="aksi-KONFIRMASI_KELUAR"]'); await tunggu(p, '[data-testid="panel-KONFIRMASI_KELUAR"]');
    ok("D2 panel Keluarkan dari stok menyatakan dampak: 'SBX-BUSA-A: stok berkurang 7,5 kg (diminta 12,5)'; tombol 'Keluarkan dari stok'", /stok berkurang 7,5 kg \(diminta 12,5\)/.test(await teksDari(p, '[data-testid="ringkasan-KONFIRMASI_KELUAR"]')) && /Keluarkan dari stok/.test(await teksDari(p, '[data-testid="kirim-KONFIRMASI_KELUAR"]')));
    await foto(p, "D2-konfirmasi-keluar"); const jur0 = (await state()).jurnal; const awalK = p.permintaan.length;
    await dobelKlik(p, '[data-testid="kirim-KONFIRMASI_KELUAR"]'); await tidur(2800); sa = await state();
    const gk = gerakDoc(sa, baru);
    ok("D2 klik ganda Keluarkan → TEPAT satu POST /issue; TEPAT satu pergerakan ISSUE −7,5 bertaut dokumen & unit A", p.permintaan.slice(awalK).filter((r) => /\/issue$/.test(r.u)).length === 1 && gk.length === 1 && gk[0].type === "ISSUE" && Number(gk[0].qty) === -7.5 && gk[0].unitId === Un.a, JSON.stringify(gk));
    ok("D2 DB: saldo BUSA-A turun tepat 7,5; pencadangan dokumen ini dilepas (kembali ke awal); status ISSUED; issuedQty 7,5; 1 peristiwa audit 'diposting'", sa.stok[busa].saldo === saldo0 - 7.5 && sa.stok[busa].dicadangkan === cad0 && sa.dokumen[baru].status === "ISSUED" && sa.dokumen[baru].baris[0].keluar === 7.5 && acara(sa, baru, "DOCUMENT_POSTED") === 1, `saldo ${saldo0}→${sa.stok[busa].saldo}`);
    ok("D2 setelah keluar: tidak ada tombol Batalkan/Kembalikan/Undo (jalur koreksi resmi saja); peringatan 'dikeluarkan sebagian'; selisih 5 kg", !(await tampak(p, '[data-testid="aksi-BATALKAN"]')) && !(await tampak(p, '[data-testid="aksi-KEMBALIKAN"]')) && await tampak(p, '[data-testid="peringatan-sebagian"]') && /Kurang dikeluarkan 5/.test(await teksDari(p, '[data-testid="selisih-keluar"]')));
    // pengulangan di jalur server: permintaan sama persis tidak menulis lagi; jumlah berbeda ditolak
    const dokServer = await api("gudang", "GET", `/api/inventory/material-issues/${baru}`); const lineId = dokServer.json.lines[0].id;
    const ulangSama = await api("gudang", "POST", `/api/inventory/material-issues/${baru}/issue`, { lines: [{ lineId, issuedQty: 7.5 }] });
    const ulangBeda = await api("gudang", "POST", `/api/inventory/material-issues/${baru}/issue`, { lines: [{ lineId, issuedQty: 9 }] });
    sa = await state();
    ok("D2 pengulangan permintaan keluar yang SAMA: sukses tanpa menulis ulang (ulang=true); jumlah BERBEDA ditolak; pergerakan tetap 1, saldo tetap", ulangSama.status === 200 && ulangSama.json.ulang === true && ulangBeda.status >= 400 && gerakDoc(sa, baru).length === 1 && sa.stok[busa].saldo === saldo0 - 7.5, `${ulangSama.status}/${ulangBeda.status}`);
    await klik(p, '[data-testid="tab-pakai"]'); await tunggu(p, '[data-testid="pemakaian-unit"]');
    const pakaiApi = await api("produksi", "GET", `/api/units/${Un.a}/materials`);
    const totBusa = (pakaiApi.json.totals ?? []).find((t) => t.material.code === busa)?.usedQty;
    ok("D2 Pemakaian pada unit A: satu pencatatan dari dokumen ini; total pemakaian busa unit A menurut Produksi = 7,5 (TIDAK ada pengurangan kedua)", (await p.$$('[data-testid="pemakaian-dokumen-ini"] [data-testid="baris-pemakaian"]')).length === 1 && totBusa === 7.5, `usedQty=${totBusa}`);
    await foto(p, "D2-pemakaian"); await p.close();

    // ── D3. Stok kurang: server menolak, tidak ada yang berkurang, isian bertahan; lalu pengeluaran sebagian yang cukup
    p = await buka(browser, "gudang", `/warehouse/material-issue/${ID.D.diambil2.id}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500); await klik(p, '[data-testid="tab-keluar"]');
    const lem = KODE("LEM-C"); const sLem = await state();
    await klik(p, '[data-testid="aksi-KONFIRMASI_KELUAR"]'); await tunggu(p, '[data-testid="panel-KONFIRMASI_KELUAR"]'); await klik(p, '[data-testid="kirim-KONFIRMASI_KELUAR"]'); await tidur(2000);
    const sLem2 = await state();
    ok("D3 stok kurang (diminta 6, saldo 3): server menolak; galat tampil; dokumen tetap 'Sudah diambil'; TIDAK ada pergerakan; isian 6 bertahan", await tampak(p, '[data-testid="galat-aksi"]') && sLem2.dokumen[ID.D.diambil2.id].status === "PICKED" && gerakDoc(sLem2, ID.D.diambil2.id).length === 0 && sLem2.stok[lem].saldo === sLem.stok[lem].saldo && (await p.$eval('[data-testid="keluar-SBX-LEM-C"]', (e) => e.value)) === "6", await teksDari(p, '[data-testid="galat-aksi"]'));
    await foto(p, "D3-stok-kurang");
    await isi(p, '[data-testid="keluar-SBX-LEM-C"]', "2"); await klik(p, '[data-testid="kirim-KONFIRMASI_KELUAR"]'); await tidur(2200);
    const sLem3 = await state();
    ok("D3 pengeluaran sebagian yang cukup (2 dari 6): saldo LEM-C 3→1 tepat sekali; dokumen Sudah dikeluarkan dengan selisih 4; tidak ada dokumen susulan otomatis", sLem3.stok[lem].saldo === sLem.stok[lem].saldo - 2 && sLem3.dokumen[ID.D.diambil2.id].status === "ISSUED" && gerakDoc(sLem3, ID.D.diambil2.id).length === 1 && sLem3.dokumenTotal === sLem2.dokumenTotal && /Kurang dikeluarkan 4/.test(await teksDari(p, '[data-testid="selisih-keluar"]')));
    await p.close();

    // ── D4. Batalkan (alasan wajib, pencadangan dilepas), Buat ulang, Kembalikan ke Draf
    p = await buka(browser, "gudang", `/warehouse/material-issue/${ID.D.disetujui.id}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    let sd = await state(); const cadB = sd.stok[busa].dicadangkan;
    await klik(p, '[data-testid="aksi-BATALKAN"]'); await tunggu(p, '[data-testid="panel-BATALKAN"]');
    ok("D4 Batalkan: panel menyatakan dampak (pencadangan dilepas, dokumen tidak dihapus); alasan wajib → tombol nonaktif sampai diisi", /Pencadangan stok dilepas/.test(await teksDari(p, '[data-testid="panel-BATALKAN"]')) && await p.$eval('[data-testid="kirim-BATALKAN"]', (e) => e.disabled));
    await p.type('[data-testid="bidang-alasan"]', "Salah unit (uji QA)"); const awalB = p.permintaan.length;
    await dobelKlik(p, '[data-testid="kirim-BATALKAN"]'); await tidur(2200); sd = await state();
    ok("D4 klik ganda Batalkan → TEPAT satu PATCH; status CANCELLED; busa dicadangkan −20; saldo tidak berubah; 1 peristiwa audit pembatalan", p.permintaan.slice(awalB).filter((r) => /\/cancel$/.test(r.u)).length === 1 && sd.dokumen[ID.D.disetujui.id].status === "CANCELLED" && sd.stok[busa].dicadangkan === cadB - 20 && sd.stok[busa].saldo === sa.stok[busa].saldo && acara(sd, ID.D.disetujui.id, "DOCUMENT_CANCELLED") === 1, `cad ${cadB}→${sd.stok[busa].dicadangkan}`);
    await klik(p, '[data-testid="aksi-BUAT_ULANG"]'); await tunggu(p, '[data-testid="panel-BUAT_ULANG"]'); await p.type('[data-testid="bidang-alasan"]', "Unit yang benar"); await klik(p, '[data-testid="kirim-BUAT_ULANG"]'); await tidur(2500);
    const sd2 = await state(); const baruUlang = Object.entries(sd2.dokumen).find(([id]) => !sd.dokumen[id])?.[0];
    ok("D4 Buat permintaan baru dari dokumen dibatalkan: dokumen BARU berstatus Draf dengan baris sama; dokumen lama tidak berubah; stok tidak berubah", !!baruUlang && sd2.dokumen[baruUlang].status === "DRAFT" && sd2.dokumen[baruUlang].baris.length === 2 && sd2.dokumen[ID.D.disetujui.id].status === "CANCELLED" && sd2.stok[busa].dicadangkan === sd.stok[busa].dicadangkan && sd2.dokumenTotal === sd.dokumenTotal + 1);
    await bukaDok(p, ID.D.diambil.id); await klik(p, '[data-testid="aksi-KEMBALIKAN"]'); await tunggu(p, '[data-testid="panel-KEMBALIKAN"]');
    ok("D4 Kembalikan ke Draf (sudah diambil): panel menyatakan persetujuan gugur & pencadangan dilepas; alasan wajib", /Persetujuan lama GUGUR/.test(await teksDari(p, '[data-testid="panel-KEMBALIKAN"]')) && await p.$eval('[data-testid="kirim-KEMBALIKAN"]', (e) => e.disabled));
    await p.type('[data-testid="bidang-alasan"]', "Jumlah perlu direvisi"); await klik(p, '[data-testid="kirim-KEMBALIKAN"]'); await tidur(2200); const sk = await state();
    ok("D4 setelah Kembalikan: status DRAFT, persetujuan dikosongkan, pencadangan busa/lem dokumen itu dilepas (busa −8), saldo tak berubah", sk.dokumen[ID.D.diambil.id].status === "DRAFT" && !sk.dokumen[ID.D.diambil.id].approvedById && sk.stok[busa].dicadangkan === sd2.stok[busa].dicadangkan - 8 && sk.stok[busa].saldo === sd2.stok[busa].saldo);
    await bukaDok(p, ID.D.keluar.id);
    ok("D4 dokumen yang sudah dikeluarkan: tidak ada Batalkan/Kembalikan/Hapus; kartu jalur koreksi resmi ada di tab Riwayat", !(await tampak(p, '[data-testid="aksi-BATALKAN"]')) && !(await tampak(p, '[data-testid="aksi-KEMBALIKAN"]')) && await (async () => { await klik(p, '[data-testid="tab-riwayat"]'); await tidur(800); return /koreksi/i.test(await teksDari(p, '[data-testid="bagian-riwayat"]')); })());
    await p.close();

    // ── D5. Revisi basi (dua petugas): hanya satu yang menyetujui; yang lain diberi tahu keadaan terbaru
    const dua = await buka(browser, "gudang2", `/warehouse/material-issue/${ID.D.menunggu.id}`); await tunggu(dua, '[data-testid="status-dokumen"]'); await tidur(400);
    const satu = await buka(browser, "gudang", `/warehouse/material-issue/${ID.D.menunggu.id}`); await tunggu(satu, '[data-testid="status-dokumen"]'); await tidur(400);
    await satu.bringToFront(); await klik(satu, '[data-testid="aksi-SETUJUI"]'); await tunggu(satu, '[data-testid="kirim-SETUJUI"]'); await klik(satu, '[data-testid="kirim-SETUJUI"]'); await tidur(2000);
    await dua.bringToFront(); await klik(dua, '[data-testid="aksi-SETUJUI"]'); await tunggu(dua, '[data-testid="kirim-SETUJUI"]'); await klik(dua, '[data-testid="kirim-SETUJUI"]'); await tidur(2200);
    const s5 = await state();
    ok("D5 dua petugas menyetujui dokumen yang sama: hanya SATU persetujuan tercatat; yang kedua melihat keadaan terbaru (tidak ada persetujuan ganda atau pencadangan ganda)", acara(s5, ID.D.menunggu.id, "DOCUMENT_APPROVED") === 1 && s5.dokumen[ID.D.menunggu.id].status === "APPROVED" && s5.stok[KODE("LEM-C")].dicadangkan === sk.stok[KODE("LEM-C")].dicadangkan + 2 && (await statusUI(dua)) !== "MENUNGGU", `peristiwa=${acara(s5, ID.D.menunggu.id, "DOCUMENT_APPROVED")}`);
    await dua.close(); await satu.close();

    // ── D6. Hubungan dengan pencatatan langsung Produksi: dua jalur terpisah, tidak ada pengurangan kedua untuk satu kejadian
    const kain = KODE("KAIN-B"); const sP0 = await state(); const kunciP = `qa-mi-langsung-${Date.now()}-0001`;
    const langsung = await api("produksi", "POST", `/api/units/${Un.c}/materials`, { materialId: M.kain, qty: 4, note: "Pemakaian langsung uji" }, { "Idempotency-Key": kunciP });
    const langsung2 = await api("produksi", "POST", `/api/units/${Un.c}/materials`, { materialId: M.kain, qty: 4, note: "Pemakaian langsung uji" }, { "Idempotency-Key": kunciP });
    const sP1 = await state();
    ok("D6 Produksi mencatat pemakaian langsung 4 m (kunci idempotensi sama dikirim dua kali): TEPAT satu pergerakan; saldo −4; dokumen Gudang unit itu tidak berubah", langsung.status === 201 && langsung2.status === 200 && sP1.gerakIssue === sP0.gerakIssue + 1 && sP1.stok[kain].saldo === sP0.stok[kain].saldo - 4 && sP1.dokumen[ID.D.siap.id].status === "READY_TO_PICK", `${langsung.status}/${langsung2.status}`);
    p = await buka(browser, "gudang", `/warehouse/material-issue/${ID.D.siap.id}`); await tunggu(p, '[data-testid="status-dokumen"]'); await tidur(500);
    await klik(p, '[data-testid="aksi-TANDAI_DIAMBIL"]'); await tidur(1800); await klik(p, '[data-testid="tab-keluar"]'); await klik(p, '[data-testid="aksi-KONFIRMASI_KELUAR"]'); await tunggu(p, '[data-testid="panel-KONFIRMASI_KELUAR"]'); await klik(p, '[data-testid="kirim-KONFIRMASI_KELUAR"]'); await tidur(2500);
    const sP2 = await state(); const issueKain = sP2.gerak.filter((m) => m.materialId === M.kain && m.unitId === Un.c && m.type === "ISSUE").map((m) => ({ ...m, qty: Number(m.qty) }));
    ok("D6 Gudang lalu mengeluarkan dokumen 12 m untuk unit yang sama: pergerakan unit = 12 (dokumen) + 4 (langsung) = dua kejadian TERPISAH, masing-masing sekali; pencatatan langsung tidak menjadi pengeluaran dokumen dan sebaliknya", issueKain.length === 2 && issueKain.some((m) => m.materialIssueId === ID.D.siap.id && m.qty === -12) && issueKain.some((m) => !m.materialIssueId && m.qty === -4) && sP2.stok[kain].saldo === sP0.stok[kain].saldo - 16, JSON.stringify(issueKain.map((m) => [m.qty, !!m.materialIssueId])));
    await klik(p, '[data-testid="tab-pakai"]'); await tunggu(p, '[data-testid="pemakaian-unit"]');
    ok("D6 Pemakaian menampilkan keduanya terpisah + peringatan kemungkinan pencatatan ganda (bahan sama) — sistem tidak menggabungkan atau memblokir", (await p.$$('[data-testid="pemakaian-dokumen-ini"] [data-testid="baris-pemakaian"]')).length === 1 && (await p.$$('[data-testid="pemakaian-langsung"] [data-testid="baris-pemakaian"]')).length === 1 && await tampak(p, '[data-testid="peringatan-ganda"]'));
    await foto(p, "D6-ganda"); await p.close();

    // ── D7. Tampilan form & aksi: HP, gelap
    p = await buka(browser, "gudang", "/warehouse/material-issue", { lebar: 390, tinggi: 844, hp: true }); await tunggu(p, '[data-testid="baris-dokumen"]');
    await klik(p, '[data-testid="permintaan-baru"]'); await tunggu(p, '[data-testid="form-permintaan"]'); await tidur(500);
    ok("D7 form di HP: satu kolom berurutan (daftar diminta tampil SEBELUM katalog), tanpa gulir samping, tombol ≥44px", await p.evaluate(() => { const a = document.querySelector('[data-testid="daftar-diminta"]').getBoundingClientRect().top; const b = document.querySelector('[data-testid="katalog-bahan"]').getBoundingClientRect().top; return a < b && document.scrollingElement.scrollWidth <= innerWidth + 1 && document.querySelector('[data-testid="simpan-permintaan"]').getBoundingClientRect().height >= 43; }));
    await foto(p, "D7-hp-form"); await p.close();
    p = await buka(browser, "gudang", "/warehouse/material-issue", { tema: "dark" }); await tunggu(p, '[data-testid="baris-dokumen"]'); await klik(p, '[data-testid="permintaan-baru"]'); await tunggu(p, '[data-testid="form-permintaan"]'); await tidur(500); await foto(p, "D7-gelap-form"); await p.close();
    U.selesai("hasil-miD.json");
  } catch (e) { ok("Skenario D berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-miD.json"); } finally { await browser.close(); }
})();
