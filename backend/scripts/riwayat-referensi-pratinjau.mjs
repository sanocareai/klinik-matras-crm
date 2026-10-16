// PRATINJAU CATATAN REFERENSI HISTORIS (BACA-SAJA, tidak menyimpan). Untuk menyimpan, pakai UI/API POST /api/inventory/riwayat-referensi/impor (wajib hash pratinjau).
//   node scripts/riwayat-referensi-pratinjau.mjs --pemakaian <csv> [--pembelian <csv>] (--dump <folder out_*.csv> | --db) [--mulai "YYYY-MM-DD HH:mm"] [--alias alias.json] [--out dir]
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { parseCsvText } from "../src/services/stokFileImport.js";
import { susunReferensi, pratinjauReferensi, LABEL_REFERENSI } from "../src/services/stokRiwayatReferensi.js";
import { dariDump } from "./lib/muatDataStok.mjs";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
if (["--apply", "--post", "--simpan", "--impor"].some((f) => process.argv.includes(f))) { console.error("STOP: skrip ini hanya pratinjau. Simpan lewat UI/API (konfirmasi hash)."); process.exit(2); }
const OUT = arg("--out", "./referensi-pratinjau");
const wib = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if (!m) throw new Error(`Format waktu "${s}" harus YYYY-MM-DD HH:mm (WIB)`); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5])); };
const baca = (n) => (arg(n) ? fs.readFileSync(arg(n), "utf8") : "");
const input = { pakaiCsv: baca("--pemakaian"), beliCsv: baca("--pembelian"), alias: arg("--alias") ? JSON.parse(fs.readFileSync(arg("--alias"), "utf8")) : {}, mulai: arg("--mulai") ? wib(arg("--mulai")) : null, namaBerkasPakai: arg("--pemakaian") ? path.basename(arg("--pemakaian")) : undefined, namaBerkasBeli: arg("--pembelian") ? path.basename(arg("--pembelian")) : undefined };
if (!input.pakaiCsv && !input.beliCsv) { console.error("Wajib --pemakaian dan/atau --pembelian"); process.exit(1); }

let hasil;
if (arg("--dump")) {
  const dir = arg("--dump"); const d = dariDump(dir);
  const tabel = (n) => { const r = parseCsvText(fs.readFileSync(path.join(dir, `out_${n}.csv`), "utf8")); const h = r[0]; return r.slice(1).filter((x) => x.length > 1).map((x) => Object.fromEntries(h.map((k, i) => [k, x[i]]))); };
  const idPer = new Map(d.materials.map((m) => [m.code, m.id]));
  const pembanding = {
    issues: tabel("ref_issue_order").map((x) => ({ orderNumber: x.order_number, materialId: idPer.get(x.material_code), qty: Number(x.qty), movementId: x.movement_id, dokumen: x.dokumen || null, at: x.created_at ? new Date(x.created_at) : null })).filter((x) => x.materialId),
    issuePending: tabel("ref_mi_pending").map((x) => ({ orderNumber: x.order_number, sourceReference: x.source_reference, materialId: idPer.get(x.material_code), qty: Number(x.qty), dokumen: x.dokumen, status: x.status })).filter((x) => x.materialId),
    ordersKnown: new Set(tabel("ref_orders").map((x) => String(x.order_number).toUpperCase())), grLines: d.grLines.map((g) => ({ ...g, qty: g.acceptedQty ?? g.receivedQty ?? g.orderedQty })),
  };
  hasil = { materials: d.materials, ...susunReferensi({ ...input, materials: d.materials, pembanding }) };
} else if (process.argv.includes("--db")) {
  const { prisma } = await import("../src/db.js");
  hasil = await prisma.$transaction(async (tx) => { await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY"); return pratinjauReferensi(tx, input); }, { timeout: 120_000 });
  await prisma.$disconnect();
} else { console.error("Pilih --dump <folder> atau --db"); process.exit(1); }

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "referensi-pratinjau.json"), JSON.stringify({ label: LABEL_REFERENSI, hashKonten: hasil.hashKonten, ringkasan: hasil.ringkasan, dikecualikan: hasil.dikecualikan, rows: hasil.rows }, null, 1));
const wb = new ExcelJS.Workbook(); wb.creator = "SANSS Gudang — pratinjau referensi historis";
const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }, alignment: { wrapText: true, vertical: "middle" } };
const sheet = (nama, kol, rows, w = []) => { const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 1 }] }); ws.addRow(kol); ws.getRow(1).eachCell((c) => Object.assign(c, HEAD)); for (const r of rows) ws.addRow(r).alignment = { vertical: "top", wrapText: true }; kol.forEach((_, i) => { ws.getColumn(i + 1).width = w[i] || 14; }); ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kol.length } }; };
const rs = wb.addWorksheet("Ringkasan"); rs.columns = [{ width: 40 }, { width: 110 }]; rs.addRow([LABEL_REFERENSI]).font = { bold: true }; rs.addRow(["Hash konten (untuk konfirmasi impor)", hasil.hashKonten]);
for (const [k, v] of Object.entries(hasil.ringkasan)) rs.addRow([k, typeof v === "object" ? JSON.stringify(v) : v]); rs.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; });
const kol = ["Jenis", "Order / surat jalan", "Kode master", "Nama di file", "Jumlah", "Satuan file", "Satuan master", "Tanggal order / kirim", "Tanggal pemakaian", "Label bulan file (BUKAN bukti)", "Status", "Antrean", "Alasan blocker", "Peringatan", "Dokumen resmi", "Sumber"];
const baris = (r) => [r.jenis, r.nomorOrder || r.suratJalan || "", r.materialKode || "", r.namaDiFile, r.jumlah ?? "(tidak terbaca)", r.satuanFile, r.satuanMaster || "", r.tanggalOrder || r.tanggalKirim || "", "(tidak ada bukti)", r.labelBulanFile || "", r.statusVerifikasi, r.antrean || "", r.alasanBlocker.join("\n"), r.peringatan.join("\n"), r.dokumenResmi ? JSON.stringify(r.dokumenResmi) : "", `${r.sumberFile} baris ${r.sumberBaris.join(",")}`];
const W = [26, 22, 34, 38, 9, 9, 9, 14, 12, 12, 28, 22, 60, 60, 40, 34];
sheet("Antrean penyelesaian", kol, hasil.rows.filter((r) => r.antrean).map(baris), W);
sheet("Penerimaan perlu pemeriksaan", kol, hasil.rows.filter((r) => r.statusVerifikasi === "PERLU_PEMERIKSAAN").map(baris), W);
sheet("Sudah ada di resmi", kol, hasil.rows.filter((r) => r.statusVerifikasi === "SUDAH_ADA_DI_RESMI" || r.statusVerifikasi === "ADA_DOKUMEN_RESMI_BELUM_DIPOSTING").map(baris), W);
sheet("Belum diverifikasi", kol, hasil.rows.filter((r) => r.statusVerifikasi === "BELUM_DIVERIFIKASI").map(baris), W);
sheet("Dikecualikan (T0)", ["Order/nama", "Alasan"], hasil.dikecualikan.map((x) => [x.resi || x.nama, x.alasan]), [40, 90]);
await wb.xlsx.writeFile(path.join(OUT, "referensi-pratinjau.xlsx"));
console.log(JSON.stringify({ keluaran: OUT, hashKonten: hasil.hashKonten, ringkasan: { ...hasil.ringkasan, label: undefined } }, null, 1));
