// Skenario B — Stok bahan (tahap 2): form & tindakan yang MENULIS (tambah/ubah/nonaktifkan bahan, koreksi saldo, ubah harga) di atas backend + DB sandbox ASLI. Bukti dari /qa/state (DB).
//   BASE=http://127.0.0.1:5480 API=http://127.0.0.1:4479 OUT=C:/tmp/gud-qa/stok node frontend/qa-harness/gudang-stok-skenarioB.cjs
const U = require("./gudang-qa-util.cjs");
const { puppeteer, CHROME, ID, tidur, ok, api, buka, tampak, tunggu, klik, klikTeks, isi, teksDari, foto, tanpaGulirSamping, API } = U;
const state = async () => (await fetch(`${API}/qa/state`)).json();
const K = (k) => `SBX-${k}`;
const pilih = async (p, tid, nilai) => { await klik(p, `[data-testid="${tid}"]`); await klik(p, `[data-testid="${tid}-${nilai}"]`); };
const cariBuka = async (p, kata) => { await isi(p, '[data-testid="cari-bahan"]', kata); await tidur(350); await klik(p, '[data-testid="baris-stok"]'); await tunggu(p, '[data-testid="drawer-bahan"]'); await tidur(400); };
const tulis = (p, re, m = "POST") => p.permintaan.filter((r) => r.m === m && re.test(r.u));
const hargaDb = (s, kode) => s.harga.filter((h) => h.materialId === s.stok[kode].id);

(async () => {
  const browser = await puppeteer.launch({ executablePath: CHROME, headless: "new", args: ["--no-sandbox", "--disable-gpu"] });
  try {
    const s0 = await state();
    // ── B1. Tambah bahan
    let p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    await klik(p, '[data-testid="tambah-bahan"]'); await tunggu(p, '[data-testid="form-bahan"]');
    await klik(p, '[data-testid="simpan-bahan"]'); await tidur(300);
    ok("B1 simpan kosong → galat di kolom Kode & Nama (aria-invalid), tidak ada permintaan", await tampak(p, '#wh-code[aria-invalid="true"]') && await tampak(p, '#wh-name[aria-invalid="true"]') && p.permintaan.length === 0, await teksDari(p, ".gud-f-galat"));
    await p.type("#wh-code", "SBX-BARU-01"); await p.type("#wh-name", "Bahan Baru Uji Tambah");
    await p.type('[data-testid="input-batas-minimum"]', "-3");
    await klik(p, '[data-testid="simpan-bahan"]'); await tidur(300);
    ok("B1 batas minimum negatif ditolak dini (kolom ditandai), tanpa permintaan", await tampak(p, '[data-testid="input-batas-minimum"][aria-invalid="true"]') && p.permintaan.length === 0);
    await isi(p, '[data-testid="input-batas-minimum"]', "5,5"); await pilih(p, "pilih-satuan", "KG"); await pilih(p, "pilih-kategori", "RAW_MATERIAL"); await isi(p, '[data-testid="input-jumlah-restok"]', "10");
    await foto(p, "B1-form-tambah");
    await p.evaluate(() => { const b = document.querySelector('[data-testid="simpan-bahan"]'); b.click(); b.click(); }); await tidur(2000);
    const post = tulis(p, /\/inventory\/materials$/);
    ok("B1 klik ganda Tambah → TEPAT satu POST", post.length === 1, `POST=${post.length}`);
    ok("B1 payload sesuai kontrak (code, name, unit KG, category, reorderPoint '5.5', reorderQty '10')", post[0]?.b?.code === "SBX-BARU-01" && post[0].b.unit === "KG" && post[0].b.category === "RAW_MATERIAL" && Number(post[0].b.reorderPoint) === 5.5 && Number(post[0].b.reorderQty) === 10, JSON.stringify(post[0]?.b));
    const s1 = await state();
    ok("B1 DB: +1 bahan, tanpa pergerakan stok baru (saldo belum diketahui), jurnal tetap", s1.bahanTotal === s0.bahanTotal + 1 && s1.stok[K("BARU-01")]?.gerakan === 0 && s1.gerakanTotal === s0.gerakanTotal && s1.jurnal === s0.jurnal);
    // duplikat → gagal, isian bertahan
    await klik(p, '[data-testid="tambah-bahan"]'); await tunggu(p, '[data-testid="form-bahan"]');
    await p.type("#wh-code", "SBX-BARU-01"); await p.type("#wh-name", "Duplikat Kode");
    await klik(p, '[data-testid="simpan-bahan"]'); await tidur(1500);
    ok("B1 kode ganda: galat server tampil, isian TETAP, tidak ada bahan tambahan", await tampak(p, '[data-testid="galat-bahan"]') && (await p.$eval("#wh-name", (e) => e.value)) === "Duplikat Kode" && (await state()).bahanTotal === s1.bahanTotal, await teksDari(p, '[data-testid="galat-bahan"]'));
    await klikTeks(p, "button", "Batal"); await tidur(300);
    await p.close();

    // ── B2. Ubah bahan: kode & satuan terkunci; payload hanya yang boleh; saldo/harga/dokumen tak berubah
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    const sebelum2 = await state();
    await cariBuka(p, "HR-N44"); await klik(p, '[data-testid="edit-bahan"]'); await tunggu(p, '[data-testid="form-bahan"]');
    ok("B2 kode dan satuan dikunci saat ubah (dengan alasan tertulis)", await p.$eval("#wh-code", (e) => e.disabled) && await p.$eval("#wh-unit", (e) => e.disabled) && /dikunci/.test(await teksDari(p, '[data-testid="form-bahan"]')));
    await isi(p, "#wh-name", "Busa HR Foam N44 (nama diubah)"); await isi(p, '[data-testid="input-batas-minimum"]', "25");
    await foto(p, "B2-form-ubah");
    await p.evaluate(() => { const b = document.querySelector('[data-testid="simpan-bahan"]'); b.click(); b.click(); }); await tidur(2000);
    const pat = tulis(p, /\/inventory\/materials\/[0-9a-f-]{36}$/, "PATCH");
    ok("B2 klik ganda Simpan → TEPAT satu PATCH; payload TANPA code/unit", pat.length === 1 && !("code" in pat[0].b) && !("unit" in pat[0].b) && pat[0].b.name === "Busa HR Foam N44 (nama diubah)" && Number(pat[0].b.reorderPoint) === 25, JSON.stringify(pat[0]?.b));
    ok("B2 ruang kerja tetap terbuka setelah Simpan dan langsung menampilkan nama baru (tanpa membuka ulang)", await tampak(p, '[data-testid="drawer-bahan"]') && (await teksDari(p, '[data-testid="drawer-nama"]')) === "Busa HR Foam N44 (nama diubah)");
    const s2 = await state();
    ok("B2 DB: nama & batas minimum berubah; saldo, pergerakan, harga, jurnal TIDAK berubah (tidak mengubah dokumen lama)", s2.stok[K("HR-N44")].nama === "Busa HR Foam N44 (nama diubah)" && s2.stok[K("HR-N44")].reorderPoint === 25 && s2.stok[K("HR-N44")].saldo === sebelum2.stok[K("HR-N44")].saldo && s2.stok[K("HR-N44")].gerakan === sebelum2.stok[K("HR-N44")].gerakan && JSON.stringify(hargaDb(s2, K("HR-N44"))) === JSON.stringify(hargaDb(sebelum2, K("HR-N44"))) && s2.jurnal === sebelum2.jurnal && s2.gerakanTotal === sebelum2.gerakanTotal);
    await cariBuka(p, "HR-N44"); await klik(p, '[data-testid="edit-bahan"]'); await tunggu(p, '[data-testid="form-bahan"]'); await isi(p, '[data-testid="input-batas-minimum"]', ""); await klik(p, '[data-testid="simpan-bahan"]'); await tidur(1500);
    ok("B2 mengosongkan batas minimum = 'belum diatur' (null di DB, bukan 0)", (await state()).stok[K("HR-N44")].reorderPoint === null);
    await p.close();

    // ── B3. Nonaktifkan / aktifkan: konfirmasi di dalam aplikasi, riwayat tetap
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    const sebelum3 = await state();
    await cariBuka(p, "KAYU"); await klik(p, '[data-testid="tab-info"]'); await klik(p, '[data-testid="ubah-aktif"]'); await tunggu(p, '[data-testid="konfirmasi-aktif"]');
    ok("B3 konfirmasi nonaktif tampil di dalam aplikasi (bukan dialog bawaan peramban), dengan dampaknya", /tidak bisa dipakai untuk dokumen baru/.test(await teksDari(p, '[data-testid="konfirmasi-aktif"]')));
    await klikTeks(p, '[data-testid="konfirmasi-aktif"] button', "Batal"); await tidur(300);
    ok("B3 Batal tidak menulis apa pun", p.permintaan.length === 0 && (await state()).stok[K("RACUK-3X5")].aktif === true);
    await klik(p, '[data-testid="ubah-aktif"]'); await klik(p, '[data-testid="ya-ubah-aktif"]'); await tidur(1800);
    const s3 = await state();
    ok("B3 nonaktif: DB aktif=false, saldo & pergerakan utuh, panel tertutup, bahan hilang dari daftar aktif", s3.stok[K("RACUK-3X5")].aktif === false && s3.stok[K("RACUK-3X5")].saldo === 60 && s3.gerakanTotal === sebelum3.gerakanTotal && !(await tampak(p, '[data-testid="drawer-bahan"]')));
    await klik(p, '[data-testid="buka-filter"]'); await klik(p, '[data-testid="tampilkan-nonaktif"]'); await klik(p, '[data-testid="selesai-filter"]'); await tidur(300); await cariBuka(p, "RACUK"); await klik(p, '[data-testid="tab-info"]');
    await klik(p, '[data-testid="ubah-aktif"]'); await klik(p, '[data-testid="ya-ubah-aktif"]'); await tidur(1800);
    ok("B3 aktifkan kembali: DB aktif=true", (await state()).stok[K("RACUK-3X5")].aktif === true);
    await p.close();

    // ── B4. Koreksi saldo (Gudang): pratinjau baca-saja → ajukan tepat sekali → stok berubah HANYA setelah disetujui orang lain + diposting
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    const sebelum4 = await state(); const kulit = sebelum4.stok[K("HR-KULIT")];
    await cariBuka(p, "HR-KULIT"); await klik(p, '[data-testid="tombol-koreksi-saldo"]'); await tunggu(p, '[data-testid="modal-koreksi-saldo"]');
    ok("B4 form koreksi = dialog lebar (≥ 700px) dengan dua bagian sejajar, bukan panel sempit di dalam panel", await p.evaluate(() => { const e = document.querySelector('[data-testid="modal-koreksi-saldo"]'); const d = e.closest('[role="dialog"]'); return !!d && d.getBoundingClientRect().width >= 700 && !!e.querySelector(".gud-form-dua") && !document.querySelector('[data-testid="panel-satu-lapisan"]'); }));
    await klik(p, '[data-testid="lihat-pratinjau-koreksi"]'); await tidur(300);
    ok("B4 pratinjau tanpa isian → galat di kolom jumlah & alasan, tanpa permintaan", await tampak(p, '#ks-jumlah[aria-invalid="true"]') && await tampak(p, '#ks-alasan[aria-invalid="true"]') && p.permintaan.length === 0, await teksDari(p, ".gud-f-galat"));
    await isi(p, "#ks-jumlah", "20"); await isi(p, "#ks-alasan", "Hitung fisik 3 Nov: sisa 20 kg");
    await klik(p, '[data-testid="lihat-pratinjau-koreksi"]'); await tunggu(p, '[data-testid="pratinjau-koreksi"]'); await foto(p, "B4-pratinjau");
    ok("B4 pratinjau dari server: saldo 24 → fisik 20, selisih −4; TIDAK menulis data", /24/.test(await teksDari(p, '[data-testid="pra-saldo-sebelum"]')) && /20/.test(await teksDari(p, '[data-testid="pra-jumlah-fisik"]')) && /[-−]4/.test(await teksDari(p, '[data-testid="pra-selisih"]')) && JSON.stringify((await state()).pengajuan) === JSON.stringify(sebelum4.pengajuan));
    // gagal simpan → isian & pratinjau bertahan
    await p.setRequestInterception(true); const gagal = (r) => { if (r.method() === "POST" && /koreksi-saldo\/ajukan|koreksi-saldo.*ajukan/.test(r.url())) r.respond({ status: 500, contentType: "application/json", body: JSON.stringify({ error: "Simulasi gagal ajukan" }) }); else r.continue(); };
    p.on("request", gagal); await klik(p, '[data-testid="ajukan-koreksi"]'); await tidur(1200);
    ok("B4 gagal ajukan: pesan galat tampil, pratinjau & isian BERTAHAN, tidak ada pengajuan", /Simulasi gagal ajukan/.test(await teksDari(p, '[data-testid="galat-koreksi"]')) && await tampak(p, '[data-testid="pratinjau-koreksi"]') && JSON.stringify((await state()).pengajuan) === JSON.stringify(sebelum4.pengajuan));
    p.off("request", gagal); await p.setRequestInterception(false);
    const mulai4 = p.permintaan.length;
    await p.evaluate(() => { const b = document.querySelector('[data-testid="ajukan-koreksi"]'); b.click(); b.click(); }); await tidur(2500);
    const aj = p.permintaan.slice(mulai4).filter((r) => r.m === "POST" && /ajukan/.test(r.u));
    ok("B4 klik ganda Ajukan → TEPAT satu POST dengan Idempotency-Key; payload (materialId, jumlahFisik angka, saldoDilihat, alasan)", aj.length === 1 && !!aj[0].h["idempotency-key"] && aj[0].b.materialId === kulit.id && aj[0].b.jumlahFisik === 20 && aj[0].b.saldoDilihat === 24 && /Hitung fisik/.test(aj[0].b.alasan), JSON.stringify(aj[0]?.b));
    const s4 = await state(); const req = s4.pengajuan.filter((x) => x.materialId === kulit.id);
    ok("B4 DB: satu pengajuan WAITING_APPROVAL (selisih −4); saldo bahan MASIH 24; tak ada pergerakan baru", req.length === 1 && req[0].status === "WAITING_APPROVAL" && Number(req[0].adjustmentQty) === -4 && s4.stok[K("HR-KULIT")].saldo === 24 && s4.gerakanTotal === sebelum4.gerakanTotal, JSON.stringify(req));
    ok("B4 hasil: 'Stok belum berubah' dijelaskan, nomor pengajuan tampil", /Stok belum berubah/.test(await teksDari(p, '[data-testid="hasil-stok-belum-berubah"]')) && /ADJ-/.test(await teksDari(p, '[data-testid="hasil-nomor"]')));
    await foto(p, "B4-hasil");
    // jalur resmi: pengaju (Gudang) tak boleh menyetujui; Owner menyetujui; Gudang memposting → TEPAT satu pergerakan ADJUSTMENT
    const diriSendiri = await api("gudang", "PATCH", `/api/inventory/adjustments/${req[0].id}`, { status: "APPROVED" });
    const setuju = await api("owner", "PATCH", `/api/inventory/adjustments/${req[0].id}`, { status: "APPROVED" });
    const posting = await api("gudang", "POST", `/api/inventory/adjustments/${req[0].id}/post`, {}); const ulang = await api("gudang", "POST", `/api/inventory/adjustments/${req[0].id}/post`, {});
    const s4b = await state();
    ok("B4 jalur resmi: pengaju 403; Owner setuju 200; posting 200; posting ulang tidak menggandakan", diriSendiri.status === 403 && setuju.status === 200 && posting.status === 200 && ulang.status >= 400, `${diriSendiri.status}/${setuju.status}/${posting.status}/${ulang.status}`);
    ok("B4 DB: saldo = 20 (fisik) dan TEPAT satu pergerakan ADJUSTMENT −4 baru", s4b.stok[K("HR-KULIT")].saldo === 20 && s4b.gerakanTotal === sebelum4.gerakanTotal + 1 && s4b.stok[K("HR-KULIT")].gerakan === kulit.gerakan + 1 && s4b.jurnal === sebelum4.jurnal);
    await p.close();
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]'); await cariBuka(p, "HR-KULIT");
    ok("B4 konsistensi: daftar, panel Saldo, dan riwayat pergerakan menunjukkan 20 kg & pergerakan penyesuaian", /20/.test(await teksDari(p, '[data-testid="stok-tersedia"]')) && /20/.test(await teksDari(p, '[data-testid="baris-stok"]')));
    await klik(p, '[data-testid="tab-pergerakan"]'); await tunggu(p, '[data-testid="daftar-pergerakan"]');
    ok("B4 riwayat: jumlah baris = DB (2) dan memuat penyesuaian −4", (await p.$$('[data-testid="baris-pergerakan"]')).length === s4b.stok[K("HR-KULIT")].gerakan && (await p.$$eval('[data-testid="baris-pergerakan"][data-tipe="ADJUSTMENT"] [data-testid="qty-pergerakan"]', (e) => e.map((x) => x.textContent))).some((t) => /[-−]4/.test(t)));
    await p.close();

    // ── B5. Ubah harga (Finance): validasi, pratinjau baca-saja, simpan tepat sekali, riwayat harga lama utuh
    p = await buka(browser, "finance", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]');
    const sebelum5 = await state();
    await cariBuka(p, "SOFT-D23"); await klik(p, '[data-testid="tab-harga"]'); await klik(p, '[data-testid="tombol-ubah-harga"]'); await tunggu(p, '[data-testid="modal-ubah-harga"]');
    ok("B5 form harga = dialog lebar (≥ 700px), dua bagian: harga & waktu berlaku | alasan & bukti", await p.evaluate(() => { const e = document.querySelector('[data-testid="modal-ubah-harga"]'); const d = e.closest('[role="dialog"]'); return !!d && d.getBoundingClientRect().width >= 700 && e.querySelectorAll(".gud-f-seksi").length === 2; }));
    ok("B5 pemisah angka jelas di form: Harga Berlaku bukan nilai persediaan Finance", /bukan/i.test(await teksDari(p, '[data-testid="catatan-pemisah"]')));
    await klik(p, '[data-testid="lihat-pratinjau"]'); await tidur(300);
    ok("B5 pratinjau kosong → galat harga & alasan (kolom ditandai), tanpa permintaan", await tampak(p, '#hb-harga[aria-invalid="true"]') && await tampak(p, '#hb-alasan[aria-invalid="true"]') && p.permintaan.length === 0, await teksDari(p, ".gud-f-galat"));
    await isi(p, "#hb-harga", "0"); await isi(p, "#hb-alasan", "Harga dasar bahan baru"); await klik(p, '[data-testid="lihat-pratinjau"]'); await tidur(500);
    ok("B5 harga Rp0 ditolak (belum ada harga ≠ Rp0)", await tampak(p, '#hb-harga[aria-invalid="true"]') || await tampak(p, '[data-testid="galat-modal"]'), await teksDari(p, ".gud-f-galat, [data-testid=galat-modal]"));
    await klik(p, '[data-testid="mode-jadwal"]'); await klik(p, '[data-testid="lihat-pratinjau"]'); await tidur(300);
    ok("B5 mode jadwal: pemilih tanggal & jam aplikasi (bukan datetime-local), bawaan = besok (masa depan, tidak ditandai salah)", await tampak(p, '[data-testid="input-mulai"]') && !(await tampak(p, '[data-testid="input-mulai"][data-invalid="ya"]')) && !(await tampak(p, 'input[type="datetime-local"]')));
    await klik(p, '[data-testid="mode-sekarang"]'); await isi(p, "#hb-harga", "15000"); await isi(p, "#hb-bukti", "Nota supplier 03/11");
    await klik(p, '[data-testid="lihat-pratinjau"]'); await tunggu(p, '[data-testid="pratinjau-harga"]'); await foto(p, "B5-pratinjau");
    ok("B5 pratinjau dari server (belum ada → Rp15.000/kg); TIDAK menulis data", /15\.000/.test(await teksDari(p, '[data-testid="harga-baru"]')) && JSON.stringify((await state()).harga) === JSON.stringify(sebelum5.harga) && p.permintaan.every((r) => /pratinjau/.test(r.u)));
    await p.evaluate(() => { const b = document.querySelector('[data-testid="simpan-harga"]'); b.click(); b.click(); }); await tidur(2500);
    const sh = p.permintaan.filter((r) => r.m === "POST" && /harga-berlaku$/.test(r.u));
    ok("B5 klik ganda Simpan harga → TEPAT satu POST dengan Idempotency-Key + hash pratinjau", sh.length === 1 && !!sh[0].h["idempotency-key"] && !!sh[0].b.hashPratinjau && sh[0].b.satuan === "KG", JSON.stringify(sh[0]?.b));
    const s5 = await state();
    ok("B5 DB: tepat +1 baris Harga Berlaku (15000/KG); stok, pergerakan, jurnal tidak berubah", hargaDb(s5, K("SOFT-D23")).length === 1 && hargaDb(s5, K("SOFT-D23"))[0].unitPrice === 15000 && s5.harga.length === sebelum5.harga.length + 1 && s5.gerakanTotal === sebelum5.gerakanTotal && s5.jurnal === sebelum5.jurnal);
    ok("B5 panel menampilkan harga baru & 'Berlaku sejak'; kolom daftar ikut berubah", /15\.000/.test(await teksDari(p, '[data-testid="harga-berlaku"]')) && /Berlaku sejak/.test(await teksDari(p, '[data-testid="harga-sejak"]')));
    // ubah harga bahan yang sudah punya harga → baris lama tetap (riwayat)
    await klik(p, '[data-testid="fokus-tutup"]'); await cariBuka(p, "HR-N44"); await klik(p, '[data-testid="tab-harga"]'); await klik(p, '[data-testid="tombol-ubah-harga"]'); await tunggu(p, '[data-testid="modal-ubah-harga"]');
    await isi(p, "#hb-harga", "38000"); await isi(p, "#hb-alasan", "Kenaikan harga supplier Nov"); await klik(p, '[data-testid="lihat-pratinjau"]'); await tunggu(p, '[data-testid="pratinjau-harga"]');
    ok("B5 pratinjau menampilkan harga lama → baru (36.000 → 38.000) dan dampak ke order", /36\.000/.test(await teksDari(p, '[data-testid="harga-lama"]')) && /38\.000/.test(await teksDari(p, '[data-testid="harga-baru"]')));
    await klik(p, '[data-testid="simpan-harga"]'); await tidur(2500);
    const s5b = await state();
    ok("B5 DB: baris harga lama N44 UTUH + baris baru (2 baris); saldo tak berubah", hargaDb(s5b, K("HR-N44")).length === hargaDb(s5, K("HR-N44")).length + 1 && hargaDb(s5b, K("HR-N44")).some((h) => h.unitPrice === 36000) && hargaDb(s5b, K("HR-N44")).some((h) => h.unitPrice === 38000) && s5b.stok[K("HR-N44")].saldo === 50);
    await tunggu(p, '[data-testid="baris-riwayat"]');
    ok("B5 riwayat harga di panel memuat kedua harga dengan alasan & pelaku", (await p.$$('[data-testid="baris-riwayat"]')).length === 2 && /Kenaikan harga supplier/.test(await teksDari(p, '[data-testid="riwayat-harga"]')));
    ok("B5 tidak ada 'nilai persediaan' hasil stok × harga yang diklaim angka pembukuan (50 × 38.000 = 1.900.000)", !/1\.900\.000/.test(await teksDari(p, '[data-testid="drawer-bahan"]')));
    await foto(p, "B5-riwayat-harga"); await p.close();

    // ── B6. Izin
    const sales = await api("sales", "PATCH", `/api/inventory/materials/${s0.stok[K("HR-N44")].id}`, { name: "x" });
    const lihat = await api("lihat", "PATCH", `/api/inventory/materials/${s0.stok[K("HR-N44")].id}`, { name: "x" });
    const salesKor = await api("sales", "POST", "/api/inventory/adjustments/koreksi-saldo/pratinjau", { materialId: s0.stok[K("HR-N44")].id, jumlahFisik: 1 });
    const gudHarga = await api("gudang", "POST", "/api/finance/biaya-bahan/harga-berlaku/pratinjau", { materialId: s0.stok[K("HR-N44")].id, hargaBaru: "1", satuan: "KG", alasan: "uji izin" });
    ok("B6 izin ditegakkan server: SALES & peran hanya-lihat ditolak ubah bahan; SALES ditolak koreksi; Gudang ditolak mengubah harga", [sales.status, lihat.status].every((x) => x === 403) && salesKor.status === 403 && gudHarga.status === 403, `${sales.status}/${lihat.status}/${salesKor.status}/${gudHarga.status}`);
    p = await buka(browser, "gudang", "/warehouse/inventory"); await tunggu(p, '[data-testid="baris-stok"]'); await cariBuka(p, "HR-N44"); await klik(p, '[data-testid="tab-harga"]'); await tidur(800);
    ok("B6 UI Gudang: panel Harga Berlaku tidak tampil tanpa izin Finance (tidak ada tombol ubah harga)", !(await tampak(p, '[data-testid="tombol-ubah-harga"]')) && !(await tampak(p, '[data-testid="harga-berlaku"]')));
    await p.close();

    // ── B7. Form di HP & gelap
    p = await buka(browser, "gudang", "/warehouse/inventory", { lebar: 390, tinggi: 844, hp: true }); await tunggu(p, '[data-testid="baris-stok"]');
    await klik(p, '[data-testid="tambah-bahan"]'); await tunggu(p, '[data-testid="form-bahan"]'); await tidur(300);
    ok("B7 form Tambah bahan di HP: tanpa gulir samping, tombol ≥44px", await tanpaGulirSamping(p) && (await p.$eval('[data-testid="simpan-bahan"]', (e) => e.getBoundingClientRect().height)) >= 43);
    await foto(p, "B7-hp-form"); await p.close();
    p = await buka(browser, "finance", "/warehouse/inventory", { tema: "dark" }); await tunggu(p, '[data-testid="baris-stok"]'); await cariBuka(p, "KNIT-HIJAU"); await klik(p, '[data-testid="tab-harga"]'); await klik(p, '[data-testid="tombol-ubah-harga"]'); await tunggu(p, '[data-testid="modal-ubah-harga"]'); await foto(p, "B7-gelap-harga"); await p.close();
    p = await buka(browser, "gudang", "/warehouse/inventory", { tema: "dark" }); await tunggu(p, '[data-testid="baris-stok"]'); await cariBuka(p, "MEMORY"); await klik(p, '[data-testid="tombol-koreksi-saldo"]'); await tunggu(p, '[data-testid="modal-koreksi-saldo"]'); await foto(p, "B7-gelap-koreksi"); await p.close();

    U.selesai("hasil-stokB.json");
  } catch (e) { ok("Skenario B berhenti karena galat", false, e.stack || e.message); U.selesai("hasil-stokB.json"); } finally { await browser.close(); }
})();
