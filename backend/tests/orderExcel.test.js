// Excel Order berwarna: berkas dibuat SUNGGUHAN lalu dibaca kembali dengan exceljs (bukan memeriksa pola kode).
import test from "node:test";
import assert from "node:assert/strict";
import ExcelJS from "exceljs";
import { buatBukuOrder, argb, OrderExcelError, MAKS_BARIS } from "../src/services/orderExcel.js";

const PAL_KATEGORI = { Layanan: { bg: "#ede9fe", color: "#5b21b6" }, Baru: { bg: "#dcfce7", color: "#166534" } };
const kolom = [
  { key: "ID Order", header: "ID Order", lebar: 20 },
  { key: "Pelanggan", header: "Pelanggan" },
  { key: "Kategori", header: "Kategori", palette: PAL_KATEGORI },
  { key: "Jenis Pekerjaan", header: "Jenis Pekerjaan", tandaKomplain: true },
  { key: "Hari", header: "Hari di Status", tipe: "angka", tandaMandek: true },
  { key: "Nilai", header: "Nilai", tipe: "uang", total: true },
  { key: "Dibuat", header: "Dibuat", tipe: "tanggal" },
  { key: "Link", header: "Link Lokasi", tipe: "link" },
];
const baris = [
  ["RES-1", "Ibu A", "Layanan", "Order Baru", 2, 1000000, "2026-10-02", "https://maps.google.com/?q=1,2"],
  ["NEW-2", "Pak B", "Baru", "KOMPLAIN / REVISI", 9, 2500000, "2026-10-03", "javascript:alert(1)"],
  ["RES-3", "=HYPERLINK(\"x\")", "Layanan", "Order Baru", 8, 500000, "", ""],
];
const bendera = [[], ["komplain"], ["mandek"]];
const spec = (o = {}) => ({
  judul: "Laporan Order", filterLabel: "Status Diproses",
  sheets: [{ nama: "Order", kolom, baris, bendera }],
  ringkasan: { kunciNilai: "Nilai", kelompok: [{ judul: "Kategori", kunci: "Kategori" }], kunciLunas: "Pelanggan", nilaiLunas: "Ibu A" },
  ...o,
});
async function baca(s = spec()) {
  const buf = await buatBukuOrder(s, { sekarang: new Date("2026-10-07T11:30:00Z") });
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}
const fill = (c) => c.fill?.fgColor?.argb;

test("tab: Ringkasan pertama, Order kedua dan menjadi tab aktif", async () => {
  const wb = await baca();
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Ringkasan", "Order"]);
  assert.equal(wb.views[0].activeTab, 1);
});

test("filter di header, beku header + 2 kolom pertama, tanpa garis kisi", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(ws.autoFilter, "A3:H6");
  assert.equal(ws.views[0].state, "frozen");
  assert.equal(ws.views[0].xSplit, 2);
  assert.equal(ws.views[0].ySplit, 3);
});

test("header bergaya & warna sel mengikuti isi (palette)", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(fill(ws.getCell("A3")), "FF1E2139");
  assert.equal(ws.getCell("A3").font.bold, true);
  assert.equal(fill(ws.getCell("C4")), "FFEDE9FE"); // Layanan
  assert.equal(fill(ws.getCell("C5")), "FFDCFCE7"); // Baru
  assert.equal(ws.getCell("C4").font.color.argb, "FF5B21B6");
});

test("KOMPLAIN: seluruh baris merah muda, ID tebal merah tua, sel penanda merah pekat putih; baris lain tidak", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(fill(ws.getCell("A5")), "FFFEE2E2");
  assert.equal(fill(ws.getCell("B5")), "FFFEE2E2");
  assert.equal(ws.getCell("A5").font.color.argb, "FF7F1D1D");
  assert.equal(ws.getCell("A5").border.left.style, "thick");
  assert.equal(fill(ws.getCell("D5")), "FFDC2626");
  assert.equal(ws.getCell("D5").font.color.argb, "FFFFFFFF");
  assert.notEqual(fill(ws.getCell("A4")), "FFFEE2E2");
  assert.notEqual(fill(ws.getCell("D4")), "FFDC2626");
});

test("kategori tetap berwarna di baris komplain (warna isi menang atas merah muda)", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(fill(ws.getCell("C5")), "FFDCFCE7");
});

test("MANDEK: hanya sel penanda yang kuning, baris tidak merah", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(fill(ws.getCell("E6")), "FFFEF3C7");
  assert.equal(ws.getCell("E6").font.color.argb, "FF92400E");
  assert.notEqual(fill(ws.getCell("A6")), "FFFEE2E2");
});

test("tipe data: uang = ANGKA berformat Rp, tanggal = tanggal Excel, link hanya http(s)", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(ws.getCell("F4").value, 1000000);
  assert.match(ws.getCell("F4").numFmt, /Rp/);
  assert.ok(ws.getCell("G4").value instanceof Date);
  assert.equal(ws.getCell("G4").value.toISOString().slice(0, 10), "2026-10-02");
  assert.equal(ws.getCell("G4").numFmt, "dd/mm/yyyy");
  assert.equal(ws.getCell("H4").value.hyperlink, "https://maps.google.com/?q=1,2");
  assert.equal(typeof ws.getCell("H5").value, "string", "javascript: tidak boleh jadi hyperlink");
});

test("formula injection: teks diawali = dinetralkan", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(ws.getCell("B6").value, "'=HYPERLINK(\"x\")");
});

test("baris TOTAL memakai SUBTOTAL (ikut filter) dengan hasil tersimpan", async () => {
  const ws = (await baca()).getWorksheet("Order");
  assert.equal(ws.getCell("F7").value.formula, "SUBTOTAL(109,F4:F6)");
  assert.equal(ws.getCell("F7").value.result, 4000000);
  assert.match(ws.getCell("A7").value.formula, /SUBTOTAL\(103,A4:A6\)/);
});

test("Ringkasan: angka kunci benar & rincian per kelompok memakai rumus yang mengacu ke tab Order", async () => {
  const rs = (await baca()).getWorksheet("Ringkasan");
  const nilai = {};
  rs.eachRow((r) => { const k = r.getCell(1).value; if (typeof k === "string") nilai[k] = r.getCell(2).value; });
  assert.equal(nilai["Jumlah order"], 3);
  assert.equal(nilai["Total nilai order"], 4000000);
  assert.equal(nilai["Order komplain / revisi"], 1);
  assert.equal(nilai["Order mandek"], 1);
  assert.equal(nilai["Order lunas"], 1);
  let ditemukan = 0;
  rs.eachRow((r) => {
    const v = r.getCell(2).value;
    if (v && v.formula && r.getCell(1).value === "Layanan") { ditemukan++; assert.equal(v.formula, "SUMPRODUCT(--('Order'!$C$4:$C$6=$A" + r.number + "))"); assert.equal(v.result, 2); assert.equal(r.getCell(3).value.result, 1500000); }
  });
  assert.equal(ditemukan, 1);
});

test("keterangan warna hanya memuat warna yang benar-benar dipakai di data", async () => {
  const rs = (await baca()).getWorksheet("Ringkasan");
  const isi = [];
  rs.eachRow((r) => { const v = r.getCell(5).value; if (typeof v === "string") isi.push(v); });
  assert.ok(isi.some((t) => t.includes("Kategori: Layanan")));
  assert.ok(isi.some((t) => t.includes("Kategori: Baru")));
});

test("tanpa ringkasan: hanya sheet data, tab aktif pertama", async () => {
  const wb = await baca(spec({ ringkasan: undefined }));
  assert.deepEqual(wb.worksheets.map((w) => w.name), ["Order"]);
  assert.equal(wb.views[0].activeTab, 0);
});

test("warna tidak valid diabaikan (tanpa galat); isi tanpa palette dibiarkan", async () => {
  const k = kolom.map((x) => (x.key === "Kategori" ? { ...x, palette: { Layanan: { bg: "merah", color: "??" } } } : x));
  const ws = (await baca(spec({ sheets: [{ nama: "Order", kolom: k, baris, bendera }] }))).getWorksheet("Order");
  assert.notEqual(fill(ws.getCell("C4")), "FFFF0000");
  assert.equal(argb("#ABCDEF"), "FFABCDEF");
  assert.equal(argb("xyz"), null);
});

test("beberapa sheet; nama sheet dibersihkan & unik", async () => {
  const s = spec({ sheets: [{ nama: "Order/1?", kolom, baris, bendera }, { nama: "Order/1?", kolom, baris, bendera }] });
  const wb = await baca(s);
  const nama = wb.worksheets.map((w) => w.name);
  assert.equal(new Set(nama.map((n) => n.toLowerCase())).size, nama.length);
  assert.ok(nama.every((n) => !/[\\/?*[\]:]/.test(n)));
});

test("VALIDASI: kosong, bentuk salah, terlalu banyak baris/sel → OrderExcelError dengan kode HTTP yang tepat", async () => {
  await assert.rejects(buatBukuOrder(null), OrderExcelError);
  await assert.rejects(buatBukuOrder({ sheets: [] }), OrderExcelError);
  await assert.rejects(buatBukuOrder({ sheets: [{ kolom: [], baris: [] }] }), OrderExcelError);
  await assert.rejects(buatBukuOrder({ sheets: [{ kolom, baris: [["a", "b", "c", "d", "e", "f", "g", "h", "i-kelebihan"]] }] }), OrderExcelError);
  const banyak = Array.from({ length: MAKS_BARIS + 1 }, () => ["x"]);
  await assert.rejects(buatBukuOrder({ sheets: [{ kolom: [{ key: "a", header: "a" }], baris: banyak }] }), (e) => e instanceof OrderExcelError && e.statusCode === 413);
  const lebar = Array.from({ length: 3000 }, () => Array(60).fill("x"));
  await assert.rejects(buatBukuOrder({ sheets: [{ kolom: Array.from({ length: 60 }, (_, i) => ({ key: "k" + i, header: "k" + i })), baris: lebar }] }), (e) => e instanceof OrderExcelError && e.statusCode === 413);
});

test("data kosong pada sheet: berkas tetap valid (tanpa filter/total yang rusak)", async () => {
  const ws = (await baca(spec({ sheets: [{ nama: "Order", kolom, baris: [], bendera: [] }] }))).getWorksheet("Order");
  assert.equal(ws.autoFilter, undefined);
  assert.equal(ws.getCell("A3").value, "ID Order");
});

test("teks sangat panjang dipotong di batas sel Excel", async () => {
  const panjang = "x".repeat(40_000);
  const ws = (await baca(spec({ sheets: [{ nama: "Order", kolom, baris: [["RES-9", panjang, "Layanan", "Order Baru", 1, 1, "", ""]], bendera: [[]] }] }))).getWorksheet("Order");
  assert.ok(String(ws.getCell("B4").value).length <= 32_000);
});
