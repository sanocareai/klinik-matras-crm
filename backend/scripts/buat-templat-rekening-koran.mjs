// Membuat templat impor rekening koran (CSV + XLSX) di docs/rekonsiliasi-bank/. Data di dalamnya SINTETIS dan bertanda "CONTOH".
// Jalankan: node backend/scripts/buat-templat-rekening-koran.mjs   (tidak menyentuh database)
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const KELUAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/rekonsiliasi-bank");
fs.mkdirSync(KELUAR, { recursive: true });

const HEADER = ["Tanggal", "Tanggal Efektif", "Keterangan", "Referensi", "Debit", "Kredit", "Saldo"];
// Debit = uang KELUAR dari rekening, Kredit = uang MASUK. Saldo = saldo setelah baris itu (boleh dikosongkan, tetapi diisi lebih aman).
const BARIS = [
  ["01/10/2026", "01/10/2026", "CONTOH - SETORAN (HAPUS BARIS INI)", "CTH-0001", 0, 1000000, 1000000],
  ["01/10/2026", "01/10/2026", "CONTOH - BIAYA ADM BANK (HAPUS BARIS INI)", "CTH-0002", 13000, 0, 987000],
  ["02/10/2026", "02/10/2026", "CONTOH - BUNGA TABUNGAN (HAPUS BARIS INI)", "CTH-0003", 0, 24500, 1011500],
];

const fmt = (n) => n.toLocaleString("id-ID", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const csv = [HEADER.join(";"), ...BARIS.map(([a, b, c, d, e, f, g]) => [a, b, c, d, fmt(e), fmt(f), fmt(g)].join(";"))].join("\r\n") + "\r\n";
fs.writeFileSync(path.join(KELUAR, "template-impor-rekening-koran.csv"), "﻿" + csv, "utf8");

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Rekening Koran");
ws.addRow(HEADER).font = { bold: true };
for (const [a, b, c, d, e, f, g] of BARIS) {
  const tgl = (s) => { const [dd, mm, yy] = s.split("/").map(Number); return new Date(Date.UTC(yy, mm - 1, dd)); };
  ws.addRow([tgl(a), tgl(b), c, d, e, f, g]);
}
ws.getColumn(1).numFmt = "dd/mm/yyyy"; ws.getColumn(2).numFmt = "dd/mm/yyyy";
for (const k of [5, 6, 7]) ws.getColumn(k).numFmt = "#,##0.00";
ws.columns.forEach((c, i) => { c.width = [12, 15, 48, 14, 16, 16, 18][i]; });
await wb.xlsx.writeFile(path.join(KELUAR, "template-impor-rekening-koran.xlsx"));
console.log("Templat ditulis ke", KELUAR);
