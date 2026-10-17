// CATATAN REFERENSI HISTORIS DARI FILE — pratinjau, penyimpanan idempoten, dan status TERKINI. TIDAK PERNAH menulis stock_movements, saldo, GR, Material Issue, adjustment, atau jurnal.
//
// Yang disimpan: apa yang TERTULIS di file (rekap pemakaian per order, log pembelian) per order & Material ID: sumber berkas/baris, jumlah, satuan, tanggal ORDER, waktu impor,
// status verifikasi, alasan blocker. Tanggal pemakaian SELALU kosong (tidak ada bukti): label bulan (SEP/OKT) dan tanggal order BUKAN bukti waktu pemakaian.
//
// T0 (waktu mulai pencatatan baru) TIDAK menyaring baris file. Tanggal order bukan waktu kejadian, jadi baris tidak dibuang karena tanggal order ≥ T0. T0 hanya dipakai untuk
// menandai transaksi RESMI (movement/GR) yang waktu kejadiannya terbukti (createdAt movement / tanggal kedatangan GR) berada sebelum/sesudah T0. Potensi duplikasi dideteksi dari
// order + Material ID + dokumen resmi (Issue di ledger, Material Issue belum diposting, GR), bukan dari tanggal.
//
// STATUS TERKINI diturunkan SAAT DIBACA dari kondisi dokumen resmi sekarang (belum diverifikasi → dokumen resmi belum diposting → sudah ada di resmi) tanpa menunggu impor ulang.
// Perubahan itu juga dapat dicatat sebagai REVISI baru yang append-only (segarkanStatus); revisi lama tetap tersimpan (aktif=false).
import crypto from "node:crypto";
import { petakan, enumSatuan, normNama } from "./stokFileImport.js";
import { bacaPemakaian, bacaPembelian, TIER } from "./stokRiwayatOktober.js";
import { ENTITY_TYPES, EVENT_TYPES, recordActivity } from "../lib/activityLog.js";

export const LABEL_REFERENSI = "REFERENSI HISTORIS DARI FILE — bukan transaksi resmi, bukan saldo, dan bukan bukti tanggal pemakaian";
export const JENIS = Object.freeze({ PAKAI: "PEMAKAIAN_ORDER", TERIMA: "PENERIMAAN_TERBUKTI_TANPA_GR" });
export const STATUS = Object.freeze({
  BELUM: "BELUM_DIVERIFIKASI", RESMI: "SUDAH_ADA_DI_RESMI", DOK_PENDING: "ADA_DOKUMEN_RESMI_BELUM_DIPOSTING", PERIKSA: "PERLU_PEMERIKSAAN", ANTREAN: "PERLU_PENYELESAIAN",
});
export const ANTREAN = Object.freeze({
  TANPA_PASANGAN: "TANPA_PASANGAN", PEMETAAN: "PEMETAAN_PERLU_KONFIRMASI", MASTER_GANDA: "NAMA_MASTER_GANDA", SATUAN_BEDA: "SATUAN_BEDA", SATUAN_CAMPUR: "SATUAN_CAMPUR", ANGKA: "ANGKA_TIDAK_VALID",
});
const r3 = (x) => Math.round(x * 1000) / 1000;
const sha = (x) => crypto.createHash("sha256").update(typeof x === "string" ? x : JSON.stringify(x)).digest("hex");
const up = (s) => String(s || "").trim().toUpperCase();
const AWAL_OKT_ISO = "2026-10-01";
const BULAN_LABEL = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, MEI: 5, JUN: 6, JUL: 7, AUG: 8, AGU: 8, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DES: 12 };
const isoWib = (d) => (d ? new Date(new Date(d).getTime() + 7 * 3600e3).toISOString().slice(0, 10) : null);

/** Kamus alias keputusan MANUSIA: { "NAMA DI FILE": "KODE-MASTER" } → Map(normNama → kode). */
export function normalisasiAlias(alias) {
  const m = new Map(); if (!alias || typeof alias !== "object") return m;
  for (const [nama, kode] of Object.entries(alias)) if (nama && kode) m.set(normNama(nama), String(kode).trim());
  return m;
}

function pemeta(materials, alias) {
  const cache = new Map(); const byCode = new Map(materials.map((m) => [m.code, m]));
  return (nama) => {
    const k = normNama(nama); if (cache.has(k)) return cache.get(k);
    let r;
    if (alias.has(k)) { const m = byCode.get(alias.get(k)); r = m ? { material: m, kelas: "ALIAS_DIKONFIRMASI", catatan: `alias manusia → ${m.code}` } : { material: null, kelas: "TANPA_PASANGAN", catatan: `alias menunjuk kode ${alias.get(k)} yang tidak ada di master` }; }
    else { const p = petakan({ baris: [{ baris: 0, nama }] }, materials)[0]; r = { material: p.material, kelas: p.kelasPemetaan, kandidat: p.kandidat || [], catatan: "" }; }
    cache.set(k, r); return r;
  };
}

function klasifikasiPemetaan(pt) {
  if (pt.material && (pt.kelas === "NAMA_SAMA" || pt.kelas === "ALIAS_DIKONFIRMASI")) return { material: pt.material, antrean: null, alasan: [] };
  if (pt.kelas === "NAMA_MASTER_GANDA") return { material: null, antrean: ANTREAN.MASTER_GANDA, alasan: ["Nama sama dengan lebih dari satu material di master — pilih manual."] };
  if (pt.material && pt.kelas === "NAMA_SAMA_TANPA_TANDA_BACA") return { material: null, antrean: ANTREAN.PEMETAAN, alasan: [`Cocok hanya setelah mengabaikan tanda baca dengan ${pt.material.code} — konfirmasi manusia, tidak dipetakan otomatis.`] };
  if (pt.kelas === "KANDIDAT_BELUM_PASTI") return { material: null, antrean: ANTREAN.PEMETAAN, alasan: [`Hanya mirip: ${(pt.kandidat || []).map((c) => `${c.code} (${c.skor})`).join(", ")} — tidak dipetakan otomatis.`] };
  return { material: null, antrean: ANTREAN.TANPA_PASANGAN, alasan: [pt.catatan || "Tidak ada material master dengan nama ini."] };
}

// ---------- indeks pembanding (resmi) ----------
export function indeksPembanding(pembanding) {
  const issueKey = new Map(); const orderPunyaIssue = new Map(); const pendKey = new Map();
  for (const x of pembanding.issues || []) {
    const o = up(x.orderNumber); if (!o) continue; const k = `${o}|${x.materialId}`;
    const e = issueKey.get(k) || { qty: 0, mov: [], dokumen: new Set(), waktu: null }; e.qty = r3(e.qty + Math.abs(x.qty)); e.mov.push(x.movementId); if (x.dokumen) e.dokumen.add(x.dokumen);
    const w = x.at ? new Date(x.at) : null; if (w && (!e.waktu || w > e.waktu)) e.waktu = w; issueKey.set(k, e); orderPunyaIssue.set(o, (orderPunyaIssue.get(o) || 0) + 1);
  }
  for (const x of pembanding.issuePending || []) for (const o of [up(x.orderNumber), up(x.sourceReference)].filter(Boolean)) {
    const k = `${o}|${x.materialId}`; const e = pendKey.get(k) || { dokumen: new Set() }; e.dokumen.add(`${x.dokumen} (${x.status})`); pendKey.set(k, e);
  }
  return { issueKey, orderPunyaIssue, pendKey, ordersKnown: pembanding.ordersKnown || new Set(), grLines: pembanding.grLines || [] };
}

/**
 * STATUS TERKINI satu baris referensi dari fakta file + kondisi dokumen resmi sekarang. Murni (tanpa DB).
 * fakta: { jenis, materialId, materialKode, nomorOrder, jumlah, suratJalan, tanggalKirim, tanggalOrder, labelBulanFile, antrean }
 * ctx:   { idx: indeksPembanding(), grDipakai: Set, mulai: Date|null }
 * Kembali: { status, dokumenResmi, peringatanDinamis[] }.  T0 TIDAK memengaruhi status; hanya menandai dokumenResmi.setelahT0.
 */
export function statusTerkini(fakta, ctx) {
  const { idx, grDipakai, mulai } = ctx; const peringatan = []; let dokumenResmi = null; let status;
  const tandaiT0 = (w) => (mulai && w ? new Date(w) >= mulai : null);
  if (fakta.jenis === JENIS.PAKAI) {
    if (fakta.materialId) {
      const k = `${up(fakta.nomorOrder)}|${fakta.materialId}`; const iss = idx.issueKey.get(k); const pend = idx.pendKey.get(k);
      if (iss) {
        dokumenResmi = { jenis: "ISSUE_DI_LEDGER", qty: iss.qty, movementIds: iss.mov, dokumen: [...iss.dokumen], waktu: iss.waktu ? iss.waktu.toISOString() : null, setelahT0: tandaiT0(iss.waktu) };
        if (fakta.jumlah != null && Math.abs(iss.qty - Number(fakta.jumlah)) > 0.06) peringatan.push(`QTY_BEDA_DENGAN_RESMI: file ${fakta.jumlah} vs ledger ${iss.qty} — tidak ditimpa dan tidak dicatat ulang.`);
      } else if (pend) {
        dokumenResmi = { jenis: "MATERIAL_ISSUE_BELUM_DIPOSTING", dokumen: [...pend.dokumen] };
        peringatan.push("Ada Material Issue resmi yang belum diposting untuk order+bahan ini — jangan dicatat dari file.");
      } else if (idx.orderPunyaIssue.has(up(fakta.nomorOrder))) peringatan.push(`ORDER_SUDAH_PUNYA_ISSUE_RESMI_BAHAN_LAIN (${idx.orderPunyaIssue.get(up(fakta.nomorOrder))} movement): bahan ini belum tercatat resmi tetapi order sudah sebagian dicatat — periksa agar tidak ganda.`);
    }
    if (!idx.ordersKnown.has(up(fakta.nomorOrder))) peringatan.push("Nomor order tidak ditemukan di SANSS (hanya referensi file).");
    const t0Iso = isoWib(mulai);
    if (t0Iso && fakta.tanggalOrder && fakta.tanggalOrder >= t0Iso) peringatan.push("Tanggal ORDER ≥ T0 (tanggal order bukan tanggal pemakaian): baris tetap disimpan sebagai referensi; periksa duplikasi dengan Material Issue resmi order ini.");
    status = fakta.antrean ? STATUS.ANTREAN : dokumenResmi?.jenis === "ISSUE_DI_LEDGER" ? STATUS.RESMI : dokumenResmi ? STATUS.DOK_PENDING : STATUS.BELUM;
  } else {
    if (fakta.materialKode) {
      const kand = idx.grLines.filter((g) => g.materialCode === fakta.materialKode && !grDipakai.has(`${g.receiptNumber}|${fakta.materialKode}`)).map((g) => {
        const tgl = g.arrivedDate || g.receivedDate; const sj = fakta.suratJalan && g.suratJalan && fakta.suratJalan.replace(/\s/g, "") === g.suratJalan.replace(/\s/g, "");
        const qtySama = g.qty != null && fakta.jumlah != null && Math.abs(g.qty - Number(fakta.jumlah)) <= 0.5; const dekat = tgl && fakta.tanggalKirim && Math.abs((new Date(tgl + "T00:00:00Z") - new Date(fakta.tanggalKirim + "T00:00:00Z")) / 86400000) <= 3;
        return { g, skor: (sj ? 4 : 0) + (qtySama ? 2 : 0) + (dekat ? 1 : 0), sj, qtySama };
      }).filter((x) => x.sj || (x.qtySama && x.skor >= 3)).sort((a, b) => b.skor - a.skor);
      if (kand.length) {
        const g = kand[0].g; grDipakai.add(`${g.receiptNumber}|${fakta.materialKode}`); const tglGr = g.arrivedDate || g.receivedDate || null;
        dokumenResmi = { jenis: "GOODS_RECEIPT", nomor: g.receiptNumber, status: g.status, qty: g.qty, tanggalKedatangan: tglGr, setelahT0: tandaiT0(tglGr ? tglGr + "T00:00:00+07:00" : null) };
        if (g.status !== "COMPLETED") peringatan.push(`GR ${g.receiptNumber} (${g.status}) belum diputaway — stok belum masuk.`);
      } else if (!fakta.antrean) peringatan.push("Terbukti tiba (tanggal kirim aktual) tetapi belum ada GR — ini catatan pemeriksaan, BUKAN stok masuk.");
    }
    status = fakta.antrean ? STATUS.ANTREAN : dokumenResmi ? (dokumenResmi.status === "COMPLETED" ? STATUS.RESMI : STATUS.DOK_PENDING) : STATUS.PERIKSA;
  }
  return { status, dokumenResmi, peringatanDinamis: peringatan };
}

/** Peringatan yang diturunkan dari fakta file saja (stabil). */
export function peringatanStatis(r) {
  const p = [];
  if (r.jenis === JENIS.PAKAI && r.labelBulanFile && r.tanggalOrder && Number(r.tanggalOrder.slice(5, 7)) !== (BULAN_LABEL[String(r.labelBulanFile).toUpperCase()] || -1)) p.push(`Label bulan file "${r.labelBulanFile}" tidak cocok dengan bulan tanggal order — label tidak dipakai.`);
  return p;
}

export function hitungKontenHash(r) {
  return sha({ k: r.kunci, j: r.jenis, m: r.materialId, n: r.namaDiFile, o: r.nomorOrder, q: r.jumlah, s: r.satuanFile, sm: r.satuanMaster, to: r.tanggalOrder, tk: r.tanggalKirim, sj: r.suratJalan, v: r.vendor, l: r.labelBulanFile, f: r.sumberFile, b: r.sumberBaris, st: r.statusVerifikasi, a: r.antrean, bl: r.alasanBlocker, p: r.peringatan, d: r.dokumenResmi });
}

/**
 * @param p.pembanding  { issues:[{orderNumber, materialId, qty, movementId, dokumen, at}], issuePending:[...], ordersKnown:Set, grLines:[{receiptNumber,status,arrivedDate,receivedDate,suratJalan,materialCode,qty}] }
 * @param p.mulai       Date | null — T0. TIDAK menyaring baris; hanya menandai dokumen resmi (setelahT0) dan memberi peringatan duplikasi.
 */
export function susunReferensi({ pakaiCsv = "", beliCsv = "", alias = {}, materials, pembanding, mulai = null, namaBerkasPakai = "Pemakaian Bahan.csv", namaBerkasBeli = "Data Pembelian Supplier.csv" }) {
  const aliasMap = normalisasiAlias(alias); const petaNama = pemeta(materials, aliasMap);
  const rows = []; const abaikan = { bukanBarisData: 0 }; const idx = indeksPembanding(pembanding); const grDipakai = new Set();

  // ---------- PEMAKAIAN ----------
  const pakai = bacaPemakaian(pakaiCsv); const grup = new Map();
  const tambah = (b, valid) => {
    const nama = b.namaMaterial ?? b.nama; const k = `${up(b.resi)}|${normNama(nama)}`;
    const g = grup.get(k) || { resi: up(b.resi), nama, tanggal: b.tanggal, label: b.labelBulan ?? b.label ?? "", qty: 0, satuan: new Set(), baris: [], invalid: [] };
    if (valid) { g.qty = r3(g.qty + b.qty); g.satuan.add(String(b.satuan || "").trim().toUpperCase()); g.baris.push(b.barisCsv); } else { g.invalid.push({ baris: b.baris, qtyMentah: b.qtyMentah, alasan: b.alasan }); g.baris.push(b.baris); if (b.satuan) g.satuan.add(String(b.satuan).trim().toUpperCase()); }
    if (b.tanggal && !g.tanggal) g.tanggal = b.tanggal; grup.set(k, g);
  };
  for (const b of pakai.baris) tambah(b, true);
  for (const t of pakai.tidakDikenal) { if (t.resi) tambah(t, false); else abaikan.bukanBarisData++; }

  for (const g of [...grup.values()].sort((a, b) => (a.resi + normNama(a.nama)).localeCompare(b.resi + normNama(b.nama)))) {
    const kl = klasifikasiPemetaan(petaNama(g.nama)); const m = kl.material; const blocker = [...kl.alasan]; let antrean = kl.antrean;
    const satuanFile = [...g.satuan].filter(Boolean);
    if (g.invalid.length) { antrean = antrean || ANTREAN.ANGKA; blocker.push(`Jumlah tidak terbaca di baris file ${g.invalid.map((i) => `${i.baris} ("${i.qtyMentah}")`).join(", ")}.`); }
    if (satuanFile.length > 1) { antrean = antrean || ANTREAN.SATUAN_CAMPUR; blocker.push(`Satuan campur dalam satu order+bahan: ${satuanFile.join(", ")} — jumlah tidak dijumlahkan.`); }
    if (m && satuanFile.length === 1) {
      const sat = enumSatuan(satuanFile[0]);
      if (!sat || sat !== String(m.unit).toUpperCase()) { antrean = antrean || ANTREAN.SATUAN_BEDA; blocker.push(`Satuan file ${satuanFile[0]}${sat ? "" : " (tidak dikenal)"} ≠ satuan master ${m.unit}; tidak dikonversi otomatis.`); }
    }
    if (m && satuanFile.length === 0) { antrean = antrean || ANTREAN.SATUAN_BEDA; blocker.push("Satuan tidak tertulis di file."); }
    const jumlah = g.invalid.length || satuanFile.length > 1 ? null : g.qty;
    const r = {
      kunci: `RIWAYAT-REF:PAKAI:${g.resi}:${m ? m.code : "NAMA:" + normNama(g.nama)}`, jenis: JENIS.PAKAI, materialId: m ? m.id : null, materialKode: m?.code || null, namaDiFile: g.nama, nomorOrder: g.resi, jumlah, satuanFile: satuanFile.join("/") || "", satuanMaster: m ? String(m.unit) : null,
      tanggalOrder: g.tanggal || null, tanggalPemakaian: null, tanggalKirim: null, suratJalan: null, vendor: null, labelBulanFile: g.label || null, sumberFile: namaBerkasPakai, sumberBaris: [...new Set(g.baris)].sort((a, b) => a - b),
      antrean, alasanBlocker: blocker,
    };
    const st = statusTerkini(r, { idx, grDipakai, mulai });
    Object.assign(r, { statusVerifikasi: st.status, dokumenResmi: st.dokumenResmi, peringatan: [...peringatanStatis(r), ...st.peringatanDinamis] });
    rows.push(r);
  }

  // ---------- PENERIMAAN terbukti tiba (tier A/B) ----------
  const beli = beliCsv ? bacaPembelian(beliCsv) : { events: [], cakupan: {} }; let estimasiDilewati = 0; let lainDilewati = 0;
  for (const ev of beli.events) {
    if (ev.tier === TIER.C) { estimasiDilewati++; continue; }
    if (![TIER.A, TIER.B].includes(ev.tier) || !ev.tanggalKirim || ev.tanggalKirim < AWAL_OKT_ISO || !/BAHAN/i.test(ev.jenis)) { lainDilewati++; continue; }
    const kl = klasifikasiPemetaan(petaNama(ev.nama)); const m = kl.material; const blocker = [...kl.alasan]; let antrean = kl.antrean;
    const sat = enumSatuan(ev.satuan);
    if (m && (!sat || sat !== String(m.unit).toUpperCase())) { antrean = antrean || ANTREAN.SATUAN_BEDA; blocker.push(`Satuan kirim ${ev.satuan}${ev.catatan ? ` (catatan: "${ev.catatan}")` : ""} ≠ satuan master ${m.unit}; tidak dikonversi otomatis.`); }
    const r = {
      kunci: `RIWAYAT-REF:TERIMA:${ev.suratJalan || ev.tanggalKirim}:${m ? m.code : "NAMA:" + normNama(ev.nama)}:${ev.qtyKirim}`, jenis: JENIS.TERIMA, materialId: m ? m.id : null, materialKode: m?.code || null, namaDiFile: ev.nama, nomorOrder: null, jumlah: ev.qtyKirim, satuanFile: ev.satuan,
      satuanMaster: m ? String(m.unit) : null, tanggalOrder: null, tanggalPemakaian: null, tanggalKirim: ev.tanggalKirim, suratJalan: ev.suratJalan || null, vendor: ev.vendor || null, labelBulanFile: ev.bulanLabel || null, sumberFile: namaBerkasBeli, sumberBaris: [ev.barisCsv],
      antrean, alasanBlocker: blocker,
    };
    const st = statusTerkini(r, { idx, grDipakai, mulai });
    Object.assign(r, { statusVerifikasi: st.status, dokumenResmi: st.dokumenResmi, peringatan: [...peringatanStatis(r), ...st.peringatanDinamis] });
    rows.push(r);
  }

  rows.sort((a, b) => a.kunci.localeCompare(b.kunci));
  for (const r of rows) r.kontenHash = hitungKontenHash(r);
  const hashKonten = sha(rows.map((r) => [r.kunci, r.kontenHash]));
  const hitung = (f) => rows.filter(f).length; const tgl = rows.map((r) => r.tanggalOrder).filter(Boolean).sort(); const t0Iso = isoWib(mulai);
  const perBulanOrder = rows.reduce((o, r) => { if (r.tanggalOrder) { const b = r.tanggalOrder.slice(0, 7); o[b] = (o[b] || 0) + 1; } return o; }, {});
  const ringkasan = {
    label: LABEL_REFERENSI, baris: rows.length, pemakaianOrderBahan: hitung((r) => r.jenis === JENIS.PAKAI), penerimaanTerbuktiTanpaGR: hitung((r) => r.jenis === JENIS.TERIMA),
    status: rows.reduce((o, r) => ((o[r.statusVerifikasi] = (o[r.statusVerifikasi] || 0) + 1), o), {}), antrean: rows.reduce((o, r) => (r.antrean ? ((o[r.antrean] = (o[r.antrean] || 0) + 1), o) : o), {}),
    jumlahAntrean: hitung((r) => !!r.antrean), perBulanTanggalOrder: perBulanOrder, resmiSetelahT0: hitung((r) => r.dokumenResmi?.setelahT0 === true), tanggalOrderSetelahT0: t0Iso ? hitung((r) => r.tanggalOrder && r.tanggalOrder >= t0Iso) : null,
    estimasiDilewati, penerimaanLainDilewati: lainDilewati, barisBukanDataDilewati: abaikan.bukanBarisData, dikecualikanKarenaT0: 0,
    cakupan: { tanggalOrderDari: tgl[0] || null, tanggalOrderSampai: tgl[tgl.length - 1] || null, pembelianAktualSampai: beli.cakupan?.aktualSampai || null, catatan: "Tidak ada data pemakaian setelah tanggal order terakhir di atas, dan pembelian aktual setelah tanggal terakhir di atas." },
    tanggalPemakaian: "KOSONG untuk semua baris (tidak ada bukti)", t0: mulai ? mulai.toISOString() : null, t0Aturan: "T0 tidak menyaring baris file; hanya menandai dokumen RESMI yang waktu kejadiannya terbukti setelah T0.",
  };
  return { rows, dikecualikan: [], ringkasan, hashKonten, hash: { pakai: pakaiCsv ? sha(pakaiCsv) : null, beli: beliCsv ? sha(beliCsv) : null, alias: Object.keys(alias || {}).length ? sha(Object.entries(alias).sort()) : null } };
}

// ---------- pembanding dari DB (BACA-SAJA) ----------
export async function muatPembanding(db, { orderNumbers = [] } = {}) {
  const mv = await db.stockMovement.findMany({
    where: { type: "ISSUE" },
    select: { id: true, materialId: true, qty: true, createdAt: true, unit: { select: { order: { select: { orderNumber: true } } } }, materialIssue: { select: { issueNumber: true, sourceReference: true, unit: { select: { order: { select: { orderNumber: true } } } } } } },
  });
  const issues = mv.map((x) => ({ orderNumber: x.unit?.order?.orderNumber || x.materialIssue?.unit?.order?.orderNumber || x.materialIssue?.sourceReference || null, materialId: x.materialId, qty: Number(x.qty), movementId: x.id, dokumen: x.materialIssue?.issueNumber || null, at: x.createdAt })).filter((x) => x.orderNumber);
  const mi = await db.materialIssue.findMany({ where: { status: { in: ["DRAFT", "WAITING_APPROVAL", "APPROVED", "READY_TO_PICK", "PICKED"] } }, select: { issueNumber: true, status: true, sourceReference: true, unit: { select: { order: { select: { orderNumber: true } } } }, lines: { select: { materialId: true, requestedQty: true } } } });
  const issuePending = mi.flatMap((d) => d.lines.map((l) => ({ orderNumber: d.unit?.order?.orderNumber || null, sourceReference: d.sourceReference, materialId: l.materialId, qty: l.requestedQty, dokumen: d.issueNumber, status: d.status })));
  const nomor = [...new Set(orderNumbers.map(up))];
  const ord = nomor.length ? await db.order.findMany({ where: { orderNumber: { in: nomor } }, select: { orderNumber: true } }) : [];
  const gr = await db.goodsReceiptLine.findMany({ select: { acceptedQty: true, receivedQty: true, orderedQty: true, material: { select: { code: true } }, goodsReceipt: { select: { receiptNumber: true, status: true, arrivedDate: true, receivedDate: true, deliveryNote: true } } } });
  const iso = (d) => (d ? d.toISOString().slice(0, 10) : null);
  const grLines = gr.map((l) => ({ receiptNumber: l.goodsReceipt.receiptNumber, status: l.goodsReceipt.status, arrivedDate: iso(l.goodsReceipt.arrivedDate), receivedDate: iso(l.goodsReceipt.receivedDate), suratJalan: l.goodsReceipt.deliveryNote || "", materialCode: l.material.code, qty: l.acceptedQty ?? l.receivedQty ?? l.orderedQty }))
    .sort((a, b) => (a.receiptNumber + a.materialCode).localeCompare(b.receiptNumber + b.materialCode));
  return { issues, issuePending, ordersKnown: new Set(ord.map((o) => up(o.orderNumber))), grLines };
}

export async function pratinjauReferensi(db, input) {
  const materials = (await db.material.findMany({ select: { id: true, code: true, name: true, unit: true, active: true } })).map((m) => ({ ...m, unit: String(m.unit) }));
  const pk = input.pakaiCsv ? bacaPemakaian(input.pakaiCsv) : { baris: [], tidakDikenal: [] };
  const nomor = [...new Set([...pk.baris.map((b) => b.resi), ...pk.tidakDikenal.map((t) => t.resi).filter(Boolean)])];
  const pembanding = await muatPembanding(db, { orderNumbers: nomor });
  return { materials, ...susunReferensi({ ...input, materials, pembanding }) };
}

/** Menyimpan hasil pratinjau. Idempoten: kunci+hash sama → dilewati; hash beda → revisi baru (yang lama aktif=false, tetap tersimpan). Hanya menulis tabel referensi + log aktivitas. */
export async function simpanReferensi(prisma, input, { userId, konfirmasiHash }) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('stok_riwayat_referensi'))");
    const hasil = await pratinjauReferensi(tx, input);
    if (!konfirmasiHash || konfirmasiHash !== hasil.hashKonten) { const e = new Error("Hasil pratinjau berubah atau konfirmasi tidak cocok — jalankan pratinjau ulang dan periksa sebelum menyimpan."); e.statusCode = 409; e.code = "PRATINJAU_BERUBAH"; throw e; }
    const impor = await tx.stokRiwayatImpor.create({ data: {
      diimporOleh: userId || null, berkasPemakaian: input.namaBerkasPakai || null, hashPemakaian: hasil.hash.pakai, berkasPembelian: input.namaBerkasBeli || null, hashPembelian: hasil.hash.beli, hashAlias: hasil.hash.alias, hashKonten: hasil.hashKonten,
      mulaiT0: input.mulai || null, ringkasan: { jenis: "IMPOR", ...hasil.ringkasan } } });
    const kunci = hasil.rows.map((r) => r.kunci);
    const aktif = await tx.stokRiwayatReferensi.findMany({ where: { kunci: { in: kunci }, aktif: true }, select: { id: true, kunci: true, revisi: true, kontenHash: true } });
    const adaMap = new Map(aktif.map((a) => [a.kunci, a]));
    const maks = await tx.stokRiwayatReferensi.groupBy({ by: ["kunci"], where: { kunci: { in: kunci } }, _max: { revisi: true } });
    const maksMap = new Map(maks.map((m) => [m.kunci, m._max.revisi]));
    let baru = 0; let dilewati = 0; let direvisi = 0;
    for (const r of hasil.rows) {
      const ada = adaMap.get(r.kunci);
      if (ada && ada.kontenHash === r.kontenHash) { dilewati++; continue; }
      if (ada) { await tx.stokRiwayatReferensi.update({ where: { id: ada.id }, data: { aktif: false } }); direvisi++; } else baru++;
      await tx.stokRiwayatReferensi.create({ data: dataBaris(r, impor.id, (maksMap.get(r.kunci) || 0) + 1) });
    }
    const hasilSimpan = { imporId: impor.id, baru, dilewati, direvisi, totalBaris: hasil.rows.length };
    await recordActivity(tx, { entityType: ENTITY_TYPES.STOK_RIWAYAT_REFERENSI, entityId: impor.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId || null, metadata: { aksi: "IMPOR_RIWAYAT_REFERENSI", ...hasilSimpan, hashKonten: hasil.hashKonten, catatan: "Hanya catatan referensi; tidak ada movement/saldo/GR/Issue/adjustment/jurnal." } });
    return { ...hasilSimpan, ringkasan: hasil.ringkasan };
  }, { timeout: 120_000 });
}

function dataBaris(r, imporId, revisi) {
  return {
    imporId, kunci: r.kunci, revisi, aktif: true, kontenHash: r.kontenHash, jenis: r.jenis, materialId: r.materialId, namaDiFile: r.namaDiFile, nomorOrder: r.nomorOrder, jumlah: r.jumlah, satuanFile: r.satuanFile, satuanMaster: r.satuanMaster,
    tanggalOrder: r.tanggalOrder ? new Date(r.tanggalOrder + "T00:00:00Z") : null, tanggalPemakaian: null, tanggalKirim: r.tanggalKirim ? new Date(r.tanggalKirim + "T00:00:00Z") : null, suratJalan: r.suratJalan, vendor: r.vendor, labelBulanFile: r.labelBulanFile,
    sumberFile: r.sumberFile, sumberBaris: r.sumberBaris, statusVerifikasi: r.statusVerifikasi, antrean: r.antrean, alasanBlocker: r.alasanBlocker, peringatan: r.peringatan, dokumenResmi: r.dokumenResmi,
  };
}

// ---------- STATUS TERKINI atas baris tersimpan (tanpa impor ulang) ----------
const dariDb = (b) => ({
  kunci: b.kunci, jenis: b.jenis, materialId: b.materialId, materialKode: b.material?.code || null, namaDiFile: b.namaDiFile, nomorOrder: b.nomorOrder, jumlah: b.jumlah == null ? null : Number(b.jumlah), satuanFile: b.satuanFile, satuanMaster: b.satuanMaster,
  tanggalOrder: b.tanggalOrder ? b.tanggalOrder.toISOString().slice(0, 10) : null, tanggalKirim: b.tanggalKirim ? b.tanggalKirim.toISOString().slice(0, 10) : null, suratJalan: b.suratJalan, vendor: b.vendor, labelBulanFile: b.labelBulanFile,
  sumberFile: b.sumberFile, sumberBaris: b.sumberBaris, antrean: b.antrean, alasanBlocker: b.alasanBlocker,
});

/** Menghitung status terkini semua baris AKTIF dari kondisi dokumen resmi sekarang. Baca-saja. Mengembalikan baris tersimpan + {terkini:{status, dokumenResmi, peringatan, kontenHash}, berubah}. */
export async function muatTerkini(db, { materialId = null } = {}) {
  const t0 = (await db.stokRiwayatImpor.findFirst({ where: { mulaiT0: { not: null } }, orderBy: { waktuImpor: "desc" }, select: { mulaiT0: true } }))?.mulaiT0 || null;
  const baris = await db.stokRiwayatReferensi.findMany({ where: { aktif: true, ...(materialId && { materialId }) }, orderBy: { kunci: "asc" }, include: { material: { select: { id: true, code: true, name: true, unit: true } }, impor: { select: { waktuImpor: true } } } });
  const pembanding = await muatPembanding(db, { orderNumbers: baris.map((b) => b.nomorOrder).filter(Boolean) });
  const idx = indeksPembanding(pembanding); const grDipakai = new Set();
  const hasil = baris.map((b) => {
    const f = dariDb(b); const st = statusTerkini(f, { idx, grDipakai, mulai: t0 });
    const turunan = { ...f, statusVerifikasi: st.status, dokumenResmi: st.dokumenResmi, peringatan: [...peringatanStatis(f), ...st.peringatanDinamis] };
    const kontenHash = hitungKontenHash(turunan);
    return { baris: b, terkini: { status: st.status, dokumenResmi: st.dokumenResmi, peringatan: turunan.peringatan, kontenHash }, berubah: kontenHash !== b.kontenHash, fakta: f };
  });
  return { hasil, t0 };
}

/** Mencatat perubahan status sebagai REVISI baru (append-only): baris lama aktif=false, revisi baru memuat status/dokumen resmi terkini. Idempoten: tanpa perubahan → tidak menulis apa pun. */
export async function segarkanStatus(prisma, { userId = null } = {}) {
  return prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SELECT pg_advisory_xact_lock(hashtext('stok_riwayat_referensi'))");
    const { hasil, t0 } = await muatTerkini(tx);
    const ubah = hasil.filter((h) => h.berubah);
    if (!ubah.length) return { direvisi: 0, totalAktif: hasil.length, perubahan: [] };
    const maks = await tx.stokRiwayatReferensi.groupBy({ by: ["kunci"], where: { kunci: { in: ubah.map((u) => u.baris.kunci) } }, _max: { revisi: true } });
    const maksMap = new Map(maks.map((m) => [m.kunci, m._max.revisi]));
    const perubahan = ubah.map((u) => ({ kunci: u.baris.kunci, dari: u.baris.statusVerifikasi, ke: u.terkini.status }));
    const hashKonten = sha(ubah.map((u) => [u.baris.kunci, u.terkini.kontenHash]));
    const impor = await tx.stokRiwayatImpor.create({ data: { diimporOleh: userId, hashKonten, mulaiT0: t0, ringkasan: { jenis: "SEGARKAN_STATUS", direvisi: ubah.length, perubahan: perubahan.slice(0, 200), catatan: "Revisi status karena kondisi dokumen resmi berubah; tanpa impor ulang file." } } });
    for (const u of ubah) {
      await tx.stokRiwayatReferensi.update({ where: { id: u.baris.id }, data: { aktif: false } });
      const r = { ...u.fakta, statusVerifikasi: u.terkini.status, dokumenResmi: u.terkini.dokumenResmi, peringatan: u.terkini.peringatan, kontenHash: u.terkini.kontenHash };
      await tx.stokRiwayatReferensi.create({ data: dataBaris(r, impor.id, (maksMap.get(u.baris.kunci) || u.baris.revisi) + 1) });
    }
    await recordActivity(tx, { entityType: ENTITY_TYPES.STOK_RIWAYAT_REFERENSI, entityId: impor.id, eventType: EVENT_TYPES.DOCUMENT_EDITED, actorId: userId, metadata: { aksi: "SEGARKAN_STATUS_REFERENSI", direvisi: ubah.length, contoh: perubahan.slice(0, 20), catatan: "Hanya catatan referensi; tidak ada movement/saldo/GR/Issue/adjustment/jurnal." } });
    return { direvisi: ubah.length, totalAktif: hasil.length, imporId: impor.id, perubahan: perubahan.slice(0, 200) };
  }, { timeout: 120_000 });
}
