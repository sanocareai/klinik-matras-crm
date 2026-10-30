// Rekonsiliasi API ↔ layar ↔ CSV ↔ XLSX ↔ DB di atas SALINAN backup produksi (lokal, terisolasi). Tidak menulis produksi.
//   BASE=http://localhost:5192 API=http://127.0.0.1:4021 OUT=C:/tmp/km-mkt-prodcopy DARI=2026-10-01 SAMPAI=2026-10-29 node frontend/qa-harness/marketing-browser-salinan.cjs
const U = require("./qa-util.cjs"); const XLSX = require("xlsx");
const { ok, num, tidur, tunggu, teks, buka, fs, path } = U;
const DARI = process.env.DARI || "2026-10-01", SAMPAI = process.env.SAMPAI || "2026-10-29"; const P = `dari=${DARI}&sampai=${SAMPAI}`;
const REF = JSON.parse(fs.readFileSync(path.join(U.OUT, "rekon-api.json"), "utf8")); const DBR = JSON.parse(fs.readFileSync(path.join(U.OUT, "rekon.json"), "utf8"));
const parseCsv = (t) => t.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l !== "").map((l) => { const o = []; let c = "", q = false; for (let i = 0; i < l.length; i++) { const ch = l[i]; if (q) { if (ch === '"' && l[i + 1] === '"') { c += '"'; i++; } else if (ch === '"') q = false; else c += ch; } else if (ch === '"') q = true; else if (ch === ",") { o.push(c); c = ""; } else c += ch; } o.push(c); return o; });
const sheetRows = (wb, nama) => (wb.Sheets[nama] ? XLSX.utils.sheet_to_json(wb.Sheets[nama], { header: 1, defval: "" }) : null);
const rekap = [];   // baris tabel rekonsiliasi: metrik | API | layar | CSV | XLSX | DB
const catat = (metrik, api, layar, csv, xlsx, db) => rekap.push({ metrik, api, layar, csv, xlsx, db });

(async () => {
  const sumber = (await U.apiGet("admin", `/api/atribusi/iklan/sumber?${P.replace("dari=", "dari=")}`)).json;
  const meta = (await U.apiGet("admin", `/api/atribusi/iklan?${P}&level=campaign`)).json;
  const traffic = (await U.apiGet("admin", `/api/analytics/traffic?from=${DARI}&to=${SAMPAI}`)).json;
  const t = sumber.total; const jt = meta.jumlahTeratribusi;
  const browser = await U.mulai();
  try {
    const page = await buka(browser, "admin", `/laporan?tab=Marketing&${P}`);
    await tunggu(page, '[data-testid="kartu-ringkas"]'); await tunggu(page, '[data-testid="tabel-sumber"]'); await page.waitForSelector(".recharts-wrapper", { timeout: 60000 }).catch(() => {});
    await page.click('[data-testid="bagian-kualitas"] button'); await tunggu(page, '[data-butir="rekonMeta"]', 90000);   // laporan Meta sudah termuat → sheet "Meta CTWA" akan ada
    await tidur(1000);

    // ── 1. LAYAR (kartu + tabel + total) vs API vs DB ──
    const kart = async (id) => teks(page, `[data-testid="kartu-${id}"] span:nth-child(2)`);
    const kartu = { lead: num(await kart("lead")), berOrder: num(await kart("berOrder")), lunas: num(await kart("lunas")), nilai: num(await kart("nilai")), uang: num(await kart("uang")) };
    const judulLead = await teks(page, '[data-testid="kartu-lead"]');
    ok("Label kartu: 'Total lead (termasuk spam)' dan rincian sah · spam", /Total lead \(termasuk spam\)/.test(judulLead || "") && new RegExp(`${t.leadSah.toLocaleString("id-ID")} sah · ${t.spam.toLocaleString("id-ID")} spam`).test(judulLead || ""), judulLead);
    ok("Layar = API: total lead / ber-order / lunas / nilai order / uang bersih", kartu.lead === t.lead && kartu.berOrder === t.berOrder && kartu.lunas === t.lunas && kartu.nilai === t.nilaiOrderSaatIni && kartu.uang === t.uangBersih, JSON.stringify(kartu));
    ok("API = DB: total lead = customer dibuat − B2B/karyawan; spam = spam DB", t.lead === DBR.customerDibuat - DBR.b2bKaryawan && t.spam === DBR.spam, `${t.lead}/${DBR.customerDibuat - DBR.b2bKaryawan}; ${t.spam}/${DBR.spam}`);
    const biayaLayar = await kart("biaya");
    ok("Biaya iklan (berbayar) tidak diubah jadi 0 bila total belum lengkap", t.berbayar?.spend == null ? biayaLayar === "—" : num(biayaLayar) === t.berbayar.spend, `${biayaLayar} vs ${t.berbayar?.spend}`);
    catat("Total lead (termasuk spam)", t.lead, kartu.lead, null, null, DBR.customerDibuat - DBR.b2bKaryawan);
    catat("Spam", t.spam, null, null, null, DBR.spam);
    catat("Lead sah (tanpa spam)", t.leadSah, null, null, null, DBR.customerDibuat - DBR.b2bKaryawan - DBR.spam);
    catat("Customer ber-order", t.berOrder, kartu.berOrder, null, null, `≈${DBR.berOrderKasar} (kasar, non-batal; bukan kontrak eligible)`);
    catat("Customer lunas (ledger)", t.lunas, kartu.lunas, null, null, null);
    catat("Nilai order (Rp)", t.nilaiOrderSaatIni, kartu.nilai, null, null, null);
    catat("Uang diterima bersih (Rp)", t.uangBersih, kartu.uang, null, null, null);
    catat("Biaya iklan berbayar (Rp)", t.berbayar?.spend ?? null, biayaLayar, null, null, null);

    const barisSumber = {}; for (const s of sumber.sumber) { barisSumber[s.id] = await page.$$eval(`[data-testid="baris-sumber-${s.id}"] td`, (tds) => tds.map((x) => x.textContent.trim())).catch(() => null); }
    for (const s of sumber.sumber) {
      const b = barisSumber[s.id]; if (!b) { ok(`Baris sumber ${s.id} tampil`, false); continue; }
      const cocok = num(b[2]) === s.lead && num(b[3]) === s.berOrder && num(b[4]) === s.lunas && num(b[5]) === s.uang.nilaiOrderSaatIni && num(b[6]) === s.uang.uangBersih;
      ok(`Layar = API baris ${s.id}: lead/ber-order/lunas/nilai/uang`, cocok, `${b.slice(2, 8).join(" | ")}`);
      if (s.biaya?.spend == null) ok(`Spend null ${s.id} tampil '—'/'tidak tersedia' (bukan Rp0)`, !/^Rp0$/.test(b[7]), b[7]); else ok(`Spend ${s.id} = API`, num(b[7]) === s.biaya.spend, b[7]);
    }
    const tot = await page.$$eval('[data-testid="baris-total"] td', (tds) => tds.map((x) => x.textContent.trim()));
    ok("Baris total layar = API total", num(tot[2]) === t.lead && num(tot[3]) === t.berOrder && num(tot[5]) === t.nilaiOrderSaatIni, tot.slice(2, 8).join(" | "));
    const rl = await teks(page, '[data-butir="rekonLead"]');
    ok("Rekonsiliasi lead di layar: total − spam = tren harian", new RegExp(`${t.lead.toLocaleString("id-ID")}.*${t.spam.toLocaleString("id-ID")}.*${traffic.totalLeads.toLocaleString("id-ID")}`).test(rl || "") && /Cocok/.test(rl || ""), rl);
    catat("Lead tanpa spam = tren harian (/analytics/traffic)", traffic.totalLeads, traffic.totalLeads, null, null, DBR.customerDibuat - DBR.b2bKaryawan - DBR.spam);

    // ── 2. CSV sumber ──
    let t0 = Date.now(); await page.click('[data-testid="ekspor-sumber"]');
    const fCsv = await U.tungguUnduhan(/^marketing-sumber-.*\.csv$/, t0); ok("CSV sumber terunduh dengan nama 'marketing-sumber-…'", !!fCsv, fCsv && path.basename(fCsv));
    if (fCsv) {
      const txt = fs.readFileSync(fCsv, "utf8"); const rows = parseCsv(txt); const head = rows.findIndex((r) => r[0] === "Sumber"); const kol = rows[head];
      ok("CSV memuat periode, basis, cutoff, dasar, urutan yang terlihat", rows.some((r) => r[0] === "Periode lead masuk (WIB)" && r[1] === `${DARI} s/d ${SAMPAI}`) && rows.some((r) => r[0] === "Basis laporan") && rows.some((r) => r[0] === "Evaluasi pembayaran sampai" && /WIB/.test(r[1])) && rows.some((r) => r[0] === "Urut menurut"), rows.slice(0, 6).map((r) => r.join("=")).join(" ; "));
      const c = (r, nama) => r[kol.indexOf(nama)];
      const totR = rows.find((r) => r[0] === "TOTAL (semua sumber)");
      ok("CSV total = API (lead/spam/ber-order/lunas/nilai/uang)", Number(c(totR, "Total lead (termasuk spam)")) === t.lead && Number(c(totR, "Spam")) === t.spam && Number(c(totR, "Ber-order")) === t.berOrder && Number(c(totR, "Lunas")) === t.lunas && Number(c(totR, "Nilai order saat ini (Rp)")) === t.nilaiOrderSaatIni && Number(c(totR, "Pembayaran tercatat bersih (Rp)")) === t.uangBersih);
      let semua = true, nullKosong = true;
      for (const s of sumber.sumber) { const r = rows.find((x) => x[0] === s.label); if (!r) { semua = false; continue; } if (!(Number(c(r, "Total lead (termasuk spam)")) === s.lead && Number(c(r, "Ber-order")) === s.berOrder && Number(c(r, "Lunas")) === s.lunas && Number(c(r, "Nilai order saat ini (Rp)")) === s.uang.nilaiOrderSaatIni)) semua = false; if (s.biaya?.spend == null && c(r, "Biaya iklan (Rp)") !== "") nullKosong = false; if (s.biaya?.cpa == null && c(r, "CPA lunas (Rp)") !== "") nullKosong = false; }
      ok("CSV per sumber = API (lead/ber-order/lunas/nilai)", semua); ok("CSV: spend/CPA null = sel kosong (bukan 0)", nullKosong);
      const urutLayar = await page.$$eval('[data-testid^="baris-sumber-"]', (r) => r.map((x) => x.dataset.testid.replace("baris-sumber-", "")));
      const urutCsv = rows.slice(head + 1).filter((r) => !/^TOTAL/.test(r[0]) && r[0] !== "").map((r) => sumber.sumber.find((s) => s.label === r[0])?.id);
      ok("Urutan baris CSV = urutan baris di layar", urutLayar.join() === urutCsv.join(), `${urutLayar.join(",")} | ${urutCsv.join(",")}`);
      catat("Total lead (termasuk spam)", t.lead, kartu.lead, Number(c(totR, "Total lead (termasuk spam)")), null, null);
      catat("Customer ber-order", t.berOrder, kartu.berOrder, Number(c(totR, "Ber-order")), null, null);
    }

    // ── 3. XLSX (Export Marketing) ──
    t0 = Date.now(); await U.klikTeks(page, "button", "Export Marketing");
    const fX = await U.tungguUnduhan(/^laporan-marketing-.*\.xlsx$/, t0, 60000); ok("XLSX terunduh (laporan-marketing-…)", !!fX, fX && path.basename(fX));
    if (fX) {
      const wb = XLSX.readFile(fX); const namaSheet = wb.SheetNames;
      ok("XLSX: sheet Marketing pertama, lalu Meta CTWA, lalu dua sheet legacy berlabel", namaSheet[0] === "Marketing" && namaSheet[1] === "Meta CTWA" && namaSheet.includes("Traffic (legacy)"), namaSheet.join(" | "));
      const r = sheetRows(wb, "Marketing"); const teksSemua = r.map((x) => x.join("|")).join("\n");
      ok("XLSX Marketing: periode, basis, cutoff, urutan", new RegExp(`Periode lead masuk \\(WIB\\)\\|${DARI} s/d ${SAMPAI}`).test(teksSemua) && /Basis laporan\|/.test(teksSemua) && /Evaluasi pembayaran sampai\|.*WIB/.test(teksSemua) && /Urut menurut\|/.test(teksSemua));
      const head = r.findIndex((x) => x[0] === "Sumber"); const kol = r[head]; const c = (row, nama) => row[kol.indexOf(nama)];
      const totR = r.find((x) => String(x[0]).startsWith("TOTAL (semua"));
      ok("XLSX total = API", c(totR, "Total lead (termasuk spam)") === t.lead && c(totR, "Spam") === t.spam && c(totR, "Customer ber-order") === t.berOrder && c(totR, "Customer lunas (ledger)") === t.lunas && c(totR, "Nilai order saat ini") === t.nilaiOrderSaatIni && c(totR, "Pembayaran tercatat bersih") === t.uangBersih);
      let semua = true, nullStrip = true;
      for (const s of sumber.sumber) { const row = r.find((x) => x[0] === s.label); if (!row) { semua = false; continue; } if (!(c(row, "Total lead (termasuk spam)") === s.lead && c(row, "Customer ber-order") === s.berOrder && c(row, "Customer lunas (ledger)") === s.lunas && c(row, "Nilai order saat ini") === s.uang.nilaiOrderSaatIni)) semua = false; if (s.biaya?.spend == null && c(row, "Biaya iklan") !== "—") nullStrip = false; if (s.biaya?.cpa == null && c(row, "CPA lunas") !== "—") nullStrip = false; }
      ok("XLSX per sumber = API", semua); ok("XLSX: spend/CPA null = '—' (bukan 0)", nullStrip);
      const urutX = r.slice(head + 1).filter((x) => x[0] && !/^TOTAL/.test(String(x[0]))).map((x) => sumber.sumber.find((s) => s.label === x[0])?.id);
      const urutLayar = await page.$$eval('[data-testid^="baris-sumber-"]', (rr) => rr.map((x) => x.dataset.testid.replace("baris-sumber-", "")));
      ok("Urutan XLSX = urutan layar", urutX.join() === urutLayar.join());
      catat("Total lead (termasuk spam)", t.lead, kartu.lead, null, c(totR, "Total lead (termasuk spam)"), null);
      catat("Customer ber-order", t.berOrder, kartu.berOrder, null, c(totR, "Customer ber-order"), null);
      catat("Customer lunas (ledger)", t.lunas, kartu.lunas, null, c(totR, "Customer lunas (ledger)"), null);
      catat("Nilai order (Rp)", t.nilaiOrderSaatIni, kartu.nilai, null, c(totR, "Nilai order saat ini"), null);
      catat("Uang diterima bersih (Rp)", t.uangBersih, kartu.uang, null, c(totR, "Pembayaran tercatat bersih"), null);
      const rm = sheetRows(wb, "Meta CTWA"); const hm = rm.findIndex((x) => x[0] === "Peringkat"); const km = rm[hm];
      const barisM = rm.slice(hm + 1).filter((x) => x[km.indexOf("Status")] !== ""); const sumLead = barisM.filter((x) => x[km.indexOf("Status")] !== "UNKNOWN").reduce((a, x) => a + (Number(x[km.indexOf("Lead CTWA terbukti (termasuk spam)")]) || 0), 0); const unkLead = barisM.filter((x) => x[km.indexOf("Status")] === "UNKNOWN").reduce((a, x) => a + (Number(x[km.indexOf("Lead CTWA terbukti (termasuk spam)")]) || 0), 0); const unkApi = meta.grup.filter((g) => g.status === "UNKNOWN").reduce((a, g) => a + (g.lead?.unik || 0), 0);
      ok("XLSX Meta CTWA: Σ MAPPED+UNMAPPED = lead terbukti API (UNKNOWN terpisah, tidak dikreditkan); cutoff & dasar CTWA tertulis", sumLead === jt.leadUnik && unkLead === unkApi && rm.some((x) => x[0] === "Evaluasi pembayaran sampai" && /WIB/.test(x[1])) && rm.some((x) => x[0] === "Dasar atribusi" && /CTWA/.test(x[1])), `${sumLead} vs ${jt.leadUnik}; UNKNOWN ${unkLead} vs ${unkApi}`);
      const tl = sheetRows(wb, "Traffic (legacy)"); ok("XLSX sheet legacy Traffic berlabel 'tanpa spam' dan = total tren", tl && /LEGACY — TANPA SPAM/.test(tl[0][0]) && tl.some((x) => /Total lead masuk \(tanpa spam\)/.test(x[0]) && x[1] === traffic.totalLeads), tl && tl[0][0]);
      catat("Lead tanpa spam (sheet legacy Traffic)", traffic.totalLeads, traffic.totalLeads, null, tl?.find((x) => /Total lead masuk/.test(x[0]))?.[1] ?? null, null);
    }

    // ── 4. META: layar vs API vs CSV ──
    await page.click(`[data-testid="baris-sumber-META"]`).catch(async () => { await page.click(`[data-testid="baris-sumber-META"] td`); });
    await tunggu(page, '[data-testid="tabel-meta"] tbody tr', 90000); await tidur(1500);
    const totalMeta = await teks(page, '[data-testid="total-meta"]');
    const angkaTot = (totalMeta || "").match(/-?[\d.]+/g) || [];
    ok("Meta: baris total di layar memuat lead terbukti = API", num(angkaTot[0]) === jt.leadUnik || new RegExp(String(jt.leadUnik.toLocaleString("id-ID"))).test(totalMeta || ""), totalMeta);
    const baM = await page.$$eval('[data-testid^="baris-meta-"]', (r) => r.map((x) => ({ id: x.dataset.testid, t: [...x.querySelectorAll("td")].map((c) => c.textContent.trim()) })));
    const jumlahBaris = meta.grup.length;
    ok("Meta: jumlah baris layar = grup API (UNMAPPED/UNKNOWN ikut)", baM.length === jumlahBaris, `${baM.length} vs ${jumlahBaris}`);
    t0 = Date.now(); await page.click('[data-testid="ekspor-meta"]');
    const fM = await U.tungguUnduhan(/^marketing-meta-campaign-.*\.csv$/, t0); ok("CSV Meta terunduh", !!fM, fM && path.basename(fM));
    if (fM) {
      const rows = parseCsv(fs.readFileSync(fM, "utf8")); const head = rows.findIndex((r) => r[0] === "Peringkat"); const kol = rows[head]; const isi = rows.slice(head + 1);
      const sum = (nama) => isi.filter((r) => r[kol.indexOf("Status")] !== "UNKNOWN").reduce((a, r) => a + (Number(r[kol.indexOf(nama)]) || 0), 0);
      ok("CSV Meta: Σ (MAPPED+UNMAPPED) lead / ber-order / membayar / lunas = total terbukti API; UNKNOWN tidak dikreditkan", sum("Lead CTWA terbukti (termasuk spam)") === jt.leadUnik && sum("Customer ber-order") === jt.customerDenganOrder && sum("Customer membayar") === jt.customerPernahMembayar && sum("Customer lunas (ledger)") === jt.closingUtama.customerLunasTerbuktiLedger, `${sum("Lead CTWA terbukti (termasuk spam)")}/${jt.leadUnik}; ${sum("Customer ber-order")}/${jt.customerDenganOrder}`);
      ok("CSV Meta: periode, basis, cutoff, dasar CTWA", rows.some((r) => r[0] === "Periode lead (WIB)" && r[1] === `${DARI} s/d ${SAMPAI}`) && rows.some((r) => r[0] === "Basis laporan") && rows.some((r) => r[0] === "Evaluasi pembayaran sampai" && /WIB/.test(r[1])) && rows.some((r) => r[0] === "Dasar atribusi" && /CTWA/.test(r[1])));
      const spendKosong = isi.filter((r) => r[kol.indexOf("Spend (Rp)")] === "").length; const spendNullApi = meta.grup.filter((g) => g.biaya?.spend == null).length;
      ok("CSV Meta: spend null = sel kosong (jumlah baris kosong = jumlah null di API)", spendKosong === spendNullApi, `${spendKosong} vs ${spendNullApi}`);
      catat("Lead CTWA terbukti (Meta)", jt.leadUnik, num(angkaTot[0]), sum("Lead CTWA terbukti (termasuk spam)"), null, null);
      catat("Meta: ber-order terbukti", jt.customerDenganOrder, null, sum("Customer ber-order"), null, null);
      catat("Meta: membayar terbukti", jt.customerPernahMembayar, null, sum("Customer membayar"), null, null);
      catat("Meta: lunas ledger terbukti", jt.closingUtama.customerLunasTerbuktiLedger, null, sum("Customer lunas (ledger)"), null, null);
    }
    ok("Tanpa galat halaman/konsol selama rekonsiliasi", page.galat.length === 0, page.galat.join(" | "));
    // ── 5. tidak ada penulisan ke salinan oleh QA ──
    const tabelKini = JSON.parse(require("child_process").execFileSync("node", ["-e", `const {execFileSync}=require('child_process');const q=(s)=>Number(execFileSync('docker',['exec','km_sanss-postgres-1','psql','-U','klinik','-d','km_prodcopy_20261030_test','-Atc',s],{encoding:'utf8'}).trim());console.log(JSON.stringify({customer:q('select count(*) from "Customer"'),order:q('select count(*) from "Order"'),pembayaran:q('select count(*) from payments'),touch:q('select count(*) from attribution_touches'),spendEntri:q('select count(*) from ad_source_spend_entries')}))`], { encoding: "utf8" }));
    ok("Jumlah baris customer/order/pembayaran/touch/spend tidak berubah selama QA (salinan)", JSON.stringify(tabelKini) === JSON.stringify(DBR.tabel), JSON.stringify(tabelKini));
    await U.foto(page, "S1-meta-campaign-salinan");
  } finally { await browser.close(); }
  fs.writeFileSync(path.join(U.OUT, "rekap-rekonsiliasi.json"), JSON.stringify(rekap, null, 2));
  U.selesai("hasil-browser-salinan.json"); process.exit(U.hasilRef().gagal ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });
