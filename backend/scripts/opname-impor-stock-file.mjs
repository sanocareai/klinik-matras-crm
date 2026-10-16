// PRATINJAU IMPOR STOK DARI FILE (BACA-SAJA). Tidak menulis ke DB/produksi dan tidak memposting apa pun.
//
//   node scripts/opname-impor-stock-file.mjs --csv Sano-Stock.csv --dump <folder out_*.csv dari baca_segar>  --out <folder>
//   node scripts/opname-impor-stock-file.mjs --csv Sano-Stock.csv --db --out <folder>            (SELECT-only, transaksi READ ONLY)
//   opsi: --alias alias.csv (baris_file,kode_material — keputusan manusia) · --waktu-hitung "2026-10-01 09:00" (WIB) --sumber-waktu "<bukti>"
//         --penghitung "<nama>" --pemeriksa "<nama>" --bukti-petugas "<rujukan>" · --skenario "2026-10-01 00:00" (hanya kolom informatif)
// Tanpa bukti waktu + petugas: semua baris BLOCKER. Dengan bukti lengkap tetap TIDAK ada penulisan; rencana-draft.json adalah masukan untuk ajukanDraft() (DRAFT, API resmi).
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { bacaStockCsv, petakan, buatPratinjau, bangunRencanaDraft, parseCsvText } from "../src/services/stokFileImport.js";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
if (["--apply", "--post", "--ajukan"].some((f) => process.argv.includes(f))) { console.error("STOP: skrip ini hanya pratinjau."); process.exit(2); }
const CSV = arg("--csv"); const OUT = arg("--out", "./impor-stok");
if (!CSV) { console.error("Pakai: --csv <file> (--dump <folder> | --db) [--out dir]"); process.exit(1); }
const wib = (s) => { if (!s) return null; const m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/); if (!m) throw new Error(`Format waktu "${s}" harus YYYY-MM-DD HH:mm (WIB)`); return new Date(Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 7, +m[5])); };

// ---------- sumber data ----------
import { dariDump, dariDb } from "./lib/muatDataStok.mjs";

const data = arg("--dump") ? dariDump(arg("--dump")) : process.argv.includes("--db") ? await dariDb() : (console.error("Pilih --dump <folder> atau --db"), process.exit(1));
const alias = new Map();
if (arg("--alias")) for (const r of parseCsvText(fs.readFileSync(arg("--alias"), "utf8")).slice(1)) if (r[0] && r[1]) alias.set(Number(r[0]), r[1].trim());
const bacaan = bacaStockCsv(fs.readFileSync(CSV, "utf8"));
const bukti = { waktuHitung: wib(arg("--waktu-hitung")), sumberWaktu: arg("--sumber-waktu", ""), penghitung: arg("--penghitung", ""), pemeriksa: arg("--pemeriksa", ""), buktiPetugas: arg("--bukti-petugas", "") };
const skenario = wib(arg("--skenario", "2026-10-01 00:00"));
const pratinjau = buatPratinjau({ pemetaan: petakan(bacaan, data.materials, alias), materials: data.materials, ledger: data.ledger, pending: data.pending, bukti, skenario });
fs.mkdirSync(OUT, { recursive: true });
const buktiLengkap = bukti.waktuHitung && bukti.sumberWaktu && bukti.penghitung && bukti.pemeriksa && bukti.buktiPetugas;
const rencana = buktiLengkap ? bangunRencanaDraft(pratinjau, bukti) : [];
fs.writeFileSync(path.join(OUT, "pratinjau.json"), JSON.stringify({ sumberCsv: path.basename(CSV), stempel: data.stempel, bukti: { ...bukti, waktuHitung: bukti.waktuHitung?.toISOString() || null }, skenario: skenario.toISOString(), ...pratinjau }, null, 1));
fs.writeFileSync(path.join(OUT, "rencana-draft.json"), JSON.stringify(rencana, null, 1));

const wb = new ExcelJS.Workbook(); wb.creator = "SANSS Gudang — pratinjau impor file stok";
const HEAD = { font: { bold: true, color: { argb: "FFFFFFFF" } }, fill: { type: "pattern", pattern: "solid", fgColor: { argb: "FF1F3A5F" } }, alignment: { wrapText: true, vertical: "middle" } };
const sheet = (nama, kol, rows, w = []) => {
  const ws = wb.addWorksheet(nama, { views: [{ state: "frozen", ySplit: 1 }] }); ws.addRow(kol); ws.getRow(1).eachCell((c) => Object.assign(c, HEAD));
  for (const r of rows) ws.addRow(r).alignment = { vertical: "top", wrapText: true };
  kol.forEach((_, i) => { ws.getColumn(i + 1).width = w[i] || 18; }); return ws;
};
sheet("Ringkasan", ["Butir", "Nilai"], Object.entries(pratinjau.ringkasan).map(([k, v]) => [k, typeof v === "object" ? JSON.stringify(v) : v]).concat([["bukti waktu hitung", bukti.sumberWaktu || "TIDAK ADA — header QTY SEP bukan bukti tanggal"], ["skenario informatif", skenario.toISOString()]]), [34, 80]);
sheet("Per bahan", ["Kode", "Nama master", "Satuan master", "Baris file", "Angka sumber", "Satuan file", "Fisik", "Waktu hitung (bukti)", "Skenario (informatif)", "Ledger saat hitung", "Pergerakan sesudahnya", "Ledger kini", "Proyeksi kini", "Selisih (fisik − ledger saat hitung)", "Jendela waktu yang memberi hasil sama", "Status", "Alasan"],
  pratinjau.bahan.map((x) => [x.kode, x.nama, x.satuanMaster, x.barisFile.join(","), x.angkaSumber, x.satuanFile, x.fisik, x.waktuHitung || "TIDAK TERBUKTI", x.waktuSkenario || "", x.ledgerSaatHitung,
    x.pergerakanSesudah.map((p) => `${p.type} ${p.qty > 0 ? "+" : ""}${p.qty} ${p.dokumen || ""} ${p.at.slice(0, 16)}`).join("\n"), x.ledgerKini, x.proyeksiKini, x.delta,
    x.jendelaHasilSama ? `${x.jendelaHasilSama.dari || "-"} s/d < ${x.jendelaHasilSama.sampaiSebelum || "sekarang"}` : "", x.status, x.isu.map((i) => `[${i.level}] ${i.kode}: ${i.pesan}`).join("\n")]),
  [34, 38, 9, 9, 10, 9, 9, 22, 22, 11, 36, 10, 10, 12, 40, 16, 80]);
sheet("Tanpa pasangan", ["Baris file", "Nama di file", "Jenis", "QTY SEP", "Kelas", "Kandidat (BUKAN keputusan)"], pratinjau.tanpaPasangan.map((x) => [x.baris, x.nama, x.jenis, x.qtySep, x.kelas, x.kandidat.map((k) => `${k.code} (${k.satuan}) skor ${k.skor}`).join("\n")]), [9, 50, 12, 10, 28, 70]);
sheet("Di luar lingkup", ["Baris file", "Nama", "Jenis", "QTY SEP", "Kode master"], pratinjau.luarLingkup.map((x) => [x.baris, x.nama, x.jenis, x.qtySep, x.kode || ""]), [9, 50, 14, 10, 34]);
sheet("Master tanpa baris file", ["Kode", "Nama", "Satuan", "Aktif", "Ledger kini"], pratinjau.masterTanpaBarisFile.map((x) => [x.kode, x.nama, x.satuan, x.aktif ? "ya" : "tidak", x.ledgerKini]), [34, 50, 9, 8, 12]);
await wb.xlsx.writeFile(path.join(OUT, "pratinjau.xlsx"));
console.log(JSON.stringify({ keluaran: OUT, ringkasan: pratinjau.ringkasan, draftRencana: rencana.length }, null, 1));
