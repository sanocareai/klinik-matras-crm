// Skenario 3 — Retur Supplier (daftar, form, rincian, konfirmasi), pembatalan/koreksi/jadwal, penerimaan tanpa PO, keadaan kosong/gagal, keyboard, HP, terang/gelap.
const fs = require("fs"); const path = require("path");
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, T, API, tidur, ok, keadaan, api, saldo, gerak, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, pilihTanggalHariIni, tanpaGulirSamping } = U;
const OUT = process.env.OUT || "C:/tmp/gud-qa/db";
const PNG = path.join(OUT, "bukti.png");
fs.writeFileSync(PNG, Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFUlEQVR42mP8z8Dwn4EIwDiqkL4KAcT9GO0U4BxoAAAAAElFTkSuQmCC", "base64"));

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await keadaan();
    const grA = s0.penerimaan.find((x) => x.purchaseOrderId === ID.po.A); const grC = s0.penerimaan.find((x) => x.id === ID.gr.C);
    // ── S11. Retur Supplier: daftar → form → pratinjau → draf → rincian → konfirmasi barang keluar
    let p = await buka(browser, "gudang", "/warehouse/retur-supplier");
    ok("S11 daftar retur: keadaan kosong jujur + tombol Retur baru", await tampak(p, '[data-testid="retur-kosong"]') && await tampak(p, '[data-testid="buat-retur"]'));
    await foto(p, "s11-retur-kosong");
    await klik(p, '[data-testid="buat-retur"]'); await tunggu(p, '[data-testid="pilih-po-retur"]');
    await klik(p, '[data-testid="pilih-po-retur"]'); await klik(p, `[data-testid="pilih-po-retur-${ID.po.C}"]`); await tunggu(p, '[data-testid="baris-kandidat"]');
    ok("S11 PO dipilih lewat pemilih aplikasi; kandidat = barang yang SUDAH masuk stok, boleh diretur 12", /boleh diretur 12/.test(await teksDari(p, '[data-testid="baris-kandidat"]')), await teksDari(p, '[data-testid="baris-kandidat"]'));
    const kolomRetur = `input[aria-label^="Jumlah retur SBX-BUSA-R50"]`;
    await isi(p, kolomRetur, "3");
    await p.type('input[placeholder="mis. busa pecah-pecah saat dibongkar"]', "Busa pecah-pecah saat dibongkar");
    ok("S11 tanpa foto bukti: Pratinjau dinonaktifkan dengan alasan", await p.evaluate(() => document.querySelector('[data-testid="pratinjau-retur"]').disabled) && /foto bukti/i.test(await teksDari(p, '[data-testid="galat-retur"]')), await teksDari(p, '[data-testid="galat-retur"]'));
    await (await p.$('input[type="file"][aria-label="Pilih foto bukti"]')).uploadFile(PNG); await tidur(2500);
    await foto(p, "s11-form-retur");
    await klik(p, '[data-testid="pratinjau-retur"]'); await tunggu(p, '[data-testid="hasil-pratinjau"]');
    ok("S11 pratinjau dari server: 'boleh'; stok belum berubah", /boleh/.test(await teksDari(p, '[data-testid="hasil-pratinjau"]')) && JSON.stringify((await keadaan()).stok) === JSON.stringify(s0.stok), await teksDari(p, '[data-testid="hasil-pratinjau"]'));
    const sebelum = p.permintaan.length;
    await p.evaluate(() => { const b = document.querySelector('[data-testid="simpan-retur"]'); b.click(); b.click(); });
    await tidur(2500);
    const buat = p.permintaan.slice(sebelum).filter((r) => r.m === "POST" && /\/retur-supplier$/.test(r.u));
    ok("S11 klik ganda Buat Draf Retur → TEPAT satu POST dengan Idempotency-Key", buat.length === 1 && !!buat[0].h["idempotency-key"], `POST=${buat.length}`);
    ok("S11 payload retur: reasonCode, reason, evidenceUrls, baris (goodsReceiptLineId, qty angka)", buat[0]?.b?.reasonCode === "RUSAK" && buat[0].b.evidenceUrls?.length === 1 && buat[0].b.lines?.length === 1 && buat[0].b.lines[0].goodsReceiptLineId === ID.line.C && buat[0].b.lines[0].qty === 3, JSON.stringify(buat[0]?.b).slice(0, 300));
    const s11a = await keadaan();
    ok("S11 draf retur TIDAK mengurangi stok (barang belum keluar)", saldo(s11a, "SBX-BUSA-R50") === saldo(s0, "SBX-BUSA-R50"), `busa=${saldo(s11a, "SBX-BUSA-R50")}`);
    await tunggu(p, '[data-testid="aksi-keluar"]'); await foto(p, "s11-detail-retur-draf");
    await klik(p, '[data-testid="aksi-keluar"]'); await tunggu(p, '[data-testid="form-keluar"]');
    ok("S11 konfirmasi keluar dinonaktifkan sampai PIC diisi", await p.evaluate(() => document.querySelector('[data-testid="kirim-keluar"]').disabled));
    await p.type('input[aria-label="PIC yang menyerahkan"]', "Budi Gudang");
    ok("S11 tanggal barang keluar memakai kalender aplikasi", await tampak(p, '[data-testid="tanggal-keluar"]') && !(await tampak(p, 'input[type="date"]')));
    const sebelum2 = p.permintaan.length;
    await p.evaluate(() => { const b = document.querySelector('[data-testid="kirim-keluar"]'); b.click(); b.click(); });
    await tidur(3000);
    const keluar = p.permintaan.slice(sebelum2).filter((r) => r.m === "POST" && /\/keluar$/.test(r.u));
    ok("S11 klik ganda Konfirmasi Barang Keluar → TEPAT satu POST", keluar.length === 1, `POST=${keluar.length}`);
    const s11b = await keadaan();
    ok("S11 DB: stok busa berkurang TEPAT 3 KG, 1 pergerakan baru (retur setelah masuk stok)", saldo(s11b, "SBX-BUSA-R50") === saldo(s0, "SBX-BUSA-R50") - 3 && gerak(s11b, "SBX-BUSA-R50") === gerak(s0, "SBX-BUSA-R50") + 1, `busa ${saldo(s0, "SBX-BUSA-R50")}→${saldo(s11b, "SBX-BUSA-R50")}`);
    await foto(p, "s11-retur-keluar");
    ok("S11 Gudang tidak melihat nilai rupiah di retur", !/Rp\s?\d/.test(await teksDari(p, "body")));
    await p.close();
    // Finance TIDAK berubah: halaman Finance memakai komponen lama (tanpa kelas Gudang)
    p = await buka(browser, "finance", "/finance/retur-supplier").catch(() => null);
    if (p) { await tidur(1200); ok("S11 Finance: tampilan Retur memakai tata letak lama (tanpa kelas gud-*)", !(await tampak(p, ".gud-halaman, .gud-panel, .gud-kartu")), p.url()); await foto(p, "s11-finance-retur"); await p.close(); }

    // ── S12. Pembatalan, pemulihan, ubah jadwal, koreksi (hanya pratinjau), catatan & riwayat
    const sA = await keadaan();
    p = await buka(browser, "gudang", `/warehouse/goods-receipt/${ID.gr.draf}`);
    await klik(p, '[data-testid="aksi-BATALKAN_JADWAL"]'); await tunggu(p, '[data-testid="panel-BATALKAN_JADWAL"]');
    ok("S12 Batalkan penerimaan: tombol konfirmasi nonaktif sampai alasan terisi (field wajib)", await p.evaluate(() => document.querySelector('[data-testid="kirim-BATALKAN_JADWAL"]').disabled));
    await foto(p, "s12-batal-panel");
    await p.type('[data-testid="bidang-alasan"]', "Salah buat dokumen");
    await klik(p, '[data-testid="kirim-BATALKAN_JADWAL"]'); await tidur(1800);
    let s12 = await keadaan();
    ok("S12 dibatalkan: status REJECTED, stok TIDAK berubah", s12.penerimaan.find((x) => x.id === ID.gr.draf).status === "REJECTED" && JSON.stringify(s12.stok) === JSON.stringify(sA.stok));
    await tunggu(p, '[data-testid="aksi-PULIHKAN"]'); await klik(p, '[data-testid="aksi-PULIHKAN"]'); await tunggu(p, '[data-testid="panel-PULIHKAN"]');
    await p.type('[data-testid="bidang-alasan"]', "Ternyata masih dipakai"); await klik(p, '[data-testid="kirim-PULIHKAN"]'); await tidur(1800);
    s12 = await keadaan();
    ok("S12 dipulihkan ke DRAFT; stok tetap", s12.penerimaan.find((x) => x.id === ID.gr.draf).status === "DRAFT" && JSON.stringify(s12.stok) === JSON.stringify(sA.stok));
    ok("S12 catatan & riwayat: lipatan Riwayat berisi jejak pembatalan dan pemulihan", /catatan/.test(await teksDari(p, '[data-testid="jejak-dokumen"] summary')) && (await p.$$eval('[data-testid="jejak-baris"]', (e) => e.length)) >= 2);
    await p.close();

    p = await buka(browser, "gudang", `/warehouse/goods-receipt/${ID.gr.jadwal}`);
    await klik(p, '[data-testid="aksi-UBAH_JADWAL"]'); await tunggu(p, '[data-testid="panel-UBAH_JADWAL"]');
    await klik(p, '[data-testid="bidang-tanggal"]'); await klikTeks(p, "button", "Hari ini"); await tidur(200);
    await foto(p, "s12-ubah-jadwal");
    const sebelum3 = p.permintaan.length; await klik(p, '[data-testid="kirim-UBAH_JADWAL"]'); await tidur(1600);
    const pj = p.permintaan.slice(sebelum3).find((r) => r.m === "PATCH");
    ok("S12 Ubah jadwal: PATCH expectedDate dari kalender + revisi (kontrak konflik revisi)", /^\d{4}-\d{2}-\d{2}$/.test(pj?.b?.expectedDate ?? "") && !!pj.b.revisi, JSON.stringify(pj?.b));
    await p.close();

    p = await buka(browser, "gudang", `/warehouse/goods-receipt/${grA.id}`);
    await tunggu(p, '[data-testid="aksi-KOREKSI_KEDATANGAN"]'); await klik(p, '[data-testid="aksi-KOREKSI_KEDATANGAN"]');
    await tunggu(p, '[data-testid="lihat-dampak"]'); await foto(p, "s12-koreksi-kedatangan");
    const sebelum4 = p.permintaan.length;
    await klik(p, '[data-testid="panel-kembali"]'); await tidur(500);
    ok("S12 membuka lalu menutup Koreksi Kedatangan: tidak ada penulisan, stok tetap", p.permintaan.slice(sebelum4).length === 0 && JSON.stringify((await keadaan()).stok) === JSON.stringify(sA.stok));
    await p.close();

    // ── S13. Penerimaan tanpa PO + pemilih bahan (kolom cari) + keyboard
    p = await buka(browser, "gudang", "/warehouse/goods-receipt");
    await klikTeks(p, "button", "Penerimaan baru"); await tunggu(p, '[data-testid="form-penerimaan-baru"]');
    await klik(p, '[data-testid="mode-manual"]'); await tunggu(p, '[data-testid="peringatan-tanpa-po"]');
    await klik(p, '[data-testid="pilih-bahan-0"]'); await tunggu(p, '.gud-menu-cari input'); await p.keyboard.type("Paku 3"); await tidur(300);
    const daftarCari = await p.$$eval(".gud-menu-item", (e) => e.map((x) => x.textContent.trim()));
    ok("S13 pemilih bahan punya kolom cari: 'Paku 3' menyaring (Paku 3, 30?) tanpa menampilkan bahan lain", daftarCari.length >= 1 && daftarCari.every((t) => /Paku 3/.test(t)), JSON.stringify(daftarCari));
    await p.keyboard.press("ArrowDown"); await p.keyboard.press("Enter"); await tidur(300);
    ok("S13 keyboard: ↓ lalu Enter memilih bahan", /Paku 3/.test(await teksDari(p, '[data-testid="pilih-bahan-0"]')), await teksDari(p, '[data-testid="pilih-bahan-0"]'));
    await p.type('input[aria-label="Jumlah baris 1"]', "9");
    await p.type("#gr-supplier", "Toko Paku (sandbox)");
    await klik(p, '[data-testid="buat-draf"]'); await tidur(1800);
    const manual = p.permintaan.find((r) => r.m === "POST" && /goods-receipts$/.test(r.u));
    ok("S13 payload tanpa PO: sourceType, supplier, baris {materialId, orderedQty}", manual?.b?.sourceType === "SUPPLIER_DELIVERY" && manual.b.supplier === "Toko Paku (sandbox)" && manual.b.lines?.length === 1 && Number(manual.b.lines[0].orderedQty) === 9 && !manual.b.purchaseOrderId, JSON.stringify(manual?.b).slice(0, 260));
    const s13 = await keadaan();
    ok("S13 draf tanpa PO terbentuk; stok tetap", s13.penerimaan.length === sA.penerimaan.length + 1 && JSON.stringify(s13.stok) === JSON.stringify(sA.stok));
    await p.close();

    // keadaan kosong, gagal, keyboard daftar
    p = await buka(browser, "gudang", "/warehouse/goods-receipt");
    await p.type('input[aria-label="Cari penerimaan"]', "zzzz-tidak-ada"); await tidur(500);
    ok("S13 keadaan kosong saat tak ada yang cocok + tombol Reset saringan", await tampak(p, '[data-testid="daftar-kosong"]') && /Tidak ada penerimaan yang cocok/.test(await teksDari(p, '[data-testid="daftar-kosong"]')));
    await foto(p, "s13-kosong");
    await klikTeks(p, '[data-testid="daftar-kosong"] button', "Reset"); await tidur(400);
    ok("S13 Reset mengembalikan daftar", (await p.$$('tr[data-testid="baris-penerimaan"]')).length >= 1);
    await p.focus('tr[data-testid="baris-penerimaan"] a'); await p.keyboard.press("Enter"); await tidur(900);
    ok("S13 keyboard: Enter pada nomor dokumen membuka detail", /\/warehouse\/goods-receipt\/[0-9a-f-]{36}/.test(p.url()), p.url());
    await p.close();
    p = await buka(browser, "gudang", "/warehouse/goods-receipt");
    await p.setRequestInterception(true); p.on("request", (r) => { if (r.method() === "GET" && /\/inventory\/goods-receipts$/.test(r.url().replace(/\?.*/, ""))) r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulasi server gagal" }) }); else r.continue(); });
    await p.reload({ waitUntil: "networkidle2" }); await tidur(900);
    ok("S13 keadaan gagal muat: pesan galat terlihat, halaman tidak runtuh", await tampak(p, ".gud-galat") && /Simulasi server gagal/.test(await teksDari(p, ".gud-galat")) && p.galat.length === 0, `${await teksDari(p, ".gud-galat")} | ${p.galat.join(";")}`);
    await foto(p, "s13-gagal"); await p.close();

    // ── S14. HP (390), jendela fokus (1100), terang/gelap: tanpa gulir samping, tangkapan layar untuk dibuka
    for (const [nama, rute, lebar, tema, hp] of [["hp-daftar", "/warehouse/goods-receipt", 390, "light", true], ["hp-detail", `/warehouse/goods-receipt/${grA.id}`, 390, "light", true], ["hp-bad", `/warehouse/barang-akan-datang/${ID.po.B}`, 390, "light", true], ["fokus-1100", `/warehouse/goods-receipt/${grA.id}`, 1100, "light", false], ["gelap-daftar", "/warehouse/goods-receipt", 1440, "dark", false], ["gelap-detail", `/warehouse/goods-receipt/${ID.gr.siap}`, 1440, "dark", false]]) {
      const q = await buka(browser, "gudang", rute, { lebar, tema, hp, tinggi: hp ? 844 : 900 }); await tidur(900);
      ok(`S14 ${nama}: tanpa gulir samping, tanpa galat konsol`, await U.tanpaGulirSamping(q) && q.galat.length === 0, q.galat.join(";"));
      await foto(q, `s14-${nama}`); await q.close();
    }
    // formulir di HP dan gelap
    p = await buka(browser, "gudang", "/warehouse/goods-receipt", { lebar: 390, hp: true, tinggi: 844 });
    await klikTeks(p, "button", "Penerimaan baru"); await tunggu(p, '[data-testid="form-penerimaan-baru"]'); await klik(p, '[data-testid="mode-manual"]'); await tidur(300);
    ok("S14 form Penerimaan baru di HP: tanpa gulir samping", await U.tanpaGulirSamping(p)); await foto(p, "s14-hp-form"); await p.close();
    p = await buka(browser, "gudang", "/warehouse/goods-receipt", { tema: "dark" });
    await klikTeks(p, "button", "Penerimaan baru"); await tunggu(p, '[data-testid="form-penerimaan-baru"]'); await klik(p, '[data-testid="pilih-po"]'); await tidur(400); await foto(p, "s14-gelap-form"); await p.close();

    U.selesai("hasil-3.json");
  } catch (e) { ok("Skenario 3 berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-3.json"); } finally { await browser.close(); }
})();
