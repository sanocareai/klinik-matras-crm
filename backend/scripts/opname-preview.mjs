// PRATINJAU SELISIH OPNAME FISIK — DRY-RUN MURNI (tidak ada mode apply; tidak menulis stok, jurnal, atau dokumen apa pun).
//
//   docker compose exec backend node scripts/opname-preview.mjs --file /tmp/Lembar-Opname-terisi.xlsx --out /tmp/preview-opname [--cutoff "2026-10-31 23:59"] [--saldo-1400-sampai 2026-10-31] [--stock-count CC-311026]
//   --stock-count: tanda 'sudah/belum masuk hitungan fisik' yang dibuat penghitung di aplikasi (Stock Count) ikut dibaca sebagai log pergerakan jendela.
//
// Membaca lembar hitung (sheet "Hitung"; opsional "Log pergerakan jendela" dan "Harga Finance"), membandingkan terhadap ledger PADA WAKTU HITUNG yang sama,
// dan menulis preview.json + preview.xlsx. Seluruh akses DB berada dalam SATU transaksi READ ONLY (SET TRANSACTION READ ONLY) — menulis akan ditolak Postgres.
// Harga hanya dari sheet "Harga Finance" (sumber dokumen); harga sheet manual / harga referensi master TIDAK dipakai.
import fs from "node:fs";
import path from "node:path";
import ExcelJS from "exceljs";
import { prisma } from "../src/db.js";
import { muatPergerakanSesi } from "../src/services/pergerakanSesiHitung.js";
import {
  KOLOM_HITUNG, normalisasiBaris, normalisasiLog, normalisasiHarga, hitungPreview, muatLedger, KOLOM_LOG, gabungStockCount, muatMaterials, muatDokumenTertunda, muatSaldoBuku1400, parseWaktuWIB, LEVEL,
} from "../src/services/opnameCutover.js";

const arg = (n, d = null) => { const i = process.argv.indexOf(n); return i >= 0 ? process.argv[i + 1] : d; };
if (process.argv.includes("--apply") || process.argv.includes("--post")) {
  console.error("STOP: skrip ini hanya dry-run. Tidak ada --apply. Posting dilakukan lewat Stock Adjustment/Stock Count resmi oleh orang berbeda.");
  process.exit(2);
}
const FILE = arg("--file"); const OUT = arg("--out", "./preview-opname");
const STOCK_COUNT = arg("--stock-count");
if ((!FILE && !STOCK_COUNT) || (FILE && !fs.existsSync(FILE))) { console.error("Pakai: --file <lembar-terisi.xlsx> [--out dir] [--cutoff 'YYYY-MM-DD HH:mm' (WIB)] [--saldo-1400-sampai YYYY-MM-DD]"); process.exit(1); }

const nilaiSel = (c) => {
  const v = c?.value; if (v === null || v === undefined) return null;
  if (v instanceof Date) return v;
  if (typeof v === "object") return v.result ?? v.text ?? (v.richText ? v.richText.map((r) => r.text).join("") : null);
  return v;
};
function bacaSheet(ws, judulWajib) {
  if (!ws) return [];
  let hdr = null;
  ws.eachRow((row, n) => { if (hdr === null) { const vals = row.values.slice(1).map((c) => String(nilaiSel({ value: c }) ?? "").trim()); if (vals.includes(judulWajib)) hdr = { n, vals }; } });
  if (!hdr) return [];
  const out = [];
  ws.eachRow((row, n) => {
    if (n <= hdr.n) return;
    const o = {}; let ada = false;
    hdr.vals.forEach((h, i) => { if (!h) return; const v = nilaiSel(row.getCell(i + 1)); o[h] = v; if (v !== null && v !== "") ada = true; });
    if (ada) { o.__baris = n; out.push(o); }
  });
  return out;
}

const wb = new ExcelJS.Workbook();
if (FILE) await wb.xlsx.readFile(FILE);
const lembar = FILE ? bacaSheet(wb.getWorksheet("Hitung"), KOLOM_HITUNG.materialId) : [];
if (FILE && !lembar.length && !STOCK_COUNT) { console.error('Sheet "Hitung" kosong atau tak punya kolom "Material ID".'); process.exit(1); }
let baris = lembar.map((r) => normalisasiBaris(r, r.__baris));
const logJendela = FILE ? normalisasiLog(bacaSheet(wb.getWorksheet("Log pergerakan jendela"), "Dokumen / ID movement")) : [];
const harga = FILE ? normalisasiHarga(bacaSheet(wb.getWorksheet("Harga Finance"), "Kode material")) : new Map();

// Hasil hitung yang diinput Gudang di aplikasi (Stock Count) digabung SEBELUM menentukan jendela waktu.
let countDipakai = null; let selesaiPerLine = new Map();
if (STOCK_COUNT) {
  const info = await prisma.$transaction(async (tx) => {
    await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
    const count = await tx.stockCount.findFirst({ where: /^[0-9a-f-]{36}$/i.test(STOCK_COUNT) ? { id: STOCK_COUNT } : { countNumber: STOCK_COUNT }, include: { lines: { include: { material: { select: { code: true, unit: true } } } } } });
    if (!count) throw new Error("Stock Count tidak ditemukan: " + STOCK_COUNT);
    const ev = await tx.activityEvent.findMany({ where: { entityType: "stock_count", entityId: count.id, eventType: "DOCUMENT_EDITED" }, select: { metadata: true, createdAt: true }, orderBy: { createdAt: "asc" } });
    const per = new Map();
    for (const e of ev) if (e.metadata?.aksi === "HASIL_HITUNG_DIISI" && e.metadata.lineId && "countedQtyBaru" in e.metadata) per.set(e.metadata.lineId, e.createdAt);
    return { count, per };
  });
  countDipakai = info.count; selesaiPerLine = info.per;
  baris = gabungStockCount(baris, { count: countDipakai, selesaiPerLine });
}
const tertinggi = baris.map((b) => b.selesai).filter((d) => d instanceof Date && !Number.isNaN(d.getTime())).sort((a, b) => b - a)[0] || new Date();
const cutoff = arg("--cutoff") ? parseWaktuWIB(arg("--cutoff")) : tertinggi;
const sampai = new Date(Math.max(+cutoff, +tertinggi));

const hasil = await prisma.$transaction(async (tx) => {
  await tx.$executeRawUnsafe("SET TRANSACTION READ ONLY");
  const materials = await muatMaterials(tx);
  const ids = materials.map((m) => m.id);
  const ledger = await muatLedger(tx, ids, sampai);
  const pending = await muatDokumenTertunda(tx);
  const tglBuku = arg("--saldo-1400-sampai");
  const saldo1400 = tglBuku ? await muatSaldoBuku1400(tx, tglBuku) : null;
  // Tanda dari sesi Stock Count di aplikasi (bila diminta): pergerakan sesi + tanda eksplisit penghitung → baris log. Yang belum ditandai dibiarkan kosong (→ BLOCKER, tidak menebak).
  let logGabungan = logJendela;
  const sc = arg("--stock-count");
  if (sc) {
    const count = await tx.stockCount.findFirst({
      where: /^[0-9a-f-]{36}$/i.test(sc) ? { id: sc } : { countNumber: sc },
      include: { lines: { include: { material: { select: { code: true } } } } },
    });
    if (!count) throw new Error("Stock Count tidak ditemukan: " + sc);
    const kodePer = new Map(count.lines.map((l) => [l.materialId, l.material.code]));
    const { pergerakan } = await muatPergerakanSesi(tx, count, { sampai });
    const tambahan = pergerakan.map((p) => ({
      [KOLOM_LOG.dokumen]: p.id, [KOLOM_LOG.kode]: kodePer.get(p.materialId), [KOLOM_LOG.qty]: p.qty, [KOLOM_LOG.waktu]: p.at,
      [KOLOM_LOG.tercermin]: p.tanda === "SUDAH_TERHITUNG" ? "YA" : p.tanda === "BELUM_TERHITUNG" ? "TIDAK" : "", [KOLOM_LOG.pencatat]: "Stock Count " + count.countNumber,
    }));
    logGabungan = [...logJendela, ...normalisasiLog(tambahan)];
  }
  const prev = hitungPreview({ materials, baris, ledger, cutoff, logJendela: logGabungan, hargaFinance: harga, pending, saldoBuku1400: saldo1400 });
  const [{ now }] = await tx.$queryRaw`SELECT now() AS now`;
  return { ...prev, meta: { dibuat: now, file: FILE ? path.basename(FILE) : '(hanya Stock Count)', stockCount: countDipakai ? countDipakai.countNumber : null, cutoff: cutoff.toISOString(), sampaiLedger: sampai.toISOString(), barisHitung: baris.length, barisLog: logJendela.length, barisHarga: harga.size, readOnly: true } };
}, { timeout: 120_000 });

fs.mkdirSync(OUT, { recursive: true });
fs.writeFileSync(path.join(OUT, "preview.json"), JSON.stringify(hasil, null, 2));

const o = new ExcelJS.Workbook();
const ring = o.addWorksheet("Ringkasan");
ring.addRows([["PRATINJAU SELISIH OPNAME (DRY-RUN — tidak ada yang diposting)"], ["File", hasil.meta.file], ["Cut-off", hasil.meta.cutoff], ["Material dihitung", hasil.ringkasan.materialDihitung],
  ["Perlu hitung ulang (ada BLOCKER)", hasil.ringkasan.perluHitungUlang], ["Belum dihitung", hasil.ringkasan.belumDihitung], ["Material aktif/berstok tanpa baris hitung", hasil.ringkasan.tidakAdaBarisHitung],
  ["Selisih qty NAIK (terpisah)", hasil.ringkasan.selisihQtyNaik], ["Selisih qty TURUN (terpisah)", hasil.ringkasan.selisihQtyTurun], [hasil.ringkasan.catatanNaikTurun], [],
  ["REKONSILIASI NILAI (terpisah dari qty)"], ["Nilai fisik material berharga Finance", hasil.rekonNilai.nilaiFisikDitetapkan], ["Saldo buku 1-1400", hasil.rekonNilai.saldoBuku1400],
  ["Penyesuaian jurnal persediaan awal (nilai fisik − buku)", hasil.rekonNilai.penyesuaianJurnalPersediaanAwal], ["Material berstok TANPA harga Finance", hasil.rekonNilai.materialBerstokTanpaHarga.length], [hasil.rekonNilai.catatan]]);
ring.getColumn(1).width = 58; ring.getColumn(2).width = 40;
const pm = o.addWorksheet("Per material");
pm.addRow(["Kode", "Nama", "Satuan", "Status akhir", "Fisik milik SANO", "Ledger saat hitung", "Selisih (fisik − ledger)", "%", "Ledger cut-off", "Fisik proyeksi cut-off", "GR fisik blm diposting", "Dalam perjalanan", "Sisa di produksi", "Milik customer", "Nilai: status", "Harga/satuan", "Nilai selisih (Rp)", "Isu"]);
for (const m of hasil.materials) pm.addRow([m.kode, m.nama, m.satuan, m.statusAkhir || m.kelas, m.fisikMilikSano, m.ledgerSaatHitung ?? m.ledgerCutoff, m.delta, m.deltaPersen, m.ledgerCutoff, m.fisikProyeksiCutoff,
  m.dikecualikan?.grFisikBelumDiposting, m.dikecualikan?.dalamPerjalanan, m.dikecualikan?.sisaDiProduksi, m.dikecualikan?.milikCustomer, m.nilai?.status, m.nilai?.unitCost, m.nilai?.nilaiSelisih, m.isu.map((x) => `[${x.level}] ${x.kode}: ${x.pesan}`).join("\n")]);
const sw = o.addWorksheet("Pergerakan di jendela & jalur cepat");
sw.addRow(["Kode", "Jenis", "Tipe", "Qty", "Waktu", "Dokumen", "Log YA/TIDAK", "Catatan"]);
for (const m of hasil.materials) {
  for (const p of m.pergerakanJendela || []) sw.addRow([m.kode, "DI JENDELA HITUNG", p.type, p.qty, p.at, p.dokumenId || "TANPA DOKUMEN", p.log ?? "(tak tercatat)", p.note]);
  for (const p of m.pergerakanSetelahHitung || []) sw.addRow([m.kode, "SETELAH HITUNG", p.type, p.qty, p.at, p.dokumenId || "TANPA DOKUMEN", "", p.note]);
}
const td = o.addWorksheet("Tidak dihitung");
td.addRow(["Kode", "Nama", "Satuan", "Aktif", "Ledger", "Perlu dihitung"]);
for (const t of hasil.tidakDihitung) td.addRow([t.kode, t.nama, t.satuan, t.aktif, t.ledger, t.perlu ? "YA" : "tidak"]);
await o.xlsx.writeFile(path.join(OUT, "preview.xlsx"));

// Rencana pengajuan Stock Adjustment (BUKAN eksekusi): hanya material tanpa BLOCKER dan selisih ≠ 0. Key idempoten dipakai sebagai awalan alasan.
const tglKunci = hasil.meta.cutoff.slice(0, 10);
const csvEsc = (v) => '"' + String(v ?? "").replace(/"/g, '""') + '"';
const rencana = [["key", "material_id", "kode", "satuan", "selisih_qty", "kelas", "perlu_pemeriksa_tambahan", "alasan"]];
for (const m of hasil.materials) {
  if (m.statusAkhir === "PERLU_HITUNG_ULANG" || m.kelas === "BELUM_DIHITUNG" || !Number.isFinite(m.delta) || Math.abs(m.delta) < 1e-6) continue;
  rencana.push([`OPNAME-${tglKunci}:${m.kode}`, m.materialId, m.kode, m.satuan, m.delta, m.kelas, ["SELISIH_BESAR", "NOL_FISIK_LEDGER_POSITIF", "LEDGER_NEGATIF"].includes(m.kelas) ? "YA" : "tidak",
    `Opname fisik ${m.selesai?.slice(0, 16)}Z: fisik ${m.fisikMilikSano} ${m.satuan} vs ledger saat hitung ${m.ledgerSaatHitung}; bukti ${m.bukti.join("/")}; penghitung ${m.penghitung.join("/")}; pemeriksa ${m.pemeriksa.join("/")}`]);
}
fs.writeFileSync(path.join(OUT, "rencana-adjustment.csv"), rencana.map((r) => r.map(csvEsc).join(",")).join("\n") + "\n");

const blok = hasil.materials.reduce((n, m) => n + m.isu.filter((x) => x.level === LEVEL.BLOCKER).length, 0) + hasil.isuUmum.length;
console.log(JSON.stringify({ dryRun: true, keluaran: OUT, ringkasan: hasil.ringkasan, blockerTotal: blok }, null, 2));
await prisma.$disconnect();
