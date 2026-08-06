import * as XLSX from "xlsx";
import { saveAs } from "file-saver";
import { STAGE_LABELS, ORDER_STATUS_LABELS, SOURCE_LABELS } from "./format.js";

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

  // Aging piutang — "Belum lunas" di atas satu angka gabungan; umur menunggak
  // dihitung dari tanggal order sampai SEKARANG (tidak ikut rentang laporan).
  const aging = u.outstandingAging || [];
  if (aging.length) {
    sb.row(["UMUR PIUTANG (belum lunas)", "", ""]);
    sb.row(["Umur", "Jumlah Order", "Nilai"]);
    aging.forEach((a) => sb.row([a.label, num(a.count), rp(a.value)]));
    sb.blank();
  }

  sb.row(["KONVERSI", "", ""]);
  sb.row(["Metrik", "Nilai", "Catatan"]);
  sb.rows([
    ["Pelanggan baru",       num(k.totalCustomers), "Dibuat pada periode ini"],
    ["Pernah order",         num(k.customersWithOrders), ""],
    ["% pernah order",       pct(k.orderRate), ""],
    ["Sampai tahap bayar",   num(k.paidCustomers), "Pipeline stage Paid / Already Reviewed"],
    ["% sampai bayar",       pct(k.paidRate), "Ini conversion rate penjualan yang sebenarnya"],
    ["Order lebih dari sekali", num(k.repeatCustomers), "Pelanggan dengan >= 2 order (CANCELLED tidak dihitung)"],
    ["% repeat order",       pct(k.repeatRate), "Dari pelanggan yang PERNAH order, berapa yang balik lagi"],
    ["Total percakapan",     num(perf?.totalConversations), "Grup WA internal tidak dihitung"],
    ["Rata-rata respons",    num(perf?.avgResponseMinutes, FMT.menit), "Pesan pertama customer → balasan pertama"],
    ["Jumlah komplain",      num(summary?.komplain?.count), ""],
    ["% komplain",           pct(summary?.komplain?.rate), "Dari jumlah order"],
  ]);
  sb.blank();

  sb.row(["INTEGRITAS DATA", "", ""]);
  sb.row(["Pemeriksaan", "Jumlah", "Artinya"]);
  sb.row([
    "Pelanggan Paid tanpa order",
    num(summary?.integritas?.paidTanpaOrder),
    "Ditandai sudah bayar tapi tidak ada order — pendapatannya belum tercatat",
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
  sb.row(["Atribusi: percakapan yang SEKARANG di-assign ke sales (Conversation.assignedToId)"]);
  sb.row(["\"Ditangani Sendiri\" = klaim pertama sejak awal; \"Warisan Takeover\" = pindah dari sales lain lewat Ambil/Ambil Alih — dipisah supaya beban kerja tidak salah atribusi (lihat backend routes/analytics.js)"]);
  if (report?.periodeTarget) {
    sb.row([`Kolom target memakai target bulan ${report.periodeTarget.month}/${report.periodeTarget.year}`]);
  }
  sb.blank();

  const HEAD = [
    "Sales", "Ditangani Sendiri", "Warisan Takeover", "Dibalas", "Menggantung", "Avg Respons (mnt)",
    "SLA >60mnt", "Qualified (kini)", "Quoted (kini)", "Pelanggan Order", "Konversi %",
    "Pindah ke Paid", "Order", "Nilai Penjualan", "Sudah Lunas", "AOV", "Target", "% Target",
    "Komplain", "% Komplain",
  ];
  sb.row(HEAD);

  (report?.rows || []).forEach((r) => sb.row([
    r.name,
    num(r.handledOwn), num(r.handledTakeover), num(r.replied), num(r.stalled),
    num(r.avgResponseMinutes), num(r.slaBreach),
    num(r.funnel?.QUALIFIED), num(r.funnel?.QUOTED),
    num(r.orderingCustomers), pct(r.orderConversionRate),
    num(r.paidCustomers),
    num(r.orders), rp(r.grossValue), rp(r.collectedValue), rp(r.aov),
    rp(r.target), num(r.percentToTarget, FMT.pct0),
    num(r.complaints), pct(r.complaintRate),
  ]));

  const t = report?.total;
  if (t) {
    sb.row([
      "TOTAL TIM",
      num(t.handledOwn), num(t.handledTakeover), num(t.replied), num(t.stalled),
      "—", num(t.slaBreach), "—", "—",
      num(t.orderingCustomers), pct(t.orderConversionRate),
      num(t.paidCustomers),
      num(t.orders), rp(t.grossValue), rp(t.collectedValue), rp(t.aov),
      rp(t.target), num(t.percentToTarget, FMT.pct0),
      num(t.complaints), "—",
    ]);
    // Rata-rata respons & konversi per-tahap TIDAK dijumlahkan/dirata-ratakan
    // di baris total: merata-ratakan rata-rata tanpa bobot jumlah percakapan
    // menghasilkan angka yang salah. Sengaja "—".
  }

  const ws = sb.build([16, 16, 16, 10, 13, 17, 12, 16, 15, 16, 11, 15, 8, 18, 16, 14, 16, 10, 10, 12]);
  // Autofilter di baris header tabel — ini SATU-SATUNYA bantuan navigasi yang
  // benar-benar bertahan di community edition (freeze pane tidak).
  const headRow = sb.aoa.findIndex((r) => r[0] === "Sales");
  if (headRow >= 0) {
    const lastCol = XLSX.utils.encode_col(HEAD.length - 1);
    ws["!autofilter"] = { ref: `A${headRow + 1}:${lastCol}${sb.aoa.length}` };
  }
  return ws;
}

// ── Sheet: Traffic Lead ───────────────────────────────────────────────────
// Isi tab Traffic seutuhnya: deret harian + baseline/status spike, agregat
// per jam, DUA matriks heatmap 7×24 (volume & respons), dan sumber lead.
// Matriks ditulis sebagai tabel Hari×Jam supaya bisa langsung di-conditional-
// format sendiri di Excel — itu bentuk paling berguna, bukan daftar 168 baris.
const HARI_EXCEL = ["Minggu", "Senin", "Selasa", "Rabu", "Kamis", "Jumat", "Sabtu"];
const STATUS_LABEL = { spike: "SPIKE", drop: "DROP", normal: "Normal" };

function sheetTraffic({ periode, traffic }) {
  const sb = new SheetBuilder();
  judul(sb, "TRAFFIC LEAD", periode);

  sb.row(["Total lead masuk", num(traffic.totalLeads)]);
  sb.row(["Periode sebelumnya", num(traffic.prevTotalLeads)]);
  sb.row(["Pertumbuhan", traffic.growthPct != null ? num(traffic.growthPct, FMT.pct0) : "—"]);
  sb.row(["Lead teridentifikasi sumbernya", num(traffic.atribusi?.teridentifikasi),
    traffic.atribusi?.rate != null ? num(traffic.atribusi.rate, FMT.pct) : "—"]);
  sb.blank();
  sb.row(["CATATAN: 1 lead = 1 nomor WA unik yang pertama kali chat (dibuat otomatis dari webhook)."]);
  sb.row(["Termasuk salah sambung/spam — belum ada mekanisme menandai lead sampah."]);
  sb.blank();

  // ── Deret harian ──
  sb.row(["DERET HARIAN & DETEKSI ANOMALI"]);
  sb.row(["Status dihitung dari rata-rata bergerak 7 hari SEBELUMNYA ± 2 standar deviasi."]);
  sb.row(["Tanggal", "Lead", "Normal (rata2)", "Batas Bawah", "Batas Atas", "Status", "Selisih vs Normal"]);
  (traffic.daily || []).forEach((d) => sb.row([
    d.bucket, num(d.value), num(d.baseline), num(d.lower), num(d.upper),
    d.partial ? "Hari berjalan" : (STATUS_LABEL[d.status] || d.status),
    d.deltaPct != null ? num(d.deltaPct, FMT.pct0) : "—",
  ]));
  sb.blank();

  // ── Per jam ──
  sb.row(["AGREGAT PER JAM (WIB, lintas semua hari)"]);
  sb.row(["Jam", "Lead Masuk", "Percakapan Dibalas", "Rata-rata Respons", "Lewat SLA 60mnt"]);
  (traffic.hourly || []).forEach((h) => sb.row([
    `${String(h.jam).padStart(2, "0")}:00`,
    num(h.leads), num(h.responded), num(h.avgMinutes, FMT.menit), num(h.slaBreach),
  ]));
  sb.blank();

  // ── Heatmap: matriks Hari × Jam ──
  const cell = {};
  for (const c of traffic.heatmap || []) cell[`${c.dow}-${c.jam}`] = c;
  const headerJam = ["Hari \\ Jam", ...Array.from({ length: 24 }, (_, j) => `${String(j).padStart(2, "0")}:00`)];

  sb.row(["MATRIKS VOLUME LEAD (Hari × Jam)"]);
  sb.row(headerJam);
  HARI_EXCEL.forEach((nama, dow) => sb.row([
    nama, ...Array.from({ length: 24 }, (_, j) => num(cell[`${dow}-${j}`]?.leads || 0)),
  ]));
  sb.blank();

  sb.row(["MATRIKS RATA-RATA WAKTU RESPONS, MENIT (Hari × Jam)"]);
  sb.row(["Kosong = tidak ada percakapan yang dibalas di slot itu."]);
  sb.row(headerJam);
  HARI_EXCEL.forEach((nama, dow) => sb.row([
    nama, ...Array.from({ length: 24 }, (_, j) => num(cell[`${dow}-${j}`]?.avgMinutes ?? null, FMT.menit)),
  ]));
  sb.blank();

  // ── Sumber lead ──
  sb.row(["SUMBER LEAD"]);
  sb.row(["Sumber", "Jumlah", "% dari Total"]);
  const totalSrc = traffic.atribusi?.total || 0;
  [...(traffic.atribusi?.bySource || [])].sort((a, b) => b.count - a.count).forEach((s) => sb.row([
    SOURCE_LABELS[s.source] || s.source, num(s.count),
    num(totalSrc > 0 ? Math.round((s.count / totalSrc) * 1000) / 10 : null, FMT.pct),
  ]));
  sb.blank();
  sb.row(["PERINGATAN AKURASI: mayoritas lead tercatat \"WhatsApp Langsung\" karena sistem"]);
  sb.row(["tidak bisa mendeteksi asalnya — BUKAN berarti semua lead organik. Untuk data"]);
  sb.row(["sumber yang bisa dipercaya, pakai Link Pelacakan (1 link per campaign)."]);

  return sb.build([16, ...Array.from({ length: 24 }, () => 9)]);
}

// ── Sheet: Percakapan ─────────────────────────────────────────────────────
function sheetPercakapan({ periode, perf, overview }) {
  const sb = new SheetBuilder();
  judul(sb, "PERCAKAPAN", periode);

  sb.row(["Metrik", "Nilai", "Catatan"]);
  sb.row(["Total percakapan", num(perf?.totalConversations), "Hanya chat individual — grup WA internal tidak dihitung"]);
  sb.row(["Terbuka", num(perf?.openCount), ""]);
  sb.row(["Selesai (RESOLVED)", num(perf?.resolvedCount), ""]);
  sb.row(["Closing rate", num(perf?.closingRate, FMT.pct0), "% percakapan berstatus Selesai — metrik kebersihan inbox, BUKAN penjualan"]);
  sb.row(["Rata-rata waktu respons pertama", num(perf?.avgResponseMinutes, FMT.menit), "Jeda pesan pertama customer → balasan pertama"]);
  sb.blank();

  const channel = overview?.channelBreakdown || [];
  if (channel.length) {
    const totalCh = channel.reduce((s, c) => s + c.count, 0);
    sb.row(["BREAKDOWN CHANNEL"]);
    sb.row(["Channel", "Percakapan", "% dari Total"]);
    channel.forEach((c) => sb.row([
      c.channel, num(c.count),
      num(totalCh > 0 ? Math.round((c.count / totalCh) * 1000) / 10 : null, FMT.pct),
    ]));
    sb.blank();
  }

  const tren = perf?.monthlyResponseTime || [];
  if (tren.length) {
    sb.row(["TREN WAKTU RESPONS BULANAN"]);
    sb.row(["Bulan", "Rata-rata Respons"]);
    tren.forEach((t) => sb.row([t.month, num(t.avgMinutes ?? t.avg_minutes, FMT.menit)]));
  }

  return sb.build([34, 18, 62]);
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

// Sheet apa yang ikut untuk TIAP TAB. Kunci = nama tab di pages/Laporan.jsx.
//
// BUG YANG DIPERBAIKI (6 Agustus 2026): dulu tombol Export SELALU menulis
// seluruh sheet (Ringkasan+Penjualan+Pipeline+Sales+Kota) apa pun tab yang
// sedang dibuka — jadi export dari tab Traffic menghasilkan file yang TIDAK
// berisi data traffic sama sekali (sheet-nya memang belum pernah ada), dan
// export dari tab mana pun terlihat sama persis. Sekarang tiap tab punya
// isi sendiri yang cocok dengan yang dilihat user di layar.
const SHEET_PER_TAB = {
  Ringkasan: (d) => [
    ["Ringkasan", d.summary && sheetRingkasan(d)],
    ["Kota",      d.summary?.topCities?.length && sheetKota(d)],
  ],
  Traffic:   (d) => [["Traffic",    d.traffic && sheetTraffic(d)]],
  Percakapan:(d) => [["Percakapan", d.perf && sheetPercakapan(d)]],
  Penjualan: (d) => [["Penjualan",  d.summary && sheetPenjualan(d)]],
  Pipeline:  (d) => [["Pipeline",   (d.funnel?.length || d.velocity) && sheetPipeline(d)]],
  Sales:     (d) => [["Sales",      d.salesReport?.rows?.length && sheetSales({ ...d, report: d.salesReport })]],
};

/**
 * Export tab AKTIF jadi file .xlsx. `tab` = nama tab (lihat SHEET_PER_TAB);
 * kalau tidak dikenali, jatuh ke workbook lengkap semua tab (perilaku lama).
 */
export function exportLaporanWorkbook({
  periode, namaFile, tab,
  summary, overview, perf, funnel, velocity, salesReport, traffic,
}) {
  const data = { periode, summary, overview, perf, funnel, velocity, salesReport, traffic };
  const wb = XLSX.utils.book_new();

  const builder = SHEET_PER_TAB[tab];
  const sheets = builder
    ? builder(data)
    : Object.values(SHEET_PER_TAB).flatMap((fn) => fn(data));

  let ada = 0;
  for (const [nama, ws] of sheets) {
    if (ws) { XLSX.utils.book_append_sheet(wb, ws, nama); ada++; }
  }
  if (ada === 0) {
    throw new Error(`Belum ada data ${tab ? `untuk tab "${tab}" ` : ""}pada periode ini.`);
  }

  const buf = XLSX.write(wb, { bookType: "xlsx", type: "array" });
  saveAs(
    new Blob([buf], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    `${namaFile}.xlsx`
  );
}
