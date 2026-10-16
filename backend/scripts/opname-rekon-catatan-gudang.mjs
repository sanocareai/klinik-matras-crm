// REKONSILIASI SALDO SISTEM vs CATATAN OPERASIONAL GUDANG (BACA-SAJA). Tidak menulis ke DB, tidak membuat adjustment/jurnal, tidak membatalkan dokumen.
//
//   node scripts/opname-rekon-catatan-gudang.mjs --csv Sano-Stock.csv --dump <folder out_*.csv dari baca_segar> --out <folder>
//   node scripts/opname-rekon-catatan-gudang.mjs --csv Sano-Stock.csv --db --out <folder>        (transaksi READ ONLY)
//   opsi: --alias alias.csv (baris_file,kode_material = keputusan manusia) · --batas "2026-10-01 00:00" (WIB) · --ukuran-batch 30
// Keluaran: rekon-catatan-gudang.xlsx (+ .json) dan Lembar-Cek-Fisik-<batch>.xlsx (buta: tanpa saldo sistem/file) untuk bahan prioritas.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { bacaStockCsv, petakan, parseCsvText } from "../src/services/stokFileImport.js";
import { rekonsiliasiCatatan, PRIORITAS } from "../src/services/stokRekonCatatan.js";
import { buatLembarHitung } from "../src/services/opnameLembar.js";
import { dariDump, dariDb } from "./lib/muatDataStok.mjs";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
if (["--apply", "--post", "--ajukan"].some((f) => process.argv.includes(f))) { console.error("STOP: skrip ini hanya rekonsiliasi baca-saja."); process.exit(2); }
const CSV = arg("--csv"); const OUT = arg("--out", "./rekon-catatan-gudang");
if (!CSV) { console.error("Pakai: --csv <file> (--dump <folder> | --db) [--out dir]"); process.exit(1); }
const wib = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if (!m) throw new Error(`Format waktu "${s}" harus YYYY-MM-DD HH:mm (WIB)`); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5])); };
const data = arg("--dump") ? dariDump(arg("--dump")) : process.argv.includes("--db") ? await dariDb() : (console.error("Pilih --dump <folder> atau --db"), process.exit(1));
const alias = new Map();
if (arg("--alias")) for (const r of parseCsvText(fs.readFileSync(arg("--alias"), "utf8")).slice(1)) if (r[0] && r[1]) alias.set(Number(r[0]), r[1].trim());
const bacaan = bacaStockCsv(fs.readFileSync(CSV, "utf8"));
const batas = arg("--batas") ? wib(arg("--batas")) : undefined;
const hasil = rekonsiliasiCatatan({ pemetaan: petakan(bacaan, data.materials, alias), materials: data.materials, ledger: data.ledger, pending: data.pending, ...(batas && { batas }) });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "rekon-catatan-gudang.json"), JSON.stringify({ sumberCsv: path.basename(CSV), stempel: data.stempel, ...hasil }, null, 1));

// ---------- workbook ----------
const wb = new ExcelJS.Workbook(); wb.creator = "SANSS Gudang — rekonsiliasi catatan Gudang";
const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }, alignment: { wrapText: true, vertical: "middle" } };
const WARNA = { P1_MENGHAMBAT: "FFF8D7DA", P2_RISIKO: "FFFFE0B2", P3_SELISIH_BESAR: "FFFFF3CD", P4_SELISIH_KECIL: "FFFFFDE7", P5_SESUAI: "FFD4EDDA", P6_TANPA_ANGKA_FILE: "FFEEEEEE" };
const sheet = (nama, kol, rows, w = [], warnaKolom = null) => {
  const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 1, xSplit: 2 }] }); ws.addRow(kol); ws.getRow(1).eachCell((c) => Object.assign(c, HEAD)); ws.getRow(1).height = 44;
  for (const r of rows) { const row = ws.addRow(r.v ?? r); row.alignment = { vertical: "top", wrapText: true }; if (warnaKolom != null && r.p) row.getCell(warnaKolom).fill = { type: "pattern", pattern: "solid", fgColor: { argb: WARNA[r.p] || "FFFFFFFF" } }; }
  kol.forEach((_, i) => { ws.getColumn(i + 1).width = w[i] || 14; }); ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kol.length } }; return ws;
};
const teks = (x) => x.isu.map((i) => `[${i.level === "BLOCKER" ? "B" : "P"}] ${i.kode}`).join("; ");
const n = (v) => (v == null ? "" : v);

const rs = wb.addWorksheet("Ringkasan"); rs.columns = [{ width: 46 }, { width: 100 }];
const baris = [
  ["REKONSILIASI SALDO SISTEM vs CATATAN GUDANG (Sano-Stock) — BACA-SAJA"], ["Sumber stempel", data.stempel || "-"],
  ["Sifat file", "Catatan operasional Gudang: QTY SEP = titik awal, MASUK/KELUAR/SISA Oktober = pencatatan berjalan. BUKAN opname fisik (SO Oktober gagal), BUKAN saldo resmi. Tanggal QTY SEP tidak terbukti."],
  ["Saldo resmi", "Ledger (stock_movements). Tidak ada penggantian saldo, adjustment, atau jurnal dari file ini."], ["Kosong", "Kosong = belum diketahui, bukan nol. Rumus file yang menganggap kosong = 0 TIDAK diikuti."], ["Harga", "Kolom harga file tidak dipakai (bukan nilai persediaan)."],
  ["Pembatas ledger awal/Oktober", (batas || new Date("2026-09-30T17:00:00Z")).toISOString() + " (1 Okt 00:00 WIB). Ledger tidak punya pergerakan 8 Sep–9 Okt 08:04 WIB sehingga hasil sama untuk tanggal manapun di rentang itu."],
  ["Perkiraan tanpa hitung ganda", "= QTY SEP + max(MASUK file, penerimaan ledger) − KELUAR file. INFORMATIF untuk menentukan prioritas cek fisik; bukan saldo."], [],
];
baris.forEach((r) => rs.addRow(r)); rs.getRow(1).font = { bold: true, size: 14 };
for (const [k, v] of Object.entries(hasil.ringkasan)) rs.addRow([k, typeof v === "object" ? JSON.stringify(v) : v]);
rs.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });

const kolom = ["Prioritas", "Kode (Material ID di JSON)", "Nama master", "Satuan master", "Satuan file", "Baris file", "QTY SEP (catatan)", "MASUK Okt (file)", "KELUAR Okt (file)", "SISA Okt (file)", "SISA dihitung ulang (SEP+MASUK−KELUAR)",
  "Ledger awal (≤1 Okt)", "Penerimaan ledger Okt", "Keluar ledger Okt", "Ledger kini", "Selisih awal (SEP − ledger awal)", "Selisih masuk (file − ledger)", "Selisih keluar (file − ledger)", "Selisih total (SISA − ledger kini)", "Perkiraan tanpa hitung ganda (informatif)",
  "GR di kedua sumber", "Pemakaian hanya di file", "Dokumen ledger masuk", "Penanda", "Alasan prioritas", "Sumber angka file", "Sumber angka ledger", "Bukti fisik"];
const rowOf = (x) => ({ p: x.prioritas, v: [x.prioritas, x.kode, x.nama, x.satuanMaster, x.satuanFile, x.barisFile.join(","), x.sepMentah === "" ? "(kosong)" : x.sep, n(x.masukFile) === "" ? x.masukMentah || "" : x.masukFile, n(x.keluarFile) === "" ? x.keluarMentah || "" : x.keluarFile, x.sisaMentah || "", n(x.sisaHitungUlang),
  x.ledgerAwal, x.ledgerMasuk, x.ledgerKeluar, x.ledgerKini, n(x.selisihAwal), n(x.selisihMasuk), n(x.selisihKeluar), n(x.selisihTotal), n(x.perkiraanTanpaDobel), x.flag.grDiKeduaSumber || "", x.flag.pemakaianHanyaDiFile ? "YA" : "", x.dokMasukLedger.join(", "), teks(x), x.alasanPrioritas, x.sumber.sep + " | " + x.sumber.oktober, x.sumber.ledger, x.buktiFisik] });
const W = [18, 36, 38, 9, 9, 9, 10, 10, 10, 10, 12, 10, 10, 10, 10, 11, 11, 11, 11, 13, 14, 10, 22, 50, 50, 50, 50, 30];
sheet("Rekon per bahan", kolom, hasil.bahan.map(rowOf), W, 1);
sheet("Prioritas (menghambat)", kolom, hasil.bahan.filter((x) => [PRIORITAS.P1_MENGHAMBAT, PRIORITAS.P2_RISIKO].includes(x.prioritas) || x.ledgerKini < -1e-6).map(rowOf), W, 1);
sheet("GR di kedua sumber", ["Kode", "Nama", "Satuan master", "MASUK file", "Penerimaan ledger", "Dokumen", "Hubungan", "Aturan"], hasil.bahan.filter((x) => x.flag.grDiKeduaSumber).map((x) => [x.kode, x.nama, x.satuanMaster, x.masukMentah, x.ledgerMasuk, x.dokMasukLedger.join(", "), x.flag.grDiKeduaSumber, "Pakai ledger; jangan jumlahkan MASUK file dan GR."]), [34, 38, 9, 10, 12, 26, 24, 50]);
sheet("Pemakaian hanya di file", ["Kode", "Nama", "Satuan master", "KELUAR file", "Keluar ledger", "Ledger kini", "Catatan"], hasil.bahan.filter((x) => x.flag.pemakaianHanyaDiFile).map((x) => [x.kode, x.nama, x.satuanMaster, x.keluarMentah, x.ledgerKeluar, x.ledgerKini, "Tidak ada Material Issue/transaksi resmi. Jangan direkonstruksi tanpa bukti per transaksi; selesaikan lewat cek fisik."]), [34, 38, 9, 10, 10, 10, 70]);
sheet("Konflik satuan & ambigu", ["Kode", "Nama", "Satuan master", "Satuan file", "Masalah", "Keputusan yang dibutuhkan"], hasil.bahan.filter((x) => x.isu.some((i) => ["SATUAN_BEDA", "SATUAN_TIDAK_TERTULIS", "SATUAN_TIDAK_DIKENAL", "NAMA_GANDA_DI_FILE", "PEMETAAN_TANPA_TANDA_BACA", "SATUAN_BLOK_OKTOBER_BEDA", "FORMAT_ANGKA_AMBIGU"].includes(i.kode))).map((x) => [x.kode, x.nama, x.satuanMaster, x.satuanFile, x.isu.filter((i) => /SATUAN|GANDA|PEMETAAN|FORMAT/.test(i.kode)).map((i) => i.pesan).join("\n"), "Gudang/Tech: tetapkan satuan hitung & faktor (bila ada) atau pilih baris sumber; sistem tidak mengonversi sendiri."]), [34, 38, 9, 9, 80, 60]);
sheet("Tanpa pasangan", ["Baris file", "Nama di file", "QTY SEP", "Kelas", "Kandidat (BUKAN keputusan)"], hasil.tanpaPasangan.map((x) => [x.baris, x.nama, x.sep, x.kelas, x.kandidat.map((k) => `${k.code} (${k.satuan}) skor ${k.skor}`).join("\n")]), [9, 50, 10, 26, 70]);
sheet("Master tanpa baris file", ["Kode", "Nama", "Satuan", "Aktif", "Ledger kini"], hasil.masterTanpaBarisFile.map((x) => [x.kode, x.nama, x.satuan, x.aktif ? "ya" : "tidak", x.ledgerKini]), [34, 50, 9, 8, 12]);
await wb.xlsx.writeFile(path.join(OUT, "rekon-catatan-gudang.xlsx"));

// ---------- lembar cek fisik prioritas (BUTA) ----------
const ukuran = Number(arg("--ukuran-batch", 30));
const prio = hasil.bahan.filter((x) => [PRIORITAS.P1_MENGHAMBAT, PRIORITAS.P2_RISIKO, PRIORITAS.P3_SELISIH_BESAR].includes(x.prioritas) || x.ledgerKini < -1e-6);
const batches = []; for (let i = 0; i < prio.length; i += ukuran) batches.push(prio.slice(i, i + ukuran));
const idx = [];
for (const [i, bs] of batches.entries()) {
  const kodes = new Set(bs.map((x) => x.kode)); const nama = `CF-${String(i + 1).padStart(2, "0")}`;
  const ds = { materials: data.materials.filter((m) => kodes.has(m.code)), locations: data.locations, pending: data.pendingFull, pilotKodes: new Set() };
  const w = buatLembarHitung(ds, { pilotSaja: false, judul: `LEMBAR CEK FISIK PRIORITAS — batch ${nama} (buta: tanpa saldo sistem/catatan)` });
  await w.xlsx.writeFile(path.join(OUT, `Lembar-Cek-Fisik-${nama}.xlsx`));
  idx.push({ batch: nama, bahan: bs.length, prioritas: bs.reduce((o, x) => ((o[x.prioritas] = (o[x.prioritas] || 0) + 1), o), {}) });
}
fs.writeFileSync(path.join(OUT, "batch-cek-fisik.json"), JSON.stringify(idx, null, 1));
console.log(JSON.stringify({ keluaran: OUT, ringkasan: hasil.ringkasan, batchCekFisik: idx }, null, 1));
