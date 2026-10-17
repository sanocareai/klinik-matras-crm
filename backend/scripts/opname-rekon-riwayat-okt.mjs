// PRATINJAU REKONSILIASI RIWAYAT OKTOBER PER MATERIAL ID + KESIAPAN PENCATATAN TRANSAKSI BARU (BACA-SAJA).
// Tidak membuat movement/adjustment/jurnal/dokumen, tidak membatalkan GR, tidak mengubah master.
//
//   node scripts/opname-rekon-riwayat-okt.mjs --stok-okt Sano-Stock.csv --pemakaian "..Pemakaian Bahan.csv" --rekap-order "..Rekapitulasi Order.csv" --pembelian "Data Pembelian Supplier 1-12 Oktober.csv" \
//        (--dump <folder out_*.csv> | --db) [--stok-sep "Stock Sano-Sep.csv"] [--mulai "2026-10-17 00:00"] [--alias alias.csv] [--out dir]
// --mulai = waktu mulai pencatatan transaksi baru (T0, WIB) yang DISEPAKATI; peristiwa pada/setelah T0 tidak diambil dari file.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { bacaStockCsv, petakan, parseCsvText } from "../src/services/stokFileImport.js";
import { rekonsiliasiCatatan, PRIORITAS } from "../src/services/stokRekonCatatan.js";
import { bacaPemakaian, bacaRekapOrder, bacaPembelian, rekonsiliasiRiwayat } from "../src/services/stokRiwayatOktober.js";
import { kesiapanPencatatanBaru } from "../src/services/stokKesiapanCatat.js";
import { dariDump, dariDb } from "./lib/muatDataStok.mjs";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
if (["--apply", "--post", "--ajukan", "--import"].some((f) => process.argv.includes(f))) { console.error("STOP: skrip ini hanya pratinjau baca-saja."); process.exit(2); }
const OUT = arg("--out", "./rekon-riwayat-okt");
const wib = (s) => { const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if (!m) throw new Error(`Format waktu "${s}" harus YYYY-MM-DD HH:mm (WIB)`); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5])); };
const baca = (n) => { const p = arg(n); if (!p) { console.error(`Wajib: ${n} <berkas>`); process.exit(1); } return fs.readFileSync(p, "utf8"); };
const data = arg("--dump") ? dariDump(arg("--dump")) : process.argv.includes("--db") ? await dariDb() : (console.error("Pilih --dump <folder> atau --db"), process.exit(1));
const alias = new Map(); const aliasNama = new Map();
if (arg("--alias")) for (const r of parseCsvText(fs.readFileSync(arg("--alias"), "utf8")).slice(1)) { if (r[0] && r[1]) { if (/^\d+$/.test(r[0])) alias.set(Number(r[0]), r[1].trim()); else aliasNama.set(r[0].trim().toUpperCase().replace(/\s+/g, " "), r[1].trim()); } }
const mulai = arg("--mulai") ? wib(arg("--mulai")) : null;

// ---- stok (hitung parsial)
const stokCsv = baca("--stok-okt"); const bacaan = bacaStockCsv(stokCsv); const pet = petakan(bacaan, data.materials, alias);
const stok = new Map(); const stokGanda = [];
const perMat = new Map(); for (const b of pet) if (b.material) (perMat.get(b.material.id) || perMat.set(b.material.id, []).get(b.material.id)).push(b);
for (const [id, bs] of perMat) {
  const berangka = bs.filter((b) => b.qtySep.status !== "KOSONG" || b.qtyOkt.status !== "KOSONG" || b.masukOkt.nilai || b.keluarOkt.nilai);
  if (bs.filter((b) => b.qtySep.status !== "KOSONG").length > 1) { stokGanda.push({ kode: bs[0].material.code, baris: bs.map((b) => b.baris) }); continue; }
  const b = berangka[0] || bs[0];
  stok.set(id, { sep: b.qtySep.status === "OK" || b.qtySep.status === "RIBUAN_DIASUMSIKAN" ? b.qtySep.nilai : null, sepMentah: b.qtySep.mentah, qtyOkt: b.qtyOkt.status === "OK" ? b.qtyOkt.nilai : null, masukOkt: b.masukOkt.nilai, keluarOkt: b.keluarOkt.nilai, sisaOkt: b.sisaOkt.nilai, satuanSep: b.satuanSepMentah || b.satuanPrimer || "", barisCsv: b.baris });
}
let verifikasiSep = null;
if (arg("--stok-sep")) {
  const R = parseCsvText(fs.readFileSync(arg("--stok-sep"), "utf8")); const sepRows = R.slice(2).filter((r) => (r[0] || "").trim());
  const a = bacaan.baris; let sama = 0; let beda = 0; const idx = {};
  for (const r of sepRows) { const n = r[0].trim().toUpperCase().replace(/\s+/g, " "); idx[n] = (idx[n] || 0) + 1; const x = a.filter((b) => b.nama.toUpperCase().replace(/\s+/g, " ") === n)[idx[n] - 1]; if (!x) { beda++; continue; } (x.qtySep.mentah === (r[1] || "").trim() ? sama++ : beda++); }
  verifikasiSep = { barisFileSep: sepRows.length, sama, beda };
}

// ---- pemetaan nama (usage/pembelian) memakai pemetaan yang sama dengan Stock
const cache = new Map();
const pemetaanNama = (nama) => {
  const k = String(nama).toUpperCase().replace(/\s+/g, " ").trim(); if (cache.has(k)) return cache.get(k);
  const kode = aliasNama.get(k); let r;
  if (kode) { const m = data.materials.find((x) => x.code === kode); r = { material: m || null, kelas: m ? "ALIAS" : "TANPA_PASANGAN" }; }
  else { const p = petakan({ baris: [{ baris: 0, nama }] }, data.materials)[0]; r = { material: p.material, kelas: p.kelasPemetaan, kandidat: p.kandidat }; }
  cache.set(k, r); return r;
};

const pakai = bacaPemakaian(baca("--pemakaian")); const rekap = bacaRekapOrder(baca("--rekap-order")); const beli = bacaPembelian(baca("--pembelian"));
const riwayat = rekonsiliasiRiwayat({ pemetaanNama, materials: data.materials, ledger: data.ledger, issueLedger: data.issueLedger, grLines: data.grLines, poLines: data.poLines, stok, pakai, beli, rekap, mulai, pending: data.pending });
const catatan = rekonsiliasiCatatan({ pemetaan: pet, materials: data.materials, ledger: data.ledger, pending: data.pending });
const kesiapan = kesiapanPencatatanBaru({ catatan, riwayat, materials: data.materials, ledger: data.ledger, pending: data.pending, mulai });
// Daftar cek fisik MENDESAK = bahan P1 (ledger <= 0 padahal catatan Gudang menyatakan ada). Bahan P1 yang juga punya dokumen tertunda (mis. BUSA OCEAN + GR tertunda) TETAP di daftar ini: butuh cek fisik DAN keputusan GR.
const daftarP1 = kesiapan.bahan.filter((k) => k.cekFisikMendesakP1).map((k) => ({ kode: k.kode, nama: k.nama, satuan: k.satuan, ledgerKini: k.ledgerKini, dokumenTertunda: k.dokumenTertunda, alasan: k.alasan, tindakan: k.tindakan }));

// cakupan order: rekap vs pemakaian
const resiPakai = new Set(pakai.baris.map((b) => b.resi)); const resiRekap = new Set(rekap.orders.map((o) => o.resi));
const cakupanOrder = { orderRekap: resiRekap.size, orderPemakaian: resiPakai.size, diRekapTanpaPemakaian: [...resiRekap].filter((r) => !resiPakai.has(r)), diPemakaianTanpaRekap: [...resiPakai].filter((r) => !resiRekap.has(r)) };
const cakupan = { ...riwayat.ringkasan.cakupan, order: cakupanOrder, kekosongan: ["Pemakaian/rekap order: tidak ada data bertanggal setelah " + (pakai.cakupan.sampai || "-") + " (10–16 Okt dst. kosong).", "Pembelian: tanggal kirim aktual terakhir " + (beli.cakupan.aktualSampai || "-") + "; sisanya estimasi.", "Hitung parsial: QTY SEP tanpa tanggal; QTY OKT hanya " + [...stok.values()].filter((s) => s.qtyOkt != null).length + " bahan."] };

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "rekon-riwayat-okt.json"), JSON.stringify({ stempel: data.stempel, mulai: mulai?.toISOString() || null, verifikasiSep, stokGanda, struktur: { pemakaian: pakai.struktur, tidakDikenalPemakaian: pakai.tidakDikenal.length }, cakupan, ringkasan: riwayat.ringkasan, luar: riwayat.luar, bahan: riwayat.bahan, kesiapan: kesiapan.bahan, ringkasanKesiapan: kesiapan.ringkasan, daftarCekFisikP1: daftarP1 }, null, 1));

// ---------- workbook ----------
const wb = new ExcelJS.Workbook(); wb.creator = "SANSS Gudang — rekonsiliasi riwayat Oktober";
const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }, alignment: { wrapText: true, vertical: "middle" } };
const sheet = (nama, kol, rows, w = []) => { const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 1, xSplit: 1 }] }); ws.addRow(kol); ws.getRow(1).eachCell((c) => Object.assign(c, HEAD)); ws.getRow(1).height = 42; for (const r of rows) ws.addRow(r).alignment = { vertical: "top", wrapText: true }; kol.forEach((_, i) => { ws.getColumn(i + 1).width = w[i] || 14; }); ws.autoFilter = { from: { row: 1, column: 1 }, to: { row: 1, column: kol.length } }; return ws; };
const n = (v) => (v == null ? "" : v);
const rs = wb.addWorksheet("Ringkasan"); rs.columns = [{ width: 46 }, { width: 110 }];
[["REKONSILIASI RIWAYAT OKTOBER PER MATERIAL ID — PRATINJAU BACA-SAJA"], ["Sumber data sistem", data.stempel || "-"],
  ["Sifat hitung", "QTY SEP / QTY OKT = hitung PARSIAL per bahan, bukan SO penuh dan bukan saldo awal resmi seluruh Gudang. Kosong/absen = belum diketahui (bahan tetap ada di master)."],
  ["Bukti tiba", "Hanya tanggal kirim AKTUAL (log pembelian) / kedatangan GR. PO saja dan estimasi (EST) bukan bukti stok masuk."],
  ["Anti-ganda", "Pemakaian: kunci (order, material) dicocokkan ke ISSUE ledger (unit order). Penerimaan: surat jalan/qty/tanggal dicocokkan ke GR. Yang sudah ada di ledger ditandai SUDAH_DI_LEDGER dan tidak dihitung lagi."],
  ["Waktu mulai pencatatan baru (T0)", mulai ? mulai.toISOString() + " — peristiwa ≥ T0 tidak diambil dari file (sistem yang mencatat)." : "BELUM DITETAPKAN (parameter --mulai)."],
  ["Struktur CSV rekap", pakai.struktur.catatan + ` Label bulan tidak cocok dengan bulan tanggal pada ${pakai.struktur.labelBulanTidakDipercaya} dari ${pakai.baris.length} baris (label OKT pada baris bertanggal September; label SEP pada Juli/Agustus). Tanggal sel sama dengan tanggal pada nomor resi di ${pakai.struktur.tanggalSamaDenganNomorResi}/${pakai.baris.length} baris → itu tanggal ORDER, bukan bukti tanggal selesai/pemakaian. Label tidak dipercaya; dilaporkan sebagai rentang (batas bawah = tanggal Oktober, batas atas = + berlabel OKT).`],
  ["Verifikasi file Stock September", verifikasiSep ? JSON.stringify(verifikasiSep) : "tidak diberikan"], [],
  ["CAKUPAN"], ...cakupan.kekosongan.map((k) => ["Kekosongan", k]), ["Pemakaian tanggal", `${pakai.cakupan.dari} s/d ${pakai.cakupan.sampai} (${pakai.baris.length} baris, ${resiPakai.size} order)`], ["Rekap order tanggal", `${rekap.cakupan.dari} s/d ${rekap.cakupan.sampai} (${rekap.orders.length} order)`],
  ["Pembelian aktual", `${beli.cakupan.aktualDari} s/d ${beli.cakupan.aktualSampai}; estimasi ${beli.cakupan.estimasi} baris`], ["Ledger terakhir", riwayat.ringkasan.cakupan.ledgerSampai || "-"], [],
  ["HASIL"]].forEach((r) => rs.addRow(r));
for (const [k, v] of Object.entries({ ...riwayat.ringkasan, cakupan: undefined })) if (v !== undefined) rs.addRow([k, typeof v === "object" ? JSON.stringify(v) : v]);
rs.addRow(["stokGanda (tidak dipakai)", JSON.stringify(stokGanda)]); rs.addRow(["kesiapan pencatatan baru", JSON.stringify(kesiapan.ringkasan)]);
rs.eachRow((r) => { r.alignment = { wrapText: true, vertical: "top" }; }); rs.getRow(1).font = { bold: true, size: 14 };

sheet("Per bahan", ["Kode", "Nama master", "Satuan master", "Status", "Hitung parsial (angka · waktu · bukti)", "Penerimaan terbukti belum di ledger", "Penerimaan sudah di ledger", "Pemakaian Okt belum di ledger (order)", "Qty pemakaian Okt belum di ledger", "Pemakaian berlabel OKT bertanggal Sep belum di ledger (order)", "Ledger awal Okt", "Ledger 9 Okt", "Ledger kini", "Perkiraan 9 Okt — batas bawah pemakaian (SEP+terima−pakai tgl Okt)", "Selisih batas bawah − ledger 9 Okt", "Perkiraan 9 Okt — batas atas pemakaian (+label OKT)", "Selisih batas atas − ledger 9 Okt", "Penanda", "Belum bisa dipastikan"],
  riwayat.bahan.map((x) => [x.kode, x.nama, x.satuanMaster, x.status, x.titikHitung.map((t) => `${t.jenis}: ${t.angka} ${t.satuan} · ${t.waktu || "waktu tidak terbukti"} · ${t.bukti}`).join("\n") || "(tidak ada — kosong ≠ nol)", x.penerimaanTerbuktiBelumDiLedger, x.penerimaanSudahDiLedger, x.pemakaianOktBelumDiLedger, x.qtyPemakaianOktBelumDiLedger, x.pemakaianLabelOktSebelumBelumDiLedger, x.ledgerAwalOktober, x.ledger9Okt, x.ledgerKini, n(x.perkiraan9Okt), n(x.selisih9Okt), n(x.perkiraan9OktAtas), n(x.selisih9OktAtas), x.isu.map((i) => `[${i.level === "BLOCKER" ? "B" : "P"}] ${i.kode}`).join("; "), x.belumPasti.join("\n")]),
  [34, 38, 9, 22, 56, 11, 11, 11, 11, 12, 10, 10, 10, 14, 12, 14, 12, 50, 70]);
sheet("Penerimaan", ["Kode", "Tier bukti", "Status", "Tanggal kirim", "Surat jalan", "Vendor", "Qty kirim", "Satuan", "Satuan = master?", "GR", "Status GR", "Catatan", "Kunci idempoten", "Baris CSV"],
  riwayat.bahan.flatMap((x) => x.penerimaan.map((t) => [x.kode, t.tier, t.status, t.tanggalKirim || "", t.suratJalan, t.vendor, n(t.qtyKirim), t.satuan, t.satuanSesuaiMaster ? "ya" : "TIDAK", t.gr?.nomor || "", t.gr?.status || "", t.catatan, t.kunci, t.barisCsv])), [34, 26, 28, 12, 22, 26, 9, 9, 9, 16, 16, 26, 44, 8]);
sheet("Pemakaian per order", ["Kode", "Order", "Tanggal", "Label bulan (tidak dipercaya)", "Qty rekap", "Satuan rekap", "Satuan = master?", "Qty di ledger", "Status", "Kunci idempoten", "Baris CSV"],
  riwayat.bahan.flatMap((x) => x.pemakaian.map((p) => [x.kode, p.resi, p.tanggal, p.labelBulan, p.qtyRekap, p.satuanRekap, p.satuanSesuaiMaster ? "ya" : "TIDAK", p.qtyLedger, p.status, p.kunci, p.barisCsv.join(",")])), [34, 22, 12, 12, 10, 10, 10, 10, 26, 44, 12]);
sheet("GR tanpa log pembelian", ["Kode", "GR", "Status", "Tanggal", "Surat jalan", "Qty", "Bukti"], riwayat.bahan.flatMap((x) => x.grTanpaLog.map((g) => [x.kode, g.nomor, g.status, g.tanggal || "", g.suratJalan, n(g.qty), g.bukti])), [34, 16, 16, 12, 22, 9, 28]);
sheet("Tidak berpasangan", ["Sumber", "Nama", "Vendor/Order", "Qty", "Tanggal", "Kelas"], [...riwayat.luar.pakaiTanpaPasangan.map((x) => ["pemakaian", x.nama, x.resi, x.qty, x.tanggal, x.kelas]), ...riwayat.luar.beliTanpaPasangan.map((x) => ["pembelian", x.nama, x.vendor, n(x.qty), x.tanggal || "", x.kelas])], [12, 50, 30, 9, 12, 28]);
sheet("Kesiapan catat baru", ["Kode", "Nama", "Satuan", "Kesiapan", "Alasan", "Ledger kini", "Tindakan sebelum dipakai di transaksi baru"], kesiapan.bahan.map((x) => [x.kode, x.nama, x.satuan, x.kesiapan, x.alasan, x.ledgerKini, x.tindakan]), [34, 38, 9, 22, 60, 10, 70]);
sheet("Daftar cek fisik P1", ["Kode", "Nama", "Satuan", "Ledger kini", "Dokumen tertunda?", "Alasan", "Tindakan"], daftarP1.map((x) => [x.kode, x.nama, x.satuan, x.ledgerKini, x.dokumenTertunda ? "YA — keputusan GR tetap dibutuhkan" : "tidak", x.alasan, x.tindakan]), [34, 40, 9, 10, 26, 80, 80]);
await wb.xlsx.writeFile(path.join(OUT, "rekon-riwayat-okt.xlsx"));
console.log(JSON.stringify({ keluaran: OUT, ringkasan: { ...riwayat.ringkasan, cakupan: undefined }, cakupan: cakupan.kekosongan, struktur: { ...pakai.struktur, kombinasiTanggalLabel: undefined }, kesiapan: kesiapan.ringkasan, cekFisikP1: daftarP1.map((x) => x.kode + (x.dokumenTertunda ? " [+dokumen tertunda]" : "")), stokGanda: stokGanda.length, verifikasiSep }, null, 1));
void PRIORITAS;
