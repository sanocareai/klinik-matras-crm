// Utilitas Excel BERSAMA (ExcelJS) — dipakai Export Order Sales (exportOrdersStyled.js) dan Export Rencana Produksi (exportRencanaProduksi.js).
// Satu tempat untuk: format tanggal/rupiah, tanggal bertipe (bukan teks), pengaturan cetak, dan memuat ExcelJS secara dinamis (~1MB, hanya saat tombol Export diklik).
export const FORMAT_TANGGAL = "yyyy-mm-dd";
export const FORMAT_RUPIAH = '"Rp" #,##0;[Red]-"Rp" #,##0';
export const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/** "YYYY-MM-DD..." -> Date (UTC tengah malam) agar Excel menyimpan TANGGAL bertipe (bisa diurutkan/disaring sebagai tanggal), bukan teks. */
export function keTanggal(v) {
  if (!v) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(v));
  return m ? new Date(Date.UTC(+m[1], +m[2] - 1, +m[3])) : null;
}

/** Cetak: landscape A4, lebar 1 halaman (tinggi bebas), baris judul tabel berulang di tiap halaman (titlesRow mis. "1:1" atau "7:7"). */
export function aturCetak(ws, { titlesRow = "1:1" } = {}) {
  ws.pageSetup = { orientation: "landscape", fitToPage: true, fitToWidth: 1, fitToHeight: 0, paperSize: 9 };
  if (titlesRow) ws.pageSetup.printTitlesRow = titlesRow;
}

export async function loadExcelJS() { return (await import("exceljs")).default; }

/** Menyimpan workbook sebagai unduhan (file-saver dimuat dinamis supaya modul ini aman diimpor di Node untuk tes). */
export async function simpanWorkbook(wb, filename) {
  const buf = await wb.xlsx.writeBuffer();
  const { saveAs } = await import("file-saver");
  saveAs(new Blob([buf], { type: XLSX_MIME }), filename);
}
