// MATRIKS PILOT OPNAME (BACA-SAJA) — fisik, satuan, saldo pada waktu hitung, pergerakan sesi, selisih, bukti, dokumen tertunda, keputusan Gudang/Finance, GO/NO-GO.
//
//   docker compose exec -T backend node scripts/opname-matriks-pilot.mjs --pilot KODE1,KODE2,... [--preview /tmp/preview-opname/preview.json] [--keputusan /tmp/keputusan.xlsx] --out /tmp/matriks
//
// Tanpa --preview: matriks berisi fakta terkini (saldo, dokumen tertunda) dengan semua bahan "BELUM DIHITUNG" — angka fisik TIDAK diisi/dikarang.
// --keputusan: xlsx sheet "Keputusan" berkolom Kode | Keputusan Gudang | Alasan Gudang | Keputusan Finance | Alasan Finance (diisi manusia).
// Seluruh akses DB dalam transaksi READ ONLY.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/db.js";
import { muatDokumenTertunda } from "../src/services/opnameCutover.js";
import { bangunMatriksPilot, buatWorkbookMatriks } from "../src/services/opnameMatriks.js";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
if (process.argv.includes("--apply") || process.argv.includes("--post")) { console.error("STOP: skrip ini hanya baca-saja."); process.exit(2); }
const kodes = (arg("--pilot") || "").split(",").map((x) => x.trim()).filter(Boolean);
if (!kodes.length) { console.error("Pakai: --pilot KODE1,KODE2,... [--preview preview.json] [--keputusan keputusan.xlsx] [--out dir]"); process.exit(1); }
const OUT = arg("--out", "./matriks-pilot");
const preview = arg("--preview") ? JSON.parse(fs.readFileSync(arg("--preview"), "utf8")) : null;

const nilaiSel = (c) => { const v = c?.value; if (v === null || v === undefined) return ""; if (typeof v === "object") return String(v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join("") : "")); return String(v); };
const keputusan = new Map();
if (arg("--keputusan")) {
  const wb = new ExcelJS.Workbook(); await wb.xlsx.readFile(arg("--keputusan"));
  const ws = wb.getWorksheet("Keputusan");
  if (ws) ws.eachRow((row, n) => { if (n === 1) return; const [kode, g, ag, f, af] = [1, 2, 3, 4, 5].map((i) => nilaiSel(row.getCell(i)).trim()); if (kode) keputusan.set(kode, { gudang: g.toUpperCase(), alasanGudang: ag, finance: f.toUpperCase(), alasanFinance: af }); });
}

const { fakta, pilot } = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  const ms = await tx.material.findMany({ where: { code: { in: kodes } }, select: { id: true, code: true, name: true, unit: true } });
  const saldo = await tx.stockMovement.groupBy({ by: ["materialId"], where: { materialId: { in: ms.map((m) => m.id) } }, _sum: { qty: true }, _max: { createdAt: true } });
  const sm = new Map(saldo.map((s) => [s.materialId, s]));
  const pend = await muatDokumenTertunda(tx);
  const fakta = new Map(ms.map((m) => [m.code, { saldoSekarang: Number(sm.get(m.id)?._sum.qty || 0), pergerakanTerakhir: sm.get(m.id)?._max.createdAt || null, dokumenTertunda: pend.filter((p) => p.materialCode === m.code) }]));
  const urut = kodes.map((k) => ms.find((m) => m.code === k)).filter(Boolean);
  const hilang = kodes.filter((k) => !ms.some((m) => m.code === k));
  if (hilang.length) throw new Error("Kode tidak ada di master: " + hilang.join(", "));
  return { fakta, pilot: urut.map((m) => ({ kode: m.code, nama: m.name, satuan: m.unit })) };
}, { timeout: 60_000 });

const { baris, ringkasan } = bangunMatriksPilot({ pilot, fakta, preview, keputusan });
fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "matriks.json"), JSON.stringify({ ringkasan, baris }, null, 2));

const wb = buatWorkbookMatriks(ExcelJS, { baris, ringkasan });
await wb.xlsx.writeFile(path.join(OUT, "matriks.xlsx"));
console.log(JSON.stringify({ keluaran: OUT, ringkasan }, null, 2));
await prisma.$disconnect();
