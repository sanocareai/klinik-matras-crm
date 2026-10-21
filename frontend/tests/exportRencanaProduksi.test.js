// Export Excel Rencana Produksi — unit exporter: kontrak data (backend domain murni) + workbook ExcelJS yang DITULIS lalu DIBACA ULANG (zip/XML asli) untuk memverifikasi
// Excel Table + filter, panel beku, warna header, format bersyarat, tanggal/angka bertipe, cetak landscape 1 halaman lebar, header berulang, karakter Indonesia, >500 unit.
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import JSZip from "jszip";
import * as D from "../../backend/src/lib/domain/productionRencanaExport.js";
import { FIRST_DATA_ROW, HEADER_ROW, SHEET_NAME, TABLE_NAME, WARNA, buildRencanaWorkbook, cellValueOf, colLetter } from "../src/utils/exportRencanaProduksi.js";
import { FORMAT_RUPIAH, FORMAT_TANGGAL, keTanggal } from "../src/utils/excelCommon.js";

const NOW = new Date("2026-10-12T07:05:00.000Z"); // 14.05 WIB
const TODAY = "2026-10-12";

function view(i, o = {}) {
  const station = o.station === undefined ? `TABLE_${(i % 4) + 1}` : o.station;
  return {
    runId: `run-${i}`, unit: { id: `unit-${i}`, unitCode: `U-${String(i).padStart(4, "0")}`, merk: "Serta", ukuran: "160x200" },
    customer: { orderNumber: `RES-${i}`, name: o.customer ?? `Pelanggan ${i}`, salesName: "Rina", salesServices: ["Servis Spring"], complaints: o.complaints ?? [], request: o.request ?? null, weightKg: o.weightKg ?? 70 },
    priority: o.priority || { key: "NORMAL", label: "Normal", rank: 0 },
    globalStatus: o.globalStatus || { key: "DITERIMA_WORKSHOP", label: "Diterima di Workshop", detail: null },
    plan: station ? { id: `plan-${i}`, stationCode: station, productionDate: o.date ?? TODAY, targetDate: o.targetDate ?? null, stationSequence: o.seq === undefined ? (i % 7) + 1 : o.seq, operator: o.operator === undefined ? { name: "Andi" } : o.operator, cornerOperator: o.corner ?? null, targetMissed: !!o.late } : null,
    materialStatus: o.material || { key: "SUDAH_DISERAHKAN", label: "Sudah diserahkan" }, warnings: o.warnings || [], steps: [{ no: 5, label: "Diagnosa", status: "CURRENT" }], bucketLabel: "Antrean",
    build: o.build ?? { materialOperator: { name: "Ucok" } }, corner: o.cornerState ?? { applies: false },
  };
}
const row = (i, o = {}, extras = {}) => D.exportRowOf({ view: view(i, o), todayKey: TODAY, extras: { productLine: "KASUR", productType: "KASUR_SPRING", events: [], ...extras } });
const dataOf = (rows, { includeValue = false, stations = [] } = {}) => {
  const sorted = D.sortExportRows(rows);
  return {
    meta: { generatedAt: NOW.toISOString(), generatedLabel: `Data dibuat: ${D.wibStamp(NOW)}`, from: TODAY, to: TODAY, periodLabel: D.periodLabel({ from: TODAY, to: TODAY }), scopeLabel: "Semua Meja", includeValue, fileName: D.exportFileName({ from: TODAY, to: TODAY }), truncated: false, maxRows: D.EXPORT_MAX_ROWS, readOnlyNote: "Snapshot baca-saja." },
    summary: D.summaryOf(sorted, { stations: ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"] }), columns: D.columnsFor({ includeValue }), rows: sorted,
  };
};
async function roundTrip(data) {
  const wb = buildRencanaWorkbook(ExcelJS, data);
  const buf = await wb.xlsx.writeBuffer();
  const read = new ExcelJS.Workbook(); await read.xlsx.load(buf);
  const zip = await JSZip.loadAsync(buf);
  const files = Object.keys(zip.files);
  const xml = async (re) => zip.file(files.find((f) => re.test(f))).async("string");
  return { wb: read, buf, zip, files, xml };
}

test("nama berkas: Target-Produksi-DD-MMMM-YYYY.xlsx (bulan Indonesia); rentang memakai -sd-; waktu WIB", () => {
  assert.equal(D.exportFileName({ from: "2026-10-12", to: "2026-10-12" }), "Target-Produksi-12-Oktober-2026.xlsx");
  assert.equal(D.exportFileName({ from: "2026-03-05" }), "Target-Produksi-05-Maret-2026.xlsx");
  assert.equal(D.exportFileName({ from: "2026-12-30", to: "2027-01-02" }), "Target-Produksi-30-Desember-2026-sd-02-Januari-2027.xlsx");
  assert.equal(D.wibStamp(NOW), "12 Oktober 2026, 14.05 WIB");
  assert.doesNotMatch(D.exportFileName({ from: "2026-08-01" }), /[\\/:*?"<>|\s]/);
});

test("kolom: tepat 29 kolom berurutan sesuai kontrak (+ Tanggal Jadwal, Status Rencana, Mode pelaksanaan); Nilai Order hanya bila diminta", () => {
  const h = D.EXPORT_COLUMNS.map((c) => c.header);
  assert.deepEqual(h, ["No.", "Target", "Tanggal Jadwal", "Meja", "Urutan", "Prioritas", "Status", "Status Rencana", "Mode pelaksanaan", "Resi", "Kode Unit", "Customer", "Sales", "Layanan Sales", "Jenis Produk", "Jenis Kasur", "Merek", "Ukuran", "Berat Customer", "Keluhan/Catatan Sales", "Ganti Kain", "PIC Meja", "PIC Bahan", "PIC QC", "PIC Corner", "Status Bahan", "Tahap Sekarang", "Alasan Lewat Target", "Catatan Kepala Produksi"]);
  assert.equal(D.columnsFor().length, 29); assert.equal(D.columnsFor({ includeValue: true }).at(-1).header, "Nilai Order");
  assert.equal(D.columnsFor({ includeValue: true }).at(-1).type, "rupiah");
});

test("urutan: tanggal target → Meja → stationSequence; unit tanpa Meja SETELAH unit terjadwal; nomor manual mendahului prioritas", () => {
  const rows = [
    row(1, { station: "TABLE_2", date: "2026-10-13", seq: 1 }),
    row(2, { station: "TABLE_1", date: "2026-10-12", seq: 3 }),
    row(3, { station: "TABLE_1", date: "2026-10-12", seq: 1, priority: { key: "NORMAL", label: "Normal", rank: 0 } }),
    row(4, { station: "TABLE_1", date: "2026-10-12", seq: 2, priority: { key: "COMPLAINT", label: "Komplain", rank: 2 } }),
    row(5, { station: "TABLE_3", date: "2026-10-12", seq: 1 }),
    row(6, { station: null }),
    row(7, { station: "TABLE_1", date: "2026-10-12", seq: 1, targetDate: "2026-10-14" }), // target khusus kartu lebih akhir dari tanggal papan
  ];
  const s = D.sortExportRows(rows).map((r) => r.unitCode);
  assert.deepEqual(s, ["U-0003", "U-0004", "U-0002", "U-0005", "U-0001", "U-0007", "U-0006"]);
  assert.deepEqual(D.sortExportRows(rows).map((r) => r.no), [1, 2, 3, 4, 5, 6, 7]);
  const last = D.sortExportRows(rows).at(-1); assert.equal(last.meja, "Belum Dijadwalkan"); assert.equal(last.target, null);
  // tanpa nomor manual: prioritas menentukan urutan bawaan, lalu kode unit
  const free = D.sortExportRows([row(10, { seq: null, station: "TABLE_1" }), row(11, { seq: null, station: "TABLE_1", priority: { key: "HIGH", label: "Tinggi", rank: 1 } })]);
  assert.deepEqual(free.map((r) => r.unitCode), ["U-0011", "U-0010"]);
  assert.deepEqual(free.map((r) => r.urutan), [1, 2], "tanpa nomor manual: kolom Urutan = posisi bawaan papan (prioritas dulu)");
  assert.deepEqual(free.map((r) => r.seqManual), [false, false]);
  // nomor manual mengalahkan prioritas; posisi dihitung per Meja per tanggal papan
  const mixed = D.sortExportRows([row(20, { seq: 2, station: "TABLE_1" }), row(21, { seq: 1, station: "TABLE_1" }), row(22, { seq: null, station: "TABLE_1", priority: { key: "COMPLAINT", label: "Komplain", rank: 2 } }), row(23, { seq: null, station: "TABLE_2" })]);
  assert.deepEqual(mixed.map((r) => [r.unitCode, r.urutan]), [["U-0021", 1], ["U-0020", 2], ["U-0022", 3], ["U-0023", 1]]);
  assert.deepEqual(mixed.map((r) => r.seqManual), [true, true, false, false]);
});

test("target: target khusus kartu bila ada, bila tidak tanggal papan; alasan Lewat Target dari server (hari + alasan jadwal ulang)", () => {
  assert.equal(row(1, { date: "2026-10-12" }).target, "2026-10-12");
  assert.equal(row(1, { date: "2026-10-12", targetDate: "2026-10-15" }).target, "2026-10-15");
  const ev = [{ missedTarget: true, reasonCode: "WAITING_MATERIAL", note: "Bahan belum datang", kind: "RESCHEDULED" }];
  const late = row(1, { date: "2026-10-09", late: true }, { events: ev });
  assert.equal(late.alasanLewat, "Lewat target 3 hari — jadwal ulang: Menunggu bahan"); assert.equal(late.late, true);
  assert.equal(late.catatanLead, "Bahan belum datang");
  const hist = row(2, { date: "2026-10-12", late: false }, { events: ev });
  assert.match(hist.alasanLewat, /^Riwayat: dijadwalkan ulang setelah lewat target — Menunggu bahan/); assert.equal(hist.late, false);
  assert.equal(row(3).alasanLewat, "");
});

test("ringkasan: total, per Meja, Komplain, Tinggi, Lewat Target, tanpa PIC (hanya unit di Meja), Belum Dijadwalkan", () => {
  const rows = D.sortExportRows([
    row(1, { station: "TABLE_1" }), row(2, { station: "TABLE_1", priority: { key: "COMPLAINT", label: "Komplain", rank: 2 } }), row(3, { station: "TABLE_2", priority: { key: "HIGH", label: "Tinggi", rank: 1 }, late: true, date: "2026-10-10" }),
    row(4, { station: "TABLE_2", operator: null }), row(5, { station: null }),
  ]);
  const s = D.summaryOf(rows, { stations: ["TABLE_1", "TABLE_2", "TABLE_3", "TABLE_4"] });
  assert.equal(s.total, 5); assert.deepEqual(s.perStation.map((p) => p.count), [2, 2, 0, 0]); assert.equal(s.unscheduled, 1);
  assert.equal(s.komplain, 1); assert.equal(s.tinggi, 1); assert.equal(s.lewatTarget, 1); assert.equal(s.tanpaPic, 1);
});

test("isi baris: satu Layanan Sales (tanpa layanan teknis), PIC/Corner/Bahan/QC, jenis produk, ganti kain, bahan tertahan, tahap sekarang", () => {
  const r = row(1, { build: { materialOperator: null }, corner: null, cornerState: { applies: true }, warnings: [{ code: "BAHAN_BELUM" }], material: { key: "BOM_BELUM_ADA", label: "BOM belum dibuat" }, complaints: ["Sakit pinggang"], request: "Mohon ganti kain motif\nwarna abu" }, { gantiKain: true, picQc: "Risdy", productType: "SOFA_L", productLine: "SOFA" });
  assert.equal(r.layanan, "Servis Spring"); assert.equal(r.picBahan, "Belum ditetapkan"); assert.equal(r.picCorner, "Belum ditetapkan"); assert.equal(r.picQc, "Risdy");
  assert.equal(r.statusBahan, "Tertahan — BOM belum dibuat"); assert.equal(r.gantiKain, "Ya"); assert.equal(r.tahap, "5. Diagnosa");
  assert.equal(r.jenisProduk, "Sofa — Sofa L"); assert.equal(r.jenisKasur, "—"); assert.match(r.catatanSales, /Keluhan: Sakit pinggang\nCatatan: Mohon ganti kain motif\nwarna abu/);
  const k = row(2, { cornerState: { applies: false } }, { productType: "KASUR_SPRING" });
  assert.equal(k.picCorner, "Tidak diperlukan"); assert.equal(k.jenisProduk, "Kasur"); assert.equal(k.jenisKasur, "Kasur Spring"); assert.equal(k.gantiKain, "Tidak"); assert.equal(k.picMeja, "Andi");
  assert.equal(row(3, { operator: null }).picMeja, "Belum ada PIC"); assert.equal(row(4, { station: null }).picMeja, "—");
});

test("izin harga: tanpa includeValue baris TIDAK punya field nilaiOrder; dengan includeValue numerik", () => {
  const plain = row(1, {}, { orderValue: 2_500_000 }); assert.equal("nilaiOrder" in plain, false);
  const withValue = D.exportRowOf({ view: view(2), todayKey: TODAY, includeValue: true, extras: { orderValue: 2_500_000 } }); assert.equal(withValue.nilaiOrder, 2_500_000);
  assert.equal(D.exportRowOf({ view: view(3), todayKey: TODAY, includeValue: true, extras: {} }).nilaiOrder, null);
});

test("masukan: tanggal/rentang/Meja/id divalidasi; rentang >62 hari ditolak; id kartu harus UUID; default Meja = semua + Belum Dijadwalkan", () => {
  const ok = D.normalizeExportQuery({ from: "2026-10-12" }, { today: TODAY, stations: ["TABLE_1", "TABLE_2"] });
  assert.deepEqual([ok.from, ok.to, ok.stations, ok.includeUnscheduled, ok.includeValue, ok.visibleOnly], ["2026-10-12", "2026-10-12", [], true, false, false]);
  const r = D.normalizeExportQuery({ from: "2026-10-01", to: "2026-10-07", stations: "TABLE_2" }, { today: TODAY, stations: ["TABLE_1", "TABLE_2"] });
  assert.deepEqual(r.stations, ["TABLE_2"]); assert.equal(r.includeUnscheduled, false);
  const code = (fn) => { try { fn(); return null; } catch (e) { return e.code; } };
  assert.equal(code(() => D.normalizeExportQuery({ from: "2026-13-40" }, { today: TODAY })), "EXPORT_DATE_INVALID");
  assert.equal(code(() => D.normalizeExportQuery({ from: "2026-10-12", to: "2026-10-01" }, { today: TODAY })), "EXPORT_RANGE_INVALID");
  assert.equal(code(() => D.normalizeExportQuery({ from: "2026-01-01", to: "2026-12-31" }, { today: TODAY })), "EXPORT_RANGE_TOO_LONG");
  assert.equal(code(() => D.normalizeExportQuery({ stations: ["TABLE_9"] }, { today: TODAY, stations: ["TABLE_1"] })), "EXPORT_STATION_INVALID");
  assert.equal(code(() => D.normalizeExportQuery({ runIds: ["bukan-uuid"] }, { today: TODAY })), "EXPORT_IDS_INVALID");
  assert.equal(D.normalizeExportQuery({}, { today: TODAY }).from, TODAY);
});

test("workbook: Excel Table dengan filter aktif, panel beku tepat di bawah header, header royal blue + teks putih, judul navy/off-white", async () => {
  const { wb, xml, files } = await roundTrip(dataOf([row(1), row(2, { station: null }), row(3, { station: "TABLE_2" })]));
  assert.deepEqual(wb.worksheets.map((w) => w.name), [SHEET_NAME, "Keterangan"]);
  const ws = wb.getWorksheet(SHEET_NAME);
  assert.equal(ws.views[0].state, "frozen"); assert.equal(ws.views[0].ySplit, HEADER_ROW); assert.equal(HEADER_ROW, 7);
  const tableXml = await xml(/xl\/tables\/table\d+\.xml$/);
  assert.match(tableXml, new RegExp(`name="${TABLE_NAME}"`)); assert.match(tableXml, /<autoFilter ref="A7:AC10"/); assert.match(tableXml, /headerRowCount="1"|<tableColumns count="26"/);
  assert.ok(files.some((f) => /xl\/tables\/table\d+\.xml$/.test(f)), "Excel Table (bukan sekadar autofilter)");
  const hdr = ws.getRow(HEADER_ROW).getCell(1);
  assert.equal(hdr.fill.fgColor.argb, WARNA.royal); assert.equal(hdr.font.color.argb, "FFFFFFFF"); assert.equal(hdr.font.bold, true);
  assert.equal(ws.getRow(HEADER_ROW).getCell(26).fill.fgColor.argb, WARNA.royal);
  assert.equal(ws.getCell("A1").fill.fgColor.argb, WARNA.navy); assert.equal(ws.getCell("A1").font.color.argb, WARNA.offWhite);
  assert.equal(ws.getCell("A1").value, "TARGET PRODUKSI HARIAN — SANSS");
  assert.match(String(ws.getCell("A3").value), /Data dibuat: 12 Oktober 2026, 14\.05 WIB/);
  assert.equal(ws.getCell("A5").value, 3, "Total Unit"); assert.equal(ws.getCell("A4").value, "Total Unit");
});

test("workbook: tanggal bertipe Date + format yyyy-mm-dd (sortable), angka bertipe Number, tanggal kosong untuk Belum Dijadwalkan", async () => {
  const { wb } = await roundTrip(dataOf([row(1, { date: "2026-10-12", weightKg: 72.5 }), row(2, { station: null })], { includeValue: true }));
  const ws = wb.getWorksheet(SHEET_NAME);
  const target = ws.getCell(FIRST_DATA_ROW, 2);
  assert.ok(target.value instanceof Date); assert.equal(target.value.toISOString().slice(0, 10), "2026-10-12"); assert.equal(target.numFmt, FORMAT_TANGGAL);
  assert.equal(typeof ws.getCell(FIRST_DATA_ROW, 1).value, "number"); assert.equal(typeof ws.getCell(FIRST_DATA_ROW, 5).value, "number");
  const berat = ws.getCell(FIRST_DATA_ROW, 19); assert.equal(typeof berat.value, "number"); assert.equal(berat.value, 72.5);
  assert.equal(ws.getCell(FIRST_DATA_ROW + 1, 2).value, null, "unit tanpa Meja: tanggal kosong, bukan teks");
  assert.equal(ws.getCell(FIRST_DATA_ROW + 1, 3).value, null, "Tanggal Jadwal kosong untuk unit belum dijadwalkan"); assert.equal(ws.getCell(FIRST_DATA_ROW + 1, 4).value, "Belum Dijadwalkan");
  assert.deepEqual(cellValueOf({ type: "tanggal" }, "2026-10-12"), new Date(Date.UTC(2026, 9, 12))); assert.deepEqual(keTanggal("2026-10-12T05:00:00.000Z"), new Date(Date.UTC(2026, 9, 12))); assert.equal(cellValueOf({ type: "tanggal" }, null), null);
});

test("workbook: Nilai Order numerik berformat Rupiah hanya bila disertakan", async () => {
  const r = D.exportRowOf({ view: view(1), todayKey: TODAY, includeValue: true, extras: { orderValue: 2_500_000 } });
  const { wb } = await roundTrip(dataOf([r], { includeValue: true }));
  const ws = wb.getWorksheet(SHEET_NAME);
  const cell = ws.getCell(FIRST_DATA_ROW, 30);
  assert.equal(ws.getRow(HEADER_ROW).getCell(30).value, "Nilai Order"); assert.equal(cell.value, 2_500_000); assert.equal(cell.numFmt, FORMAT_RUPIAH);
  const noValue = (await roundTrip(dataOf([row(1)]))).wb.getWorksheet(SHEET_NAME);
  assert.equal(noValue.columnCount <= 29, true); assert.equal(noValue.getRow(HEADER_ROW).getCell(30).value, null);
});

test("workbook: format bersyarat — Komplain/Tinggi/Normal, Lewat Target, Ganti Kain, PIC kosong/bahan tertahan, zebra", async () => {
  const { xml } = await roundTrip(dataOf([row(1), row(2, { priority: { key: "COMPLAINT", label: "Komplain", rank: 2 } })]));
  const sheet = await xml(/xl\/worksheets\/sheet1\.xml$/); const styles = await xml(/xl\/styles\.xml$/);
  const cf = [...sheet.matchAll(/<conditionalFormatting sqref="([^"]+)">([\s\S]*?)<\/conditionalFormatting>/g)];
  assert.ok(cf.length >= 8, `aturan format bersyarat: ${cf.length}`);
  const all = sheet.match(/<conditionalFormatting[\s\S]*<\/conditionalFormatting>/)[0];
  for (const needle of ['"Komplain"', '"Tinggi"', '"Normal"', "Lewat target", '"Ya"', 'LEFT(V8,6)=&quot;Belum &quot;', "Tertahan", "MOD(ROW(),2)=0"]) assert.ok(all.includes(needle) || all.includes(needle.replace(/"/g, "&quot;")), `aturan: ${needle}`);
  assert.ok(cf.some(([, ref]) => /^B8:B9 AB8:AB9$/.test(ref)), "Lewat Target menyorot Target + Alasan");
  assert.ok(cf.some(([, ref]) => /^V8:Y9$/.test(ref)), "PIC Meja..PIC Corner");
  for (const argb of [WARNA.komplain, WARNA.tinggi, WARNA.normalBg, WARNA.lewatBg, WARNA.kainBg, WARNA.kuningBg, WARNA.zebra]) assert.ok(styles.includes(argb), `warna ${argb} di dxf`);
});

test("workbook: cetak landscape, pas 1 halaman lebar, header tabel berulang, footer; kolom cukup lebar; baris catatan panjang tidak terpotong", async () => {
  const panjang = `${"Catatan sangat panjang dari Sales: customer minta kain motif bunga warna abu tua, jahit rapi, pinggiran diganti. ".repeat(6)}\nBaris kedua — Ñandú café, 70 kg, “tebal”.`;
  const { wb, xml } = await roundTrip(dataOf([row(1, { request: panjang, complaints: ["Sakit pinggang", "Pegal-pegal"] })]));
  const ws = wb.getWorksheet(SHEET_NAME);
  assert.equal(ws.pageSetup.orientation, "landscape"); assert.equal(ws.pageSetup.fitToPage, true); assert.equal(ws.pageSetup.fitToWidth, 1); assert.equal(ws.pageSetup.fitToHeight, 0); assert.equal(ws.pageSetup.paperSize, 9);
  const sheet = await xml(/xl\/worksheets\/sheet1\.xml$/); const book = await xml(/xl\/workbook\.xml$/);
  assert.match(sheet, /<pageSetup[^>]*orientation="landscape"/); assert.match(sheet, /<pageSetup[^>]*fitToWidth="1"/); assert.match(sheet, /fitToPage="1"/);
  assert.match(book, /_xlnm\.Print_Titles[^>]*>[^<]*\$7:\$7/); assert.match(sheet, /Halaman &amp;P dari &amp;N/);
  const idx = D.EXPORT_COLUMNS.findIndex((c) => c.key === "catatanSales") + 1;
  const cell = ws.getCell(FIRST_DATA_ROW, idx);
  assert.equal(cell.alignment.wrapText, true); assert.ok(String(cell.value).includes("Ñandú café")); assert.ok(String(cell.value).includes("“tebal”")); assert.ok(String(cell.value).includes("\n"));
  assert.ok(ws.getColumn(idx).width >= 44 && ws.getColumn(idx).width <= 60);
  assert.ok(ws.getRow(FIRST_DATA_ROW).height >= 120, `tinggi baris ${ws.getRow(FIRST_DATA_ROW).height}`);
  for (const c of D.EXPORT_COLUMNS) assert.ok(ws.getColumn(D.EXPORT_COLUMNS.indexOf(c) + 1).width >= String(c.header).length * 0.8, `lebar kolom ${c.header}`);
  assert.equal(colLetter(26), "Z"); assert.equal(colLetter(27), "AA");
});

test("skala: >500 unit (1200) menghasilkan satu tabel utuh terurut dengan filter mencakup semua baris", async () => {
  const rows = []; for (let i = 1; i <= 1200; i += 1) rows.push(row(i, { late: i % 50 === 0, date: i % 50 === 0 ? "2026-10-09" : TODAY, operator: i % 97 === 0 ? null : { name: "Andi" } }));
  const data = dataOf(rows);
  const t0 = Date.now(); const { wb, xml } = await roundTrip(data); const ms = Date.now() - t0;
  const ws = wb.getWorksheet(SHEET_NAME);
  assert.equal(data.summary.total, 1200); assert.equal(ws.getCell("A5").value, 1200);
  assert.equal(ws.getCell(FIRST_DATA_ROW + 1199, 1).value, 1200); assert.equal(ws.getCell(FIRST_DATA_ROW + 1200, 1).value, null);
  assert.match(await xml(/xl\/tables\/table\d+\.xml$/), /<autoFilter ref="A7:AC1207"/);
  assert.ok(ms < 30000, `waktu ${ms}ms`);
  // urutan terjaga: target naik, lalu Meja, lalu urutan
  const keys = []; for (let r = FIRST_DATA_ROW; r < FIRST_DATA_ROW + 1200; r += 1) keys.push([ws.getCell(r, 2).value?.toISOString().slice(0, 10), ws.getCell(r, 4).value, ws.getCell(r, 5).value ?? 99]);
  for (let i = 1; i < keys.length; i += 1) { const a = keys[i - 1]; const b = keys[i]; assert.ok(a[0] < b[0] || (a[0] === b[0] && (a[1] < b[1] || (a[1] === b[1] && a[2] <= b[2]))), `urutan baris ${i}`); }
});

test("tanpa unit: pembuat workbook menolak (tidak membuat file kosong)", () => {
  assert.throws(() => buildRencanaWorkbook(ExcelJS, { columns: D.columnsFor(), rows: [], meta: {}, summary: {} }), /Tidak ada unit/);
});

// ---- Formulir & pemasangan di Rencana Produksi (text-scan; tanpa jsdom) -----------------------------------------------------------------------
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { buildExportBody } from "../src/utils/exportRencanaProduksi.js";
const here = path.dirname(fileURLToPath(import.meta.url));
const read = (...p) => fs.readFileSync(path.join(here, "..", "src", ...p), "utf8");

test("formulir: body permintaan — tanggal papan / rentang, Semua Meja / Meja tertentu, kartu terlihat, nilai order", () => {
  const base = { scope: "papan", date: "2026-10-12", from: "2026-10-12", to: "2026-10-12", mejaMode: "semua", mejaSel: [], visibleOnly: false, includeUnscheduled: true, includeValue: false };
  assert.deepEqual(buildExportBody(base), { from: "2026-10-12", to: "2026-10-12", stations: [], visibleOnly: false, includeUnscheduled: true, includeValue: false });
  assert.deepEqual(buildExportBody({ ...base, scope: "rentang", from: "2026-10-01", to: "2026-10-07" }).to, "2026-10-07");
  const some = buildExportBody({ ...base, mejaMode: "tertentu", mejaSel: ["TABLE_2", "TABLE_4"] });
  assert.deepEqual(some.stations, ["TABLE_2", "TABLE_4"]); assert.equal(some.includeUnscheduled, false, "Meja tertentu tidak menyertakan Belum Dijadwalkan");
  const vis = buildExportBody({ ...base, visibleOnly: true, includeUnscheduled: false, visibleRunIds: ["r1"], visibleUnitIds: ["u1"] });
  assert.deepEqual([vis.visibleOnly, vis.runIds, vis.unitIds], [true, ["r1"], ["u1"]]);
  assert.equal("runIds" in buildExportBody(base), false);
  assert.equal(buildExportBody({ ...base, includeValue: true }).includeValue, true);
});

test("pemasangan: tombol Export Excel di header Rencana Produksi memakai id kartu terlihat + API server; ExcelJS dimuat dinamis; tanpa CSV; tanpa baca DOM", () => {
  const ws = read("pages", "bengkel", "ProductionRencanaWorkspace.jsx");
  assert.match(ws, /<RencanaExportButton date=\{date\}[^>]*visibleRunIds=\{exportVisibleRunIds\} visibleUnitIds=\{exportVisibleUnitIds\}/);
  const btn = read("features", "production", "RencanaExportButton.jsx");
  for (const id of ["export-excel-open", "export-scope-board", "export-scope-range", "export-meja-all", "export-meja-some", "export-visible-only", "export-include-value", "export-submit"]) assert.ok(btn.includes(`data-testid="${id}"`) || btn.includes("data-testid={`" + id.replace(/TABLE_\d/, "")), id);
  assert.match(btn, /api\.exportRencanaProduksi\(body\)/); assert.match(btn, /await import\("@\/utils\/exportRencanaProduksi\.js"\)/);
  assert.match(btn, /adminOwner && \(/, "opsi nilai order hanya ADMIN/OWNER"); assert.match(btn, /includeValue: adminOwner && includeValue/);
  const all = btn + read("utils", "exportRencanaProduksi.js");
  assert.doesNotMatch(all, /\.csv|text\/csv|document\.querySelector|innerText|textContent|getElementsBy/, "tidak ada CSV / pembacaan DOM");
  assert.match(read("api.js"), /exportRencanaProduksi: \(body\) => request\("\/production-v2\/rencana\/export", \{ method: "POST"/);
  // utilitas bersama dengan Export Order Sales (bukan implementasi paralel)
  assert.match(read("utils", "exportOrdersStyled.js"), /from "\.\/excelCommon\.js"/); assert.match(read("utils", "exportRencanaProduksi.js"), /from "\.\/excelCommon\.js"/);
  assert.doesNotMatch(read("utils", "exportOrdersStyled.js"), /^function keTanggal|^function aturCetak/m);
});
