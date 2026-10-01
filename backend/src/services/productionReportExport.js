// Export laporan Production–Warehouse (P11): Excel (.xlsx) dan PDF dibuat dari DOKUMEN LAPORAN YANG SAMA dengan layar
// (productionReportingService → { tables, coverage, filters, definitions, ... }). Tidak ada rumus/format ulang di sini: sel Excel = nilai baris,
// teks PDF = nilai baris; layar merender tabel yang sama. Sertakan definisi metrik, cakupan, target yang dipakai, dan timestamp data (WIB).
import PDFDocument from "pdfkit";
import { buatXlsx, ExportError, namaBerkas } from "./finance/export/excel.js";
import { formatMinutes, round1, wibKey } from "../lib/domain/productionMetrics.js";

const wibStamp = (iso) => { const d = new Date(new Date(iso).getTime() + 7 * 3600_000).toISOString(); return `${d.slice(0, 10)} ${d.slice(11, 16)} WIB`; };
const nf = new Intl.NumberFormat("id-ID", { maximumFractionDigits: 4 });

// Font standar PDF (Helvetica/WinAnsi) tidak punya → − ≤ ≥ : ditransliterasi supaya tidak tampil sebagai karakter rusak. Isi/angka tidak berubah.
const PDF_GLYPHS = { "→": "->", "−": "-", "≤": "<=", "≥": ">=" };
export const pdfSafe = (t) => String(t).replace(/[→−≤≥]/g, (c) => PDF_GLYPHS[c]);

// Tampilan sel (dipakai PDF; layar memakai fungsi setara di frontend `formatCell`). null -> "—".
export function formatCell(value, tipe) {
  if (value === null || value === undefined || value === "") return "—";
  if (tipe === "angka") return typeof value === "number" ? nf.format(value) : String(value);
  if (tipe === "waktu") return wibStamp(value);
  if (tipe === "tanggal") return String(value).slice(0, 10);
  return String(value);
}

export function coverageLines(doc) {
  const c = doc.coverage;
  return [
    `Cakupan: ${c.scope}`, `Unit cohort: ${c.cohortUnits} · Run V2 dalam cohort: ${c.runsInCohort} · Setelah filter: ${c.runsAfterFilters} · Total unit V2 di sistem: ${c.totalV2Units}`,
    `Periode: ${c.period.from} s/d ${c.period.to} (${c.period.days} hari) · Zona waktu: ${c.timezone}`, `Data dibuat: ${wibStamp(doc.generatedAt)}`,
    `Target harian dipakai: ${doc.targetPerHari} unit/hari — ${doc.targetNote}`, `Sampel minimum untuk rata-rata/persentase: ${doc.minSample}`,
    `Filter aktif: ${doc.filters.length ? doc.filters.join("; ") : "tanpa filter"}`,
  ];
}

export function toWorkbookData(doc) {
  const periodeLabel = `${doc.coverage.period.from} s/d ${doc.coverage.period.to}`;
  const sheets = doc.tables.map((t) => ({ nama: t.title.replace(/[^\p{L}\p{N} _-]/gu, "").slice(0, 28) || t.key, judul: `${doc.title} — ${t.title}`, kolom: t.columns.map((c) => ({ key: c.key, header: c.header, tipe: c.tipe })), baris: t.rows, catatan: t.note ? [t.note] : [], pesanKosong: t.empty }));
  const infoRows = [
    ...coverageLines(doc).map((l) => { const i = l.indexOf(":"); return { item: l.slice(0, i), nilai: l.slice(i + 1).trim() }; }),
    ...Object.entries(doc.dateBases).map(([k, v]) => ({ item: `Tanggal ${k}`, nilai: v })),
    ...doc.definitions.map((d) => ({ item: `Definisi: ${d.label}`, nilai: `${d.formula} [Dasar: ${d.basis}]${d.note ? ` — ${d.note}` : ""}` })),
    { item: "SLA", nilai: `Permintaan bahan ${doc.sla.materialResponseMin} mnt · Retur ${doc.sla.returnReceiveMin} mnt · Barang jadi ${doc.sla.finishedGoodsAcceptMin} mnt. ${doc.sla.note}` },
    { item: "Keamanan data", nilai: "Tanpa omzet/harga/pembayaran/HPP. Baris dapat ditelusuri ke unit/order lewat Kode Unit dan Resi/Order." },
  ];
  sheets.push({ nama: "Cakupan dan Definisi", judul: `${doc.title} — Cakupan, definisi metrik, timestamp`, kolom: [{ key: "item", header: "Item", tipe: "teks", lebar: 34 }, { key: "nilai", header: "Keterangan", tipe: "teks", lebar: 110 }], baris: infoRows, catatan: [] });
  return { nama: doc.title, periodeLabel, filterLabel: doc.filters.length ? doc.filters.join("; ") : "Tanpa filter (semua data)", basisTanggalLabel: "Dasar tanggal per metrik — lihat sheet Cakupan dan Definisi", sheets };
}

export async function buildXlsx(doc, { pengekspor = "", now = new Date() } = {}) {
  return buatXlsx(toWorkbookData(doc), { pengekspor, sekarang: now });
}

// ---------------------------------------------------------------- PDF -------------------------------------------------------------------
export function buildPdf(doc, { pengekspor = "", compress = true } = {}) {
  return new Promise((resolve, reject) => {
    const widest = Math.max(...doc.tables.map((t) => t.columns.length), 1);
    const size = widest > 18 ? "A3" : "A4";
    const pdf = new PDFDocument({ size, layout: "landscape", margin: 28, compress, info: { Title: doc.title, Author: "Klinik Matras — Production", Subject: "Laporan Production-Warehouse" } });
    const chunks = []; pdf.on("data", (c) => chunks.push(c)); pdf.on("end", () => resolve(Buffer.concat(chunks))); pdf.on("error", reject);
    const W = pdf.page.width - 56; const BOTTOM = pdf.page.height - 36;
    const fs = widest > 18 ? 6 : widest > 12 ? 7 : 8.5;
    const line = (t, o = {}) => { pdf.font(o.bold ? "Helvetica-Bold" : "Helvetica").fontSize(o.size || 8.5).fillColor(o.color || "#222").text(pdfSafe(t), 28, pdf.y, { width: W, ...o.opts }); };
    line("Klinik Matras — Production & Warehouse", { size: 9, color: "#555" });
    line(doc.title, { bold: true, size: 17 });
    for (const l of coverageLines(doc)) line(l, { size: 7.5, color: "#444" });
    if (pengekspor) line(`Diekspor oleh: ${pengekspor}`, { size: 7.5, color: "#444" });
    pdf.moveDown(0.6);
    for (const t of doc.tables) {
      if (pdf.y > BOTTOM - 70) pdf.addPage();
      line(t.title, { bold: true, size: 11 }); pdf.moveDown(0.2);
      const cols = t.columns;
      const weights = cols.map((c) => (c.tipe === "teks" ? Math.max(1.3, Math.min(3, c.header.length / 8)) : c.tipe === "waktu" ? 1.5 : 1));
      const total = weights.reduce((a, b) => a + b, 0);
      const widths = weights.map((w) => (w / total) * W);
      const drawRow = (cells, { head = false } = {}) => {
        const texts = cells.map((v, i) => pdfSafe(head ? v : formatCell(v, cols[i].tipe)));
        const h = Math.max(...texts.map((tx, i) => pdf.font(head ? "Helvetica-Bold" : "Helvetica").fontSize(fs).heightOfString(String(tx), { width: widths[i] - 4 }))) + 4;
        if (pdf.y + h > BOTTOM) { pdf.addPage(); if (!head) drawRow(cols.map((c) => c.header), { head: true }); }
        const y = pdf.y; let x = 28;
        if (head) pdf.rect(28, y, W, h).fill("#1E2139");
        texts.forEach((tx, i) => { pdf.font(head ? "Helvetica-Bold" : "Helvetica").fontSize(fs).fillColor(head ? "#fff" : "#111").text(String(tx), x + 2, y + 2, { width: widths[i] - 4, align: !head && ["angka"].includes(cols[i].tipe) ? "right" : "left" }); x += widths[i]; });
        pdf.y = y + h; if (!head) pdf.moveTo(28, pdf.y).lineTo(28 + W, pdf.y).lineWidth(0.3).strokeColor("#ddd").stroke();
      };
      drawRow(cols.map((c) => c.header), { head: true });
      if (!t.rows.length) line(t.empty || "Tidak ada data.", { size: 8, color: "#666" });
      for (const r of t.rows) drawRow(cols.map((c) => r[c.key]));
      if (t.note) { pdf.moveDown(0.2); line(t.note, { size: 7, color: "#666" }); }
      pdf.moveDown(0.8);
    }
    if (pdf.y > BOTTOM - 80) pdf.addPage();
    line("Definisi metrik", { bold: true, size: 11 }); pdf.moveDown(0.2);
    for (const d of doc.definitions) line(`• ${d.label}: ${d.formula} [Dasar: ${d.basis}]${d.note ? ` — ${d.note}` : ""}`, { size: 7.5 });
    line(`SLA: permintaan bahan ${doc.sla.materialResponseMin} mnt · retur ${doc.sla.returnReceiveMin} mnt · barang jadi ${doc.sla.finishedGoodsAcceptMin} mnt. ${doc.sla.note}`, { size: 7.5 });
    line("Tanpa omzet/harga/pembayaran/HPP. Baris dapat ditelusuri ke unit/order lewat Kode Unit dan Resi/Order.", { size: 7.5, color: "#666" });
    pdf.end();
  });
}

export function exportFileName(doc, ext, now = new Date()) {
  return namaBerkas(`Production_${doc.kind}`, { from: doc.coverage.period.from, to: doc.coverage.period.to }, now).replace(/^Finance_/, "").replace(/\.xlsx$/, `.${ext}`);
}
export { ExportError, formatMinutes, round1, wibKey };
