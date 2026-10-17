// REKONSILIASI RIWAYAT OKTOBER PER MATERIAL ID — BACA-SAJA (pratinjau). Tidak membuat movement, adjustment, jurnal, atau dokumen.
//
// Sumber: Stock September/Oktober (hitung PARSIAL per bahan), rekap pemakaian per order, rekap order, log pembelian supplier, dokumen GR/PO + ledger sistem.
// Prinsip:
//  • Struktur CSV dibaca dari ISI, bukan dari header (ekspor rekap: kolom tanggal bergeser; label bulan tidak dipercaya, tanggal sel ISO yang dipakai).
//  • Hitung September/1 Oktober = hitung parsial bahan yang punya angka; BUKAN SO penuh dan BUKAN saldo awal resmi. Absen/kosong = belum diketahui, bukan nol.
//  • PO saja BUKAN bukti stok masuk. Bukti tiba = tanggal kirim aktual (+ surat jalan/GR). Estimasi ("EST", "estimasi") bukan bukti.
//  • Kunci idempoten per peristiwa (GR / pemakaian per order): peristiwa yang sudah ada di ledger (dokumen GR atau unit order) TIDAK dihitung dua kali.
//  • Peristiwa pada/setelah waktu mulai pencatatan baru (T0) tidak diambil dari file: sistem yang mencatatnya. Riwayat tidak menimpa transaksi baru.
import { parseCsvText, parseAngkaId, enumSatuan, normNama } from "./stokFileImport.js";

const r4 = (x) => Math.round(x * 10000) / 10000;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const RESI = /^([A-Z]{2,5})-(\d{2})(\d{2})(\d{4})-(\d+)$/;
const BULAN = { jan: 1, januari: 1, feb: 2, februari: 2, mar: 3, maret: 3, apr: 4, april: 4, mei: 5, may: 5, jun: 6, juni: 6, jul: 7, juli: 7, agu: 8, agt: 8, aug: 8, agustus: 8, sep: 9, sept: 9, september: 9, okt: 10, oct: 10, oktober: 10, nov: 11, november: 11, des: 12, dec: 12, desember: 12 };
const LABEL_BULAN = { JAN: 1, FEB: 2, MAR: 3, APR: 4, MAY: 5, MEI: 5, JUN: 6, JUL: 7, AUG: 8, AGU: 8, SEP: 9, OKT: 10, OCT: 10, NOV: 11, DES: 12 };

/** "25 Desember 2025" | "9 Oktober 2026" → {iso, estimasi:false}; "EST 9 oct" / "estimasi 12 OCT" → {iso:'2026-10-09', estimasi:true, tahunDiasumsikan:true}. */
export function parseTanggalId(mentah, tahunBawaan = 2026) {
  const t = String(mentah ?? "").trim(); if (!t) return null;
  const est = /^(estimasi|perkiraan|est)\b/i.test(t);
  const m = t.replace(/^(estimasi|perkiraan|est)\b\.?\s*/i, "").match(/^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{4}))?$/);
  if (!m) return null;
  const bln = BULAN[m[2].toLowerCase()]; if (!bln) return null;
  const th = m[3] ? Number(m[3]) : tahunBawaan; const d = Number(m[1]);
  return { iso: `${th}-${String(bln).padStart(2, "0")}-${String(d).padStart(2, "0")}`, estimasi: est, tahunDiasumsikan: !m[3] };
}

const angka = (s) => parseAngkaId(String(s ?? "").replace(/^Rp\s*/i, ""));

// ---------- rekap pemakaian bahan per order ----------
export function bacaPemakaian(text) {
  const R = parseCsvText(text); const baris = []; const tidakDikenal = []; const posTanggal = {}; const kombinasi = {};
  for (let i = 0; i < R.length; i++) {
    const r = R[i]; const resi = (r[1] || "").trim();
    if (!RESI.test(resi) || !/^\d+$/.test((r[0] || "").trim())) { if (r.some((c) => (c || "").trim()) && i >= 3) tidakDikenal.push({ baris: i + 1, alasan: "bukan baris data (No/Resi tidak dikenal)" }); continue; }
    const idxIso = r.findIndex((c, j) => j >= 2 && j <= 9 && ISO.test((c || "").trim()));
    const nama = (r[11] || "").trim(); const qty = angka(r[14]); const satuan = (r[15] || "").trim();
    if (idxIso < 0 || !nama || qty.status !== "OK" && qty.status !== "RIBUAN_DIASUMSIKAN") { tidakDikenal.push({ baris: i + 1, resi, nama, qtyMentah: (r[14] || "").trim(), satuan, tanggal: idxIso >= 0 ? r[idxIso].trim() : null, label: idxIso >= 0 ? (r[idxIso + 1] || "").trim().toUpperCase() : "", alasan: idxIso < 0 ? "tanggal ISO tidak ditemukan di kolom 3–10" : !nama ? "nama material kosong" : `qty "${r[14]}" tidak valid` }); continue; }
    const tanggal = r[idxIso].trim(); const label = (r[idxIso + 1] || "").trim().toUpperCase();
    posTanggal[idxIso + 1] = (posTanggal[idxIso + 1] || 0) + 1;
    const bT = Number(tanggal.slice(5, 7)); const bL = LABEL_BULAN[label] || null;
    const k = `tanggal bulan ${bT} / label ${label || "-"}`; kombinasi[k] = (kombinasi[k] || 0) + 1;
    const mr = RESI.exec(resi); const tglResi = `${mr[4]}-${mr[3]}-${mr[2]}`;
    baris.push({ barisCsv: i + 1, no: Number(r[0]), resi, tanggal, tanggalSamaDenganResi: tglResi === tanggal, labelBulan: label, labelCocokTanggal: bL === bT, namaMaterial: nama, qty: qty.nilai, qtyMentah: r[14], satuan, kategori: (r[10] || "").trim(), qc: (r[21] || "").trim() });
  }
  const tgl = baris.map((b) => b.tanggal).sort();
  const perTanggal = baris.reduce((o, b) => ((o[b.tanggal] = (o[b.tanggal] || 0) + 1), o), {});
  return { baris, tidakDikenal, struktur: { kolomTanggalPosisi: posTanggal, catatan: "Sel tanggal ISO berada di kolom 9 (header menyebutnya 'PIC / Teknisi'); kolom 3–4 berisi status & PIC, bukan tanggal/bulan.", labelBulanTidakDipercaya: baris.filter((b) => !b.labelCocokTanggal).length, tanggalSamaDenganNomorResi: baris.filter((b) => b.tanggalSamaDenganResi).length, jumlahBaris: baris.length, kombinasiTanggalLabel: kombinasi }, cakupan: { dari: tgl[0] || null, sampai: tgl[tgl.length - 1] || null, perTanggal } };
}

// ---------- rekap order (ringkasan per order) ----------
export function bacaRekapOrder(text) {
  const R = parseCsvText(text); const orders = [];
  for (let i = 0; i < R.length; i++) {
    const r = R[i]; const resi = (r[1] || "").trim(); if (!RESI.test(resi) || !/^\d+$/.test((r[0] || "").trim())) continue;
    const idx = r.findIndex((c, j) => j >= 2 && j <= 9 && ISO.test((c || "").trim())); if (idx < 0) continue;
    orders.push({ barisCsv: i + 1, resi, tanggal: r[idx].trim(), status: (r[2] || "").trim(), jenisKerja: (r[7] || "").trim() });
  }
  const tgl = orders.map((o) => o.tanggal).sort();
  return { orders, cakupan: { dari: tgl[0] || null, sampai: tgl[tgl.length - 1] || null } };
}

// ---------- log pembelian supplier ----------
export const TIER = Object.freeze({ A: "A_AKTUAL_DENGAN_SURAT_JALAN", B: "B_AKTUAL_TANPA_SURAT_JALAN", C: "C_ESTIMASI", D: "D_PO_SAJA" });
export function bacaPembelian(text) {
  const R = parseCsvText(text); const h = R[0] || []; const idx = (nama) => h.findIndex((x) => String(x).trim().toLowerCase() === nama.toLowerCase());
  const K = { bulan: idx("BULAN KRM"), tglPO: idx("TGL PO"), tglKirim: idx("TANGGAL KIRIM"), sj: idx("NO SURAT JALAN"), jenis: idx("JENIS"), nama: idx("Product Description"), vendor: idx("VENDOR NAME"), satuan: idx("satuan"), po: idx("PO"), kirim: idx("QTY kirim"), catatan: idx("CATATAN"), bayar: idx("PEMBAYARAN") };
  const hilang = Object.entries(K).filter(([, v]) => v < 0).map(([k]) => k); if (hilang.length) throw new Error("Kolom log pembelian tidak ditemukan: " + hilang.join(", "));
  const events = [];
  for (let i = 1; i < R.length; i++) {
    const r = R[i]; if (!r.some((c) => (c || "").trim())) continue; const nama = (r[K.nama] || "").trim(); if (!nama) continue;
    const kirim = parseTanggalId(r[K.tglKirim]); const po = parseTanggalId(r[K.tglPO]);
    const sj = (r[K.sj] || "").trim(); const qKirim = angka(r[K.kirim]); const qPO = angka(r[K.po]);
    let tier = TIER.D; let tanggal = null;
    if (kirim && !kirim.estimasi) { tanggal = kirim.iso; tier = sj ? TIER.A : TIER.B; } else if (kirim && kirim.estimasi) { tanggal = kirim.iso; tier = TIER.C; }
    events.push({ barisCsv: i + 1, bulanLabel: (r[K.bulan] || "").trim(), tglPO: po?.iso || null, tanggalKirim: tanggal, estimasi: !!kirim?.estimasi, tglKirimMentah: (r[K.tglKirim] || "").trim(), suratJalan: sj, jenis: (r[K.jenis] || "").trim(), nama, vendor: (r[K.vendor] || "").trim(), satuan: (r[K.satuan] || "").trim(),
      qtyPO: qPO.nilai, qtyKirim: qKirim.nilai, catatan: (r[K.catatan] || "").trim(), pembayaran: (r[K.bayar] || "").trim(), tier });
  }
  const aktual = events.filter((e) => e.tier === TIER.A || e.tier === TIER.B).map((e) => e.tanggalKirim).sort();
  return { events, cakupan: { aktualDari: aktual[0] || null, aktualSampai: aktual[aktual.length - 1] || null, estimasi: events.filter((e) => e.tier === TIER.C).length } };
}

// ---------- kunci idempoten ----------
export const kunciGR = (e, kode) => `RIWAYAT-OKT:GR:${e.suratJalan || e.tanggalKirim}:${kode}:${e.qtyKirim}`;
export const kunciPakai = (resi, kode) => `RIWAYAT-OKT:ISSUE:${resi}:${kode}`;

const normResi = (s) => String(s || "").trim().toUpperCase();
const resiDariUnit = (unitCode) => { const m = String(unitCode || "").toUpperCase().match(/^(.*\d)-U\d+$/); return m ? m[1] : String(unitCode || "").toUpperCase(); };
const hariSelisih = (a, b) => Math.abs((new Date(a + "T00:00:00Z") - new Date(b + "T00:00:00Z")) / 86400000);

/**
 * @param p.pemetaanNama   fn(nama:string) → {material|null, kelas}   (pemetaan nama → master; nama sama / tanpa tanda baca / alias)
 * @param p.materials      [{id, code, name, unit, active}]
 * @param p.ledger         Map(materialId → [{id, type, qty, createdAt: Date, dokumen, jalur, grArrivedDate}])
 * @param p.issueLedger    [{materialCode, qty (negatif), unitCode, note, createdAt: Date}]
 * @param p.grLines        [{receiptNumber, status, arrivedDate, receivedDate, suratJalan, buktiFoto, materialCode, orderedQty, receivedQty, acceptedQty, poNumber}]
 * @param p.poLines        [{poNumber, status, supplier, materialCode, qty, unit}]
 * @param p.stok           Map(materialId → {sep, sepMentah, masukOkt, keluarOkt, sisaOkt, qtyOkt, satuanSep, barisCsv})  (dari Sano-Stock; kosong = null)
 * @param p.pakai          hasil bacaPemakaian(); p.beli hasil bacaPembelian(); p.rekap hasil bacaRekapOrder()
 * @param p.mulai          Date — waktu mulai pencatatan transaksi baru (T0); peristiwa ≥ T0 tidak diimpor dari file
 * @param p.awalOktober    Date (default 1 Okt 00:00 WIB)
 */
export function rekonsiliasiRiwayat({ pemetaanNama, materials, ledger, issueLedger = [], grLines = [], poLines = [], stok = new Map(), pakai, beli, rekap, mulai = null, awalOktober = new Date("2026-09-30T17:00:00Z"), pending = [] }) {
  const awalIso = new Date(awalOktober.getTime() + 7 * 3600e3).toISOString().slice(0, 10);
  const mulaiIso = mulai ? new Date(mulai.getTime() + 7 * 3600e3).toISOString().slice(0, 10) : null;
  const byCode = new Map(materials.map((m) => [m.code, m]));
  const bahan = new Map();
  const ambil = (m) => bahan.get(m.id) || bahan.set(m.id, { m, pakai: [], terima: [], grTanpaLog: [], isu: [], tidakDipakaiSetelahMulai: [] }).get(m.id);
  const luar = { pakaiTanpaPasangan: [], beliTanpaPasangan: [] };

  // --- ledger issue per (resi, kode)
  const issuePerOrder = new Map();
  for (const x of issueLedger) { const k = `${resiDariUnit(x.unitCode)}|${x.materialCode}`; const o = issuePerOrder.get(k) || { qty: 0, n: 0 }; o.qty = r4(o.qty + Math.abs(x.qty)); o.n++; issuePerOrder.set(k, o); }

  // --- pemakaian
  const grupPakai = new Map();
  for (const b of pakai?.baris || []) {
    const pt = pemetaanNama(b.namaMaterial);
    if (!pt.material) { luar.pakaiTanpaPasangan.push({ resi: b.resi, nama: b.namaMaterial, qty: b.qty, tanggal: b.tanggal, kelas: pt.kelas }); continue; }
    const k = `${normResi(b.resi)}|${pt.material.code}`; const g = grupPakai.get(k) || { m: pt.material, resi: normResi(b.resi), tanggal: b.tanggal, label: b.labelBulan, qty: 0, satuan: new Set(), barisCsv: [], qc: b.qc }; g.qty = r4(g.qty + b.qty); g.satuan.add(b.satuan); g.barisCsv.push(b.barisCsv); grupPakai.set(k, g);
  }
  for (const [k, g] of grupPakai) {
    const e = ambil(g.m); const led = issuePerOrder.get(k); const unitMaster = String(g.m.unit).toUpperCase(); const satFile = [...g.satuan].map((s) => enumSatuan(s)).filter(Boolean);
    const satOk = satFile.length > 0 && satFile.every((s) => s === unitMaster);
    let status = !led ? "BELUM_DI_LEDGER" : Math.abs(led.qty - g.qty) <= 0.06 ? "SUDAH_DI_LEDGER_SAMA" : "SUDAH_DI_LEDGER_QTY_BEDA";
    const setelahMulai = mulaiIso && g.tanggal >= mulaiIso;
    const rec = { resi: g.resi, tanggal: g.tanggal, labelBulan: g.label, tanggalOkt: g.tanggal >= awalIso, labelOkt: g.label === "OKT", qtyRekap: g.qty, satuanRekap: [...g.satuan].join("/"), satuanSesuaiMaster: satOk, qtyLedger: led ? led.qty : 0, status, kunci: kunciPakai(g.resi, g.m.code), barisCsv: g.barisCsv, qc: g.qc };
    // T0 TIDAK menyaring: tanggal order bukan tanggal pemakaian. Baris tetap masuk; hanya ditandai agar diperiksa terhadap Material Issue resmi (anti-ganda per order+bahan).
    if (setelahMulai) rec.tanggalOrderSetelahT0 = true;
    e.pakai.push(rec);
  }
  // issue ledger yang tidak ada di rekap
  for (const [k, led] of issuePerOrder) { if (!grupPakai.has(k)) { const kode = k.split("|")[1]; const m = byCode.get(kode); if (m) ambil(m).isu.push({ kode: "ISSUE_LEDGER_TANPA_BARIS_REKAP", pesan: `Ledger punya ISSUE ${led.qty} untuk ${k.split("|")[0]} yang tidak ada di rekap pemakaian.` }); } }

  // --- penerimaan: log pembelian ↔ GR
  const grPerKode = new Map(); for (const g of grLines) (grPerKode.get(g.materialCode) || grPerKode.set(g.materialCode, []).get(g.materialCode)).push(g);
  const dipakaiGR = new Set();
  for (const ev of beli?.events || []) {
    if (!ev.tanggalKirim && ev.tier === TIER.D) continue; // baris lama tanpa tanggal kirim: bukan pengiriman
    if (ev.tanggalKirim && ev.tanggalKirim < awalIso && ev.tier !== TIER.C) continue; // sebelum Oktober: di luar rekonsiliasi Oktober
    if (/ONGKIR|PERLENGKAPAN/i.test(ev.jenis) && !ev.jenis.match(/BAHAN/i)) continue;
    const pt = pemetaanNama(ev.nama); if (!pt.material) { luar.beliTanpaPasangan.push({ nama: ev.nama, vendor: ev.vendor, qty: ev.qtyKirim, tanggal: ev.tanggalKirim, tier: ev.tier, kelas: pt.kelas }); continue; }
    const e = ambil(pt.material); const kode = pt.material.code; const unitMaster = String(pt.material.unit).toUpperCase();
    const satEv = enumSatuan(ev.satuan); const satOk = satEv && satEv === unitMaster;
    const faktor = /(\d+(?:[.,]\d+)?)\s*(?:BATANG|BTG|PCS|KG|M|METER)\b/i.exec(ev.catatan);
    const rec = { tier: ev.tier, tanggalKirim: ev.tanggalKirim, suratJalan: ev.suratJalan, vendor: ev.vendor, qtyKirim: ev.qtyKirim, satuan: ev.satuan, satuanSesuaiMaster: !!satOk, catatan: ev.catatan, barisCsv: ev.barisCsv, kunci: kunciGR(ev, kode), status: "", gr: null };
    if (ev.tier === TIER.C) { rec.status = "ESTIMASI_BUKAN_BUKTI"; e.terima.push(rec); continue; }
    if (mulaiIso && ev.tanggalKirim >= mulaiIso) rec.tanggalKirimSetelahT0 = true; // tidak dibuang; dicocokkan ke GR resmi di bawah
    // cocokkan dengan baris GR (belum dipakai): surat jalan sama, atau qty sama (±0,5) dan tanggal tiba ±3 hari
    const kand = (grPerKode.get(kode) || []).filter((g) => !dipakaiGR.has(g.receiptNumber + "|" + kode)).map((g) => {
      const qtyGr = g.acceptedQty ?? g.receivedQty ?? g.orderedQty; const tgl = g.arrivedDate || g.receivedDate;
      const sjSama = ev.suratJalan && g.suratJalan && ev.suratJalan.replace(/\s/g, "") === g.suratJalan.replace(/\s/g, "");
      const qtySama = qtyGr != null && ev.qtyKirim != null && Math.abs(qtyGr - ev.qtyKirim) <= 0.5; const tglDekat = tgl && hariSelisih(tgl, ev.tanggalKirim) <= 3;
      return { g, qtyGr, skor: (sjSama ? 4 : 0) + (qtySama ? 2 : 0) + (tglDekat ? 1 : 0), qtySama, sjSama };
    }).filter((x) => x.sjSama || (x.qtySama && x.skor >= 3)).sort((a, b) => b.skor - a.skor);
    if (kand.length) {
      const { g, qtyGr } = kand[0]; dipakaiGR.add(g.receiptNumber + "|" + kode);
      const selesai = g.status === "COMPLETED";
      rec.gr = { nomor: g.receiptNumber, status: g.status, qty: qtyGr, arrivedDate: g.arrivedDate, suratJalan: g.suratJalan };
      rec.status = selesai ? "SUDAH_DI_LEDGER_VIA_GR" : "GR_ADA_BELUM_DIPUTAWAY";
    } else rec.status = "TERBUKTI_TIBA_BELUM_ADA_GR";
    e.terima.push(rec);
  }
  // GR di ledger/GR Oktober yang tidak punya padanan di log pembelian
  for (const g of grLines) {
    const m = byCode.get(g.materialCode); if (!m) continue; const tgl = g.arrivedDate || g.receivedDate; if (tgl && tgl < awalIso) continue;
    if (dipakaiGR.has(g.receiptNumber + "|" + g.materialCode)) continue;
    const e = ambil(m); e.grTanpaLog.push({ nomor: g.receiptNumber, status: g.status, tanggal: tgl, suratJalan: g.suratJalan, qty: g.acceptedQty ?? g.receivedQty ?? g.orderedQty, bukti: g.status === "COMPLETED" || !!tgl ? "ADA_DI_SISTEM" : "RENCANA_TANPA_KEDATANGAN" });
  }
  // PO terbuka tanpa GR = bukan stok
  const poTerbuka = new Map();
  for (const p of poLines) { if (!["DISETUJUI", "DITERIMA_SEBAGIAN"].includes(p.status)) continue; const m = byCode.get(p.materialCode); if (!m) continue; (poTerbuka.get(m.id) || poTerbuka.set(m.id, []).get(m.id)).push(p); }

  // --- gabungkan per material (termasuk bahan yang hanya ada di Sano-Stock)
  for (const [id, s] of stok) { const m = materials.find((x) => x.id === id); if (m) ambil(m); void s; }
  const hasil = [];
  const T9 = new Date("2026-10-09T16:59:59Z");
  for (const [id, e] of bahan) {
    const m = e.m; const mv = (ledger.get(id) || []).slice().sort((a, b) => a.createdAt - b.createdAt);
    const ledgerKini = r4(mv.reduce((s, x) => s + x.qty, 0)); const ledgerAwalOkt = r4(mv.filter((x) => x.createdAt <= awalOktober).reduce((s, x) => s + x.qty, 0)); const ledger9 = r4(mv.filter((x) => x.createdAt <= T9).reduce((s, x) => s + x.qty, 0));
    const st = stok.get(id) || null; const isu = [...e.isu]; const add = (level, kode, pesan) => isu.push({ level, kode, pesan });
    const unitMaster = String(m.unit).toUpperCase();
    const titik = [];
    if (st?.sep != null) titik.push({ jenis: "HITUNG_PARSIAL_SEPTEMBER", angka: st.sep, satuan: st.satuanSep || "", waktu: null, bukti: `Sano-Stock baris ${st.barisCsv}, kolom QTY SEP; tanggal/jam hitung tidak tercantum`, tingkat: "TANPA_TANGGAL" });
    if (st?.qtyOkt != null) titik.push({ jenis: "HITUNG_PARSIAL_1_OKTOBER", angka: st.qtyOkt, satuan: st.satuanSep || "", waktu: "1 Okt 2026 (klaim; tidak tercantum di file)", bukti: `Sano-Stock baris ${st.barisCsv}, kolom QTY OKT`, tingkat: "KLAIM_TANPA_BUKTI_WAKTU" });
    const terbukti = e.terima.filter((t) => [TIER.A, TIER.B].includes(t.tier));
    const terimaBelumLedger = terbukti.filter((t) => t.status === "TERBUKTI_TIBA_BELUM_ADA_GR" || t.status === "GR_ADA_BELUM_DIPUTAWAY");
    const terimaSudahLedger = terbukti.filter((t) => t.status === "SUDAH_DI_LEDGER_VIA_GR");
    for (const t of terbukti) if (!t.satuanSesuaiMaster) add("PERINGATAN", "SATUAN_PENERIMAAN_BEDA", `Penerimaan ${t.qtyKirim} ${t.satuan} ≠ satuan master ${m.unit}${t.catatan ? ` (catatan: "${t.catatan}")` : ""} — tidak dikonversi otomatis.`);
    // Tanggal sel = tanggal pada nomor resi (tanggal order), BUKAN bukti tanggal pemakaian; label bulan juga tidak terbukti. Batas bawah: order bertanggal Oktober; batas atas: + order berlabel OKT bertanggal September.
    const pakaiOkt = e.pakai.filter((p) => p.tanggalOkt); const pakaiOktBelum = pakaiOkt.filter((p) => p.status === "BELUM_DI_LEDGER");
    const pakaiLabelOktSebelum = e.pakai.filter((p) => !p.tanggalOkt && p.labelOkt && p.status === "BELUM_DI_LEDGER");
    const pakaiSeptBelum = e.pakai.filter((p) => !p.tanggalOkt && !p.labelOkt && p.status === "BELUM_DI_LEDGER");
    const setelahT0 = e.pakai.filter((p) => p.tanggalOrderSetelahT0 && p.status === "BELUM_DI_LEDGER"); if (setelahT0.length) add("PERINGATAN", "ORDER_SETELAH_T0_BELUM_DI_LEDGER", `${setelahT0.length} order bertanggal ≥ T0 belum punya Issue resmi untuk bahan ini (tanggal order bukan tanggal pemakaian) — periksa terhadap Material Issue resmi sebelum dianggap perlu dicatat.`);
    for (const p of e.pakai) { if (!p.satuanSesuaiMaster) add("PERINGATAN", "SATUAN_PEMAKAIAN_BEDA", `Pemakaian ${p.resi}: satuan rekap ${p.satuanRekap} ≠ master ${m.unit}.`); }
    const qtyBeda = e.pakai.filter((p) => p.status === "SUDAH_DI_LEDGER_QTY_BEDA"); if (qtyBeda.length) add("PERINGATAN", "PEMAKAIAN_QTY_BEDA_DENGAN_LEDGER", `${qtyBeda.length} order: qty rekap ≠ ledger (${qtyBeda.slice(0, 3).map((p) => `${p.resi} ${p.qtyRekap} vs ${p.qtyLedger}`).join("; ")}). Tidak ditimpa, tidak dicatat dua kali.`);
    if (e.terima.some((t) => t.status === "ESTIMASI_BUKAN_BUKTI")) add("PERINGATAN", "ESTIMASI_KEDATANGAN", "Ada kedatangan hanya berstatus estimasi — bukan bukti stok masuk.");
    const po = poTerbuka.get(id) || []; if (po.length) add("PERINGATAN", "PO_TERBUKA_BUKAN_STOK", `PO terbuka ${[...new Set(po.map((p) => `${p.poNumber} (${p.status})`))].join(", ")} — PO bukan bukti stok masuk.`);
    const pend = pending.filter((p) => p.materialCode === m.code); if (pend.length) add("PERINGATAN", "DOKUMEN_TERTUNDA", `Dokumen tertunda: ${[...new Set(pend.map((p) => p.dok))].join(", ")}.`);
    if (e.grTanpaLog.length) add("PERINGATAN", "GR_TANPA_LOG_PEMBELIAN", `GR ${e.grTanpaLog.map((g) => g.nomor).join(", ")} tidak punya padanan di log pembelian.`);
    if (ledgerKini < -1e-6) add("PERINGATAN", "LEDGER_NEGATIF", `Ledger kini ${ledgerKini}.`);
    if (st && st.satuanSep && enumSatuan(st.satuanSep) && enumSatuan(st.satuanSep) !== unitMaster) add("BLOCKER", "SATUAN_STOK_BEDA", `Satuan Sano-Stock ${st.satuanSep} ≠ master ${m.unit} — angka hitung parsial tidak sebanding.`);
    // perkiraan: SEP + penerimaan terbukti (satu kali) − pemakaian rekap Okt (1–9 Okt)
    const sepOk = st?.sep != null && !isu.some((i) => i.kode === "SATUAN_STOK_BEDA");
    // Penerimaan yang tiba pada/sebelum 1 Okt padahal ada hitung parsial: bisa sudah ada di fisik saat dihitung → tidak ditambahkan (hindari hitung ganda), dilaporkan.
    const sekitarHitung = st?.sep != null || st?.qtyOkt != null ? terbukti.filter((t) => t.tanggalKirim && t.tanggalKirim <= awalIso) : [];
    if (sekitarHitung.length) add("PERINGATAN", "PENERIMAAN_SEKITAR_HITUNG", `Penerimaan tiba ${sekitarHitung.map((t) => `${t.tanggalKirim} (${t.qtyKirim} ${t.satuan})`).join(", ")} pada/sebelum 1 Okt: bisa sudah termasuk hitung parsial — tidak ditambahkan ke perkiraan agar tidak terhitung dua kali.`);
    const terimaOk = terbukti.filter((t) => t.satuanSesuaiMaster && !sekitarHitung.includes(t)); const terimaAngka = terimaOk.reduce((s, t) => s + (t.gr ? t.gr.qty : t.qtyKirim ?? 0), 0);
    const jml = (arr) => arr.filter((p) => p.satuanSesuaiMaster && p.status === "BELUM_DI_LEDGER").reduce((s, p) => s + p.qtyRekap, 0);
    const pakaiBawah = jml(pakaiOkt); const pakaiAtas = pakaiBawah + jml(pakaiLabelOktSebelum);
    const perkiraan9Okt = sepOk ? r4(st.sep + terimaAngka - pakaiBawah) : null; const perkiraan9OktAtas = sepOk ? r4(st.sep + terimaAngka - pakaiAtas) : null;
    const selisih9Okt = perkiraan9Okt != null ? r4(perkiraan9Okt - ledger9) : null; const selisih9OktAtas = perkiraan9OktAtas != null ? r4(perkiraan9OktAtas - ledger9) : null;
    const belumPasti = [];
    if (st?.sep == null) belumPasti.push("Tidak ada hitung parsial (QTY SEP kosong): saldo awal tidak diketahui — kosong bukan nol.");
    if (st?.sep != null) belumPasti.push("Tanggal/jam hitung September tidak terbukti, dan tanggal rekap = tanggal order: " + pakaiLabelOktSebelum.length + " order berlabel OKT bertanggal September (belum di ledger) bisa jatuh sebelum atau sesudah hitung — ditampilkan sebagai batas atas.");
    if (terbukti.some((t) => !t.satuanSesuaiMaster)) belumPasti.push("Ada penerimaan dengan satuan berbeda dari master (faktor belum dikonfirmasi).");
    if (pakaiOkt.some((p) => !p.satuanSesuaiMaster)) belumPasti.push("Ada pemakaian dengan satuan berbeda dari master.");
    belumPasti.push("Tidak ada data pemakaian setelah 9 Okt 2026 dan data pembelian setelah 13 Okt; pencatatan dua periode itu hanya dari ledger.");
    if (e.terima.some((t) => t.status === "ESTIMASI_BUKAN_BUKTI")) belumPasti.push("Kedatangan estimasi belum dapat dipastikan.");
    const dari = { sep: st?.sep != null ? `Sano-Stock baris ${st.barisCsv} QTY SEP` : null };
    const status = isu.some((i) => i.level === "BLOCKER") ? "BLOCKER" : st?.sep == null && !(titik.length) ? "TANPA_TITIK_HITUNG" : (terimaBelumLedger.length || pakaiOktBelum.length || pakaiSeptBelum.length) ? "ADA_RIWAYAT_BELUM_DI_LEDGER" : "SELARAS_DENGAN_LEDGER";
    hasil.push({ kode: m.code, materialId: id, nama: m.name, satuanMaster: m.unit, aktif: m.active, titikHitung: titik, sumberAngka: dari,
      penerimaan: e.terima, penerimaanTerbuktiBelumDiLedger: terimaBelumLedger.length, penerimaanSudahDiLedger: terimaSudahLedger.length, grTanpaLog: e.grTanpaLog,
      pemakaian: e.pakai, pemakaianOktBelumDiLedger: pakaiOktBelum.length, pemakaianSeptBelumDiLedger: pakaiSeptBelum.length, pemakaianLabelOktSebelumBelumDiLedger: pakaiLabelOktSebelum.length, qtyPemakaianOktBelumDiLedger: r4(pakaiBawah), qtyPemakaianBatasAtasBelumDiLedger: r4(pakaiAtas),
      setelahMulai: e.tidakDipakaiSetelahMulai, ledgerAwalOktober: ledgerAwalOkt, ledger9Okt: ledger9, ledgerKini, perkiraan9Okt, selisih9Okt, perkiraan9OktAtas, selisih9OktAtas, stok: st,
      belumPasti, isu, status });
  }
  hasil.sort((a, b) => a.kode.localeCompare(b.kode));
  const ringkasan = {
    material: hasil.length, status: hasil.reduce((o, x) => ((o[x.status] = (o[x.status] || 0) + 1), o), {}),
    penerimaanTerbuktiBelumDiLedger: hasil.reduce((s, x) => s + x.penerimaanTerbuktiBelumDiLedger, 0), penerimaanSudahDiLedger: hasil.reduce((s, x) => s + x.penerimaanSudahDiLedger, 0),
    pemakaianOktBelumDiLedger: hasil.reduce((s, x) => s + x.pemakaianOktBelumDiLedger, 0), pemakaianSeptBelumDiLedger: hasil.reduce((s, x) => s + x.pemakaianSeptBelumDiLedger, 0), pemakaianLabelOktSebelumBelumDiLedger: hasil.reduce((s, x) => s + x.pemakaianLabelOktSebelumBelumDiLedger, 0),
    pemakaianSudahDiLedger: hasil.reduce((s, x) => s + x.pemakaian.filter((p) => p.status.startsWith("SUDAH")).length, 0), pemakaianTanpaPasangan: luar.pakaiTanpaPasangan.length, pembelianTanpaPasangan: luar.beliTanpaPasangan.length,
    cakupan: { pemakaian: pakai?.cakupan || null, rekapOrder: rekap?.cakupan || null, pembelian: beli?.cakupan || null, ledgerSampai: [...ledger.values()].flat().map((x) => x.createdAt.toISOString()).sort().pop() || null, mulaiPencatatanBaru: mulai ? mulai.toISOString() : null },
  };
  return { ringkasan, bahan: hasil, luar };
}
