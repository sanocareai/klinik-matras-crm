import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// Hitung lebar kolom optimal berdasarkan konten
function autoWidth(ws, data) {
  if (!data || !data.length) return;
  const keys = Object.keys(data[0]);
  ws["!cols"] = keys.map((key) => {
    const maxLen = Math.max(
      key.length,
      ...data.map((row) => String(row[key] ?? "").length)
    );
    return { wch: Math.min(maxLen + 2, 60) };
  });
}

// Export data (array of objects) ke file Excel (.xlsx)
export function exportToExcel(data, filename = "export") {
  const ws = XLSX.utils.json_to_sheet(data);
  autoWidth(ws, data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buf], { type: "application/octet-stream" }), `${filename}.xlsx`);
}

// Export MULTI-SHEET ke satu file Excel (29 Agustus 2026) — dipakai saat
// satu ekspor perlu granularitas berbeda dalam satu file, mis. "1 baris per
// Order" + "1 baris per item layanan" (Orders.jsx). `sheets` = array
// {name, data} — sheet dgn data kosong DILEWATI (bukan bikin sheet kosong
// yang membingungkan saat dibuka).
export function exportToExcelMultiSheet(sheets, filename = "export") {
  const wb = XLSX.utils.book_new();
  for (const { name, data } of sheets) {
    if (!data || data.length === 0) continue;
    const ws = XLSX.utils.json_to_sheet(data);
    autoWidth(ws, data);
    // Nama sheet Excel maksimal 31 karakter, tidak boleh: \ / ? * [ ]
    const safeName = name.replace(/[\\/?*[\]]/g, "-").slice(0, 31);
    XLSX.utils.book_append_sheet(wb, ws, safeName);
  }
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buf], { type: "application/octet-stream" }), `${filename}.xlsx`);
}

// Export data ke file CSV
export function exportToCSV(data, filename = "export") {
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}
