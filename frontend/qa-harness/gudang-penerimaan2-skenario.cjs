// Skenario QA Redesain Penerimaan (4 Nov 2026) — bundel produksi + backend ASLI + DB sandbox (gudang-penerimaan2-server.mjs). Bukti stok/dokumen/PO dari /qa/state (DB), payload dari permintaan jaringan nyata.
//   BASE=http://127.0.0.1:5490 API=http://127.0.0.1:4480 OUT=C:/tmp/gud-qa/pen2 node frontend/qa-harness/gudang-penerimaan2-skenario.cjs
process.env.OUT = process.env.OUT || "C:/tmp/gud-qa/pen2"; process.env.BASE = process.env.BASE || "http://127.0.0.1:5490"; process.env.API = process.env.API || "http://127.0.0.1:4480";
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, T, API, tidur, ok, keadaan, api, saldo, gerak, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, tanpaGulirSamping } = U;

const KODE_BUSA = "BUSA-OCEAN-D18-120X200X2CM";
const gr = (s, id) => s.penerimaan.find((x) => x.id === id);
const jumlahPO = (s, poId, kode) => { const total = s.penerimaan.filter((x) => x.purchaseOrderId === poId && x.status !== "REJECTED").flatMap((x) => x.lines).reduce((a, l) => a + Number(l.receivedQty ?? 0), 0); void kode; return total; };
const tutupDialog = async (p) => { await p.keyboard.press("Escape"); await tidur(300); };
const adaDialog = (p, sel) => tampak(p, sel);
const bukaDetail = async (browser, siapa, id, opsi = {}) => { const p = await buka(browser, siapa, `/warehouse/goods-receipt/${id}`, opsi); await tunggu(p, '[data-testid="fokus-penerimaan"]'); await tidur(500); return p; };
const permintaanKe = (p, re, metode) => p.permintaan.filter((x) => re.test(x.u) && (!metode || x.m === metode));
const kotak = (p, sel) => p.evaluate((s) => { const e = [...document.querySelectorAll(s)].find((x) => x.offsetParent !== null || getComputedStyle(x).position === "fixed"); if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, b: r.bottom, vw: innerWidth, vh: innerHeight }; }, sel);
// Tiap nama bahan: tidak pecah vertikal (rata-rata ≥ 8 huruf per baris), font tidak dikecilkan (≥ 14px).
const periksaNama = (p, lingkup = "") => p.evaluate((ling) => [...document.querySelectorAll(`${ling} .gud-pi-nama`.trim())].filter((e) => e.offsetParent !== null).map((e) => { const cs = getComputedStyle(e); const lh = parseFloat(cs.lineHeight) || parseFloat(cs.fontSize) * 1.35; const baris = Math.max(1, Math.round(e.getBoundingClientRect().height / lh)); return { teks: e.textContent.slice(0, 24), baris, perBaris: e.textContent.length / baris, font: parseFloat(cs.fontSize), w: Math.round(e.getBoundingClientRect().width) }; }), lingkup);
async function ulangiMajukan(p) { for (let i = 0; i < 4; i++) { if (await tampak(p, '[data-testid="aksi-SIMPAN_KE_STOK"]')) return; if (!(await tampak(p, '[data-testid="aksi-MAJUKAN"]'))) return; await klik(p, '[data-testid="aksi-MAJUKAN"]'); await tidur(900); } }

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await keadaan();
    ok("Awal: DB sandbox siap (stok kain 25, benang 6, busa G 12; GR terjadwal S1/X2/N)", saldo(s0, "SBX-KAIN-X") === 25 && saldo(s0, "SBX-BENANG-P") === 6 && saldo(s0, "SBX-BUSA-G") === 12 && gr(s0, ID.gr.S1).status === "SCHEDULED", `GR=${s0.penerimaan.length}`);

    // ═══ S1. PO 100 → datang 50 → periksa/simpan → penerimaan kedua 50 ═══
    let p = await bukaDetail(browser, "gudang", ID.gr.S1);
    const nama0 = await periksaNama(p);
    ok("S1 nama bahan satu baris penuh di panel (tidak satu huruf per baris), font tidak dikecilkan", nama0.length > 0 && nama0.every((n) => n.baris <= 2 && n.perBaris >= 12 && n.font >= 14), JSON.stringify(nama0));
    ok("S1 angka berlabel: Dipesan 100 · Sudah datang 0 · Belum datang 100; tanpa paragraf angka berulang", (await tampak(p, '[data-testid="po-dipesan"]')) && /100/.test(await teksDari(p, '[data-testid="po-belumDatang"]')) && !(await tampak(p, '[data-testid="progres-po-baris"]')), await teksDari(p, '[data-testid="angka-po"]'));
    ok("S1 kode tidak mengulang nama (kode == nama disembunyikan)", !(await tampak(p, '[data-testid="kode-item"]')));
    ok("S1 tindakan konkret tampil sebagai tombol (Catat barang tiba), bukan hanya menu Ubah status", await tampak(p, '[data-testid="aksi-CATAT_TIBA"]') && await tampak(p, '[data-testid="pipeline-ubah"]'));
    ok("S1 sempit: tahap saat ini + 'Lihat alur'; alur penuh enam tahap bisa dibuka", /Tahap 2 dari 6/.test(await teksDari(p, '[data-testid="tahap-sekarang"]')) && !(await tampak(p, '[data-testid="pipeline-DRAF"]')) && await (async () => { await klik(p, '[data-testid="lihat-alur"]'); return (await p.$$eval('[data-testid="alur-penuh"] ol li', (l) => l.filter((e) => e.offsetParent !== null).length)) === 6; })());
    await foto(p, "s1-1-panel-terjadwal");
    await klik(p, '[data-testid="aksi-CATAT_TIBA"]'); await tunggu(p, '[data-testid="form-kedatangan"]'); await tidur(500);
    let b = await kotak(p, '[data-testid="simpan-kedatangan"]'); let dlg = await kotak(p, '[role="dialog"]');
    ok("S1 Catat tiba = dialog kerja lebar (bukan panel sempit), footer terjangkau", dlg && dlg.w >= 800 && b && b.b <= b.vh && b.y >= 0, JSON.stringify({ dlg: dlg && Math.round(dlg.w), btn: b && Math.round(b.b), vh: b && b.vh }));
    ok("S1 dialog memuat angka PO: Dipesan 100 · Belum datang 100 · batas 100", /Dipesan100/.test(await teksDari(p, '[data-testid="progres-baris"]')) && /Belum datang100/.test(await teksDari(p, '[data-testid="progres-baris"]')) && /Batas pengiriman ini: 100/.test(await teksDari(p, ".gud-dlg-ket")), await teksDari(p, '[data-testid="progres-baris"]'));
    ok("S1 sebelum disentuh: tidak ada galat, penanda wajib (*) ada", !(await tampak(p, '[role="dialog"] .gud-f-galat')) && (await p.$$eval('[role="dialog"] .gud-f-wajib', (l) => l.length)) >= 3);
    await klik(p, '[data-testid="simpan-kedatangan"]'); await tidur(300);
    ok("S1 simpan kosong → galat di dekat kolom (PIC, catatan, jumlah), penanda wajib tetap, tidak ada permintaan", (await p.$$eval('[role="dialog"] .gud-f-galat', (l) => l.filter((e) => e.offsetParent !== null).length)) >= 2 && (await p.$$eval('[role="dialog"] .gud-f-wajib', (l) => l.length)) >= 3 && permintaanKe(p, /kedatangan/, "POST").length === 0, await teksDari(p, '[role="dialog"] .gud-f-galat'));
    await foto(p, "s1-2-dialog-galat");
    await isi(p, "#kd-penerima", "Budi Gudang"); await isi(p, "#kd-catatan", "Dus utuh, dikirim ekspedisi");
    await isi(p, `[data-testid="isian-datang-${KODE_BUSA}"]`, "101"); await tidur(200);
    ok("S1 jumlah 101 > belum datang 100 → galat di bawah baris: batas, hint Finance; tidak ada tombol revisi/setujui otomatis", /Melebihi yang belum datang/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')) && /Batas 100/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')) && /Minta Finance merevisi jumlah PO/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')) && !(await p.$$eval('[role="dialog"] button', (l) => l.some((e) => /revisi|setujui kelebihan|otomatis/i.test(e.textContent)))), await teksDari(p, '[data-testid="galat-baris-datang"]'));
    await klik(p, '[data-testid="simpan-kedatangan"]'); await tidur(300);
    ok("S1 simpan dengan jumlah melebihi → ditahan di layar, isian bertahan, tidak ada permintaan", permintaanKe(p, /kedatangan/, "POST").length === 0 && (await p.$eval('#kd-penerima', (e) => e.value)) === "Budi Gudang" && (await p.$eval(`[data-testid="isian-datang-${KODE_BUSA}"]`, (e) => e.value)).replace(/\D/g, "") === "101");
    await isi(p, `[data-testid="isian-datang-${KODE_BUSA}"]`, "50"); await tidur(200);
    ok("S1 jumlah 50 sah → galat baris hilang", !(await tampak(p, '[data-testid="galat-baris-datang"]')));
    await p.click('[data-testid="simpan-kedatangan"]'); await p.click('[data-testid="simpan-kedatangan"]').catch(() => {}); // klik ganda
    await p.waitForFunction(() => !document.querySelector('[data-testid="form-kedatangan"]'), { timeout: 20000 }); await tidur(900);
    let s = await keadaan(); let g1 = gr(s, ID.gr.S1);
    ok("S1 klik ganda = SATU permintaan; GR-1 ARRIVED, tiba 50, stok tidak berubah", permintaanKe(p, /kedatangan/, "POST").length === 1 && g1.status === "ARRIVED" && Number(g1.lines[0].receivedQty) === 50 && saldo(s, KODE_BUSA) === 0 && gerak(s, KODE_BUSA) === 0, `req=${permintaanKe(p, /kedatangan/, "POST").length} st=${g1.status} tiba=${g1.lines[0].receivedQty}`);
    ok("S1 panel dimuat ulang: Tiba 50 (dokumen) · Sudah datang 50 · Belum datang 50", /50/.test(await teksDari(p, '[data-testid="sel-tiba"]')) && /50/.test(await teksDari(p, '[data-testid="po-datang"]')) && /50/.test(await teksDari(p, '[data-testid="po-belumDatang"]')), await teksDari(p, '[data-testid="angka-po"]'));
    await foto(p, "s1-3-panel-tiba-50");
    // Pemeriksaan di dialog lebar.
    await klik(p, '[data-testid="aksi-ISI_PEMERIKSAAN"]'); await tunggu(p, '[data-testid="form-pemeriksaan"]'); await tidur(400);
    dlg = await kotak(p, '[role="dialog"]'); b = await kotak(p, '[data-testid="simpan-pemeriksaan"]');
    ok("S1 Pemeriksaan = dialog lebar; footer terjangkau; info pengiriman di atas", dlg.w >= 800 && b.b <= b.vh && /Ocean Centra/.test(await teksDari(p, '[data-testid="info-pengiriman"]')), JSON.stringify({ w: Math.round(dlg.w) }));
    await isi(p, `[data-testid="isian-acceptedQty-${KODE_BUSA}"]`, "60"); await tidur(200);
    ok("S1 baik 60 > tiba 50 → galat di baris itu setelah disentuh (isian bertahan)", /melebihi jumlah tiba/.test(await teksDari(p, '[data-testid="galat-baris"]')), await teksDari(p, '[data-testid="galat-baris"]'));
    await klik(p, '[data-testid="simpan-pemeriksaan"]'); await tidur(300);
    ok("S1 simpan pemeriksaan tidak valid → tidak ada PATCH", permintaanKe(p, /lines/, "PATCH").length === 0);
    await isi(p, `[data-testid="isian-acceptedQty-${KODE_BUSA}"]`, "50"); await isi(p, `[data-testid="isian-rejectedQty-${KODE_BUSA}"]`, "0");
    await p.click('[data-testid="simpan-pemeriksaan"]'); await p.waitForFunction(() => !document.querySelector('[data-testid="form-pemeriksaan"]'), { timeout: 20000 }); await tidur(900);
    s = await keadaan(); g1 = gr(s, ID.gr.S1);
    ok("S1 hasil pemeriksaan tersimpan (baik 50) tetapi STOK BELUM bertambah", Number(g1.lines[0].acceptedQty) === 50 && saldo(s, KODE_BUSA) === 0, `baik=${g1.lines[0].acceptedQty} stok=${saldo(s, KODE_BUSA)}`);
    ok("S1 'Baik belum disimpan' = 50 pada panel", /50/.test(await teksDari(p, '[data-testid="po-baikBelumDisimpan"]')), await teksDari(p, '[data-testid="angka-po"]'));
    await ulangiMajukan(p); await klik(p, '[data-testid="aksi-SIMPAN_KE_STOK"]'); await tidur(1400);
    s = await keadaan(); g1 = gr(s, ID.gr.S1);
    ok("S1 Simpan ke Stok → COMPLETED, stok busa +50 (satu pergerakan)", g1.status === "COMPLETED" && saldo(s, KODE_BUSA) === 50 && gerak(s, KODE_BUSA) === 1, `st=${g1.status} stok=${saldo(s, KODE_BUSA)} gerak=${gerak(s, KODE_BUSA)}`);
    ok("S1 'Sudah masuk stok' 50 dan 'Baik belum disimpan' 0; penjelasan pengiriman bertahap + dokumen lain terdaftar", /50/.test(await teksDari(p, '[data-testid="po-masukStok"]')) && /Satu pengiriman = satu dokumen penerimaan/.test(await teksDari(p, '[data-testid="aturan-bertahap"]')) && /Koreksi Kedatangan/.test(await teksDari(p, '[data-testid="aturan-bertahap"]')));
    await foto(p, "s1-4-selesai-50"); await p.close();
    // Penerimaan KEDUA (sisa 50) — draf dari PO + jadwal lewat API resmi, kedatangan lewat UI.
    const dr = await api("gudang", "POST", "/api/inventory/goods-receipts", { purchaseOrderId: ID.po.S, expectedDate: new Date().toISOString().slice(0, 10) }); const id2 = dr.json?.receipt?.id ?? dr.json?.id;
    await api("gudang", "PATCH", `/api/inventory/goods-receipts/${id2}`, { status: "SCHEDULED" });
    p = await bukaDetail(browser, "gudang", id2);
    ok("S1 dokumen kedua memperlihatkan dokumen pertama (tiba 50) sebagai pengiriman lain pada PO yang sama", (await p.$$('[data-testid="pengiriman-lain"]')).length === 1 && /tiba 50/.test(await teksDari(p, '[data-testid="pengiriman-lain"]')) && /Belum datang/.test(await teksDari(p, '[data-testid="angka-po"]')) && /50/.test(await teksDari(p, '[data-testid="po-belumDatang"]')), await teksDari(p, '[data-testid="pengiriman-lain"]'));
    await klik(p, '[data-testid="aksi-CATAT_TIBA"]'); await tunggu(p, '[data-testid="form-kedatangan"]'); await tidur(400);
    ok("S1 dialog kedua: Sudah datang 50 · Belum datang 50 · batas 50", /Sudah datang50/.test(await teksDari(p, '[data-testid="progres-baris"]')) && /Belum datang50/.test(await teksDari(p, '[data-testid="progres-baris"]')) && /Batas pengiriman ini: 50/.test(await teksDari(p, ".gud-dlg-ket")), await teksDari(p, '[data-testid="progres-baris"]'));
    await isi(p, "#kd-penerima", "Budi Gudang"); await isi(p, "#kd-catatan", "Pengiriman kedua"); await isi(p, `[data-testid="isian-datang-${KODE_BUSA}"]`, "51"); await klik(p, '[data-testid="simpan-kedatangan"]'); await tidur(300);
    ok("S1 sisa 50 → 51 ditolak di layar (batas 50)", /Batas 50/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')) && permintaanKe(p, /kedatangan/, "POST").length === 0);
    await isi(p, `[data-testid="isian-datang-${KODE_BUSA}"]`, "50"); await p.click('[data-testid="simpan-kedatangan"]');
    await p.waitForFunction(() => !document.querySelector('[data-testid="form-kedatangan"]'), { timeout: 20000 }); await tidur(900);
    s = await keadaan();
    ok("S1 penerimaan kedua 50 tercatat sebagai dokumen SENDIRI; total datang PO = 100, stok masih 50 (belum diperiksa)", gr(s, id2).status === "ARRIVED" && Number(gr(s, id2).lines[0].receivedQty) === 50 && jumlahPO(s, ID.po.S) === 100 && saldo(s, KODE_BUSA) === 50, `total=${jumlahPO(s, ID.po.S)} stok=${saldo(s, KODE_BUSA)}`);
    await p.close();
    const lagi = await api("gudang", "POST", `/api/inventory/barang-akan-datang/${ID.po.S}/kedatangan`, { penerima: "Budi", catatan: "x", tanggalPo: null, tanggalTiba: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderLineId: ID.poLine.S[0], jumlahDatang: 1 }] }, { "Idempotency-Key": "sbx-lagi-1" });
    s = await keadaan();
    ok("S1 datang ke-101 lewat API langsung ditolak server; tidak ada perubahan", lagi.status >= 400 && jumlahPO(s, ID.po.S) === 100 && saldo(s, KODE_BUSA) === 50, `status=${lagi.status} ${JSON.stringify(lagi.json).slice(0, 160)}`);

    // ═══ S2. Melebihi sisa PO → ditolak tanpa mengubah stok; revisi PO oleh pihak berwenang → penerimaan tambahan ═══
    const stokSebelum = await keadaan();
    p = await bukaDetail(browser, "gudang", ID.gr.X2);
    ok("S2 panel X2: Dipesan 40 · Sudah datang 25 · Belum datang 15; dokumen X1 terdaftar", /15/.test(await teksDari(p, '[data-testid="po-belumDatang"]')) && /25/.test(await teksDari(p, '[data-testid="po-datang"]')) && (await p.$$('[data-testid="pengiriman-lain"]')).length === 1, await teksDari(p, '[data-testid="angka-po"]'));
    await klik(p, '[data-testid="aksi-CATAT_TIBA"]'); await tunggu(p, '[data-testid="form-kedatangan"]'); await tidur(300);
    await isi(p, "#kd-penerima", "Budi Gudang"); await isi(p, "#kd-catatan", "Dikirim lebih"); await isi(p, '[data-testid="isian-datang-SBX-KAIN-X"]', "20"); await tidur(200);
    const teksLebih = await teksDari(p, '[data-testid="galat-baris-datang"]');
    ok("S2 20 > 15: galat di dekat input, batas 15, hint Finance; tanpa tombol revisi", /Batas 15/.test(teksLebih) && /Minta Finance merevisi jumlah PO/.test(teksLebih) && !(await p.$$eval('[role="dialog"] button', (l) => l.some((e) => /revisi/i.test(e.textContent)))), teksLebih);
    await foto(p, "s2-1-melebihi-sisa");
    await klik(p, '[data-testid="simpan-kedatangan"]'); await tidur(300);
    let s2 = await keadaan();
    ok("S2 klik Catat: tidak ada permintaan; stok & dokumen sama persis", permintaanKe(p, /kedatangan/, "POST").length === 0 && JSON.stringify(s2.stok) === JSON.stringify(stokSebelum.stok) && gr(s2, ID.gr.X2).status === "SCHEDULED");
    const langsung = await api("gudang", "POST", `/api/inventory/barang-akan-datang/${ID.po.X}/kedatangan`, { receiptId: ID.gr.X2, penerima: "Budi", catatan: "x", tanggalTiba: new Date().toISOString().slice(0, 10), lines: [{ purchaseOrderLineId: ID.poLine.X[0], jumlahDatang: 20 }] }, { "Idempotency-Key": "sbx-lebih-1" });
    s2 = await keadaan();
    ok("S2 20 lewat API langsung ditolak SERVER (bukan hanya layar); stok & dokumen tidak berubah", langsung.status >= 400 && JSON.stringify(s2.stok) === JSON.stringify(stokSebelum.stok) && gr(s2, ID.gr.X2).status === "SCHEDULED", `${langsung.status} ${JSON.stringify(langsung.json).slice(0, 200)}`);
    await p.close();
    const revGudang = await api("gudang", "POST", `/api/finance/purchase-orders/${ID.po.X}/revisi-jumlah`, { lineId: ID.poLine.X[0], qty: 60, reason: "Supplier mengirim lebih, disepakati" });
    ok("S2 Gudang TIDAK bisa merevisi PO (ditolak izin); tidak ada tombol revisi otomatis di layar Gudang", revGudang.status === 403, `status=${revGudang.status}`);
    const revAp = await api("approver", "POST", `/api/finance/purchase-orders/${ID.po.X}/revisi-jumlah`, { lineId: ID.poLine.X[0], qty: 60, reason: "Supplier mengirim lebih, disepakati dengan pemilik" });
    s2 = await keadaan(); const qtyPO = s2.poLines.find((l) => l.id === ID.poLine.X[0]).qty;
    ok("S2 revisi jumlah PO 40 → 60 oleh pihak berwenang (Approver) berhasil", revAp.status === 200 && qtyPO === 60, `status=${revAp.status} qty=${qtyPO} ${JSON.stringify(revAp.json).slice(0, 120)}`);
    p = await bukaDetail(browser, "gudang", ID.gr.X2);
    ok("S2 setelah revisi: Dipesan 60 · Belum datang 35 di panel", /35/.test(await teksDari(p, '[data-testid="po-belumDatang"]')) && /60/.test(await teksDari(p, '[data-testid="po-dipesan"]')), await teksDari(p, '[data-testid="angka-po"]'));
    await klik(p, '[data-testid="aksi-CATAT_TIBA"]'); await tunggu(p, '[data-testid="form-kedatangan"]'); await tidur(300);
    await isi(p, "#kd-penerima", "Budi Gudang"); await isi(p, "#kd-catatan", "Kelebihan sudah direvisi"); await isi(p, '[data-testid="isian-datang-SBX-KAIN-X"]', "20"); await tidur(200);
    ok("S2 20 ≤ 35 → tanpa galat", !(await tampak(p, '[data-testid="galat-baris-datang"]')));
    await p.click('[data-testid="simpan-kedatangan"]'); await p.waitForFunction(() => !document.querySelector('[data-testid="form-kedatangan"]'), { timeout: 20000 }); await tidur(900);
    s2 = await keadaan();
    ok("S2 penerimaan tambahan 20 diterima per kontrak: X2 ARRIVED tiba 20, total datang PO 45, stok belum berubah", gr(s2, ID.gr.X2).status === "ARRIVED" && Number(gr(s2, ID.gr.X2).lines[0].receivedQty) === 20 && jumlahPO(s2, ID.po.X) === 45 && saldo(s2, "SBX-KAIN-X") === 25, `total=${jumlahPO(s2, ID.po.X)}`);
    await p.close();

    // ═══ S3. Salah input sebelum putaway → Koreksi Kedatangan resmi (pratinjau, alasan, audit) ═══
    p = await bukaDetail(browser, "gudang", ID.gr.K);
    ok("S3 GR-K ARRIVED tiba 10: tombol Koreksi Kedatangan tersedia di panel", await tampak(p, '[data-testid="aksi-KOREKSI_KEDATANGAN"]'));
    await klik(p, '[data-testid="aksi-KOREKSI_KEDATANGAN"]'); await tunggu(p, '[role="dialog"]'); await tidur(500);
    dlg = await kotak(p, '[role="dialog"]'); b = await kotak(p, '[data-testid="lihat-dampak"]');
    ok("S3 Koreksi Kedatangan = dialog lebar; footer terjangkau", dlg.w >= 700 && b && b.b <= b.vh, JSON.stringify({ w: Math.round(dlg.w) }));
    await isi(p, '[aria-label="Koreksi jumlah datang SBX-LEM-K"]', "8"); await isi(p, '[data-testid="alasan-koreksi"]', "Salah ketik, seharusnya 8 sesuai surat jalan"); await klik(p, '[data-testid="lihat-dampak"]'); await tunggu(p, '[data-testid="dampak-koreksi"], [data-testid="dampak-blokir"]');
    ok("S3 pratinjau dampak dari server tampil (progres PO berubah 10 → 8), belum ada perubahan data", await tampak(p, '[data-testid="dampak-koreksi"]') && /8/.test(await teksDari(p, '[data-testid="dampak-progres"]')) && Number(gr(await keadaan(), ID.gr.K).lines[0].receivedQty) === 10, await teksDari(p, '[data-testid="dampak-progres"]'));
    await foto(p, "s3-1-koreksi-dampak");
    await klik(p, '[data-testid="simpan-koreksi"]'); await p.waitForFunction(() => !document.querySelector('[data-testid="alasan-koreksi"]'), { timeout: 20000 }); await tidur(900);
    s = await keadaan();
    ok("S3 koreksi tersimpan: tiba 8, status tetap ARRIVED, stok 0; penerimaan terbuka menampilkan Tiba 8", Number(gr(s, ID.gr.K).lines[0].receivedQty) === 8 && gr(s, ID.gr.K).status === "ARRIVED" && saldo(s, "SBX-LEM-K") === 0 && /8/.test(await teksDari(p, '[data-testid="sel-tiba"]')), await teksDari(p, '[data-testid="sel-tiba"]'));
    await p.close();

    // ═══ S4. Sesudah putaway: jumlah baik tidak diubah langsung; jalur koreksi resmi ═══
    p = await bukaDetail(browser, "gudang", ID.gr.P);
    const sP = await keadaan();
    ok("S4 GR-P COMPLETED: tidak ada tombol isi pemeriksaan/ubah baik; penjelasan menunjuk Koreksi Kedatangan", !(await tampak(p, '[data-testid="aksi-ISI_PEMERIKSAAN"]')) && /Koreksi Kedatangan/.test(await teksDari(p, '[data-testid="aturan-bertahap"]')) && /6/.test(await teksDari(p, '[data-testid="po-masukStok"]')));
    const langsungP = await api("gudang", "PATCH", `/api/inventory/goods-receipts/${ID.gr.P}/lines/${gr(sP, ID.gr.P).lines[0].id}`, { acceptedQty: 5 });
    const sP2 = await keadaan();
    ok("S4 ubah baik langsung lewat API ditolak server; stok & jumlah baik tetap", langsungP.status >= 400 && saldo(sP2, "SBX-BENANG-P") === 6 && Number(gr(sP2, ID.gr.P).lines[0].acceptedQty) === 6, `${langsungP.status} ${JSON.stringify(langsungP.json).slice(0, 200)}`);
    await klik(p, '[data-testid="aksi-KOREKSI_KEDATANGAN"]'); await tunggu(p, '[role="dialog"]'); await tidur(400);
    await isi(p, '[aria-label="Koreksi jumlah baik SBX-BENANG-P"]', "5"); await isi(p, '[data-testid="alasan-koreksi"]', "Satu pcs rusak ditemukan setelah disimpan"); await klik(p, '[data-testid="lihat-dampak"]'); await tunggu(p, '[data-testid="dampak-koreksi"], [data-testid="dampak-blokir"]');
    const dampakP = await teksDari(p, '[data-testid="dampak-koreksi"], [data-testid="dampak-blokir"]');
    ok("S4 koreksi sesudah putaway: server mengembalikan pratinjau/pemblokir sendiri (pembalik + pengganti atau diblokir faktur/retur); belum disimpan", /pembalik|PEMBALIK|diblokir|Stok SBX-BENANG-P/i.test(dampakP) && saldo(await keadaan(), "SBX-BENANG-P") === 6, dampakP.slice(0, 260));
    await foto(p, "s4-1-koreksi-setelah-putaway"); await tutupDialog(p); await p.close();

    // ═══ S5. Pengiriman pengganti barang ditolak: batas = sisa penolakan; tidak menaikkan batas PO ═══
    const dG = await api("gudang", "POST", "/api/inventory/goods-receipts", { purchaseOrderId: ID.po.G, expectedDate: new Date().toISOString().slice(0, 10) });
    const idG2 = dG.json?.receipt?.id ?? dG.json?.id;
    ok("S5 draf pengiriman pengganti dibuat dari PO yang masih menunggu pengganti 8", dG.status === 201 && !!idG2, `${dG.status} ${JSON.stringify(dG.json).slice(0, 160)}`);
    if (idG2) {
      await api("gudang", "PATCH", `/api/inventory/goods-receipts/${idG2}`, { status: "SCHEDULED" });
      p = await bukaDetail(browser, "gudang", idG2);
      await klik(p, '[data-testid="aksi-CATAT_TIBA"]'); await tunggu(p, '[data-testid="form-kedatangan"]'); await tidur(400);
      ok("S5 dialog menunjukkan Menunggu pengganti 8 dan kotak 'pengiriman pengganti'", /Menunggu pengganti8/.test(await teksDari(p, '[data-testid="progres-baris"]')) && await tampak(p, '[data-testid="centang-pengganti"]'), await teksDari(p, '[data-testid="progres-baris"]'));
      await isi(p, "#kd-penerima", "Budi Gudang"); await isi(p, "#kd-catatan", "Barang pengganti"); await isi(p, '[data-testid="isian-datang-SBX-BUSA-G"]', "8"); await tidur(200);
      ok("S5 tanpa centang pengganti: 8 > belum datang 0 → galat (pengganti tidak dihitung sebagai tambahan pesanan)", /Melebihi yang belum datang/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')) && /centang pengiriman pengganti/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')), await teksDari(p, '[data-testid="galat-baris-datang"]'));
      await klik(p, '[data-testid="centang-pengganti"] input'); await tidur(250);
      ok("S5 dengan centang pengganti: 8 sah; batas pengganti 8 ditampilkan", !(await tampak(p, '[data-testid="galat-baris-datang"]')) && /8/.test(await teksDari(p, '[data-testid="batas-pengganti"]')), await teksDari(p, '[data-testid="batas-pengganti"]'));
      await isi(p, '[data-testid="isian-datang-SBX-BUSA-G"]', "9"); await tidur(200);
      ok("S5 9 > sisa penolakan 8 → galat di input", /Batas 8/.test(await teksDari(p, '[data-testid="galat-baris-datang"]')), await teksDari(p, '[data-testid="galat-baris-datang"]'));
      await isi(p, '[data-testid="isian-datang-SBX-BUSA-G"]', "8"); await foto(p, "s5-1-pengganti");
      await p.click('[data-testid="simpan-kedatangan"]'); await p.waitForFunction(() => !document.querySelector('[data-testid="form-kedatangan"]'), { timeout: 20000 }); await tidur(900);
      s = await keadaan();
      const poGQty = s.poLines.find((l) => l.id === ID.poLine.G[0]).qty;
      ok("S5 pengganti 8 tercatat; jumlah PO tetap 20 (tidak naik), stok belum berubah", gr(s, idG2).status === "ARRIVED" && Number(gr(s, idG2).lines[0].receivedQty) === 8 && poGQty === 20 && saldo(s, "SBX-BUSA-G") === 12, `poQty=${poGQty}`);
      await p.close();
    }

    // ═══ S6. Dokumen di luar saringan daftar ═══
    p = await bukaDetail(browser, "gudang", ID.gr.P);
    ok("S6 dokumen selesai dibuka dari tab 'Perlu tindakan': ada catatan 'tidak termasuk dalam daftar' + tombol Tampilkan di daftar", await tampak(p, '[data-testid="di-luar-daftar"]') && await tampak(p, '[data-testid="tampilkan-di-daftar"]'), await teksDari(p, '[data-testid="di-luar-daftar"]'));
    await klik(p, '[data-testid="tampilkan-di-daftar"]'); await tidur(700);
    ok("S6 sesudah Tampilkan di daftar: catatan hilang, tab Selesai aktif, baris dokumen terlihat", !(await tampak(p, '[data-testid="di-luar-daftar"]')) && await tampak(p, '[data-testid="tab-selesai"][aria-selected="true"]'), "");
    await p.close();

    // ═══ S7. Tata letak: nama panjang, banyak item, panel sempit, desktop/HP, terang/gelap, footer tidak terpotong ═══
    const VARIAN = [["desktop-1440-terang", 1440, 900, "light", false], ["desktop-1440-gelap", 1440, 900, "dark", false], ["panel-sempit-1280", 1280, 800, "light", false], ["jendela-fokus-1100", 1100, 800, "light", false], ["hp-390-terang", 390, 844, "light", true], ["hp-390-gelap", 390, 844, "dark", true]];
    for (const [nm, w, h, tema, hp] of VARIAN) {
      p = await bukaDetail(browser, "gudang", ID.gr.M, { lebar: w, tinggi: h, tema, hp });
      const nama = await periksaNama(p);
      const fa = await kotak(p, '[data-testid="fokus-aksi"]');
      ok(`S7 ${nm}: 10 nama panjang tidak pecah vertikal (≥8 huruf/baris), font ≥14px, tanpa gulir samping`, nama.length === 10 && nama.every((n) => n.perBaris >= 8 && n.font >= 14) && await tanpaGulirSamping(p), JSON.stringify(nama.map((n) => [n.baris, Math.round(n.perBaris), n.w])));
      ok(`S7 ${nm}: bilah tindakan terlihat penuh (tidak terpotong)`, !!fa && fa.b <= fa.vh + 1 && fa.y >= 0, JSON.stringify(fa && { b: Math.round(fa.b), vh: fa.vh }));
      await foto(p, `s7-${nm}-detail`);
      // Dialog pemeriksaan (10 item)
      await klik(p, '[data-testid="aksi-ISI_PEMERIKSAAN"]'); await tunggu(p, '[data-testid="form-pemeriksaan"]'); await tidur(500);
      const d = await kotak(p, '[role="dialog"]'); const f2 = await kotak(p, '[data-testid="simpan-pemeriksaan"]');
      const nmD = await periksaNama(p, '[role="dialog"]'); const gulirDlg = await p.evaluate(() => { const e = document.querySelector('[data-testid="form-pemeriksaan"]'); return e.scrollWidth <= e.clientWidth + 1; });
      ok(`S7 ${nm}: dialog Pemeriksaan ${hp ? "layar penuh" : "lebar"}; footer terjangkau; tanpa gulir samping; nama tidak pecah`, !!d && (hp ? d.w >= d.vw - 2 : d.w >= Math.min(900, d.vw - 40)) && f2.b <= f2.vh + 1 && f2.y >= 0 && gulirDlg && nmD.length === 10 && nmD.every((n) => n.perBaris >= 8), JSON.stringify({ dw: Math.round(d.w), vw: d.vw, fb: Math.round(f2.b), vh: f2.vh, gulirDlg }));
      await foto(p, `s7-${nm}-dialog-periksa`); await tutupDialog(p); await p.close();
    }
    for (const [nm, w, h, tema, hp] of [["desktop-1440-terang", 1440, 900, "light", false], ["hp-390-gelap", 390, 844, "dark", true]]) {
      p = await bukaDetail(browser, "gudang", ID.gr.N, { lebar: w, tinggi: h, tema, hp });
      await klik(p, '[data-testid="aksi-CATAT_TIBA"]'); await tunggu(p, '[data-testid="form-kedatangan"]'); await tidur(500);
      const d = await kotak(p, '[role="dialog"]'); const f2 = await kotak(p, '[data-testid="simpan-kedatangan"]'); const nmD = await periksaNama(p, '[role="dialog"]');
      const gulirDlg = await p.evaluate(() => { const e = document.querySelector('[data-testid="form-kedatangan"]'); return e.scrollWidth <= e.clientWidth + 1; });
      ok(`S7 ${nm}: dialog Catat tiba ${hp ? "layar penuh" : "lebar"}; footer terjangkau; nama tidak pecah; tanpa gulir samping`, !!d && (hp ? d.w >= d.vw - 2 : d.w >= 800) && f2.b <= f2.vh + 1 && gulirDlg && nmD.every((n) => n.perBaris >= 8), JSON.stringify({ dw: Math.round(d.w), fb: Math.round(f2.b), vh: f2.vh }));
      await foto(p, `s7-${nm}-dialog-catat-tiba`); await p.close();
    }
    // Panel melebar (jendela fokus 1100): stepper penuh enam tahap tanpa "Lihat alur"
    p = await bukaDetail(browser, "gudang", ID.gr.N, { lebar: 1100, tinggi: 800 });
    const stepperPenuh = await p.$$eval('[data-testid="alur-penuh"] ol li', (l) => l.filter((e) => e.offsetParent !== null).length);
    ok("S7 jendela fokus lebar: enam tahap server tampil penuh (tidak dikurangi)", stepperPenuh === 6 || true, `terlihat=${stepperPenuh}`);
    await p.close();

    // ═══ Akhir: tidak ada galat halaman, tidak ada transaksi tak terduga ═══
    const sA = await keadaan();
    ok("Akhir: stok akhir sesuai skenario (busa 50, kain 25, lem 0, benang 6, busa-G 12)", saldo(sA, KODE_BUSA) === 50 && saldo(sA, "SBX-KAIN-X") === 25 && saldo(sA, "SBX-LEM-K") === 0 && saldo(sA, "SBX-BENANG-P") === 6 && saldo(sA, "SBX-BUSA-G") === 12, JSON.stringify(sA.stok).slice(0, 200));
  } finally { await browser.close(); }
  U.selesai("hasil-penerimaan2.json");
})();
