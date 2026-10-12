// Export Excel Rencana Produksi (snapshot BACA-SAJA) — ExcelJS, memakai utilitas bersama dengan Export Order Sales (utils/excelCommon.js: format tanggal/rupiah, tanggal bertipe,
// pengaturan cetak, pemuatan ExcelJS dinamis). Data 100% dari server (POST /production-v2/rencana/export): file ini hanya MEMFORMAT — tidak membaca DOM, tidak menghitung ulang
// status. Tabel = Excel Table dengan filter aktif; ringkasan di atas; panel beku tepat di bawah header tabel; format bersyarat (conditional formatting) untuk prioritas, lewat
// target, ganti kain, PIC kosong, dan bahan tertahan; landscape 1 halaman lebar; header tabel berulang saat dicetak.
import { FORMAT_RUPIAH, FORMAT_TANGGAL, aturCetak, keTanggal, loadExcelJS, simpanWorkbook } from "./excelCommon.js";

export const SHEET_NAME = "Target Produksi Harian";
export const TABLE_NAME = "TargetProduksi";
export const SUMMARY_ROWS = 6; // baris 1-6: judul, periode, waktu data, label KPI, nilai KPI, spasi
export const HEADER_ROW = SUMMARY_ROWS + 1; // baris judul tabel (beku tepat di bawahnya)
export const FIRST_DATA_ROW = HEADER_ROW + 1;

// Identitas SANSS: navy + off-white untuk judul/ringkasan, royal blue untuk header tabel.
export const WARNA = Object.freeze({
  navy: "FF0F1B3D", offWhite: "FFF5F7FB", royal: "FF1457D9", garis: "FFD4DCEB", zebra: "FFEEF3FC", teks: "FF111827", teksLembut: "FF475569",
  komplain: "FF7F1D1D", tinggi: "FFEA580C", normalBg: "FFDBEAFE", normalTeks: "FF1E3A8A",
  lewatBg: "FFFFD1DC", lewatTeks: "FF9F1239", kainBg: "FFFED7AA", kainTeks: "FF9A3412", kuningBg: "FFFEF08A", kuningTeks: "FF854D0E",
});

const FONT = "Calibri";
const fill = (argb) => ({ type: "pattern", pattern: "solid", fgColor: { argb } });
const cfFill = (argb) => ({ type: "pattern", pattern: "solid", bgColor: { argb } });
export const colLetter = (n) => { let s = ""; let x = n; while (x > 0) { const r = (x - 1) % 26; s = String.fromCharCode(65 + r) + s; x = Math.floor((x - 1) / 26); } return s; };

/** Nilai sel bertipe: tanggal -> Date, angka/rupiah -> Number, selain itu teks (atau kosong). */
export function cellValueOf(col, v) {
  if (col.type === "tanggal") return keTanggal(v);
  if (col.type === "angka" || col.type === "rupiah") return v === null || v === undefined || v === "" || !Number.isFinite(Number(v)) ? null : Number(v);
  return v === null || v === undefined || v === "" ? null : String(v);
}

function lebarKolom(col, rows) {
  const cap = col.wrap ? 50 : 34;
  let maxLen = String(col.header).length + 2;
  for (const r of rows) {
    const v = r[col.key]; if (v === null || v === undefined) continue;
    const s = col.type === "tanggal" ? "0000-00-00" : String(v);
    const longest = Math.max(...s.split("\n").map((x) => x.length));
    maxLen = Math.max(maxLen, longest);
  }
  const content = col.type === "tanggal" ? 13 : col.type === "rupiah" ? 18 : Math.ceil(maxLen * 1.08) + 2;
  return Math.min(Math.max(col.width || 10, Math.min(content, cap)), col.wrap ? Math.max(cap, col.width || 0) : Math.max(cap, col.width || 0));
}
function tinggiBaris(cols, widths, row) {
  let lines = 1;
  cols.forEach((c, i) => {
    if (!c.wrap) return;
    const v = row[c.key]; if (v === null || v === undefined || v === "") return;
    const per = Math.max(6, Math.floor(widths[i] * 0.95));
    const n = String(v).split("\n").reduce((s, par) => s + Math.max(1, Math.ceil(par.length / per)), 0);
    lines = Math.max(lines, n);
  });
  return Math.min(300, Math.max(20, lines * 15 + 5));
}

function tulisRingkasan(ws, data, nCols) {
  const { meta, summary } = data;
  const last = colLetter(nCols);
  const blok = (r, teks, { size = 11, bold = false, tinggi = 20, warna = WARNA.offWhite, bg = WARNA.navy } = {}) => {
    ws.mergeCells(`A${r}:${last}${r}`);
    const c = ws.getCell(`A${r}`); c.value = teks;
    c.font = { name: FONT, size, bold, color: { argb: warna } }; c.fill = fill(bg); c.alignment = { vertical: "middle", horizontal: "left", indent: 1 };
    ws.getRow(r).height = tinggi;
  };
  blok(1, "TARGET PRODUKSI HARIAN — SANSS", { size: 16, bold: true, tinggi: 30 });
  blok(2, `Target: ${meta.periodLabel}   ·   ${meta.scopeLabel}`, { size: 11, bold: true, tinggi: 20 });
  blok(3, `${meta.generatedLabel}   ·   ${meta.readOnlyNote}`, { size: 10, tinggi: 18, warna: "FFCBD5E1" });
  // KPI: tiap tile = 2 kolom (label baris 4, nilai baris 5)
  const tiles = [
    ["Total Unit", summary.total],
    ...summary.perStation.map((s) => [s.label, s.count]),
    ["Belum Dijadwalkan", summary.unscheduled], ["Komplain", summary.komplain], ["Tinggi", summary.tinggi], ["Lewat Target", summary.lewatTarget], ["Tanpa PIC", summary.tanpaPic],
  ];
  tiles.forEach(([label, value], i) => {
    const c1 = 1 + i * 2; const c2 = c1 + 1; if (c2 > nCols) return;
    ws.mergeCells(4, c1, 4, c2); ws.mergeCells(5, c1, 5, c2);
    const l = ws.getCell(4, c1); l.value = label; l.font = { name: FONT, size: 9, bold: true, color: { argb: WARNA.teksLembut } }; l.fill = fill(WARNA.offWhite); l.alignment = { vertical: "bottom", horizontal: "center", wrapText: true };
    const v = ws.getCell(5, c1); v.value = value; v.numFmt = "0"; v.font = { name: FONT, size: 16, bold: true, color: { argb: WARNA.navy } }; v.fill = fill(WARNA.offWhite); v.alignment = { vertical: "middle", horizontal: "center" };
    for (const r of [4, 5]) for (const c of [c1, c2]) ws.getCell(r, c).border = { left: c === c1 ? { style: "thin", color: { argb: WARNA.garis } } : undefined, right: c === c2 ? { style: "thin", color: { argb: WARNA.garis } } : undefined, top: r === 4 ? { style: "thin", color: { argb: WARNA.garis } } : undefined, bottom: r === 5 ? { style: "thin", color: { argb: WARNA.garis } } : undefined };
  });
  // sisa kolom ringkasan: warna latar rata
  for (let c = tiles.length * 2 + 1; c <= nCols; c += 1) for (const r of [4, 5]) ws.getCell(r, c).fill = fill(WARNA.offWhite);
  ws.getRow(4).height = 24; ws.getRow(5).height = 30; ws.getRow(6).height = 6;
}

function formatBersyarat(ws, cols, n) {
  const idx = (key) => cols.findIndex((c) => c.key === key) + 1;
  const first = FIRST_DATA_ROW; const lastRow = FIRST_DATA_ROW + n - 1;
  const range = (key) => `${colLetter(idx(key))}${first}:${colLetter(idx(key))}${lastRow}`;
  const cL = (key) => colLetter(idx(key));
  const tebal = (argb) => ({ bold: true, color: { argb } });
  const rules = [];
  const add = (ref, rule) => rules.push({ ref, rules: [rule] });
  // Prioritas
  add(range("prioritas"), { type: "cellIs", operator: "equal", formulae: ['"Komplain"'], priority: 1, style: { font: tebal("FFFFFFFF"), fill: cfFill(WARNA.komplain) } });
  add(range("prioritas"), { type: "cellIs", operator: "equal", formulae: ['"Tinggi"'], priority: 2, style: { font: tebal("FFFFFFFF"), fill: cfFill(WARNA.tinggi) } });
  add(range("prioritas"), { type: "cellIs", operator: "equal", formulae: ['"Normal"'], priority: 3, style: { font: tebal(WARNA.normalTeks), fill: cfFill(WARNA.normalBg) } });
  // Lewat Target: sel Target + Alasan Lewat Target (merah muda) bila alasan diawali "Lewat target"
  const ref2 = `${range("target")} ${range("alasanLewat")}`;
  add(ref2, { type: "expression", formulae: [`LEFT($${cL("alasanLewat")}${first},12)="Lewat target"`], priority: 4, style: { font: tebal(WARNA.lewatTeks), fill: cfFill(WARNA.lewatBg) } });
  // Ganti Kain
  add(range("gantiKain"), { type: "cellIs", operator: "equal", formulae: ['"Ya"'], priority: 5, style: { font: tebal(WARNA.kainTeks), fill: cfFill(WARNA.kainBg) } });
  // Belum punya PIC (PIC Meja..PIC Corner): teks diawali "Belum "
  const picRef = `${cL("picMeja")}${first}:${cL("picCorner")}${lastRow}`;
  add(picRef, { type: "expression", formulae: [`LEFT(${cL("picMeja")}${first},6)="Belum "`], priority: 6, style: { font: tebal(WARNA.kuningTeks), fill: cfFill(WARNA.kuningBg) } });
  // Bahan tertahan
  add(range("statusBahan"), { type: "expression", formulae: [`LEFT(${cL("statusBahan")}${first},8)="Tertahan"`], priority: 7, style: { font: tebal(WARNA.kuningTeks), fill: cfFill(WARNA.kuningBg) } });
  // Zebra (prioritas terendah; ikut terurut/tersaring karena berbasis nomor baris tampil)
  add(`A${first}:${colLetter(cols.length)}${lastRow}`, { type: "expression", formulae: ["MOD(ROW(),2)=0"], priority: 50, style: { fill: cfFill(WARNA.zebra) } });
  for (const r of rules) ws.addConditionalFormatting(r);
}

function sheetKeterangan(wb, data) {
  const ws = wb.addWorksheet("Keterangan", { properties: { tabColor: { argb: WARNA.royal } } });
  ws.getColumn(1).width = 30; ws.getColumn(2).width = 96;
  const rows = [
    ["Sumber data", "Server Rencana Produksi SANSS (data yang sama dengan papan). File ini snapshot baca-saja: mengubahnya tidak mengubah jadwal, dan file ini tidak untuk diimpor kembali."],
    ["Dibuat", data.meta.generatedLabel],
    ["Cakupan", `${data.meta.periodLabel} · ${data.meta.scopeLabel}`],
    ["Urutan", "Tanggal target → Meja → urutan di Meja. Kolom Urutan = posisi kartu di Meja seperti di papan: nomor manual hasil seret terbaru lebih dulu, lalu urutan bawaan (prioritas, lalu target mulai). Unit tanpa Meja tampil setelah unit terjadwal dengan label “Belum Dijadwalkan”."],
    ["Target", "Target khusus kartu bila ada; bila tidak, tanggal papan. Kosong untuk unit yang belum dijadwalkan."],
    ["Status", "Status global unit: Menunggu Dijemput · Pengambilan · Diterima di Workshop · Diproses · Siap Kirim · Dalam Pengiriman · Terkirim (dari bukti di server, bukan tebakan)."],
    ["Prioritas", "Komplain merah tua · Tinggi oranye · Normal biru."],
    ["Lewat Target", "Sel Target dan Alasan Lewat Target merah muda bila target efektif sudah terlewat."],
    ["Ganti Kain", "Oranye bila Sales memesan layanan ganti kain."],
    ["PIC / Bahan", "Kuning bila PIC belum ada (“Belum …”) atau bahan tertahan (“Tertahan — …”)."],
    ["PIC QC", "Pemeriksa QC yang tercatat pada inspeksi terakhir; “—” bila belum ada inspeksi."],
    ["Filter", "Gunakan tombol ▼ pada judul kolom tabel untuk menyaring dan mengurutkan."],
    ...(data.meta.includeValue ? [["Nilai Order", "Disertakan atas permintaan Admin/Owner. Jangan dibagikan ke grup umum."]] : []),
    ...(data.meta.truncated ? [["PERHATIAN", `Data dipotong pada ${data.meta.maxRows} baris pertama. Persempit rentang tanggal atau Meja.`]] : []),
  ];
  rows.forEach(([a, b], i) => {
    const r = i + 1;
    ws.getCell(`A${r}`).value = a; ws.getCell(`A${r}`).font = { name: FONT, bold: true, color: { argb: WARNA.navy } };
    ws.getCell(`B${r}`).value = b; ws.getCell(`B${r}`).alignment = { wrapText: true, vertical: "top" }; ws.getCell(`A${r}`).alignment = { vertical: "top" };
    ws.getRow(r).height = Math.max(18, Math.ceil(String(b).length / 90) * 15 + 4);
  });
  aturCetak(ws, { titlesRow: null });
}

/** Isi body permintaan export dari pilihan formulir (murni; dipakai formulir dan tes). Meja tertentu = daftar kode; kartu terlihat = id Run + id unit backlog tanpa Run. */
export function buildExportBody({ scope, date, from, to, mejaMode, mejaSel, visibleOnly, includeUnscheduled, includeValue, visibleRunIds = [], visibleUnitIds = [] }) {
  const range = scope === "rentang" ? { from, to } : { from: date, to: date };
  const stations = mejaMode === "tertentu" ? [...mejaSel] : [];
  return {
    ...range, stations, visibleOnly: !!visibleOnly, includeUnscheduled: !!includeUnscheduled && stations.length === 0, includeValue: !!includeValue,
    ...(visibleOnly ? { runIds: visibleRunIds, unitIds: visibleUnitIds } : {}),
  };
}

/** Membangun workbook (tanpa menyimpan) — dapat dijalankan di Node untuk tes. @param ExcelJS konstruktor/modul ExcelJS */
export function buildRencanaWorkbook(ExcelJS, data) {
  const cols = data?.columns || [];
  const rows = data?.rows || [];
  if (!rows.length) throw new Error("Tidak ada unit untuk diexport");
  const wb = new ExcelJS.Workbook();
  wb.creator = "SANSS"; wb.title = "Target Produksi Harian"; wb.created = new Date(data.meta.generatedAt || Date.now());
  const ws = wb.addWorksheet(SHEET_NAME, {
    views: [{ state: "frozen", xSplit: 0, ySplit: HEADER_ROW, zoomScale: 100, showGridLines: false }],
    properties: { tabColor: { argb: WARNA.royal } },
  });
  const widths = cols.map((c) => lebarKolom(c, rows));
  cols.forEach((c, i) => { ws.getColumn(i + 1).width = widths[i]; });
  tulisRingkasan(ws, data, cols.length);

  ws.addTable({
    name: TABLE_NAME, ref: `A${HEADER_ROW}`, headerRow: true, totalsRow: false,
    style: { theme: null, showRowStripes: false },
    columns: cols.map((c) => ({ name: c.header, filterButton: true })),
    rows: rows.map((r) => cols.map((c) => cellValueOf(c, r[c.key]))),
  });

  // Header tabel: royal blue, teks putih
  const hr = ws.getRow(HEADER_ROW); hr.height = 32;
  cols.forEach((c, i) => {
    const cell = hr.getCell(i + 1);
    cell.font = { name: FONT, size: 11, bold: true, color: { argb: "FFFFFFFF" } }; cell.fill = fill(WARNA.royal);
    cell.alignment = { vertical: "middle", horizontal: "center", wrapText: true };
    cell.border = { bottom: { style: "medium", color: { argb: WARNA.navy } }, right: { style: "thin", color: { argb: "FF4B7BEA" } } };
  });
  // Isi: tipe, format, bungkus teks, batas
  rows.forEach((row, ri) => {
    const r = ws.getRow(FIRST_DATA_ROW + ri);
    r.height = tinggiBaris(cols, widths, row);
    cols.forEach((c, ci) => {
      const cell = r.getCell(ci + 1);
      cell.font = { name: FONT, size: 11, color: { argb: WARNA.teks } };
      cell.border = { bottom: { style: "thin", color: { argb: WARNA.garis } }, right: { style: "hair", color: { argb: WARNA.garis } } };
      cell.alignment = { vertical: "top", wrapText: !!c.wrap, horizontal: c.type === "angka" || c.type === "rupiah" ? (c.key === "no" || c.key === "urutan" ? "center" : "right") : c.type === "tanggal" ? "center" : "left" };
      if (c.type === "tanggal" && cell.value) cell.numFmt = FORMAT_TANGGAL;
      else if (c.type === "rupiah" && cell.value !== null) cell.numFmt = FORMAT_RUPIAH;
      else if (c.key === "berat" && cell.value !== null) cell.numFmt = '0.0 "kg"';
      else if (c.type === "angka" && cell.value !== null) cell.numFmt = "0";
    });
  });
  formatBersyarat(ws, cols, rows.length);
  aturCetak(ws, { titlesRow: `${HEADER_ROW}:${HEADER_ROW}` });
  ws.pageSetup.margins = { left: 0.3, right: 0.3, top: 0.5, bottom: 0.6, header: 0.2, footer: 0.25 };
  ws.pageSetup.horizontalCentered = true;
  ws.headerFooter = { oddFooter: `&L&8${String(data.meta.generatedLabel).replace(/&/g, "&&")}&R&8Halaman &P dari &N` };
  sheetKeterangan(wb, data);
  return wb;
}

/** Mengunduh .xlsx. @returns nama berkas */
export async function exportRencanaProduksi(data) {
  if (!data?.rows?.length) throw new Error("Tidak ada unit untuk diexport");
  const ExcelJS = await loadExcelJS();
  const wb = buildRencanaWorkbook(ExcelJS, data);
  await simpanWorkbook(wb, data.meta.fileName);
  return data.meta.fileName;
}
