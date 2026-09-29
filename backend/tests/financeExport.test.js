// EXPORT EXCEL FINANCE (B3.9) — tes unit pembuat berkas & tata-kelola registri (tanpa database).
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ExcelJS from "exceljs";
import { buatXlsx, netralkanRumus, namaBerkas, labelPeriode, susunLabelFilter, ExportError, MAKS_BARIS } from "../src/services/finance/export/excel.js";
import { MODUL_EXPORT } from "../src/services/finance/export/registry.js";
import { PERMISSIONS as P } from "../src/middleware/authorize.js";

const FOLDER = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../src/services/finance/export");
const BAWAAN = new Set(["excel.js", "registry.js", "label.js"]);

async function baca(buf) {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(buf);
  return wb;
}

const data = (extra = {}) => ({
  nama: "Uji", periodeLabel: "1 Sep 2026 – 30 Sep 2026", filterLabel: "Status: Aktif",
  sheets: [{
    nama: "Uji", judul: "Uji Export",
    kolom: [
      { key: "nomor", header: "Nomor", tipe: "teks" }, { key: "tgl", header: "Tanggal", tipe: "tanggal" }, { key: "waktu", header: "Dicatat", tipe: "waktu" },
      { key: "nominal", header: "Nominal (Rp)", tipe: "uang" }, { key: "rahasia", header: "Catatan Internal", tipe: "teks", sensitif: true },
    ],
    baris: [
      { nomor: "=HYPERLINK(\"http://x\")", tgl: "2026-09-30", waktu: "2026-09-30T17:30:00.000Z", nominal: "1500000.50", rahasia: "+cmd|' /C calc'!A0" },
      { nomor: "@SUM(A1)", tgl: new Date("2026-09-01T00:00:00.000Z"), waktu: "2026-09-01T00:00:00.000Z", nominal: 250000, rahasia: "-1+1" },
      { nomor: "biasa", tgl: null, waktu: null, nominal: 0, rahasia: "" },
    ],
    total: { label: "TOTAL", nilai: { nominal: 1750000.5 } },
    catatan: ["=catatan berbahaya"],
  }],
  ...extra,
});

test("nominal = angka Excel (bukan teks) dengan format ribuan; tanggal = tanggal Excel; waktu instant dikonversi ke WIB", async () => {
  const wb = await baca(await buatXlsx(data(), { pengekspor: "Gilang", bolehSensitif: true }));
  const ws = wb.getWorksheet("Uji");
  const r1 = ws.getRow(7);
  assert.equal(typeof r1.getCell(4).value, "number");
  assert.equal(r1.getCell(4).value, 1500000.5);
  assert.match(r1.getCell(4).numFmt, /#,##0/);
  assert.ok(r1.getCell(2).value instanceof Date, "tanggal tersimpan sebagai tanggal Excel");
  assert.equal(r1.getCell(2).value.toISOString().slice(0, 10), "2026-09-30");
  // 30 Sep 17:30 UTC = 1 Okt 00:30 WIB → sel harus menampilkan 1 Okt 2026 00:30 (bukan 30 Sep)
  assert.equal(r1.getCell(3).value.toISOString().slice(0, 16), "2026-10-01T00:30");
  assert.equal(ws.getRow(9).getCell(4).value, 0, "nol tetap angka nol");
});

test("header Indonesia + kepala berkas (judul, periode, filter, waktu WIB, pengekspor) + baris total", async () => {
  const wb = await baca(await buatXlsx(data(), { pengekspor: "Gilang", bolehSensitif: true }));
  const ws = wb.getWorksheet("Uji");
  assert.match(ws.getCell("A1").value, /Klinik Matras — Uji Export/);
  assert.match(ws.getCell("A2").value, /Periode: 1 Sep 2026 – 30 Sep 2026/);
  assert.match(ws.getCell("A3").value, /Filter: Status: Aktif/);
  assert.match(ws.getCell("A4").value, /Diekspor: \d{4}-\d{2}-\d{2} \d{2}:\d{2} WIB oleh Gilang/);
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => ws.getRow(6).getCell(i).value), ["Nomor", "Tanggal", "Dicatat", "Nominal (Rp)", "Catatan Internal"]);
  const total = ws.getRow(10);
  assert.equal(total.getCell(1).value, "TOTAL");
  assert.equal(total.getCell(4).value, 1750000.5);
});

test("formula injection dicegah: teks yang diawali = + - @ diberi apostrof (kolom, kepala, catatan)", async () => {
  assert.equal(netralkanRumus("=1+1"), "'=1+1");
  assert.equal(netralkanRumus("+62812"), "'+62812");
  assert.equal(netralkanRumus("-5"), "'-5");
  assert.equal(netralkanRumus("@a"), "'@a");
  assert.equal(netralkanRumus("\t=x"), "'\t=x");
  assert.equal(netralkanRumus("aman = ok"), "aman = ok");
  assert.equal(netralkanRumus(42), 42, "non-teks tidak disentuh");
  const wb = await baca(await buatXlsx(data(), { pengekspor: "=cmd", bolehSensitif: true }));
  const ws = wb.getWorksheet("Uji");
  assert.equal(ws.getRow(7).getCell(1).value, "'=HYPERLINK(\"http://x\")");
  assert.equal(ws.getRow(8).getCell(1).value, "'@SUM(A1)");
  assert.equal(ws.getRow(7).getCell(5).value, "'+cmd|' /C calc'!A0");
  assert.match(ws.getCell("A4").value, /oleh '=cmd/);
  assert.equal(ws.getRow(12).getCell(1).value, "'=catatan berbahaya");
  // tidak ada sel berformula sama sekali
  ws.eachRow((row) => row.eachCell((c) => assert.notEqual(typeof c.value === "object" && c.value && "formula" in c.value, true)));
});

test("kolom sensitif DIBUANG total kecuali pengekspor berhak — isinya tidak ikut satu sel pun", async () => {
  const tanpa = await buatXlsx(data(), { bolehSensitif: false });
  const ws = (await baca(tanpa)).getWorksheet("Uji");
  assert.deepEqual([1, 2, 3, 4, 5].map((i) => ws.getRow(6).getCell(i).value), ["Nomor", "Tanggal", "Dicatat", "Nominal (Rp)", null]);
  const semuaTeks = [];
  ws.eachRow((row) => row.eachCell((c) => semuaTeks.push(String(c.value))));
  assert.ok(!semuaTeks.some((t) => t.includes("calc") || t.includes("Catatan Internal")), "isi & header kolom sensitif tidak bocor");
  const dengan = (await baca(await buatXlsx(data(), { bolehSensitif: true }))).getWorksheet("Uji");
  assert.equal(dengan.getRow(6).getCell(5).value, "Catatan Internal");
});

test("terlalu banyak baris ditolak dengan pesan jelas (413), tidak dipotong diam-diam; tanpa sheet → 404", async () => {
  const banyak = { sheets: [{ nama: "X", judul: "X", kolom: [{ key: "a", header: "A", tipe: "angka" }], baris: Array.from({ length: MAKS_BARIS + 1 }, (_, i) => ({ a: i })) }] };
  await assert.rejects(() => buatXlsx(banyak), (e) => e instanceof ExportError && e.statusCode === 413 && /Persempit periode atau filter/.test(e.message));
  await assert.rejects(() => buatXlsx({ sheets: [] }), (e) => e instanceof ExportError && e.statusCode === 404);
});

test("nama sheet aman (31 karakter, tanpa karakter terlarang, unik) dan nama berkas memuat modul + periode", async () => {
  const wb = await baca(await buatXlsx({ sheets: [
    { nama: "Piutang/Refund: sangat panjang sekali namanya lebih dari tiga puluh satu", judul: "A", kolom: [], baris: [] },
    { nama: "Piutang/Refund: sangat panjang sekali namanya lebih dari tiga puluh satu", judul: "B", kolom: [], baris: [] },
  ] }));
  const nama = wb.worksheets.map((w) => w.name);
  assert.ok(nama.every((n) => n.length <= 31 && !/[\\/?*[\]:]/.test(n)));
  assert.equal(new Set(nama.map((n) => n.toLowerCase())).size, 2);
  assert.equal(namaBerkas("Pembayaran & Verifikasi", { from: "2026-09-01", to: "2026-09-30" }), "Finance_Pembayaran_Verifikasi_2026-09-01_sd_2026-09-30.xlsx");
  assert.match(namaBerkas("Kasbon", {}, new Date("2026-09-30T20:00:00Z")), /^Finance_Kasbon_per_2026-10-01\.xlsx$/, "tanpa periode: tanggal WIB hari ekspor");
  assert.equal(labelPeriode({ from: "2026-09-01", to: "2026-09-30" }), "1 Sep 2026 – 30 Sep 2026");
  assert.equal(labelPeriode({}), "Semua periode");
  assert.equal(susunLabelFilter([["Status", "Aktif"], ["Cari", ""], ["Karyawan", "Imam"]]), "Status: Aktif; Karyawan: Imam");
  assert.equal(susunLabelFilter([]), "Tanpa filter (semua data)");
});

test("TATA-KELOLA registri: setiap berkas modul terdaftar; tiap modul punya kunci, nama, izin FINANCE, dan fungsi ambil", () => {
  const berkas = fs.readdirSync(FOLDER).filter((f) => f.endsWith(".js") && !BAWAAN.has(f)).map((f) => f.replace(/\.js$/, ""));
  for (const b of berkas) assert.ok(Object.hasOwn(MODUL_EXPORT, b), `berkas modul export "${b}.js" belum didaftarkan di registry.js`);
  const izinFinance = new Set([P.FINANCE_READ, P.FINANCE_POST, P.FINANCE_APPROVE, P.FINANCE_ADMIN, P.INVENTORY_READ]);
  for (const [kunci, m] of Object.entries(MODUL_EXPORT)) {
    assert.equal(m.kunci, kunci);
    assert.ok(m.nama && typeof m.ambil === "function", `${kunci}: nama & ambil wajib`);
    assert.ok(Array.isArray(m.izin) && m.izin.length > 0 && m.izin.every((i) => izinFinance.has(i)), `${kunci}: izin wajib (minimal sama dengan layar)`);
  }
});

test("11 modul yang diminta semuanya tersedia", () => {
  const wajib = ["pemasukan", "pembayaran", "pengeluaran", "pembelian", "kasbon", "uang-muka", "piutang-refund", "supplier-utang", "rekonsiliasi", "jurnal-umum", "buku-besar"];
  for (const k of wajib) assert.ok(Object.hasOwn(MODUL_EXPORT, k), `modul export "${k}" belum ada`);
});

test("batas SEL (baris × kolom) menolak 413 sebelum membangun berkas; teks >32.000 karakter dipotong; alasan pembalikan disembunyikan untuk non-admin", async () => {
  const { MAKS_SEL } = await import("../src/services/finance/export/excel.js");
  const { keteranganTanpaAlasan } = await import("../src/services/finance/export/label.js");
  const kolom = Array.from({ length: 30 }, (_, i) => ({ key: `k${i}`, header: `K${i}`, tipe: "angka" }));
  const baris = Array.from({ length: Math.ceil(MAKS_SEL / 30) + 1 }, () => ({}));
  await assert.rejects(() => buatXlsx({ sheets: [{ nama: "X", judul: "X", kolom, baris }] }), (e) => e instanceof ExportError && e.statusCode === 413 && /sel/.test(e.message));
  const wb = await baca(await buatXlsx({ sheets: [{ nama: "X", judul: "X", kolom: [{ key: "a", header: "A", tipe: "teks" }], baris: [{ a: "x".repeat(40_000) }] }] }));
  assert.equal(wb.getWorksheet("X").getRow(7).getCell(1).value.length, 32_000);
  assert.equal(keteranganTanpaAlasan("Pembatalan JV-01102026-001 — Pengeluaran EXP-1 dibatalkan — salah nominal", false), "Pembatalan JV-01102026-001");
  assert.equal(keteranganTanpaAlasan("Pembatalan JV-01102026-001 — alasan", true), "Pembatalan JV-01102026-001 — alasan");
  assert.equal(keteranganTanpaAlasan("Beli kain — putih", false), "Beli kain — putih", "keterangan biasa tidak diubah");
});
