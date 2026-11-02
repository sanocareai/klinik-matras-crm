// Skenario QA browser Fase 1 Penerimaan — alur utuh di atas backend + DB sandbox ASLI. Bukti perubahan stok/dokumen dari /qa/state (DB), payload dari permintaan jaringan nyata.
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, tidur, ok, keadaan, api, saldo, gerak, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, tanpaGulirSamping, pilihTanggalHariIni } = U;

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await keadaan();
    ok("Awal: DB sandbox siap (busa 12 KG dari PO-C, penerimaan seed ada)", saldo(s0, "SBX-BUSA-R50") === 12 && s0.penerimaan.length >= 4, `penerimaan=${s0.penerimaan.length}`);

    // ── S1. Membuka, memilih, membatalkan TIDAK mengubah stok/dokumen
    let p = await buka(browser, "gudang", "/warehouse/goods-receipt");
    ok("S1 daftar tampil: tab Perlu tindakan aktif + baris", await tampak(p, '[data-testid="tab-tindakan"][aria-selected="true"]') && (await p.$$('tr[data-testid="baris-penerimaan"]')).length >= 2);
    await klik(p, 'tr[data-testid="baris-penerimaan"]'); await tunggu(p, '[data-testid="fokus-penerimaan"]');
    ok("S1 memilih baris membuka detail (rute /:id), panel menempel", /\/warehouse\/goods-receipt\/[0-9a-f-]{36}/.test(p.url()) && await tampak(p, '[data-tempel="ya"]'));
    await klik(p, '[data-testid="fokus-tutup"]'); await tidur(300);
    await klikTeks(p, "button", "Penerimaan baru"); await tunggu(p, '[data-testid="form-penerimaan-baru"]');
    await klik(p, '[data-testid="pilih-po"]'); await tunggu(p, `[data-testid="pilih-po-${ID.po.B}"]`);
    await klik(p, `[data-testid="pilih-po-${ID.po.B}"]`);
    await foto(p, "s1-form-penerimaan-baru");
    await klikTeks(p, "button", "Batal"); await tidur(400);
    const s1 = await keadaan();
    ok("S1 buka form → pilih PO → Batal: stok, jumlah dokumen, jurnal tidak berubah", JSON.stringify(s1.stok) === JSON.stringify(s0.stok) && s1.penerimaan.length === s0.penerimaan.length && s1.jurnal === s0.jurnal && p.permintaan.length === 0, `permintaan tulis=${p.permintaan.length}`);

    // ── S2. Penerimaan baru dari PO-B: validasi kolom, kalender aplikasi, payload, klik ganda
    await klikTeks(p, "button", "Penerimaan baru"); await tunggu(p, '[data-testid="form-penerimaan-baru"]');
    await klikTeks(p, '[data-testid="buat-draf"]', "Buat draf"); await tidur(300);
    ok("S2 simpan tanpa PO → galat di kolom PO (aria-invalid), tidak ada permintaan", await tampak(p, '#gr-po[aria-invalid="true"]') && p.permintaan.length === 0, await teksDari(p, ".gud-f-galat"));
    await klik(p, '[data-testid="pilih-po"]'); await p.keyboard.type("Busa Jaya"); await tidur(300);
    await p.keyboard.press("Escape"); await tidur(200);
    await klik(p, '[data-testid="pilih-po"]'); await klik(p, `[data-testid="pilih-po-${ID.po.B}"]`);
    const kolomQty = `#gr-qty-${ID.poLine.B[0]}`;
    await isi(p, kolomQty, "50");
    ok("S2 jumlah melebihi sisa PO → galat kolom (aria-invalid) bernada jelas", await tampak(p, `${kolomQty}[aria-invalid="true"]`) && /Melebihi yang belum datang/.test(await teksDari(p, ".gud-f-galat")), await teksDari(p, ".gud-f-galat"));
    await isi(p, kolomQty, "30");
    await pilihTanggalHariIni(p, '[data-testid="tanggal-perkiraan"]');
    ok("S2 kalender aplikasi memilih tanggal (bukan input date bawaan)", !(await tampak(p, 'input[type="date"]')) && /\d{4}/.test(await teksDari(p, '[data-testid="tanggal-perkiraan"]')), await teksDari(p, '[data-testid="tanggal-perkiraan"]'));
    await foto(p, "s2-form-terisi");
    await p.evaluate(() => { const b = document.querySelector('[data-testid="buat-draf"]'); b.click(); b.click(); }); // klik ganda
    await tidur(1500);
    const tulis = p.permintaan.filter((r) => r.m === "POST" && /\/inventory\/goods-receipts$/.test(r.u));
    ok("S2 klik ganda Buat draf → TEPAT satu POST", tulis.length === 1, `POST=${tulis.length}`);
    const b2 = tulis[0]?.b;
    ok("S2 payload sesuai kontrak (purchaseOrderId, expectedDate, baris PO + jumlah angka)", b2?.purchaseOrderId === ID.po.B && /^\d{4}-\d{2}-\d{2}$/.test(b2?.expectedDate ?? "") && b2?.lines?.length === 1 && b2.lines[0].purchaseOrderLineId === ID.poLine.B[0] && b2.lines[0].orderedQty === 30, JSON.stringify(b2));
    const s2 = await keadaan();
    ok("S2 draf dibuat (+1 dokumen DRAFT), stok TIDAK berubah", s2.penerimaan.length === s0.penerimaan.length + 1 && JSON.stringify(s2.stok) === JSON.stringify(s0.stok));
    const grB = s2.penerimaan.find((x) => x.purchaseOrderId === ID.po.B);
    ok("S2 status dokumen baru = DRAFT", grB?.status === "DRAFT", grB?.status);
    await p.close();
    ID.grB = grB.id;

    // ── S3. Penjadwalan: Jadwalkan (DRAFT → SCHEDULED), stok tetap
    p = await buka(browser, "gudang", `/warehouse/goods-receipt/${ID.grB}`);
    await tunggu(p, '[data-testid="aksi-JADWALKAN"]');
    await klik(p, '[data-testid="aksi-JADWALKAN"]'); await tidur(1200);
    const s3 = await keadaan();
    ok("S3 Jadwalkan: status SCHEDULED, stok sama", s3.penerimaan.find((x) => x.id === ID.grB)?.status === "SCHEDULED" && JSON.stringify(s3.stok) === JSON.stringify(s0.stok));
    await foto(p, "s3-terjadwal");
    await p.close();

    U.selesai("hasil-1.json");
  } catch (e) { ok("Skenario berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-1.json"); } finally { await browser.close(); }
})();
