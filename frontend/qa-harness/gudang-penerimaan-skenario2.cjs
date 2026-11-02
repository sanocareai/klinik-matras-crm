// Skenario 2 — Catat tiba (Barang Akan Datang → rincian PO → pencatatan), pemeriksaan baik/ditolak, gagal simpan, Simpan ke Stok tepat sekali, penerimaan sebagian, izin.
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, T, API, tidur, ok, keadaan, api, saldo, gerak, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, pilihTanggalHariIni } = U;
const KARTU = (kode) => `[data-testid="kartu-item"][data-kode="${kode}"]`;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await keadaan();
    ID.grB = s0.penerimaan.find((x) => x.purchaseOrderId === ID.po.B)?.id;
    // ── S4. Barang Akan Datang → rincian PO → Catat Barang Tiba
    let p = await buka(browser, "gudang", "/warehouse/barang-akan-datang");
    ok("S4 daftar PO tampil dengan status dari server", (await p.$$('tr[data-testid="baris-po"]')).length >= 3);
    await klik(p, `tr[data-testid="baris-po"][data-po="${ID.poNo.A}"]`); await tunggu(p, '[data-testid="fokus-po"]');
    ok("S4 memilih PO membuka rincian (rute /:id) di panel menempel", p.url().endsWith(`/warehouse/barang-akan-datang/${ID.po.A}`) && await tampak(p, '[data-tempel="ya"]'));
    await tunggu(p, '[data-testid="panel-kedatangan"]'); await foto(p, "s4-rincian-po");
    const sebelumTulis = p.permintaan.length;
    await klik(p, '[data-testid="catat-tiba"]'); await tunggu(p, '[data-testid="simpan-kedatangan"]');
    ok("S4 membuka formulir Catat Barang Tiba menyiapkan draf SAJA (stok tidak berubah)", JSON.stringify((await keadaan()).stok) === JSON.stringify(s0.stok), `permintaan tulis=${p.permintaan.length - sebelumTulis}`);
    await foto(p, "s4-catat-tiba-kosong");
    ok("S4 simpan dinonaktifkan sampai wajib diisi, alasan tampil", await p.evaluate(() => document.querySelector('[data-testid="simpan-kedatangan"]').disabled) && (await teksDari(p, '[data-testid="galat-kedatangan"]')).length > 0, await teksDari(p, '[data-testid="galat-kedatangan"]'));
    await pilihTanggalHariIni(p, '[data-testid="tanggal-tiba-isian"]');
    await p.type('input[placeholder="mis. Budi (Gudang)"]', "Budi Gudang");
    await p.type('input[placeholder="mis. dus utuh, dikirim ekspedisi"]', "Dus utuh, diantar ekspedisi");
    await isi(p, 'input[aria-label="Jumlah datang SBX-BUSA-R50"]', "6");
    await isi(p, 'input[aria-label="Jumlah datang SBX-LEM-SRI"]', "2");
    await foto(p, "s4-catat-tiba-terisi");
    await p.evaluate(() => { const b = document.querySelector('[data-testid="simpan-kedatangan"]'); b.click(); b.click(); });
    await tidur(2500);
    const tulis = p.permintaan.filter((r) => r.m === "POST" && /\/kedatangan$/.test(r.u));
    ok("S4 klik ganda Catat Barang Tiba → TEPAT satu POST kedatangan", tulis.length === 1, `POST=${tulis.length}`);
    const b4 = tulis[0]?.b;
    ok("S4 payload sesuai kontrak (tanggal, penerima, catatan, jumlah per baris PO; Idempotency-Key)", /^\d{4}-\d{2}-\d{2}$/.test(b4?.tanggalTiba ?? "") && b4?.penerima === "Budi Gudang" && b4?.lines?.length === 2 && b4.lines.some((l) => l.purchaseOrderLineId === ID.poLine.A[0] && Number(l.jumlahDatang) === 6) && b4.lines.some((l) => l.purchaseOrderLineId === ID.poLine.A[1] && Number(l.jumlahDatang) === 2) && !!tulis[0]?.h["idempotency-key"], JSON.stringify(b4));
    const s4 = await keadaan();
    const grA = s4.penerimaan.find((x) => x.purchaseOrderId === ID.po.A);
    ok("S4 penerimaan dari PO-A berstatus ARRIVED; stok TIDAK berubah oleh pencatatan kedatangan", grA?.status === "ARRIVED" && JSON.stringify(s4.stok) === JSON.stringify(s0.stok), grA?.status);
    ID.grA = grA.id;
    await p.close();

    // ── S5. Pemeriksaan jumlah baik/ditolak: validasi, payload, konversi
    p = await buka(browser, "gudang", `/warehouse/goods-receipt/${ID.grA}`);
    await tunggu(p, KARTU("SBX-BUSA-R50"));
    const kBusa = (f) => `${KARTU("SBX-BUSA-R50")} [data-testid="isian-${f}-SBX-BUSA-R50"]`; const kLem = (f) => `${KARTU("SBX-LEM-SRI")} [data-testid="isian-${f}-SBX-LEM-SRI"]`;
    ok("S5 kartu item menampilkan Tiba (read-only dari kedatangan) dan satuan beli", /6/.test(await teksDari(p, KARTU("SBX-BUSA-R50"))) && /BOX/.test(await teksDari(p, KARTU("SBX-LEM-SRI"))), await teksDari(p, KARTU("SBX-LEM-SRI")));
    ok("S5 konversi satuan terbaca (1 dus = 12 pcs) sebelum diisi", /1 dus = 12 pcs/i.test(await teksDari(p, '[data-testid="konversi-penerimaan"]')), await teksDari(p, '[data-testid="konversi-penerimaan"]'));
    await isi(p, kBusa("acceptedQty"), "7"); await isi(p, kBusa("rejectedQty"), "1");
    ok("S5 baik+ditolak melebihi tiba → galat per baris + kolom aria-invalid", await tampak(p, `${kBusa("acceptedQty")}[aria-invalid="true"]`) && /melebihi jumlah tiba/i.test(await teksDari(p, '[data-testid="galat-baris"]')));
    await foto(p, "s5-periksa-galat");
    await isi(p, kBusa("acceptedQty"), "-1");
    ok("S5 jumlah negatif ditolak dini (galat angka)", /0 atau lebih|tidak valid|angka/i.test(await teksDari(p, '[data-testid="galat-baris"], [data-testid="galat-isian"]')), await teksDari(p, '[data-testid="galat-baris"], [data-testid="galat-isian"]'));
    await isi(p, kBusa("acceptedQty"), "5"); await isi(p, kBusa("rejectedQty"), "1");
    await isi(p, kLem("acceptedQty"), "2"); await isi(p, kLem("rejectedQty"), "0");
    // S6 gagal simpan mempertahankan isian (permintaan PATCH baris digagalkan)
    await p.setRequestInterception(true);
    const gagalkan = (r) => { if (r.method() === "PATCH" && /\/lines\//.test(r.url())) r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulasi gagal simpan" }) }); else r.continue(); };
    p.on("request", gagalkan);
    await klik(p, '[data-testid="aksi-ISI_PEMERIKSAAN"]'); await tidur(1200);
    ok("S6 gagal simpan: pesan galat tampil dan isian TETAP (5 / 1 / 2)", /Simulasi gagal simpan/.test(await teksDari(p, '[data-testid="galat-aksi"]')) && (await p.$eval(kBusa("acceptedQty"), (e) => e.value)) === "5" && (await p.$eval(kBusa("rejectedQty"), (e) => e.value)) === "1" && (await p.$eval(kLem("acceptedQty"), (e) => e.value)) === "2", await teksDari(p, '[data-testid="galat-aksi"]'));
    ok("S6 gagal simpan tidak mengubah stok/dokumen", JSON.stringify((await keadaan()).stok) === JSON.stringify(s0.stok));
    p.off("request", gagalkan); await p.setRequestInterception(false);
    const sebelumPatch = p.permintaan.length;
    await klik(p, '[data-testid="aksi-ISI_PEMERIKSAAN"]'); await tidur(1800);
    const patches = p.permintaan.slice(sebelumPatch).filter((r) => r.m === "PATCH" && /\/lines\//.test(r.u));
    ok("S5 Simpan hasil pemeriksaan → PATCH per baris dengan acceptedQty/rejectedQty sesuai isian", patches.length === 2 && patches.some((r) => Number(r.b.acceptedQty) === 5 && Number(r.b.rejectedQty) === 1) && patches.some((r) => Number(r.b.acceptedQty) === 2 && Number(r.b.rejectedQty) === 0), JSON.stringify(patches.map((r) => r.b)));
    const d5 = await api("gudang", "GET", `/api/inventory/goods-receipts/${ID.grA}`);
    const lb = d5.json.lines.find((l) => l.material.code === "SBX-BUSA-R50"); const ll = d5.json.lines.find((l) => l.material.code === "SBX-LEM-SRI");
    await tidur(800); ok("S5 setelah disimpan, layar menghitung dampak stok dari hasil tersimpan: 2 dus → menambah 24 pcs", /menambah 24 pcs/.test(await teksDari(p, '[data-testid="konversi-penerimaan"]')), await teksDari(p, '[data-testid="konversi-penerimaan"]'));
    ok("S5 DB: hasil pemeriksaan tersimpan, stok TETAP belum bertambah", Number(lb.acceptedQty) === 5 && Number(lb.rejectedQty) === 1 && Number(ll.acceptedQty) === 2 && JSON.stringify((await keadaan()).stok) === JSON.stringify(s0.stok));

    // perpindahan tahap sah: ARRIVED → INSPECTION → READY_FOR_PUTAWAY mengikuti aturan server
    const pindahApi = d5.json.tampilan.pipeline.pindah.map((x) => x.label).sort();
    await tunggu(p, '[data-testid="pipeline-ubah"]'); await klik(p, '[data-testid="pipeline-ubah"]');
    const pindahUi = (await p.$$eval('[data-testid="pipeline-menu"] [role="menuitem"]', (els) => els.map((e) => e.textContent.trim()))).sort();
    ok("S10 menu 'Ubah status' = persis perpindahan sah dari server (tidak ada lompatan)", JSON.stringify(pindahUi) === JSON.stringify(pindahApi), `${JSON.stringify(pindahUi)} vs ${JSON.stringify(pindahApi)}`);
    await klik(p, '[data-testid="pipeline-ubah"]');
    await klik(p, '[data-testid="aksi-MAJUKAN"]'); await tidur(1500);
    ok("S10 Lanjut tahap: ARRIVED → INSPECTION", (await keadaan()).penerimaan.find((x) => x.id === ID.grA).status === "INSPECTION");
    await klik(p, '[data-testid="aksi-MAJUKAN"]'); await tidur(1500);
    ok("S10 Lanjut tahap: INSPECTION → READY_FOR_PUTAWAY (belum menambah stok)", (await keadaan()).penerimaan.find((x) => x.id === ID.grA).status === "READY_FOR_PUTAWAY" && JSON.stringify((await keadaan()).stok) === JSON.stringify(s0.stok));
    await foto(p, "s7-siap-simpan");

    // ── S7. Simpan ke stok TEPAT SEKALI (klik ganda), lalu pengulangan permintaan
    await tunggu(p, '[data-testid="aksi-SIMPAN_KE_STOK"]');
    await p.evaluate(() => { const b = document.querySelector('[data-testid="aksi-SIMPAN_KE_STOK"]'); b.click(); b.click(); });
    await tidur(3000);
    const putaways = p.permintaan.filter((r) => /\/putaway$/.test(r.u));
    ok("S7 klik ganda Simpan ke Stok → TEPAT satu POST putaway", putaways.length === 1, `POST=${putaways.length}`);
    const s7 = await keadaan();
    ok("S7 DB: busa +5 KG (hanya barang baik), 1 pergerakan baru", saldo(s7, "SBX-BUSA-R50") === saldo(s0, "SBX-BUSA-R50") + 5 && gerak(s7, "SBX-BUSA-R50") === gerak(s0, "SBX-BUSA-R50") + 1, `busa ${saldo(s0, "SBX-BUSA-R50")}→${saldo(s7, "SBX-BUSA-R50")}`);
    ok("S7 DB: lem +24 pcs (2 BOX × 12), 1 pergerakan baru — konversi dihormati", saldo(s7, "SBX-LEM-SRI") === saldo(s0, "SBX-LEM-SRI") + 24 && gerak(s7, "SBX-LEM-SRI") === gerak(s0, "SBX-LEM-SRI") + 1, `lem ${saldo(s0, "SBX-LEM-SRI")}→${saldo(s7, "SBX-LEM-SRI")}`);
    ok("S7 DB: dokumen COMPLETED", s7.penerimaan.find((x) => x.id === ID.grA).status === "COMPLETED");
    const ulang = await api("gudang", "POST", `/api/inventory/goods-receipts/${ID.grA}/putaway`, {});
    const s7b = await keadaan();
    ok("S7 pengulangan permintaan putaway ditolak/ulang tanpa menggandakan pergerakan", JSON.stringify(s7b.stok) === JSON.stringify(s7.stok) && s7b.jurnal === s7.jurnal, `status=${ulang.status} ${JSON.stringify(ulang.json).slice(0, 120)}`);
    await foto(p, "s7-selesai");
    await p.close();

    // ── S8. Penerimaan sebagian: PO-A busa dipesan 10, tiba 6 → sisa 4, status PO sebagian
    const po8 = await api("gudang", "GET", `/api/inventory/barang-akan-datang/${ID.po.A}`);
    const lbus = po8.json.lines.find((l) => l.kode === "SBX-BUSA-R50");
    ok("S8 penerimaan sebagian: belum datang 4, masuk stok 5; PO tetap terbuka (diterima sebagian)", Number(lbus.belumDatang) === 4 && Number(lbus.masukStok) === 5 && po8.json.status === "DITERIMA_SEBAGIAN" , `belumDatang=${lbus.belumDatang} masukStok=${lbus.masukStok} status=${po8.json.status}`);
    p = await buka(browser, "gudang", `/warehouse/barang-akan-datang/${ID.po.A}`); await tunggu(p, '[data-testid="progres-item"]');
    ok("S8 layar menampilkan angka yang sama dengan server (tidak dihitung klien)", /4/.test(await teksDari(p, '[data-testid="baris-kuantitas"]')));
    await foto(p, "s8-sebagian"); await p.close();

    // ── S9. Izin: peran tanpa izin tulis tidak bisa mengubah; server menegakkan
    const patchSales = await api("sales", "PATCH", `/api/inventory/goods-receipts/${ID.grB}`, { status: "ARRIVED" });
    const patchLihat = await api("lihat", "PATCH", `/api/inventory/goods-receipts/${ID.grB}`, { status: "ARRIVED" });
    const putSales = await api("sales", "POST", `/api/inventory/goods-receipts/${ID.grB}/putaway`, {});
    const keduaBaca = await api("lihat", "GET", "/api/inventory/goods-receipts");
    ok("S9 server menolak ubah/putaway dari SALES dan peran hanya-lihat (403)", [patchSales.status, patchLihat.status, putSales.status].every((x) => x === 403), `sales=${patchSales.status} lihat=${patchLihat.status} putaway=${putSales.status} baca-lihat=${keduaBaca.status}`);
    ok("S9 status dokumen tidak berubah oleh percobaan itu", (await keadaan()).penerimaan.find((x) => x.id === ID.grB).status === "SCHEDULED");
    p = await buka(browser, "lihat", `/warehouse/goods-receipt/${ID.grB}`);
    await tidur(1500); const teksLihat = await teksDari(p, '[data-testid="fokus-penerimaan"]');
    ok("S9 UI peran hanya-lihat: tidak ada tombol aksi tulis", !(await tampak(p, '[data-testid="aksi-CATAT_TIBA"], [data-testid="aksi-BATALKAN_JADWAL"], [data-testid="aksi-UBAH_JADWAL"]')) && (await p.$$('[data-testid="aksi-dokumen"] button')).length === 0, teksLihat.slice(0, 120));
    await foto(p, "s9-lihat"); await p.close();

    U.selesai("hasil-2.json");
  } catch (e) { ok("Skenario 2 berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-2.json"); } finally { await browser.close(); }
})();
