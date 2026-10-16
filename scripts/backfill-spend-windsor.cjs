// BACKFILL spend Windsor Meta level Ad, rincian harian, 1–14 Oktober 2026 (SEBELUM atribusi) — pemeriksa, dry-run, commit bergerbang, verifikasi.
// TIDAK memuat data apa pun: data HARUS datang dari ekspor Windsor (CSV) + control total yang diisi Mesa. Tidak mengarang angka.
//
// Pemakaian (dari laptop, lewat pembungkus scripts/backfill-spend-windsor.sh):
//   bash scripts/backfill-spend-windsor.sh cek    <csv> <kontrol.json>   # lokal saja, tanpa server: validasi CSV + cocokkan control total
//   bash scripts/backfill-spend-windsor.sh dry    <csv> <kontrol.json>   # dry-run lewat jalur aplikasi (tidak menulis)
//   KOMIT=YA bash scripts/backfill-spend-windsor.sh commit <csv> <kontrol.json>   # commit; hanya bila SEMUA gerbang lulus
//   bash scripts/backfill-spend-windsor.sh verify <csv> <kontrol.json>   # DB vs CSV vs control total per hari/campaign/ad set/ad/akun + status SEBELUM_ATRIBUSI
//
// Gerbang commit: KOMIT=YA; CSV tervalidasi ketat (ID string digit, tanpa notasi ilmiah, spend >= 0 boleh 0, IDR, Asia/Jakarta bila ada kolom timezone, tanggal HANYA 1–14 Okt,
// tanpa duplikat hari+Ad); control total lengkap untuk 14 hari dan COCOK persis (akun per hari + per campaign per hari); dry-run aplikasi bersih (0 konflik/ditolak); total sumber = Σ control.
// Reach TIDAK pernah dijumlah (non-additive) dan tidak diperiksa/ditampilkan sebagai agregat.
"use strict";

const AWAL = "2026-10-01", AKHIR = "2026-10-14", ZONA = "Asia/Jakarta", MATA_UANG = "IDR", SUMBER = "WINDSOR_API";
const WAJIB = ["date", "account_id", "currency", "campaign_id", "adset_id", "ad_id", "spend", "impressions", "link_clicks", "messaging conversations started"];
const ID_RE = /^\d{5,32}$/, SPEND_RE = /^\d{1,13}(\.\d{1,2})?$/, INT_RE = /^\d{1,15}$/, TGL_RE = /^\d{4}-\d{2}-\d{2}$/;
const rp = (x) => Math.round((Number(x) || 0) * 100) / 100;

function hariRentang(awal = AWAL, akhir = AKHIR) {
  const out = []; for (let t = Date.parse(awal + "T00:00:00Z"); t <= Date.parse(akhir + "T00:00:00Z"); t += 86400000) out.push(new Date(t).toISOString().slice(0, 10));
  return out;
}

/** CSV RFC4180 sederhana (kutip ganda, BOM, pemisah , ; TAB). */
function parseCsv(teks) {
  const s = String(teks ?? "").replace(/^﻿/, "");
  const header = s.split(/\r?\n/, 1)[0] || "";
  const d = [[",", (header.match(/,/g) || []).length], [";", (header.match(/;/g) || []).length], ["\t", (header.match(/\t/g) || []).length]].sort((a, b) => b[1] - a[1])[0];
  const delim = d[1] > 0 ? d[0] : ",";
  const rows = []; let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") { if (c === "\r" && s[i + 1] === "\n") i++; row.push(cell); cell = ""; if (row.some((x) => x.trim() !== "")) rows.push(row); row = []; }
    else cell += c;
  }
  row.push(cell); if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}
const tglValid = (s) => TGL_RE.test(s) && new Date(s + "T00:00:00Z").toISOString().slice(0, 10) === s;

/** Validasi ketat CSV → { galat:[…], baris:[…] , agregat }. Tidak pernah menebak/memperbaiki nilai. */
function periksaCsv(csv, { akun = null } = {}) {
  const galat = [];
  const t = parseCsv(csv);
  if (t.length < 2) return { galat: ["CSV_KOSONG"], baris: [], agregat: null };
  const kepala = t[0].map((h) => h.trim().toLowerCase());
  for (const w of WAJIB) if (!kepala.includes(w)) galat.push(`KOLOM_WAJIB_HILANG:${w}`);
  if (galat.length) return { galat, baris: [], agregat: null };
  const idx = (n) => kepala.indexOf(n);
  const ada = (n) => kepala.includes(n);
  const baris = []; const unik = new Set();
  t.slice(1).forEach((r, i) => {
    const no = i + 2, v = (n) => String(r[idx(n)] ?? "").trim();
    const tolak = (a) => galat.push(`baris ${no}: ${a}`);
    const tgl = v("date");
    if (!tglValid(tgl)) return tolak("TANGGAL_TIDAK_VALID");
    if (tgl < AWAL || tgl > AKHIR) return tolak(`TANGGAL_DI_LUAR_${AWAL}_${AKHIR}`);
    for (const k of ["account_id", "campaign_id", "adset_id", "ad_id"]) {
      const x = v(k).replace(/^act_/i, "");
      if (/[eE][+-]?\d|[.,]/.test(x)) return tolak(`${k}_NOTASI_ILMIAH_ATAU_DESIMAL`);
      if (!ID_RE.test(x)) return tolak(`${k}_BUKAN_ID_DIGIT`);
    }
    const akunBaris = v("account_id").replace(/^act_/i, "");
    if (akun && akunBaris !== String(akun)) return tolak("ACCOUNT_ID_BEDA");
    if (v("currency").toUpperCase() !== MATA_UANG) return tolak("MATA_UANG_BUKAN_IDR");
    if (ada("timezone") && v("timezone") !== ZONA) return tolak("ZONA_WAKTU_BUKAN_ASIA_JAKARTA");
    const sp = v("spend");
    if (sp === "") return tolak("SPEND_KOSONG");
    if (/^-/.test(sp)) return tolak("SPEND_NEGATIF");
    if (/[eE][+-]?\d/.test(sp)) return tolak("SPEND_NOTASI_ILMIAH");
    if (!SPEND_RE.test(sp)) return tolak("SPEND_FORMAT_TIDAK_DIKENAL");
    const ang = {};
    for (const [k, n] of [["impressions", "impressions"], ["link_clicks", "link_clicks"], ["konv", "messaging conversations started"]]) {
      const x = v(n); if (x === "") return tolak(`${n.toUpperCase().replace(/ /g, "_")}_KOSONG`);
      if (!INT_RE.test(x)) return tolak(`${n.toUpperCase().replace(/ /g, "_")}_TIDAK_VALID`);
      ang[k] = Number(x);
    }
    const kunci = `${tgl}|${akunBaris}|${v("ad_id")}`;
    if (unik.has(kunci)) return tolak("DUPLIKAT_HARI_AD");
    unik.add(kunci);
    baris.push({ no, tgl, akun: akunBaris, campaign: v("campaign_id"), adset: v("adset_id"), ad: v("ad_id"), spend: rp(sp), imp: ang.impressions, link: ang.link_clicks, konv: ang.konv });
  });
  // hierarki konsisten dalam berkas
  const adset2camp = new Map(), ad2set = new Map();
  for (const b of baris) {
    if ((adset2camp.get(b.adset) ?? b.campaign) !== b.campaign) galat.push(`AD_SET_${b.adset}_DI_DUA_CAMPAIGN`);
    adset2camp.set(b.adset, b.campaign);
    if ((ad2set.get(b.ad) ?? b.adset) !== b.adset) galat.push(`AD_${b.ad}_DI_DUA_AD_SET`);
    ad2set.set(b.ad, b.adset);
  }
  return { galat: [...new Set(galat)], baris, agregat: agregatkan(baris) };
}

/** Agregat aditif per hari, campaign×hari, ad set×hari, ad×hari, dan akun. (reach sengaja tidak ada.) */
function agregatkan(baris) {
  const nol = () => ({ spend: 0, impressions: 0, link_clicks: 0, conversations: 0, ads: 0 });
  const tambah = (o, b) => { o.spend = rp(o.spend + b.spend); o.impressions += b.imp; o.link_clicks += b.link; o.conversations += b.konv; o.ads += 1; };
  const harian = {}, campaign = {}, adset = {}, ad = {}, akun = nol();
  for (const b of baris) {
    tambah((harian[b.tgl] ||= nol()), b);
    tambah(((campaign[b.tgl] ||= {})[b.campaign] ||= nol()), b);
    tambah(((adset[b.tgl] ||= {})[b.adset] ||= nol()), b);
    tambah(((ad[b.tgl] ||= {})[b.ad] ||= nol()), b);
    tambah(akun, b);
  }
  return { harian, campaign, adset, ad, akun };
}

const FIELD = ["spend", "impressions", "link_clicks", "conversations"];
/**
 * Bandingkan agregat CSV dengan control total Mesa. kontrol = { akun, zona, mata_uang, harian: { "2026-10-01": { spend, impressions, link_clicks, conversations, campaign: { "<id>": {…} } }, … } }.
 * Lengkap = 14 hari terisi, semua angka bukan null. Hasil: { lengkap, cocok, selisih:[…] }.
 */
function bandingkanKontrol(agregat, kontrol) {
  const selisih = []; let lengkap = true;
  if (!kontrol || typeof kontrol !== "object" || !kontrol.harian) return { lengkap: false, cocok: false, selisih: ["KONTROL_TOTAL_TIDAK_ADA"] };
  if (kontrol.zona !== ZONA) selisih.push(`zona kontrol '${kontrol.zona}' ≠ ${ZONA}`);
  if (kontrol.mata_uang !== MATA_UANG) selisih.push(`mata uang kontrol '${kontrol.mata_uang}' ≠ ${MATA_UANG}`);
  const angka = (x) => typeof x === "number" && Number.isFinite(x) && x >= 0;
  for (const h of hariRentang()) {
    const k = kontrol.harian[h];
    if (!k) { lengkap = false; selisih.push(`${h}: control total belum diisi`); continue; }
    for (const f of FIELD) if (!angka(k[f])) { lengkap = false; selisih.push(`${h}: ${f} belum diisi/tidak valid`); }
    const a = agregat.harian[h] || { spend: 0, impressions: 0, link_clicks: 0, conversations: 0, ads: 0 };
    for (const f of FIELD) if (angka(k[f]) && rp(k[f]) !== rp(a[f])) selisih.push(`${h}: ${f} CSV=${a[f]} kontrol=${k[f]} selisih=${rp(a[f] - k[f])}`);
    if (!k.campaign || typeof k.campaign !== "object") { lengkap = false; selisih.push(`${h}: control total per campaign belum diisi`); continue; }
    const cs = new Set([...Object.keys(k.campaign), ...Object.keys(agregat.campaign[h] || {})]);
    for (const c of cs) {
      const kk = k.campaign[c], aa = (agregat.campaign[h] || {})[c];
      if (!kk) { selisih.push(`${h} campaign ${c}: ada di CSV tetapi tidak ada di control total`); lengkap = false; continue; }
      for (const f of FIELD) {
        if (!angka(kk[f])) { lengkap = false; selisih.push(`${h} campaign ${c}: ${f} belum diisi`); continue; }
        const v = aa ? aa[f] : 0;
        if (rp(kk[f]) !== rp(v)) selisih.push(`${h} campaign ${c}: ${f} CSV=${v} kontrol=${kk[f]} selisih=${rp(v - kk[f])}`);
      }
    }
  }
  return { lengkap, cocok: lengkap && selisih.length === 0, selisih };
}
const totalKontrol = (kontrol) => rp(hariRentang().reduce((s, h) => s + (kontrol?.harian?.[h]?.spend ?? 0), 0));

/** Perintah CLI --payload: gabungkan CSV + kontrol menjadi satu JSON untuk stdin container. */
function bangunPayload(fs, csvPath, kontrolPath) {
  return JSON.stringify({ csv: fs.readFileSync(csvPath, "utf8"), kontrol: JSON.parse(fs.readFileSync(kontrolPath, "utf8")) });
}

module.exports = { hariRentang, parseCsv, periksaCsv, agregatkan, bandingkanKontrol, totalKontrol, bangunPayload, AWAL, AKHIR, ZONA, MATA_UANG, SUMBER };

// ────────────────────────── eksekusi (hanya bila BACKFILL_MODE diset; dijalankan di DALAM container backend) ──────────────────────────
async function utama() {
  const MODE = process.env.BACKFILL_MODE;
  const akunId = String(process.env.ACCOUNT_ID || "").replace(/^act_/i, "");
  const jwt = require("jsonwebtoken");
  const { PrismaClient } = require("@prisma/client");
  const prisma = new PrismaClient();
  const stdin = await new Promise((res) => { let b = ""; process.stdin.on("data", (c) => (b += c)); process.stdin.on("end", () => res(b)); });
  const { csv, kontrol } = JSON.parse(stdin);
  const out = { mode: MODE, akun: akunId, gerbang: {} };
  const cek = periksaCsv(csv, { akun: akunId });
  out.csv = { galat: cek.galat, baris: cek.baris.length, hari: Object.keys(cek.agregat?.harian || {}).length };
  const kb = cek.agregat ? bandingkanKontrol(cek.agregat, kontrol) : { lengkap: false, cocok: false, selisih: ["CSV_TIDAK_VALID"] };
  out.kontrol = { lengkap: kb.lengkap, cocok: kb.cocok, selisih: kb.selisih.slice(0, 50), totalSpendKontrol: totalKontrol(kontrol) };
  out.gerbang = { csvValid: cek.galat.length === 0, kontrolLengkap: kb.lengkap, kontrolCocok: kb.cocok };
  const adm = await prisma.user.findFirst({ where: { active: true, role: "ADMIN" } });
  const token = jwt.sign({ id: adm.id, name: adm.name, role: adm.role, roles: [adm.role] }, process.env.JWT_SECRET, { expiresIn: "3m" });
  const call = async (p, body) => { const r = await fetch("http://127.0.0.1:4000/api/atribusi/iklan" + p, { method: body ? "POST" : "GET", headers: { Authorization: "Bearer " + token, ...(body ? { "Content-Type": "application/json" } : {}) }, body: body ? JSON.stringify(body) : undefined }); return { s: r.status, j: await r.json() }; };
  const sebelumDB = { spend: await prisma.metaAdDailySpend.count(), impor: await prisma.metaSpendImport.count() };
  out.dbSebelum = sebelumDB;
  if (MODE === "dry" || MODE === "commit") {
    const body = { csv, accountId: akunId, sumber: SUMBER, zonaWaktuAkun: ZONA, namaBerkas: "windsor-meta-20261001-20261014.csv", ...(kb.lengkap ? { totalSumber: String(totalKontrol(kontrol)) } : {}), dryRun: true };
    const dr = await call("/spend", body);
    out.dryRun = { http: dr.s, ringkasan: dr.j.ringkasan, rekonsiliasi: dr.j.rekonsiliasi, perTanggal: dr.j.perTanggal, ditolak: (dr.j.ditolak || []).slice(0, 30), konflik: (dr.j.konflik || []).slice(0, 30), SPEND_UNMAPPED: dr.j.adIdTidakTerpetakan, error: dr.j.error };
    const rs = dr.j.ringkasan || {};
    out.gerbang.dryRunBersih = dr.s === 200 && rs.ditolak === 0 && rs.konflik === 0 && (dr.j.adIdTidakTerpetakan || []).length === 0 && dr.j.rekonsiliasi && dr.j.rekonsiliasi.cocok === true;
    out.gerbang.semuaHari = Object.keys(cek.agregat?.harian || {}).length === 14;
    if (MODE === "commit") {
      const siap = out.gerbang.csvValid && out.gerbang.kontrolLengkap && out.gerbang.kontrolCocok && out.gerbang.dryRunBersih && process.env.KOMIT === "YA";
      out.komit = { diizinkan: siap, KOMIT_YA: process.env.KOMIT === "YA" };
      if (!siap) out.komit.alasan = "DIBATALKAN: gerbang tidak lulus (csvValid, kontrolLengkap, kontrolCocok, dryRunBersih, KOMIT=YA). TIDAK ADA yang ditulis.";
      else {
        const k = await call("/spend", { ...body, dryRun: false });
        out.komit.http = k.s; out.komit.ringkasan = k.j.ringkasan; out.komit.rekonsiliasi = k.j.rekonsiliasi; out.komit.importId = k.j.importId ? "ada" : null; out.komit.error = k.j.error;
        out.komit.waktuWib = new Date(Date.now() + 7 * 3600e3).toISOString().replace("T", " ").slice(0, 19) + " WIB";
      }
    }
  }
  if (MODE === "verify") {
    const db = await prisma.$queryRawUnsafe(`select date_wib::text d, campaign_id c, ad_set_id s, ad_id a, spend::text sp, coalesce(impressions,0)::text im, coalesce(link_clicks,0)::text lk, coalesce(platform_conversations,0)::text kv, source src, currency cur, account_timezone tz from meta_ad_daily_spend where date_wib between '${AWAL}' and '${AKHIR}'`);
    const kunciDb = new Map(db.map((r) => [`${r.d}|${r.a}`, r]));
    const beda = []; for (const b of cek.baris) {
      const r = kunciDb.get(`${b.tgl}|${b.ad}`);
      if (!r) { beda.push(`${b.tgl} ad ${b.ad}: tidak ada di DB`); continue; }
      if (rp(r.sp) !== b.spend || Number(r.im) !== b.imp || Number(r.lk) !== b.link || Number(r.kv) !== b.konv) beda.push(`${b.tgl} ad ${b.ad}: DB≠CSV`);
      if (r.c !== b.campaign || r.s !== b.adset) beda.push(`${b.tgl} ad ${b.ad}: hierarki DB≠CSV`);
    }
    if (db.length !== cek.baris.length) beda.push(`jumlah baris DB ${db.length} ≠ CSV ${cek.baris.length}`);
    out.barisDbVsCsv = { db: db.length, csv: cek.baris.length, beda: beda.slice(0, 30), sumberSemuaWindsor: db.every((r) => r.src === SUMBER), semuaIdr: db.every((r) => r.cur === MATA_UANG), semuaJakarta: db.every((r) => r.tz === ZONA) };
    const jumlah = (rows, f) => rp(rows.reduce((s, r) => s + Number(r[f]), 0));
    out.rekonPerHari = hariRentang().map((h) => {
      const r = db.filter((x) => x.d === h);
      const per = (k) => { const m = new Map(); for (const x of r) m.set(x[k], rp((m.get(x[k]) || 0) + Number(x.sp))); return [...m.values()].reduce((s, v) => rp(s + v), 0); };
      const kh = kontrol?.harian?.[h];
      return { hari: h, ad: per("a"), adSet: per("s"), campaign: per("c"), akunDb: jumlah(r, "sp"), akunKontrol: kh ? kh.spend : null, selisih: kh ? rp(jumlah(r, "sp") - kh.spend) : null, konversasi: jumlah(r, "kv"), biayaPerKonversasi: Number(jumlah(r, "kv")) > 0 ? rp(jumlah(r, "sp") / jumlah(r, "kv")) : null };
    });
    out.spendUnmapped = (await prisma.$queryRawUnsafe(`select s.ad_id a, sum(s.spend)::text sp from meta_ad_daily_spend s left join meta_ad_references r on r.ad_id = s.ad_id where s.date_wib between '${AWAL}' and '${AKHIR}' and r.ad_id is null group by 1`));
    out.statusPerHari = [];
    for (const h of hariRentang()) {
      const r = await call(`?dari=${h}&sampai=${h}&level=campaign`);
      const j = r.j;
      out.statusPerHari.push({ hari: h, http: r.s, status: j.biaya?.status, evaluasi: j.biaya?.evaluasi?.status, cplCpaRoasNull: j.biaya ? [j.biaya.cpl, j.biaya.cpa, j.biaya.bookedRoas, j.biaya.cashRoas, ...(j.grup || []).flatMap((g) => [g.biaya.cpl, g.biaya.cpa])].every((x) => x === null) : false, peringatan: (j.peringatan || []).map((w) => w.kode).filter((k) => /ATRIBUSI|SPEND/.test(k)), rekon: j.rekonsiliasi?.ok, spend: j.biaya?.spendTotal ?? null, reachTampil: /reach/i.test(JSON.stringify(j)) });
    }
    const lulusStatus = out.statusPerHari.every((x) => x.http === 200 && x.status === "SEBELUM_ATRIBUSI" && x.evaluasi === "TIDAK_DAPAT_DIEVALUASI_SEBELUM_ATRIBUSI" && x.cplCpaRoasNull && !x.reachTampil && x.rekon === true);
    out.lulus = { barisSama: beda.length === 0 && db.length === cek.baris.length, perHariSelisihNol: out.rekonPerHari.every((x) => x.selisih === 0 && x.ad === x.akunDb && x.adSet === x.akunDb && x.campaign === x.akunDb), tanpaUnmapped: out.spendUnmapped.length === 0, statusSebelumAtribusi: lulusStatus, kontrolCocok: kb.cocok };
  }
  out.dbSesudah = { spend: await prisma.metaAdDailySpend.count(), impor: await prisma.metaSpendImport.count() };
  console.log(JSON.stringify(out, null, 1));
  await prisma.$disconnect();
}

if (process.argv[2] === "--payload") {
  process.stdout.write(bangunPayload(require("fs"), process.argv[3], process.argv[4]));
} else if (process.argv[2] === "--cek-lokal") {
  const fs = require("fs");
  const csv = fs.readFileSync(process.argv[3], "utf8"), kontrol = JSON.parse(fs.readFileSync(process.argv[4], "utf8"));
  const c = periksaCsv(csv, { akun: process.argv[5] || null });
  const kb = c.agregat ? bandingkanKontrol(c.agregat, kontrol) : { lengkap: false, cocok: false, selisih: ["CSV_TIDAK_VALID"] };
  console.log(JSON.stringify({ csvGalat: c.galat.slice(0, 50), baris: c.baris.length, kontrolLengkap: kb.lengkap, kontrolCocok: kb.cocok, selisih: kb.selisih.slice(0, 50), totalSpendCsv: c.agregat?.akun.spend ?? null, totalSpendKontrol: totalKontrol(kontrol) }, null, 1));
  process.exit(c.galat.length === 0 && kb.cocok ? 0 : 1);
} else if (process.env.BACKFILL_MODE) {
  utama().catch((e) => { console.log("ERROR " + String(e.message).slice(0, 200)); process.exit(1); });
}
