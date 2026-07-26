import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { STAGE_LABELS, ORDER_STATUS_LABELS } from "./format.js";

// ═══ EXPORT LAPORAN — WORKBOOK MULTI-SHEET ════════════════════════════════
// Menggantikan export lama yang menulis 6 baris "Metrik | Nilai" ke satu sheet
// bernama "Data".
//
// MASALAH TERBESAR export lama BUKAN kurang rapi, tapi angka uang dikirim
// sebagai TEKS hasil formatRupiah() ("Rp217.566.000"). Di Excel teks tidak
// bisa di-SUM, di-pivot, atau dibuat chart — jadi file yang "terlihat benar"
// justru tidak bisa dipakai bekerja. Di sini semua angka ditulis sebagai
// NUMBER asli, tampilannya diatur lewat number format (cell.z) — jadi tetap
// terbaca "Rp217.566.000" di layar TAPI tetap angka di mesin hitung Excel.
//
// ⚠️ BATASAN NYATA xlsx@0.18.5 (SheetJS community, sudah diverifikasi dengan
// round-trip write→read): `!cols` (lebar kolom) dan `cell.z` (number format)
// BERTAHAN di file hasil. Tapi styling sel (bold/fill/border) dan FREEZE PANE
// TIDAK didukung — properti `!freeze` hilang saat ditulis. Jadi jangan
// menambahkan kode bold/freeze di sini lalu mengira berhasil; kalau memang
// dibutuhkan, jalurnya ganti library (mis. exceljs), bukan menambah properti
// yang diabaikan. Hirarki visual di sini dibangun dari struktur (baris judul,
// baris kosong, urutan) — bukan dari font.
const FMT = {
  rp:    '"Rp"#,##0',
  int:   "#,##0",
  pct:   '0.0"%"',
  pct0:  '0"%"',
  menit: '#,##0" mnt"',
};

// Angka yang boleh kosong. `null` ditulis sebagai "—" (teks) supaya beda jelas
// dari 0 — "belum ada datanya" dan "nol" adalah dua hal berbeda di laporan.
function num(v, z = FMT.int) {
  return v == null || Number.isNaN(v) ? "—" : { v: Number(v), z };
}
const rp  = (v) => num(v, FMT.rp);
const pct = (v) => num(v, FMT.pct);

class SheetBuilder {
  constructor() { this.aoa = []; this.fmts = []; }

  // cells: nilai biasa, atau { v, z } untuk nilai + number format.
  row(cells = []) {
    const r = this.aoa.length;
    const out = cells.map((c, i) => {
      if (c && typeof c === "object" && "v" in c) {
        if (c.z) this.fmts.push({ r, c: i, z: c.z });
        return c.v;
      }
      return c;
    });
    this.aoa.push(out);
    return this;
  }

  blank() { return this.row([]); }
  rows(list) { list.forEach((r) => this.row(r)); return this; }

  build(widths) {
    const ws = XLSX.utils.aoa_to_sheet(this.aoa);
    for (const f of this.fmts) {
      const addr = XLSX.utils.encode_cell({ r: f.r, c: f.c });
      if (ws[addr]) ws[addr].z = f.z;
    }
    if (widths) ws["!cols"] = widths.map((w) => ({ wch: w }));
    return ws;
  }
}

function judul(sb, teks, periode) {
  sb.row([teks]);
  sb.row([`Periode: ${periode}`]);
  sb.row([`Dibuat: ${new Date().toLocaleString("id-ID", { timeZone: "Asia/Jakarta" })} WIB`]);
  sb.blank();
  return sb;
}

// ── Sheet 1: Ringkasan Eksekutif ──────────────────────────────────────────
function sheetRingkasan({ periode, summary, perf }) {
  const u = summary?.uang || {};
  const k = summary?.konversi || {};
  const sb = new SheetBuilder();
  judul(sb, "KLINIK MATRAS — RINGKASAN EKSEKUTIF", periode);

  sb.row(["UANG", "", ""]);
  sb.row(["Metrik", "Nilai", "Catatan"]);
  sb.rows([
    ["Nilai penjualan (order masuk)", rp(u.grossValue), "CANCELLED tidak dihitung; belum tentu sudah terbayar"],
    ["Sudah lunas",                   rp(u.collectedValue), "Order dengan Status Pembayaran = LUNAS"],
    ["Sudah DP",                      rp(u.dpValue), "Order dengan Status Pembayaran = DP"],
    ["Belum lunas",                   rp(u.outstandingValue), "Nilai penjualan − sudah lunas"],
    ["% lunas",                       num(u.collectedRate, FMT.pct0), "Rendah bisa berarti status pembayaran belum dirawat"],
    ["Jumlah order",                  num(u.totalOrders), ""],
    ["Rata-rata per order (AOV)",     rp(u.aov), "Nilai penjualan / jumlah order"],
  ]);
  sb.blank();

  sb.row(["KONVERSI", "", ""]);
  sb.row(["Metrik", "Nilai", "Catatan"]);
  sb.rows([
    ["Pelanggan baru",       num(k.totalCustomers), "Dibuat pada periode ini"],
    ["Pernah order",         num(k.customersWithOrders), ""],
    ["% pernah order",       pct(k.orderRate), ""],
    ["Sampai tahap bayar",   num(k.paidCustomers), "Pipeline stage Paid / Already Reviewed"],
    ["% sampai bayar",       pct(k.paidRate), "Ini conversion rate penjualan yang sebenarnya"],
    ["Total percakapan",     num(perf?.totalConversations), "Grup WA internal tidak dihitung"],
    ["Rata-rata respons",    num(perf?.avgResponseMinutes, FMT.menit), "Pesan pertama customer → balasan pertama"],
    ["Jumlah komplain",      num(summary?.komplain?.count), ""],
    ["% komplain",           pct(summary?.komplain?.rate), "Dari jumlah order"],
  ]);

  return sb.build([34, 18, 62]);
}

// ── Sheet 2: Penjualan (deret + kategori + status) ────────────────────────
function sheetPenjualan({ periode, summary }) {
  const sb = new SheetBuilder();
  judul(sb, "PENJUALAN", periode);
  const gran = summary?.granularity === "day" ? "Tanggal" : "Bulan";

  sb.row(["PENDAPATAN PER KATEGORI", "", ""]);
  sb.row(["Kategori", "Jumlah Order", "Nilai"]);
  const KAT = { LAYANAN: "Layanan/Upgrade", SEWA: "Kasur Sewa", BARU: "Kasur Baru" };
  (summary?.revenueByCategory || [])
    .slice().sort((a, b) => b.value - a.value)
    .forEach((r) => sb.row([KAT[r.category] || r.category, num(r.count), rp(r.value)]));
  sb.blank();

  sb.row(["ANTREAN PRODUKSI (per status order)", "", ""]);
  sb.row(["Status", "Jumlah Order", "Nilai"]);
  const URUT = ["PENDING", "PICKUP", "PROCESSING", "READY", "DELIVERED", "CANCELLED"];
  URUT.forEach((s) => {
    const r = (summary?.orderStatus || []).find((x) => x.status === s);
    if (r) sb.row([ORDER_STATUS_LABELS[s] || s, num(r.count), rp(r.value)]);
  });
  sb.blank();

  sb.row([`DERET PENDAPATAN (${gran.toLowerCase()})`, ""]);
  sb.row([gran, "Nilai"]);
  (summary?.revenueSeries || []).forEach((p) => sb.row([p.bucket, rp(p.value)]));
  sb.blank();
  sb.row(["TOTAL", rp((summary?.revenueSeries || []).reduce((s, p) => s + p.value, 0))]);

  return sb.build([24, 16, 18]);
}

// ── Sheet 3: Pipeline ─────────────────────────────────────────────────────
function sheetPipeline({ periode, funnel, velocity }) {
  const sb = new SheetBuilder();
  judul(sb, "PIPELINE", periode);

  const total = (funnel || []).reduce((s, f) => s + f.count, 0);
  sb.row(["POSISI SAAT INI", "", "", ""]);
  sb.row(["Tahap", "Jumlah Pelanggan", "% dari Total", "Nilai Order"]);
  (funnel || []).forEach((f) => sb.row([
    STAGE_LABELS[f.stage] || f.stage,
    num(f.count),
    num(total > 0 ? Math.round((f.count / total) * 1000) / 10 : null, FMT.pct),
    rp(f.value),
  ]));
  sb.row(["TOTAL", num(total), "", rp((funnel || []).reduce((s, f) => s + f.value, 0))]);
  sb.blank();

  const avg = velocity?.avgDaysInStage || [];
  if (avg.length > 0) {
    sb.row(["KECEPATAN — RATA-RATA LAMA DI TIAP TAHAP", "", ""]);
    sb.row(["Tahap", "Rata-rata (hari)", "Sampel"]);
    avg.forEach((r) => sb.row([
      STAGE_LABELS[r.stage] || r.stage,
      num(r.avgDays, "#,##0.0"),
      num(r.sample),
    ]));
    sb.blank();
  }

  const moved = velocity?.movedToStage || [];
  if (moved.length > 0) {
    sb.row(["PERGERAKAN — MASUK KE TAHAP PADA PERIODE INI", ""]);
    sb.row(["Tahap", "Jumlah Perpindahan"]);
    moved.forEach((r) => sb.row([STAGE_LABELS[r.stage] || r.stage, num(r.count)]));
    sb.blank();
    sb.row(["Total perpindahan tercatat", num(velocity?.totalTransitions)]);
  }

  return sb.build([26, 18, 16, 18]);
}

// ── Sheet 4: Sales ────────────────────────────────────────────────────────
function sheetSales({ periode, report }) {
  const sb = new SheetBuilder();
  judul(sb, "LAPORAN SALES", periode);
  sb.row(["Atribusi: percakapan yang di-assign ke sales (Conversation.assignedToId)"]);
  if (report?.periodeTarget) {
    sb.row([`Kolom target memakai target bulan ${report.periodeTarget.month}/${report.periodeTarget.year}`]);
  }
  sb.blank();

  const HEAD = [
    "Sales", "Percakapan Ditangani", "Dibalas", "Menggantung", "Avg Respons (mnt)",
    "SLA >60mnt", "Qualified", "Quoted", "Pelanggan Bayar", "Konversi %",
    "Order", "Nilai Penjualan", "Sudah Lunas", "AOV", "Target", "% Target",
    "Komplain", "% Komplain",
  ];
  sb.row(HEAD);

  (report?.rows || []).forEach((r) => sb.row([
    r.name,
    num(r.handled), num(r.replied), num(r.stalled),
    num(r.avgResponseMinutes), num(r.slaBreach),
    num(r.funnel?.QUALIFIED), num(r.funnel?.QUOTED),
    num(r.paidCustomers), pct(r.conversionRate),
    num(r.orders), rp(r.grossValue), rp(r.collectedValue), rp(r.aov),
    rp(r.target), num(r.percentToTarget, FMT.pct0),
    num(r.complaints), pct(r.complaintRate),
  ]));

  const t = report?.total;
  if (t) {
    sb.row([
      "TOTAL TIM",
      num(t.handled), num(t.replied), num(t.stalled),
      "—", num(t.slaBreach), "—", "—",
      num(t.paidCustomers), pct(t.conversionRate),
      num(t.orders), rp(t.grossValue), rp(t.collectedValue), rp(t.aov),
      rp(t.target), num(t.percentToTarget, FMT.pct0),
      num(t.complaints), "—",
    ]);
    // Rata-rata respons & konversi per-tahap TIDAK dijumlahkan/dirata-ratakan
    // di baris total: merata-ratakan rata-rata tanpa bobot jumlah percakapan
    // menghasilkan angka yang salah. Sengaja "—".
  }

  const ws = sb.build([16, 20, 10, 13, 17, 12, 11, 10, 16, 11, 8, 18, 16, 14, 16, 10, 10, 12]);
  // Autofilter di baris header tabel — ini SATU-SATUNYA bantuan navigasi yang
  // benar-benar bertahan di community edition (freeze pane tidak).
  const headRow = sb.aoa.findIndex((r) => r[0] === "Sales");
  if (headRow >= 0) {
    const lastCol = XLSX.utils.encode_col(HEAD.length - 1);
    ws["!autofilter"] = { ref: `A${headRow + 1}:${lastCol}${sb.aoa.length}` };
  }
  return ws;
}

// ── Sheet 5: Kota ─────────────────────────────────────────────────────────
function sheetKota({ periode, summary }) {
  const sb = new SheetBuilder();
  judul(sb, "SEBARAN KOTA", periode);
  const kota = summary?.topCities || [];
  const total = kota.reduce((s, k) => s + k.count, 0);
  sb.row(["Kota", "Pelanggan", "% dari Total"]);
  kota.forEach((r) => sb.row([
    r.city, num(r.count),
    num(total > 0 ? Math.round((r.count / total) * 1000) / 10 : null, FMT.pct),
  ]));
  sb.blank();
  sb.row(["Catatan: hanya 8 kota teratas. Pelanggan tanpa data kota masuk baris \"Belum diisi\"."]);
  return sb.build([24, 14, 16]);
}

/**
 * Export seluruh Laporan jadi SATU file .xlsx multi-sheet.
 * Sheet yang datanya belum ada dilewati (bukan sheet kosong yang membingungkan).
 */
export function exportLaporanWorkbook({ periode, namaFile, summary, overview, perf, funnel, velocity, salesReport }) {
  const wb = XLSX.utils.book_new();

  const sheets = [
    ["Ringkasan", summary && sheetRingkasan({ periode, summary, perf })],
    ["Penjualan", summary && sheetPenjualan({ periode, summary })],
    ["Pipeline",  (funnel?.length || velocity) && sheetPipeline({ periode, funnel, velocity })],
    ["Sales",     salesReport?.rows?.length && sheetSales({ periode, report: salesReport })],
    ["Kota",      summary?.topCities?.length && sheetKota({ periode, summary })],
  ];

  let ada = 0;
  for (const [nama, ws] of sheets) {
    if (ws) { XLSX.utils.book_append_sheet(wb, ws, nama); ada++; }
  }
  if (ada === 0) throw new Error("Belum ada data untuk diexport pada periode ini.");

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${namaFile}.xlsx`
  );
}
