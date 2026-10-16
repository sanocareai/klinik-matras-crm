// ATRIBUSI CTWA FASE 2 — referensi Ad ID → Ad Set ID → Campaign ID dan impor pemetaan dari ekspor Ads Manager.
//
// Prinsip: ID adalah kunci. Nama hanya label snapshot. TIDAK ADA pemetaan dari kemiripan nama atau angka. Notasi ilmiah (5.27E+13 — kerusakan
// umum saat CSV dibuka di spreadsheet) DITOLAK karena presisinya sudah hilang. Tidak ada kredensial Meta di sistem ini: sumber MARKETING_API
// baru boleh dipakai bila akses sah dikonfigurasi (belum); jalur yang tersedia sekarang = ADS_MANAGER_EXPORT (CSV/JSON) atau MANUAL.
import crypto from "crypto";

export const SUMBER_REFERENSI = Object.freeze(["ADS_MANAGER_EXPORT", "MARKETING_API", "MANUAL"]);
export const MAKS_BARIS_IMPOR = 5000;
const ID_RE = /^\d{5,32}$/;

// Nama kolom (setelah normalisasi: huruf kecil, hanya a-z0-9) → field kanonik.
const KOLOM = {
  adid: "adId", idiklan: "adId", idad: "adId",
  adsetid: "adSetId", idsetiklan: "adSetId", idadset: "adSetId", adgroupid: "adSetId",
  campaignid: "campaignId", idkampanye: "campaignId", idcampaign: "campaignId",
  adname: "adName", namaiklan: "adName",
  adsetname: "adSetName", namasetiklan: "adSetName", adgroupname: "adSetName",
  campaignname: "campaignName", namakampanye: "campaignName", campaign: "campaignName",
};
const norm = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** Parser CSV RFC4180 sederhana: kutip ganda, BOM, pemisah , ; atau TAB (dideteksi dari baris header). */
export function parseCsv(teks) {
  let s = String(teks ?? "").replace(/^﻿/, "");
  const header = s.split(/\r?\n/, 1)[0] || "";
  const cand = [",", ";", "\t"].map((d) => [d, (header.match(new RegExp(d === "\t" ? "\t" : `\\${d}`, "g")) || []).length]);
  const delim = cand.sort((a, b) => b[1] - a[1])[0][1] > 0 ? cand[0][0] : ",";
  const rows = [];
  let row = [], cell = "", q = false;
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) {
      if (c === '"') { if (s[i + 1] === '"') { cell += '"'; i++; } else q = false; }
      else cell += c;
    } else if (c === '"') q = true;
    else if (c === delim) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && s[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim() !== "")) rows.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim() !== "")) rows.push(row);
  return rows;
}

/** CSV (teks) → [{ baris, adId, adSetId, campaignId, adName, adSetName, campaignName }] ; kolom tak dikenal diabaikan. */
export function barisDariCsv(teks) {
  const t = parseCsv(teks);
  if (t.length === 0) return { baris: [], galat: "BERKAS_KOSONG" };
  const peta = t[0].map((h) => KOLOM[norm(h)] || null);
  for (const wajib of ["adId", "adSetId", "campaignId"]) {
    if (!peta.includes(wajib)) return { baris: [], galat: `KOLOM_WAJIB_HILANG:${wajib}` };
  }
  const baris = t.slice(1).map((r, i) => {
    const o = { baris: i + 2 };
    r.forEach((v, j) => { if (peta[j]) o[peta[j]] = v; });
    return o;
  });
  return { baris, galat: null };
}

function idBersih(v) {
  const s = String(v ?? "").trim();
  if (s === "") return { ok: false, alasan: "KOSONG" };
  if (/[eE][+-]?\d/.test(s) || /^\d+[.,]\d+$/.test(s)) return { ok: false, alasan: "NOTASI_ILMIAH_ATAU_DESIMAL" };
  if (!ID_RE.test(s)) return { ok: false, alasan: "BUKAN_ID_DIGIT" };
  return { ok: true, id: s };
}
const label = (v) => {
  if (v === undefined || v === null) return null;
  const s = String(v).replace(/[\u0000-\u001F\u007F]/g, " ").replace(/\s+/g, " ").trim().slice(0, 200);
  return s === "" ? null : s;
};

/** Validasi satu baris mentah → { ok:true, ref } | { ok:false, alasan }. */
export function validasiBaris(b) {
  const a = idBersih(b.adId), s = idBersih(b.adSetId), c = idBersih(b.campaignId);
  if (!a.ok) return { ok: false, alasan: `AD_ID_${a.alasan}` };
  if (!s.ok) return { ok: false, alasan: `AD_SET_ID_${s.alasan}` };
  if (!c.ok) return { ok: false, alasan: `CAMPAIGN_ID_${c.alasan}` };
  if (a.id === s.id || a.id === c.id || s.id === c.id) return { ok: false, alasan: "ID_BERTINGKAT_SAMA" };
  return { ok: true, ref: { adId: a.id, adSetId: s.id, campaignId: c.id, adName: label(b.adName), adSetName: label(b.adSetName), campaignName: label(b.campaignName) } };
}

/**
 * Rencana impor (MURNI). `ada` = Map adId → referensi tersimpan.
 * Aturan: (1) duplikat dalam berkas harus identik; (2) satu Ad Set hanya milik satu Campaign (berkas + tersimpan);
 * (3) Ad yang sudah ada dengan orang tua berbeda = KONFLIK kecuali izinkanKoreksi; nama boleh berubah (label).
 */
export function rencanaImpor(rows, ada = new Map(), { izinkanKoreksi = false } = {}) {
  const ditolak = [];
  const valid = [];
  for (const b of rows) {
    const v = validasiBaris(b);
    if (!v.ok) ditolak.push({ baris: b.baris ?? null, adId: String(b.adId ?? "").slice(0, 32) || null, alasan: v.alasan });
    else valid.push({ baris: b.baris ?? null, ...v.ref });
  }
  // duplikat dalam berkas
  const perAd = new Map();
  for (const r of valid) (perAd.get(r.adId) || perAd.set(r.adId, []).get(r.adId)).push(r);
  const unik = [];
  for (const [adId, lst] of perAd) {
    const sama = lst.every((x) => x.adSetId === lst[0].adSetId && x.campaignId === lst[0].campaignId);
    if (!sama) { for (const x of lst) ditolak.push({ baris: x.baris, adId, alasan: "DUPLIKAT_BERTENTANGAN" }); continue; }
    unik.push(lst.reduce((acc, x) => ({ ...acc, adName: acc.adName ?? x.adName, adSetName: acc.adSetName ?? x.adSetName, campaignName: acc.campaignName ?? x.campaignName }), lst[0]));
  }
  // satu ad set = satu campaign (berkas + tersimpan)
  const campOfSet = new Map();
  for (const r of ada.values()) if (!campOfSet.has(r.adSetId)) campOfSet.set(r.adSetId, r.campaignId);
  const bentrokSet = new Set();
  const lokal = new Map();
  for (const r of unik) {
    const c0 = lokal.get(r.adSetId);
    if (c0 && c0 !== r.campaignId) bentrokSet.add(r.adSetId);
    lokal.set(r.adSetId, c0 ?? r.campaignId);
  }
  const hasil = { baru: [], berubahNama: [], koreksi: [], sama: [], konflik: [], ditolak };
  for (const r of unik) {
    if (bentrokSet.has(r.adSetId)) { ditolak.push({ baris: r.baris, adId: r.adId, alasan: "AD_SET_DI_DUA_CAMPAIGN_DALAM_BERKAS" }); continue; }
    const cTersimpan = campOfSet.get(r.adSetId);
    if (cTersimpan && cTersimpan !== r.campaignId && !(ada.get(r.adId) && izinkanKoreksi)) {
      hasil.konflik.push({ baris: r.baris, adId: r.adId, alasan: "AD_SET_SUDAH_DI_CAMPAIGN_LAIN" }); continue;
    }
    const lama = ada.get(r.adId);
    if (!lama) { hasil.baru.push(r); continue; }
    const induk = lama.adSetId === r.adSetId && lama.campaignId === r.campaignId;
    if (!induk) {
      if (izinkanKoreksi) hasil.koreksi.push({ ...r, sebelumnya: { adSetId: lama.adSetId, campaignId: lama.campaignId } });
      else hasil.konflik.push({ baris: r.baris, adId: r.adId, alasan: "ORANG_TUA_BERBEDA_DARI_REFERENSI" });
      continue;
    }
    const namaBeda = (r.adName ?? lama.adName) !== lama.adName || (r.adSetName ?? lama.adSetName) !== lama.adSetName || (r.campaignName ?? lama.campaignName) !== lama.campaignName;
    (namaBeda ? hasil.berubahNama : hasil.sama).push(r);
  }
  return hasil;
}

export const sidikJari = (teks) => crypto.createHash("sha256").update(String(teks ?? "")).digest("hex");

/**
 * Terapkan impor ke DB dalam SATU transaksi. `dryRun` (default true) hanya menghitung rencana. Tidak pernah menghapus referensi.
 * @returns {Promise<{dryRun, ringkasan, rencana, importId?}>}
 */
export async function jalankanImpor(db, { rows, sumber = "ADS_MANAGER_EXPORT", dryRun = true, izinkanKoreksi = false, namaBerkas = null, sidik = null, userId = null, sekarang = new Date() }) {
  if (!SUMBER_REFERENSI.includes(sumber)) throw Object.assign(new Error("sumber tidak dikenal"), { statusCode: 400 });
  if (sumber === "MARKETING_API") throw Object.assign(new Error("MARKETING_API belum dikonfigurasi di sistem ini (tidak ada kredensial); gunakan ADS_MANAGER_EXPORT"), { statusCode: 400 });
  if (!Array.isArray(rows) || rows.length === 0) throw Object.assign(new Error("tidak ada baris untuk diimpor"), { statusCode: 400 });
  if (rows.length > MAKS_BARIS_IMPOR) throw Object.assign(new Error(`maksimum ${MAKS_BARIS_IMPOR} baris per impor`), { statusCode: 413 });

  const ids = [...new Set(rows.map((r) => String(r.adId ?? "").trim()).filter((x) => ID_RE.test(x)))];
  const setIds = [...new Set(rows.map((r) => String(r.adSetId ?? "").trim()).filter((x) => ID_RE.test(x)))];
  const tersimpan = await db.metaAdReference.findMany({
    where: { OR: [{ adId: { in: ids } }, { adSetId: { in: setIds } }] },
    select: { adId: true, adSetId: true, campaignId: true, adName: true, adSetName: true, campaignName: true },
  });
  const ada = new Map(tersimpan.map((r) => [r.adId, r]));
  const rencana = rencanaImpor(rows, ada, { izinkanKoreksi });
  const ringkasan = {
    total: rows.length, diterima: rencana.baru.length + rencana.berubahNama.length + rencana.koreksi.length + rencana.sama.length,
    baru: rencana.baru.length, berubahNama: rencana.berubahNama.length, koreksi: rencana.koreksi.length, tidakBerubah: rencana.sama.length,
    konflik: rencana.konflik.length, ditolak: rencana.ditolak.length,
  };
  if (dryRun) return { dryRun: true, ringkasan, rencana };

  const tulis = [...rencana.baru, ...rencana.berubahNama, ...rencana.koreksi];
  const impor = await db.$transaction(async (tx) => {
    const imp = await tx.metaAdReferenceImport.create({
      data: {
        source: sumber, fileName: namaBerkas ? String(namaBerkas).slice(0, 120) : null, contentSha256: sidik || sidikJari(JSON.stringify(rows)),
        rowsTotal: ringkasan.total, rowsAccepted: ringkasan.diterima, rowsRejected: ringkasan.ditolak + ringkasan.konflik,
        rowsNew: ringkasan.baru, rowsChanged: ringkasan.berubahNama + ringkasan.koreksi, allowCorrection: !!izinkanKoreksi, createdById: userId,
      },
      select: { id: true },
    });
    for (const r of tulis) {
      const data = { adSetId: r.adSetId, campaignId: r.campaignId, adName: r.adName, adSetName: r.adSetName, campaignName: r.campaignName, source: sumber, syncedAt: sekarang, importId: imp.id };
      await tx.metaAdReference.upsert({ where: { adId: r.adId }, create: { adId: r.adId, ...data }, update: data });
    }
    // baris yang tidak berubah: perbarui waktu sinkronisasi saja (bukti bahwa pemetaan masih berlaku pada impor ini)
    if (rencana.sama.length) {
      await tx.metaAdReference.updateMany({ where: { adId: { in: rencana.sama.map((r) => r.adId) } }, data: { syncedAt: sekarang, importId: imp.id } });
    }
    return imp;
  });
  return { dryRun: false, ringkasan, rencana, importId: impor.id };
}
