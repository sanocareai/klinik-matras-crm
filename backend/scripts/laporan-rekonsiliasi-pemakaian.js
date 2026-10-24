// Laporan rekonsiliasi pemakaian (BACA-SAJA): kejanggalan per bahan & order, yang tampil segera vs menunggu koreksi, dampak stok & HPP.
//   node scripts/laporan-rekonsiliasi-pemakaian.js [--keluar=/tmp/laporan.xlsx] [--json=/tmp/laporan.json]
import fs from "fs";
import ExcelJS from "exceljs";
import { prisma } from "../src/db.js";
import { susunLaporan } from "../src/services/laporanRekonsiliasiPemakaian.js";

const arg = (k) => (process.argv.find((a) => a.startsWith(`--${k}=`)) ?? "").split("=").slice(1).join("=");
const rp = (v) => (v == null ? "—" : "Rp" + Math.round(v).toLocaleString("id-ID"));
async function main() {
  const L = await susunLaporan(prisma);
  if (arg("json")) fs.writeFileSync(arg("json"), JSON.stringify(L, null, 1));
  const wb = new ExcelJS.Workbook(); wb.creator = "Rekonsiliasi pemakaian (baca-saja)";
  const sh = (nama, kolom, baris) => { const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 1 }] }); ws.columns = kolom.map(([h, w]) => ({ header: h, width: w })); ws.getRow(1).font = { bold: true }; baris.forEach((b) => ws.addRow(b)); return ws; };
  const R = L.ringkas;
  const ring = [
    ["Catatan Excel", R.catatanExcel], ["Catatan pengeluaran stok lama tanpa pasangan (LEDGER)", R.catatanLedger], ["Order unik", R.orderUnik],
    ["Bisa tampil segera di Produksi (catatan / order)", `${R.bisaTampilSegera.catatan} / ${R.bisaTampilSegera.order}`],
    ["Sudah tercatat di stok (tidak digandakan)", R.sudahDiStok.catatan], ["Siap jadi pengeluaran stok", R.siapPosting.catatan],
    ["Menunggu koreksi/keputusan (Perlu dicek) (catatan / order)", `${R.menungguKoreksi.catatan} / ${R.menungguKoreksi.order}`],
    ...Object.entries(R.perState).map(([k, v]) => [`Keadaan ${k}`, v]),
    ...Object.entries(R.perBulan).map(([k, v]) => [`Bulan ${k}: catatan / order`, `${v.total} / ${v.order}`]),
    ["Rencana posting: transaksi / order", `${L.siapPosting.transaksi} / ${L.siapPosting.orderUnik}`], ["Rencana posting: hash (untuk persetujuan)", L.siapPosting.hash],
    ["HPP estimasi bila rencana siap-posting dijalankan", rp(L.dampakHPP.siapPostingEstimasi)], ["...transaksi tanpa harga perolehan (tidak dihitung)", L.dampakHPP.siapPostingTanpaHarga],
    ["Dampak HPP koreksi ISSUE lama (estimasi, bertanda)", rp(L.dampakHPP.koreksiIssueLamaEstimasi)], ["Nilai tertahan menurut Excel", rp(L.dampakHPP.tertahanNilaiMenurutExcel)], ["Catatan HPP", L.dampakHPP.catatan],
  ];
  sh("Ringkasan", [["Hal", 60], ["Nilai", 70]], ring);
  sh("Penanda Perlu dicek", [["Kode penanda", 34], ["Jumlah catatan", 14]], Object.entries(L.flagTotal).sort((a, b) => b[1] - a[1]));
  sh("Kejanggalan per bahan", [["Bahan", 38], ["Nama", 40], ["Satuan", 9], ["Catatan", 9], ["Order", 8], ["Penanda", 60], ["Contoh tindakan", 90]], L.kejanggalanPerBahan.map((b) => [b.bahan, b.nama, b.satuan, b.catatan, b.order, JSON.stringify(b.penanda), b.contoh]));
  sh("Kejanggalan per order", [["Order", 20], ["Unit", 22], ["Status unit", 16], ["Bulan", 7], ["Catatan Perlu dicek", 10], ["Penanda", 60], ["Tindakan singkat", 110]], L.kejanggalanPerOrder.map((o) => [o.order, o.unit, o.statusUnit, o.bulan, o.catatanPerluDicek, JSON.stringify(o.penanda), o.tindakan.join(" | ")]));
  sh("Dampak stok (siap posting)", [["Bahan", 38], ["Satuan", 9], ["Transaksi", 9], ["Jumlah", 10], ["Saldo sekarang", 12], ["Saldo sesudah", 12], ["HPP estimasi", 14], ["Tanpa harga", 9]], L.siapPosting.dampakStok.map((p) => [p.kode, p.satuan, p.transaksi, p.qty, p.saldoSekarang, p.saldoSesudah, Math.round(p.nilaiHPP), p.tanpaHarga]));
  sh("Koreksi ISSUE lama", [["Order", 20], ["Bahan", 36], ["Satuan", 9], ["Stok mencatat", 12], ["Excel", 10], ["Selisih", 10], ["Nilai estimasi", 14]], L.dampakHPP.koreksiIssueLamaDaftar.map((k) => [k.order, k.bahan, k.satuan, k.ledger, k.excel, k.selisih, k.nilai]));
  if (arg("keluar")) { await wb.xlsx.writeFile(arg("keluar")); console.log("Ditulis", arg("keluar")); }
  console.log(JSON.stringify({ ringkas: R, flagTotal: L.flagTotal, siapPosting: { transaksi: L.siapPosting.transaksi, orderUnik: L.siapPosting.orderUnik, hash: L.siapPosting.hash, bahanSaldoNegatif: L.siapPosting.bahanSaldoNegatif.length }, dampakHPP: { ...L.dampakHPP, koreksiIssueLamaDaftar: undefined } }, null, 1));
}
main().catch((e) => { console.error(e); process.exitCode = 1; }).finally(() => prisma.$disconnect());
