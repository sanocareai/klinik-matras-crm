// Pembuat berkas Excel ORDER yang berwarna & terfilter (Okt 2026) — dipakai POST /api/orders/export-xlsx.
//
// Pembagian tugas (sengaja): FRONTEND menyusun data & label (sumber kebenaran label/warna badge ada di sana: utils/format.js, OrderSection.jsx)
// lalu mengirimnya ke sini; BACKEND hanya MERENDER tampilannya memakai exceljs. SheetJS di browser (edisi gratis) tidak bisa mewarnai sel,
// dan menyalin peta label ke backend berarti dua sumber kebenaran yang bisa berbeda.
//
// Bentuk masukan:
//   { judul, filterLabel?, pengekspor?,
//     sheets: [{ nama, kolom: [{ key, header, tipe?, lebar?, wrap?, palette?, tandaKomplain?, tandaMandek?, total? }],
//                baris: [[nilai per kolom...]], bendera?: [["komplain"|"mandek", ...] per baris] }],
//     ringkasan?: { kunciNilai, kelompok: [{ judul, kunci }], kunciLunas?, nilaiLunas? } }
//   tipe    : "teks" (default) | "uang" | "angka" | "tanggal" ("YYYY-MM-DD") | "link" (http/https → hyperlink)
//   palette : { "<isi sel>": { bg: "#rrggbb", color: "#rrggbb" } } — warna sel menurut isinya (mis. Kategori, Status, Pembayaran)
//   bendera : "komplain" → seluruh baris merah muda + sel penanda (tandaKomplain) merah pekat; "mandek" → sel penanda (tandaMandek) kuning
//
// Aturan keamanan: sel teks yang diawali = + - @ diberi apostrof (formula injection); hyperlink hanya http/https; batas ukuran supaya
// pembuat xlsx (bekerja di memori) tidak membuat server kehabisan memori.
import ExcelJS from "exceljs";
import { netralkanRumus } from "./finance/export/excel.js";

export const MAKS_BARIS = 6000;
export const MAKS_KOLOM = 80;
export const MAKS_SEL = 150_000;
const MAKS_PANJANG_TEKS = 32_000;

export class OrderExcelError extends Error {
  constructor(message, statusCode = 400) {
    super(message);
    this.name = "OrderExcelError";
    this.statusCode = statusCode;
  }
}

const FORMAT_UANG = '"Rp"#,##0;[Red]-"Rp"#,##0';
const FORMAT_ANGKA = "#,##0.##;-#,##0.##";
const FORMAT_TANGGAL = "dd/mm/yyyy";

export const WARNA = Object.freeze({
  header: "FF1E2139", headerTeks: "FFFFFFFF",
  judul: "FF111827", info: "FF6B7280",
  garis: "FFE5E7EB", zebra: "FFF8FAFC",
  komplainBaris: "FFFEE2E2", komplainTeks: "FF7F1D1D", komplainPekat: "FFDC2626", komplainPekatTeks: "FFFFFFFF",
  mandek: "FFFEF3C7", mandekTeks: "FF92400E",
  total: "FFE0E7FF", totalTeks: "FF1E3A8A",
});
const TAB = ["FF2563EB", "FF7C3AED", "FF16A34A", "FFF97316"];

/** "#dcfce7" → "FFDCFCE7". Nilai tak valid → null (sel dibiarkan tanpa warna, bukan error). */
export function argb(hex) {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(String(hex || "").trim());
  return m ? `FF${m[1].toUpperCase()}` : null;
}

function huruf(n) { // 1 → A, 27 → AA
  let s = "";
  for (let x = n; x > 0; x = Math.floor((x - 1) / 26)) s = String.fromCharCode(65 + ((x - 1) % 26)) + s;
  return s;
}

function namaSheetAman(nama, dipakai) {
  let n = String(nama || "Sheet").replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Sheet";
  let i = 2;
  while (dipakai.has(n.toLowerCase())) n = `${n.slice(0, 28)} ${i++}`;
  dipakai.add(n.toLowerCase());
  return n;
}

function tanggalKalender(v) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v || ""));
  return m ? new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : null;
}

function angka(v) {
  if (v === "" || v == null) return null;
  const n = typeof v === "number" ? v : Number(String(v).replace(/[^\d.\-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function validasi(spec) {
  if (!spec || typeof spec !== "object") throw new OrderExcelError("Data export tidak valid");
  if (!Array.isArray(spec.sheets) || spec.sheets.length === 0) throw new OrderExcelError("Tidak ada data untuk diexport");
  let sel = 0;
  for (const sh of spec.sheets) {
    if (!Array.isArray(sh?.kolom) || !Array.isArray(sh?.baris)) throw new OrderExcelError("Bentuk sheet tidak valid");
    if (sh.kolom.length === 0 || sh.kolom.length > MAKS_KOLOM) throw new OrderExcelError(`Jumlah kolom harus 1–${MAKS_KOLOM}`);
    if (sh.baris.length > MAKS_BARIS) throw new OrderExcelError(`Data terlalu banyak (${sh.baris.length} baris, maksimal ${MAKS_BARIS}) — persempit filter atau rentang tanggal`, 413);
    for (const r of sh.baris) if (!Array.isArray(r) || r.length > sh.kolom.length) throw new OrderExcelError("Bentuk baris tidak valid");
    sel += sh.baris.length * sh.kolom.length;
  }
  if (sel > MAKS_SEL) throw new OrderExcelError(`Data terlalu besar untuk dibuat berwarna (${sel} sel, maksimal ${MAKS_SEL}) — persempit filter atau rentang tanggal`, 413);
}

function gayaHeader(sel) {
  sel.font = { bold: true, color: { argb: WARNA.headerTeks }, size: 10 };
  sel.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.header } };
  sel.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
  sel.border = { top: { style: "thin", color: { argb: WARNA.header } }, bottom: { style: "medium", color: { argb: "FF93C5FD" } }, left: { style: "thin", color: { argb: "FF3B3F66" } }, right: { style: "thin", color: { argb: "FF3B3F66" } } };
}

/** Isi satu sheet data (tabel + filter + beku + total). Mengembalikan letak tabel untuk dipakai Ringkasan. */
function isiSheetData(wb, spec, sh, indeks, namaTab, pengekspor, waktu) {
  const ws = wb.addWorksheet(namaTab, { properties: { tabColor: { argb: TAB[indeks % TAB.length] } } });
  const kol = sh.kolom;
  const nKol = kol.length;
  const barisHeader = 3;
  const barisAwal = barisHeader + 1;
  const barisAkhir = barisHeader + sh.baris.length;

  // Judul + keterangan (2 baris), digabung selebar tabel supaya tidak terpotong lebar kolom pertama.
  ws.mergeCells(1, 1, 1, Math.min(nKol, 8));
  ws.getCell(1, 1).value = netralkanRumus(`${spec.judul || "Laporan Order"} — ${sh.judul || sh.nama}`);
  ws.getCell(1, 1).font = { bold: true, size: 14, color: { argb: WARNA.judul } };
  ws.getRow(1).height = 24;
  ws.mergeCells(2, 1, 2, Math.min(nKol, 12));
  const filter = spec.filterLabel ? `Filter: ${spec.filterLabel} · ` : "";
  ws.getCell(2, 1).value = netralkanRumus(`${filter}${sh.baris.length} baris · diexport ${waktu}${pengekspor ? ` oleh ${pengekspor}` : ""} · Gunakan panah di header untuk menyaring & mengurutkan; warna juga bisa dipakai untuk filter`);
  ws.getCell(2, 1).font = { italic: true, size: 9, color: { argb: WARNA.info } };

  // Header
  kol.forEach((k, i) => {
    const c = ws.getCell(barisHeader, i + 1);
    c.value = netralkanRumus(String(k.header ?? k.key ?? "").slice(0, 80));
    gayaHeader(c);
  });
  ws.getRow(barisHeader).height = 32;

  // Baris data
  sh.baris.forEach((nilai, ri) => {
    const r = barisAwal + ri;
    const bendera = new Set(Array.isArray(sh.bendera?.[ri]) ? sh.bendera[ri] : []);
    const komplain = bendera.has("komplain");
    const mandek = bendera.has("mandek");
    const dasar = komplain ? WARNA.komplainBaris : (ri % 2 === 1 ? WARNA.zebra : null);
    kol.forEach((k, ci) => {
      const c = ws.getCell(r, ci + 1);
      const mentah = nilai[ci];
      const tipe = k.tipe || "teks";
      if (tipe === "uang" || tipe === "angka") {
        const n = angka(mentah);
        c.value = n;
        if (n != null) c.numFmt = tipe === "uang" ? FORMAT_UANG : FORMAT_ANGKA;
        c.alignment = { vertical: "middle", horizontal: "right" };
      } else if (tipe === "tanggal") {
        const d = tanggalKalender(mentah);
        c.value = d || (mentah ? netralkanRumus(String(mentah)) : null);
        if (d) c.numFmt = FORMAT_TANGGAL;
        c.alignment = { vertical: "middle", horizontal: "center" };
      } else if (tipe === "link" && /^https?:\/\//i.test(String(mentah || ""))) {
        c.value = { text: "Buka peta", hyperlink: String(mentah).slice(0, 2000) };
        c.font = { color: { argb: "FF2563EB" }, underline: true, size: 10 };
        c.alignment = { vertical: "middle", horizontal: "center" };
      } else {
        const t = mentah == null ? "" : String(mentah);
        c.value = t === "" ? null : netralkanRumus(t.length > MAKS_PANJANG_TEKS ? t.slice(0, MAKS_PANJANG_TEKS) : t);
        c.alignment = { vertical: k.wrap ? "top" : "middle", wrapText: !!k.wrap, horizontal: k.palette ? "center" : undefined };
      }
      if (!c.font?.underline) c.font = { size: 10, ...(c.font || {}) };
      if (dasar) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: dasar } };
      c.border = { bottom: { style: "thin", color: { argb: WARNA.garis } }, right: { style: "thin", color: { argb: WARNA.garis } }, left: ci === 0 && komplain ? { style: "thick", color: { argb: WARNA.komplainPekat } } : undefined };

      // Warna menurut isi (Kategori/Status/Pembayaran/...): tetap tampak walau baris komplain berwarna merah muda.
      const pal = k.palette && typeof mentah === "string" ? k.palette[mentah] : null;
      if (pal) {
        const bg = argb(pal.bg); const fg = argb(pal.color);
        if (bg) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
        c.font = { size: 10, bold: true, ...(fg ? { color: { argb: fg } } : {}) };
      }
      if (komplain && ci < 2 && !pal) c.font = { size: 10, bold: true, color: { argb: WARNA.komplainTeks } };
      if (komplain && k.tandaKomplain && String(mentah ?? "") !== "" && !pal) {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.komplainPekat } };
        c.font = { size: 10, bold: true, color: { argb: WARNA.komplainPekatTeks } };
      }
      if (mandek && k.tandaMandek && String(mentah ?? "") !== "") {
        c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.mandek } };
        c.font = { size: 10, bold: true, color: { argb: WARNA.mandekTeks } };
      }
    });
  });

  // Lebar kolom
  kol.forEach((k, i) => {
    const maks = Math.max(String(k.header || "").length * 0.9, ...sh.baris.slice(0, 400).map((b) => String(b[i] ?? "").length));
    ws.getColumn(i + 1).width = Math.max(8, Math.min(Number(k.lebar) || Math.ceil(maks + 3), k.wrap ? 48 : 40));
  });

  // Baris TOTAL: SUBTOTAL ikut berubah saat tabel difilter.
  const barisTotal = barisAkhir + 1;
  const kolomTotal = kol.map((k, i) => (k.total ? i + 1 : 0)).filter(Boolean);
  if (sh.baris.length > 0) {
    const sel1 = ws.getCell(barisTotal, 1);
    sel1.value = { formula: `"TOTAL "&SUBTOTAL(103,A${barisAwal}:A${barisAkhir})&" baris (ikut filter)"`, result: `TOTAL ${sh.baris.length} baris (ikut filter)` };
    for (let i = 1; i <= nKol; i++) {
      const c = ws.getCell(barisTotal, i);
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.total } };
      c.font = { bold: true, size: 10, color: { argb: WARNA.totalTeks } };
      c.border = { top: { style: "medium", color: { argb: WARNA.totalTeks } } };
    }
    for (const ci of kolomTotal) {
      const l = huruf(ci);
      const hasil = sh.baris.reduce((a, b) => a + (angka(b[ci - 1]) || 0), 0);
      const c = ws.getCell(barisTotal, ci);
      c.value = { formula: `SUBTOTAL(109,${l}${barisAwal}:${l}${barisAkhir})`, result: hasil };
      c.numFmt = kol[ci - 1].tipe === "uang" ? FORMAT_UANG : FORMAT_ANGKA;
      c.alignment = { horizontal: "right" };
    }
  }

  // Filter (panah di header), beku (header + 2 kolom pertama), cetak.
  if (sh.baris.length > 0) ws.autoFilter = { from: { row: barisHeader, column: 1 }, to: { row: barisAkhir, column: nKol } };
  ws.views = [{ state: "frozen", xSplit: nKol >= 4 ? 2 : 0, ySplit: barisHeader, showGridLines: false }];
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9, margins: { left: 0.3, right: 0.3, top: 0.4, bottom: 0.4, header: 0.2, footer: 0.2 } };
  ws.pageSetup.printTitlesRow = `${barisHeader}:${barisHeader}`;
  return { ws, namaTab, barisHeader, barisAwal, barisAkhir, kol };
}

function kunciKolom(info, key) {
  const i = info.kol.findIndex((k) => k.key === key);
  return i >= 0 ? i + 1 : 0;
}

/** Sheet Ringkasan: angka kunci, rincian per kelompok (rumus hidup ke sheet Order), dan keterangan warna. */
function isiRingkasan(ws, spec, utama, palettes, waktu) {
  const sh = spec.sheets[0];
  const rg = spec.ringkasan || {};
  ws.getColumn(1).width = 34; ws.getColumn(2).width = 16; ws.getColumn(3).width = 22; ws.getColumn(4).width = 4; ws.getColumn(5).width = 44;
  ws.mergeCells("A1:C1");
  ws.getCell("A1").value = netralkanRumus(`${spec.judul || "Laporan Order"} — Ringkasan`);
  ws.getCell("A1").font = { bold: true, size: 15, color: { argb: WARNA.judul } };
  ws.getRow(1).height = 26;
  ws.mergeCells("A2:C2");
  ws.getCell("A2").value = netralkanRumus(`${spec.filterLabel ? `Filter: ${spec.filterLabel} · ` : ""}diexport ${waktu}`);
  ws.getCell("A2").font = { italic: true, size: 9, color: { argb: WARNA.info } };

  const nilaiCol = kunciKolom(utama, rg.kunciNilai);
  const idx = (key) => sh.kolom.findIndex((k) => k.key === key);
  const jumlah = sh.baris.length;
  const totalNilai = nilaiCol ? sh.baris.reduce((a, b) => a + (angka(b[nilaiCol - 1]) || 0), 0) : 0;
  const nKomplain = (sh.bendera || []).filter((b) => Array.isArray(b) && b.includes("komplain")).length;
  const nMandek = (sh.bendera || []).filter((b) => Array.isArray(b) && b.includes("mandek")).length;
  const iLunas = idx(rg.kunciLunas);
  const nLunas = iLunas >= 0 ? sh.baris.filter((b) => b[iLunas] === (rg.nilaiLunas ?? "Ya")).length : null;

  const rangeOrder = (col) => `'${utama.namaTab}'!$${huruf(col)}$${utama.barisAwal}:$${huruf(col)}$${utama.barisAkhir}`;
  let r = 4;
  const kpi = [
    ["Jumlah order", jumlah, "#,##0", null],
    ["Total nilai order", totalNilai, FORMAT_UANG, null],
    ...(nLunas != null ? [["Order lunas", nLunas, "#,##0", "FF16A34A"], ["Order belum lunas", jumlah - nLunas, "#,##0", "FFF97316"]] : []),
    ["Order komplain / revisi", nKomplain, "#,##0", "FFDC2626"],
    ["Order mandek", nMandek, "#,##0", "FFB45309"],
  ];
  ws.getCell(r, 1).value = "ANGKA KUNCI"; ws.getCell(r, 1).font = { bold: true, size: 10, color: { argb: WARNA.info } }; r++;
  for (const [label, nilai, fmt, warna] of kpi) {
    ws.getCell(r, 1).value = label; ws.getCell(r, 1).font = { size: 11 };
    const c = ws.getCell(r, 2); c.value = nilai; c.numFmt = fmt; c.font = { bold: true, size: 12, ...(warna ? { color: { argb: warna } } : {}) }; c.alignment = { horizontal: "right" };
    for (const k of [1, 2]) ws.getCell(r, k).border = { bottom: { style: "thin", color: { argb: WARNA.garis } } };
    r++;
  }

  for (const kel of rg.kelompok || []) {
    const kc = kunciKolom(utama, kel.kunci);
    const ik = kc - 1;
    if (!kc) continue;
    r += 1;
    ws.mergeCells(r, 1, r, 3);
    const jd = ws.getCell(r, 1); jd.value = netralkanRumus(`PER ${String(kel.judul || kel.kunci).toUpperCase()}`); jd.font = { bold: true, size: 10, color: { argb: WARNA.headerTeks } };
    jd.fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA.header } };
    r++;
    ["Kelompok", "Jumlah", "Total nilai"].forEach((h, i) => { const c = ws.getCell(r, i + 1); c.value = h; c.font = { bold: true, size: 9, color: { argb: WARNA.info } }; c.alignment = { horizontal: i ? "right" : "left" }; c.border = { bottom: { style: "thin", color: { argb: WARNA.garis } } }; });
    r++;
    const hitung = new Map();
    for (const b of sh.baris) { const v = String(b[ik] ?? ""); const e = hitung.get(v) || { n: 0, s: 0 }; e.n += 1; e.s += nilaiCol ? angka(b[nilaiCol - 1]) || 0 : 0; hitung.set(v, e); }
    const urut = [...hitung.entries()].sort((a, b) => b[1].n - a[1].n || String(a[0]).localeCompare(String(b[0]), "id"));
    const pal = palettes[kel.kunci] || null;
    for (const [v, e] of urut) {
      const ck = ws.getCell(r, 1);
      ck.value = v === "" ? "(kosong)" : netralkanRumus(v);
      const p = pal && pal[v];
      if (p) { const bg = argb(p.bg); const fg = argb(p.color); if (bg) ck.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; ck.font = { bold: true, size: 10, ...(fg ? { color: { argb: fg } } : {}) }; }
      const kriteria = v === "" ? '""' : `$A${r}`;
      const rng = rangeOrder(kc);
      const cn = ws.getCell(r, 2); cn.value = { formula: `SUMPRODUCT(--(${rng}=${kriteria}))`, result: e.n }; cn.numFmt = "#,##0";
      const cs = ws.getCell(r, 3);
      if (nilaiCol) { cs.value = { formula: `SUMPRODUCT(--(${rng}=${kriteria}),${rangeOrder(nilaiCol)})`, result: e.s }; cs.numFmt = FORMAT_UANG; }
      for (const k of [1, 2, 3]) ws.getCell(r, k).border = { bottom: { style: "thin", color: { argb: WARNA.garis } } };
      r++;
    }
  }

  // Keterangan warna (kolom E): hanya warna yang benar-benar dipakai di data.
  let rl = 4;
  ws.getCell(rl, 5).value = "KETERANGAN WARNA"; ws.getCell(rl, 5).font = { bold: true, size: 10, color: { argb: WARNA.info } }; rl++;
  const legenda = [
    ["Baris merah muda + bar merah di kiri", "Order komplain / revisi aktif", WARNA.komplainBaris, WARNA.komplainTeks],
    ["Sel merah pekat", "Penanda komplain (jenis pekerjaan, no. komplain, keluhan)", WARNA.komplainPekat, WARNA.komplainPekatTeks],
    ["Sel kuning", "Mandek: lama di status yang sama", WARNA.mandek, WARNA.mandekTeks],
    ["Baris abu-abu selang-seling", "Hanya pemisah baris agar mudah dibaca", WARNA.zebra, WARNA.judul],
  ];
  for (const [teks, arti, bg, fg] of legenda) {
    const c = ws.getCell(rl, 5); c.value = `${teks} = ${arti}`; c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } }; c.font = { size: 9, bold: true, color: { argb: fg } }; c.alignment = { wrapText: true, vertical: "middle" }; ws.getRow(rl).height = 26; rl++;
  }
  for (const k of sh.kolom) {
    if (!k.palette) continue;
    const dipakai = new Set(sh.baris.map((b) => String(b[idx(k.key)] ?? "")));
    for (const [isi, p] of Object.entries(k.palette)) {
      if (!dipakai.has(isi)) continue;
      const bg = argb(p.bg); const fg = argb(p.color);
      const c = ws.getCell(rl, 5); c.value = netralkanRumus(`${k.header}: ${isi}`);
      if (bg) c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: bg } };
      c.font = { size: 9, bold: true, ...(fg ? { color: { argb: fg } } : {}) }; rl++;
    }
  }
  ws.views = [{ showGridLines: false }];
  ws.pageSetup = { orientation: "portrait", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  return ws;
}

/** @returns {Promise<Buffer>} berkas .xlsx */
export async function buatBukuOrder(spec, { sekarang = new Date() } = {}) {
  validasi(spec);
  const wib = new Date(sekarang.getTime() + 7 * 3600_000);
  const p2 = (n) => String(n).padStart(2, "0");
  const waktu = `${p2(wib.getUTCDate())}/${p2(wib.getUTCMonth() + 1)}/${wib.getUTCFullYear()} ${p2(wib.getUTCHours())}:${p2(wib.getUTCMinutes())} WIB`;
  const pengekspor = String(spec.pengekspor || "").slice(0, 80);

  const wb = new ExcelJS.Workbook();
  wb.creator = "Klinik Matras CRM";
  wb.created = sekarang;

  // Urutan tab: Ringkasan DIBUAT lebih dulu (exceljs menyusun tab menurut urutan pembuatan), diisi sesudah sheet data selesai karena
  // rumusnya mengacu ke sheet data. Berkas terbuka di tab data pertama (yang paling sering dicari), bukan Ringkasan.
  const dipakai = new Set(["ringkasan"]);
  const wsRingkasan = spec.ringkasan ? wb.addWorksheet("Ringkasan", { properties: { tabColor: { argb: "FF0F172A" } } }) : null;
  const sheetsInfo = spec.sheets.map((sh, i) => isiSheetData(wb, spec, sh, i, namaSheetAman(sh.nama, dipakai), pengekspor, waktu));
  if (wsRingkasan) {
    const palettes = {};
    for (const k of spec.sheets[0].kolom) if (k.palette) palettes[k.key] = k.palette;
    isiRingkasan(wsRingkasan, spec, sheetsInfo[0], palettes, waktu);
  }
  wb.views = [{ activeTab: wsRingkasan ? 1 : 0, firstSheet: 0, visibility: "visible" }];
  return Buffer.from(await wb.xlsx.writeBuffer());
}
