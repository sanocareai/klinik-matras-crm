// Membuat lembar hitung fisik Uang Kas (XLSX) di docs/rekonsiliasi-bank/. Hanya lembar kosong + saldo buku acuan; TIDAK menyentuh database.
// Jalankan: node backend/scripts/buat-lembar-hitung-kas.mjs [saldoBuku] [cap waktu snapshot]
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";

const saldoBuku = Number(process.argv[2] ?? 77500);
const capWaktu = process.argv[3] ?? "03 Okt 2026 01:48 WIB";
const KELUAR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../docs/rekonsiliasi-bank");

const wb = new ExcelJS.Workbook();
const ws = wb.addWorksheet("Hitung Fisik");
ws.columns = [{ width: 34 }, { width: 18 }, { width: 22 }, { width: 40 }];
const tebal = (r) => { r.font = { bold: true }; return r; };

tebal(ws.addRow(["LEMBAR HITUNG FISIK — UANG KAS SANO"]));
ws.addRow([]);
ws.addRow(["Saldo buku (acuan sistem)", saldoBuku]).getCell(2).numFmt = "#,##0";
ws.addRow(["Saldo buku per", capWaktu]);
ws.addRow(["Tanggal & jam hitung (WIB)", ""]);
ws.addRow(["Penghitung", ""]);
ws.addRow(["Saksi", ""]);
ws.addRow(["Transaksi kas dihentikan selama menghitung?", "Ya / Tidak"]);
ws.addRow([]);

tebal(ws.addRow(["Pecahan (Rp)", "Jumlah lembar/keping", "Subtotal (Rp)", "Catatan"]));
const awal = ws.rowCount + 1;
for (const nilai of [100000, 50000, 20000, 10000, 5000, 2000, 1000, 500, 200, 100]) {
  const r = ws.addRow([nilai, null, null, ""]);
  r.getCell(1).numFmt = "#,##0";
  r.getCell(3).value = { formula: `A${r.number}*B${r.number}` };
  r.getCell(3).numFmt = "#,##0";
}
const akhir = ws.rowCount;
const total = ws.addRow(["TOTAL FISIK", null, { formula: `SUM(C${awal}:C${akhir})` }, ""]);
tebal(total); total.getCell(3).numFmt = "#,##0";
const buku = ws.addRow(["Saldo buku", null, { formula: "B3" }, ""]); buku.getCell(3).numFmt = "#,##0";
const selisih = ws.addRow(["SELISIH = buku − fisik", null, { formula: `C${buku.number}-C${total.number}` }, "Positif: fisik KURANG dari buku. Negatif: fisik LEBIH."]);
tebal(selisih); selisih.getCell(3).numFmt = "#,##0;[Red]-#,##0";
ws.addRow([]);

tebal(ws.addRow(["Penjelasan selisih (jangan dicampur ke hitungan fisik)", "Nominal (Rp)", "Dokumen/bukti", "Dibukukan?"]));
for (const t of ["Nota/kuitansi belum dibukukan", "Uang titipan pihak lain", "Kasbon belum dicatat", "Pengeluaran tanpa nota", "Lainnya (tulis)"]) {
  ws.addRow([t, null, "", "Belum / Sudah"]);
}
ws.addRow([]);
ws.addRow(["Selisih yang BELUM dijelaskan", "", "", "Harus Rp0 sebelum periode Uang Kas diselesaikan"]);
ws.addRow([]);
ws.addRow(["Tanda tangan penghitung", "", "Tanda tangan saksi", ""]);
ws.addRow(["Lampirkan foto lembar ini + foto tumpukan uang per pecahan."]);

await wb.xlsx.writeFile(path.join(KELUAR, "lembar-hitung-fisik-uang-kas.xlsx"));
console.log("Ditulis:", path.join(KELUAR, "lembar-hitung-fisik-uang-kas.xlsx"), "saldo buku", saldoBuku);
