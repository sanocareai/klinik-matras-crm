// EXPORT EXCEL FINANCE — pembuat berkas .xlsx bersama untuk 11 modul (B3.9, 28 Sep 2026).
//
// Aturan yang ditegakkan DI SINI (satu tempat, supaya tidak ada modul yang lupa):
//  • Header Bahasa Indonesia; judul + periode + filter aktif + waktu ekspor (WIB) + nama pengekspor di kepala sheet.
//  • Nominal = ANGKA Excel (bukan teks), format ribuan; tanggal = tanggal Excel (bukan teks). Tanggal kalender (kolom DATE
//    di database, tersimpan UTC tengah malam) dibaca apa adanya; instant (createdAt dst.) dikonversi ke WIB (UTC+7 tetap).
//  • Pencegahan formula injection: sel TEKS yang diawali = + - @ TAB CR diawali apostrof — sel yang dimulai dengan karakter itu
//    bisa dijalankan Excel sebagai rumus bila berkas diubah/disimpan ke CSV.
//  • Kolom bertanda `sensitif` (catatan internal, nomor rekening, tautan bukti) DIBUANG kecuali pengekspor punya izin.
//  • Baris total sesuai layar (dihitung server dari baris yang sama yang diekspor), tidak pernah dipotong diam-diam:
//    lebih dari MAKS_BARIS → ditolak dengan pesan agar filter dipersempit.
//
// Bentuk data modul (dikembalikan `ambil()` tiap modul):
//   { nama: "Kasbon", periodeLabel?, filterLabel?, sheets: [{ nama, judul, kolom, baris, total?, catatan? }] }
//   kolom : [{ key, header, tipe: "teks"|"uang"|"angka"|"tanggal"|"waktu", lebar?, sensitif? }]
//   baris : [{ [key]: nilai }]          (uang/angka: number | Decimal | string numerik; tanggal/waktu: Date | ISO string)
//   total : { label, nilai: { [key]: number } }   — satu baris tebal di bawah tabel (subtotal/total sesuai layar)

import ExcelJS from "exceljs";
import { WIB_OFFSET_MS } from "../../../utils/wib.js";

export const MAKS_BARIS = 50_000;
// Batas total SEL (baris × kolom, semua sheet): pembuat xlsx bekerja di memori (~2,7 KB/sel) dan menahan event loop — 400 ribu sel ≈ 1 GB / 4 detik.
export const MAKS_SEL = 400_000;
const MAKS_PANJANG_TEKS = 32_000; // batas sel Excel 32.767 karakter

export class ExportError extends Error {
  constructor(message, statusCode = 400, code = null) {
    super(message);
    this.name = "ExportError";
    this.statusCode = statusCode;
    if (code) this.code = code;
  }
}

const AWAL_RUMUS = /^[=+\-@\t\r]/;

/** Netralkan calon rumus: teks yang diawali = + - @ TAB CR diberi apostrof di depan. Nilai non-teks tidak disentuh. */
export function netralkanRumus(v) {
  if (typeof v !== "string") return v;
  return AWAL_RUMUS.test(v) ? `'${v}` : v;
}

const FORMAT_UANG = "#,##0;-#,##0";
const FORMAT_ANGKA = "#,##0.####;-#,##0.####";
const FORMAT_TANGGAL = "dd/mm/yyyy";
const FORMAT_WAKTU = "dd/mm/yyyy hh:mm";

const BULAN = ["Jan", "Feb", "Mar", "Apr", "Mei", "Jun", "Jul", "Agu", "Sep", "Okt", "Nov", "Des"];
/** "2026-09-01" → "1 Sep 2026". */
export function tanggalIndonesiaPendek(kunci) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(kunci || ""));
  return m ? `${Number(m[3])} ${BULAN[Number(m[2]) - 1]} ${m[1]}` : String(kunci || "");
}

/** Label periode untuk kepala sheet & nama berkas. */
export function labelPeriode(periode) {
  const dari = periode?.from ? String(periode.from).slice(0, 10) : null;
  const sampai = periode?.to ? String(periode.to).slice(0, 10) : null;
  if (dari && sampai) return `${tanggalIndonesiaPendek(dari)} – ${tanggalIndonesiaPendek(sampai)}`;
  if (dari) return `Sejak ${tanggalIndonesiaPendek(dari)}`;
  if (sampai) return `Sampai ${tanggalIndonesiaPendek(sampai)}`;
  return "Semua periode";
}

const angkaAman = (v) => {
  if (v === null || v === undefined || v === "") return null;
  const n = typeof v === "number" ? v : Number(v?.toString?.() ?? v);
  return Number.isFinite(n) ? n : null;
};

/** Tanggal kalender (kolom DATE/UTC tengah malam, atau "YYYY-MM-DD") → Date UTC tengah malam untuk sel tanggal Excel. */
function sebagaiTanggal(v) {
  if (!v) return null;
  if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v)) return new Date(`${v}T00:00:00.000Z`);
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
}

/** Instant (UTC) → jam dinding WIB yang ditulis sebagai "UTC" supaya Excel menampilkan waktu WIB yang benar. */
function sebagaiWaktuWIB(v) {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? null : new Date(d.getTime() + WIB_OFFSET_MS);
}

function nilaiSel(tipe, v) {
  if (tipe === "uang" || tipe === "angka") return angkaAman(v);
  if (tipe === "tanggal") return sebagaiTanggal(v);
  if (tipe === "waktu") return sebagaiWaktuWIB(v);
  if (v === null || v === undefined) return null;
  return netralkanRumus(String(v).slice(0, MAKS_PANJANG_TEKS));
}

const formatKolom = (tipe) => ({ uang: FORMAT_UANG, angka: FORMAT_ANGKA, tanggal: FORMAT_TANGGAL, waktu: FORMAT_WAKTU })[tipe];

/** Nama sheet Excel: maks 31 karakter, tanpa \ / ? * [ ] : */
const namaSheetAman = (n) => String(n || "Data").replace(/[\\/?*[\]:]/g, "-").slice(0, 31) || "Data";

/** "2026-09-28 14:05 WIB" — waktu ekspor menurut WIB. */
function waktuEksporWIB(d = new Date()) {
  const w = new Date(d.getTime() + WIB_OFFSET_MS).toISOString();
  return `${w.slice(0, 10)} ${w.slice(11, 16)} WIB`;
}

/**
 * Bangun berkas .xlsx. `bolehSensitif=false` membuang kolom `sensitif` sebelum satu sel pun ditulis.
 * @returns {Promise<Buffer>}
 */
export async function buatXlsx(data, { pengekspor = "", bolehSensitif = false, sekarang = new Date() } = {}) {
  const sheets = Array.isArray(data?.sheets) ? data.sheets : [];
  if (sheets.length === 0) throw new ExportError("Tidak ada data untuk diekspor", 404, "TANPA_DATA");
  const totalBaris = sheets.reduce((a, s) => a + (s.baris?.length || 0), 0);
  if (totalBaris > MAKS_BARIS) {
    throw new ExportError(`Data terlalu besar untuk satu berkas (${totalBaris.toLocaleString("id-ID")} baris, batas ${MAKS_BARIS.toLocaleString("id-ID")}). Persempit periode atau filter lalu coba lagi.`, 413, "TERLALU_BESAR");
  }

  const totalSel = sheets.reduce((a, s) => a + (s.baris?.length || 0) * Math.max((s.kolom || []).length, 1), 0);
  if (totalSel > MAKS_SEL) {
    throw new ExportError(`Data terlalu besar untuk satu berkas (${totalBaris.toLocaleString("id-ID")} baris × banyak kolom = ${totalSel.toLocaleString("id-ID")} sel, batas ${MAKS_SEL.toLocaleString("id-ID")} sel). Persempit periode atau filter lalu coba lagi.`, 413, "TERLALU_BESAR");
  }

  const wb = new ExcelJS.Workbook();
  wb.creator = "Klinik Matras — Finance";
  wb.created = sekarang;
  const dipakai = new Set();

  for (const sh of sheets) {
    const kolom = (sh.kolom || []).filter((k) => !k.sensitif || bolehSensitif);
    let nama = namaSheetAman(sh.nama);
    for (let i = 2; dipakai.has(nama.toLowerCase()); i++) nama = `${nama.slice(0, 28)}-${i}`;
    dipakai.add(nama.toLowerCase());
    const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 6 }] });
    const lebarKolom = Math.max(kolom.length, 4);

    const kepala = [
      [`Klinik Matras — ${sh.judul || data.nama || nama}`],
      [`Periode: ${data.periodeLabel || "Semua periode"}`],
      [`Filter: ${data.filterLabel || "Tanpa filter (semua data)"}`],
      [`Diekspor: ${waktuEksporWIB(sekarang)}${pengekspor ? ` oleh ${netralkanRumus(String(pengekspor))}` : ""}`],
      [`Basis tanggal: ${data.basisTanggalLabel || "Tanggal pada baris sumber"} · Zona waktu: WIB (UTC+7)`],
    ];
    kepala.forEach((baris, i) => {
      const r = ws.getRow(i + 1);
      r.getCell(1).value = netralkanRumus(baris[0]);
      r.getCell(1).font = i === 0 ? { bold: true, size: 14 } : { color: { argb: "FF555555" } };
      ws.mergeCells(i + 1, 1, i + 1, lebarKolom);
    });

    const header = ws.getRow(6);
    kolom.forEach((k, i) => {
      const c = header.getCell(i + 1);
      c.value = k.header;
      c.font = { bold: true, color: { argb: "FFFFFFFF" } };
      c.fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FF1E2139" } };
      c.alignment = { vertical: "middle", horizontal: ["uang", "angka"].includes(k.tipe) ? "right" : "left", wrapText: true };
      ws.getColumn(i + 1).width = k.lebar || (["uang", "angka"].includes(k.tipe) ? 16 : k.tipe === "waktu" ? 18 : k.tipe === "tanggal" ? 13 : 24);
    });
    header.height = 22;

    (sh.baris || []).forEach((baris, idx) => {
      const r = ws.getRow(7 + idx);
      kolom.forEach((k, i) => {
        const c = r.getCell(i + 1);
        const v = nilaiSel(k.tipe, baris[k.key]);
        if (v !== null) c.value = v;
        const f = formatKolom(k.tipe);
        if (f) c.numFmt = f;
        if (["uang", "angka"].includes(k.tipe)) c.alignment = { horizontal: "right" };
      });
    });

    let akhir = 7 + (sh.baris?.length || 0);
    if (sh.total) {
      const r = ws.getRow(akhir);
      r.getCell(1).value = netralkanRumus(sh.total.label || "TOTAL");
      kolom.forEach((k, i) => {
        if (i === 0) return;
        const v = sh.total.nilai?.[k.key];
        if (v === undefined || v === null) return;
        const c = r.getCell(i + 1);
        c.value = angkaAman(v);
        c.numFmt = formatKolom(k.tipe) || FORMAT_UANG;
        c.alignment = { horizontal: "right" };
      });
      r.eachCell({ includeEmpty: true }, (c) => {
        c.font = { bold: true };
        c.border = { top: { style: "thin" }, bottom: { style: "double" } };
      });
      for (let i = 1; i <= kolom.length; i++) r.getCell(i).border = { top: { style: "thin" }, bottom: { style: "double" } };
      akhir += 1;
    }
    for (const [i, c] of (sh.catatan || []).entries()) {
      const r = ws.getRow(akhir + 1 + i);
      r.getCell(1).value = netralkanRumus(String(c));
      r.getCell(1).font = { italic: true, color: { argb: "FF555555" } };
    }
    if (kolom.length > 0 && (sh.baris?.length || 0) > 0) ws.autoFilter = { from: { row: 6, column: 1 }, to: { row: 6 + sh.baris.length, column: kolom.length } };
  }
  return Buffer.from(await wb.xlsx.writeBuffer());
}

/** Nama berkas: `Finance_<Modul>_<periode>.xlsx`, aman untuk header HTTP dan sistem berkas. */
export function namaBerkas(modul, periode, sekarang = new Date()) {
  const dari = periode?.from ? String(periode.from).slice(0, 10) : null;
  const sampai = periode?.to ? String(periode.to).slice(0, 10) : null;
  const wib = new Date(sekarang.getTime() + WIB_OFFSET_MS).toISOString().slice(0, 10);
  const p = dari && sampai ? `${dari}_sd_${sampai}` : dari ? `sejak_${dari}` : sampai ? `sampai_${sampai}` : `per_${wib}`;
  const aman = String(modul).replace(/[^A-Za-z0-9]+/g, "_").replace(/^_+|_+$/g, "");
  return `Finance_${aman}_${p}.xlsx`;
}

/** Ringkas filter aktif jadi satu kalimat: [["Status","Disetujui"],["Cari","kain"]] → "Status: Disetujui; Cari: kain". */
export function susunLabelFilter(pasangan) {
  const bagian = (pasangan || []).filter(([, v]) => v !== undefined && v !== null && String(v).trim() !== "").map(([k, v]) => `${k}: ${String(v).trim()}`);
  return bagian.length ? bagian.join("; ") : "Tanpa filter (semua data)";
}
