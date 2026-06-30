import * as XLSX from "xlsx";
import { saveAs } from "file-saver";

// Export data (array of objects) ke file Excel (.xlsx)
export function exportToExcel(data, filename = "export") {
  const ws = XLSX.utils.json_to_sheet(data);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Data");
  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(new Blob([buf], { type: "application/octet-stream" }), `${filename}.xlsx`);
}

// Export data ke file CSV
export function exportToCSV(data, filename = "export") {
  const ws = XLSX.utils.json_to_sheet(data);
  const csv = XLSX.utils.sheet_to_csv(ws);
  saveAs(new Blob([csv], { type: "text/csv;charset=utf-8;" }), `${filename}.csv`);
}
