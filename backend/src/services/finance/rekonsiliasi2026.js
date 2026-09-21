// REKONSILIASI PENDAPATAN 2026 — audit backfill order sistem (12 Jul → sebelum pengakuan pertama di buku) + laporan bulanan + proposal jurnal.
//
// BACA-SAJA. Modul ini TIDAK mengimpor postJournal / posting apa pun dan tidak menulis ke database. Semua keluaran adalah USULAN (JSON).
// Posting hanya boleh dijalankan setelah Owner meninjau laporan dan memberi persetujuan eksplisit (skrip terpisah, belum ada).
//
// Prinsip pengakuan (sama dengan mesin posting yang sudah ada, services/finance/posting/orderRevenue.js):
//  • Pendapatan diakui bila barang/jasa SELESAI atau DISERAHTERIMAKAN (STATUS_PENGAKUAN) — bukan saat order dibuat.
//  • Tanggal pengakuan = tanggal penyelesaian pengiriman yang TERBUKTI (Job DELIVERY berstatus COMPLETED). Tanggal pembuatan order TIDAK dipakai.
//    Order berstatus selesai tetapi tanpa bukti tanggal → PERLU DITINJAU (tidak diusulkan).
//  • Order batal, belum selesai (berjalan), refund, nilai nol, atau tidak cukup bukti TIDAK diakui.
//  • Akun pendapatan menurut jenis order (revenueSystemKeyForOrder: LAYANAN→4-1100, BARU→4-1200, SEWA→4-1300; ongkir→4-1900). Bukan default satu akun.
//  • Kunci idempotensi = kunci mesin posting yang sama (`PENGAKUAN_PENDAPATAN:<orderId>`): pengakuan yang sudah ada tidak mungkin digandakan.
//  • Kas & Bank TIDAK disentuh (sudah dikalibrasi ke saldo riil). Bagian yang sudah dibayar sebelum sistem dicatat = lawan ekuitas non-kas (3-4100), bukan piutang.

import { toMoney, sumMoney, ZERO } from "./money.js";
import { STATUS_DIHITUNG } from "./journal.js";
import { revenueSystemKeyForOrder, SYSTEM_KEYS } from "./accounts.js";
// Sama dengan STATUS_PENGAKUAN di posting/orderRevenue.js (dijaga tes) — disalin agar modul ini tidak mengimpor kode posting.
const STATUS_PENGAKUAN = Object.freeze(["DELIVERED", "SEWA_DIKIRIM", "SEWA_DIAMBIL"]);
import { hitungCutoff, rekonsiliasiLegacy } from "./legacyPendapatan.js";

const uang = (v) => toMoney(v ?? 0).toFixed(2);
const wibTanggal = (d) => new Date(new Date(d).getTime() + 7 * 3600 * 1000).toISOString().slice(0, 10);
const STATUS_BERJALAN = ["PENDING", "PICKUP", "PROCESSING", "READY", "SHIPPING"];
const KODE_AKUN = { PENDAPATAN_LAYANAN: "4-1100", PENDAPATAN_PRODUK: "4-1200", PENDAPATAN_SEWA: "4-1300", PENDAPATAN_ONGKIR: "4-1900" };
const KELAS = ["LAYAK", "PERLU_DITINJAU_TANPA_TANGGAL", "BERJALAN", "BATAL", "REFUND", "TIDAK_CUKUP_DATA", "SUDAH_DIAKUI"];
export const LABEL_KELAS = {
  LAYAK: "Selesai/diserahterimakan, tanggal terbukti — layak diakui",
  PERLU_DITINJAU_TANPA_TANGGAL: "Berstatus selesai, tetapi tidak ada bukti tanggal penyelesaian — Perlu Ditinjau",
  BERJALAN: "Masih berjalan — belum diakui",
  BATAL: "Dibatalkan — tidak diakui",
  REFUND: "Ada refund aktif — tidak diusulkan",
  TIDAK_CUKUP_DATA: "Tidak cukup data (nilai nol / status tak dikenal) — tidak diakui",
  SUDAH_DIAKUI: "Sudah ada pengakuan di buku besar",
};

/** Klasifikasi SATU order (murni; diuji langsung). */
export function klasifikasiOrder(o) {
  const total = toMoney(o.value ?? 0).plus(toMoney(o.ongkir ?? 0));
  const selesaiDikirim = (o.jobs ?? []).filter((j) => j.type === "DELIVERY" && j.status === "COMPLETED" && j.completedAt).map((j) => wibTanggal(j.completedAt)).sort();
  const tanggalSelesai = selesaiDikirim[0] ?? null; // pengiriman PERTAMA = serah-terima; pengiriman ulang (komplain) tidak menggeser pengakuan
  const catatan = [];
  if (selesaiDikirim.length > 1) catatan.push(`Ada ${selesaiDikirim.length} pengiriman selesai; tanggal serah-terima memakai yang pertama (${tanggalSelesai})`);
  if (o.hasComplaint && !o.complaintResolvedAt) catatan.push("Komplain belum tuntas — pendapatan tetap layak, tetapi periksa kemungkinan retur/revisi");
  let kelas;
  if (o.status === "CANCELLED") kelas = "BATAL";
  else if ((o.refunds ?? []).some((r) => !["DITOLAK", "DIBATALKAN"].includes(r.status))) kelas = "REFUND";
  else if (o.sudahDiakui) { kelas = "SUDAH_DIAKUI"; if (STATUS_BERJALAN.includes(o.status)) catatan.push(`Sudah diakui padahal status order masih ${o.status} — anomali, tinjau (bukan bagian usulan)`); }
  else if (total.lessThanOrEqualTo(ZERO)) kelas = "TIDAK_CUKUP_DATA";
  else if (STATUS_PENGAKUAN.includes(o.status)) kelas = tanggalSelesai ? "LAYAK" : "PERLU_DITINJAU_TANPA_TANGGAL";
  else if (STATUS_BERJALAN.includes(o.status)) kelas = "BERJALAN";
  else kelas = "TIDAK_CUKUP_DATA";
  return { kelas, tanggalPengakuan: kelas === "LAYAK" ? tanggalSelesai : null, total, catatan };
}

/** Baris jurnal usulan untuk order LAYAK (murni). uangMukaLedger = saldo Uang Muka Pelanggan (2-1200) per order di buku besar. */
export function barisUsulan(o, { uangMukaLedger = ZERO } = {}) {
  const layanan = toMoney(o.value ?? 0);
  const ongkir = toMoney(o.ongkir ?? 0);
  const total = layanan.plus(ongkir);
  const akun = KODE_AKUN[revenueSystemKeyForOrder(o)];
  const lines = [{ akun, debit: "0.00", kredit: uang(layanan), ket: `Pendapatan ${o.orderNumber}` }];
  if (ongkir.greaterThan(ZERO)) lines.push({ akun: KODE_AKUN.PENDAPATAN_ONGKIR, debit: "0.00", kredit: uang(ongkir), ket: `Ongkos kirim ${o.orderNumber}` });
  const dp = uangMukaLedger.greaterThan(total) ? total : uangMukaLedger;
  let sisa = total.minus(dp);
  const peringatan = [];
  if (dp.greaterThan(ZERO)) lines.push({ akun: "2-1200", debit: uang(dp), kredit: "0.00", ket: "Uang muka pelanggan yang SUDAH dijurnal dipindahkan (bukan kas baru)" });
  let mode = "STANDAR";
  if (sisa.greaterThan(ZERO) && o.paymentStatus === "LUNAS") {
    // Ditandai LUNAS (dropdown) tetapi tidak ada Payment yang dijurnal: uang diterima SEBELUM pencatatan pembayaran di sistem → kas sudah tercermin dalam kalibrasi saldo.
    lines.push({ akun: "3-4100", debit: uang(sisa), kredit: "0.00", ket: "ASUMSI: order berstatus LUNAS tanpa catatan pembayaran → uang sudah tercermin dalam kalibrasi saldo (lawan ekuitas non-kas)" });
    peringatan.push("LUNAS tanpa catatan pembayaran: dibukukan ke ekuitas non-kas, butuh persetujuan Owner");
    mode = "MIGRASI_LUNAS_TANPA_PEMBAYARAN";
    sisa = ZERO;
  }
  if (sisa.greaterThan(ZERO)) {
    lines.push({ akun: "1-1300", debit: uang(sisa), kredit: "0.00", ket: "Piutang usaha (belum ada pembayaran tercatat)" });
    if (o.paymentStatus === "DP") peringatan.push("Berstatus DP tetapi tidak ada pembayaran tercatat — nominal DP tidak diketahui; seluruh sisa dijadikan piutang");
  }
  return { mode, lines, total: uang(total), peringatan };
}

/** Kumpulkan & klasifikasi seluruh order pada jendela [cutoff, pengakuan pertama). */
export async function auditBackfill(db) {
  const c = await hitungCutoff(db);
  if (!c.tanggal) return { jendela: null, orders: [], ringkasan: null };
  const sampai = c.pengakuanPertama ?? wibTanggal(new Date());
  const orders = await db.order.findMany({
    where: { createdAt: { gte: new Date(`${c.tanggal}T00:00:00+07:00`), lt: new Date(`${sampai}T00:00:00+07:00`) } },
    select: { id: true, orderNumber: true, createdAt: true, status: true, category: true, value: true, ongkir: true, paymentStatus: true, hasComplaint: true, complaintResolvedAt: true, customer: { select: { name: true } } },
    orderBy: { createdAt: "asc" },
  });
  const ids = orders.map((o) => o.id);
  const [jobs, refunds, diakui, akunUM] = await Promise.all([
    db.job.findMany({ where: { orderId: { in: ids }, type: "DELIVERY" }, select: { orderId: true, type: true, status: true, completedAt: true } }),
    db.finRefund.findMany({ where: { orderId: { in: ids } }, select: { orderId: true, status: true } }),
    db.finJournalEntry.findMany({ where: { source: "PENGAKUAN_PENDAPATAN", status: { in: STATUS_DIHITUNG }, sourceId: { in: ids } }, select: { sourceId: true, entryNumber: true } }),
    db.finAccount.findFirst({ where: { systemKey: SYSTEM_KEYS.UANG_MUKA_PELANGGAN }, select: { id: true } }),
  ]);
  const um = new Map();
  if (akunUM) {
    const ls = await db.finJournalLine.findMany({ where: { accountId: akunUM.id, orderId: { in: ids }, entry: { status: { in: STATUS_DIHITUNG } } }, select: { orderId: true, debit: true, credit: true } });
    for (const l of ls) um.set(l.orderId, (um.get(l.orderId) ?? ZERO).plus(toMoney(l.credit)).minus(toMoney(l.debit)));
  }
  const per = (arr) => { const m = new Map(); for (const x of arr) (m.get(x.orderId) ?? m.set(x.orderId, []).get(x.orderId)).push(x); return m; };
  const jm = per(jobs); const rm = per(refunds); const dm = new Map(diakui.map((d) => [d.sourceId, d.entryNumber]));
  const hasil = orders.map((o) => {
    const k = klasifikasiOrder({ ...o, jobs: jm.get(o.id) ?? [], refunds: rm.get(o.id) ?? [], sudahDiakui: dm.has(o.id) });
    const baris = { id: o.id, nomor: o.orderNumber, pelanggan: o.customer?.name ?? null, dibuat: wibTanggal(o.createdAt), status: o.status, kategori: o.category, bayar: o.paymentStatus, nilai: uang(k.total), kelas: k.kelas, tanggalPengakuan: k.tanggalPengakuan, catatan: k.catatan, jurnalPengakuan: dm.get(o.id) ?? null };
    if (k.kelas === "LAYAK") baris.usulan = barisUsulan(o, { uangMukaLedger: um.get(o.id) ?? ZERO });
    return baris;
  });
  return { jendela: { dari: c.tanggal, sampai, dasar: c.dasar }, orders: hasil };
}

const agregat = (rs) => ({ jumlah: rs.length, nilai: uang(rs.length ? sumMoney(rs.map((r) => r.nilai)) : ZERO) });

/** Ringkasan per kelas & per bulan (bulan = bulan TANGGAL PENGAKUAN untuk yang layak; bulan pembuatan untuk kelas lain). */
export async function laporanBackfill(db) {
  const a = await auditBackfill(db);
  if (!a.jendela) return { jendela: null, kelas: [], perBulan: [], simulasi: null };
  const nonBatal = a.orders.filter((o) => o.kelas !== "BATAL");
  const kelas = KELAS.map((k) => ({ kelas: k, label: LABEL_KELAS[k], ...agregat(a.orders.filter((o) => o.kelas === k)) }));
  const bulan = (o) => (o.kelas === "LAYAK" ? o.tanggalPengakuan : o.dibuat).slice(0, 7);
  const bulanBulan = [...new Set(a.orders.map(bulan))].sort();
  const perBulan = bulanBulan.map((b) => {
    const rs = a.orders.filter((o) => bulan(o) === b);
    const layak = rs.filter((o) => o.kelas === "LAYAK");
    const akun = {}; let dr13 = ZERO; let dr21 = ZERO; let dr34 = ZERO;
    for (const o of layak) for (const l of o.usulan.lines) {
      if (toMoney(l.kredit).greaterThan(ZERO)) akun[l.akun] = (akun[l.akun] ?? ZERO).plus(toMoney(l.kredit));
      if (l.akun === "1-1300") dr13 = dr13.plus(toMoney(l.debit));
      if (l.akun === "2-1200") dr21 = dr21.plus(toMoney(l.debit));
      if (l.akun === "3-4100") dr34 = dr34.plus(toMoney(l.debit));
    }
    const rev = layak.length ? sumMoney(Object.values(akun)) : ZERO;
    return {
      bulan: b,
      layakDiakui: { ...agregat(layak), pendapatanPerAkun: Object.fromEntries(Object.entries(akun).map(([k, v]) => [k, uang(v)])) },
      perluDitinjauTanpaTanggal: agregat(rs.filter((o) => o.kelas === "PERLU_DITINJAU_TANPA_TANGGAL")),
      berjalan: agregat(rs.filter((o) => o.kelas === "BERJALAN")), batal: agregat(rs.filter((o) => o.kelas === "BATAL")),
      refund: agregat(rs.filter((o) => o.kelas === "REFUND")), tidakCukupData: agregat(rs.filter((o) => o.kelas === "TIDAK_CUKUP_DATA")),
      sudahDiBukuBesar: { ...agregat(rs.filter((o) => o.kelas === "SUDAH_DIAKUI")) },
      simulasi: { labaRugi: { pendapatanBertambah: uang(rev) }, piutang: { bertambah: uang(dr13) }, uangMukaPelanggan: { berkurang: uang(dr21) }, ekuitas: { koreksiSaldoAwalBerkurang: uang(dr34), totalBerubah: uang(rev.minus(dr34)) }, kas: { berubah: "0.00" } },
    };
  });
  const simulasi = perBulan.reduce((s, b) => ({
    pendapatanBertambah: s.pendapatanBertambah.plus(b.simulasi.labaRugi.pendapatanBertambah), piutangBertambah: s.piutangBertambah.plus(b.simulasi.piutang.bertambah),
    uangMukaBerkurang: s.uangMukaBerkurang.plus(b.simulasi.uangMukaPelanggan.berkurang), koreksiBerkurang: s.koreksiBerkurang.plus(b.simulasi.ekuitas.koreksiSaldoAwalBerkurang),
  }), { pendapatanBertambah: ZERO, piutangBertambah: ZERO, uangMukaBerkurang: ZERO, koreksiBerkurang: ZERO });
  return {
    jendela: a.jendela, totalOrderJendela: a.orders.length, nonBatal: agregat(nonBatal), kelas, perBulan,
    simulasi: {
      catatan: "SIMULASI — tidak ada yang diposting. Hanya kelas LAYAK.",
      labaRugi: { pendapatanBertambah: uang(simulasi.pendapatanBertambah) }, piutang: { bertambah: uang(simulasi.piutangBertambah) }, uangMukaPelanggan: { berkurang: uang(simulasi.uangMukaBerkurang) },
      ekuitas: { koreksiSaldoAwalBerkurang: uang(simulasi.koreksiBerkurang), totalBerubah: uang(simulasi.pendapatanBertambah.minus(simulasi.koreksiBerkurang)) },
      kas: { berubah: "0.00", catatan: "Saldo Kas & Bank tidak berubah." },
    },
  };
}

/** PROPOSAL jurnal backfill — satu jurnal per order LAYAK, kunci idempoten = kunci mesin posting. JSON saja; TIDAK dijalankan. */
export async function proposalBackfill(db, { bulan = null } = {}) {
  const a = await auditBackfill(db);
  if (!a.jendela) return { status: "PROPOSAL — BELUM DIPOSTING", jurnal: [] };
  const layak = a.orders.filter((o) => o.kelas === "LAYAK" && (!bulan || o.tanggalPengakuan.startsWith(bulan)));
  const periodeTertutup = await db.finPeriod.findMany({ where: { status: { not: "OPEN" } }, select: { year: true, month: true, status: true } });
  const tertutup = new Set(periodeTertutup.map((p) => `${p.year}-${String(p.month).padStart(2, "0")}`));
  return {
    status: "PROPOSAL — BELUM DIPOSTING",
    persetujuan: "Butuh persetujuan eksplisit Owner. Tidak ada endpoint atau skrip posting yang dijalankan otomatis. Tidak menyentuh Kas & Bank, JV-19092026-372, JV-21092026-391, atau akun 2-1600.",
    prinsipIdempotensi: "idempotencyKey = PENGAKUAN_PENDAPATAN:<orderId> (kunci mesin posting yang sama) — pengakuan yang sudah ada tidak dapat digandakan; menjalankan ulang tidak membuat jurnal baru.",
    jendela: a.jendela, jumlahJurnal: layak.length,
    periodeTertutup: [...tertutup].sort(),
    jurnal: layak.map((o) => ({
      idempotencyKey: `PENGAKUAN_PENDAPATAN:${o.id}`, orderId: o.id, nomorOrder: o.nomor, pelanggan: o.pelanggan, tanggalBuku: o.tanggalPengakuan, dasarTanggal: "Job DELIVERY selesai (COMPLETED) — bukan tanggal order dibuat",
      mode: o.usulan.mode, total: o.usulan.total, peringatan: o.usulan.peringatan, periodeTertutup: tertutup.has(o.tanggalPengakuan.slice(0, 7)), lines: o.usulan.lines,
    })),
  };
}

/** Laporan bulanan gabungan: historis (Notion, non-posting) + order sistem layak + buku besar + pembayaran masuk. */
export async function laporanBulanan(db) {
  const [legacy, backfill] = await Promise.all([rekonsiliasiLegacy(db).catch(() => null), laporanBackfill(db)]);
  const bulanan = new Map();
  const ambil = (b) => bulanan.get(b) ?? bulanan.set(b, { bulan: b }).get(b);
  for (const b of legacy?.perBulan ?? []) Object.assign(ambil(b.bulan), { historis: { jumlah: b.jumlah, pendapatan: b.pendapatan, lunas: b.lunas, belumBayar: b.belumBayar, tidakDiketahui: b.tidakDiketahui, duplikat: b.duplikat, perluDitinjau: b.perluDitinjau, sudahDiBukuBesar: b.jurnalSaatIni, selisihTerhadapBukuBesar: b.selisihTerhadapJurnal } });
  for (const b of backfill.perBulan ?? []) Object.assign(ambil(b.bulan), { orderSistem: b });
  // Pembayaran masuk per bulan (jurnal PEMBAYARAN_ORDER, nilai kredit ke piutang/uang muka = uang diterima dari pelanggan; status pembayaran dihitung di modul pemasukan).
  const pay = await db.finJournalEntry.findMany({ where: { source: "PEMBAYARAN_ORDER", status: { in: STATUS_DIHITUNG }, reversalOfId: null }, select: { date: true, lines: { select: { debit: true, cashAccountId: true } } } });
  const masuk = new Map();
  for (const e of pay) { const b = new Date(e.date).toISOString().slice(0, 7); const v = sumMoney(e.lines.filter((l) => l.cashAccountId).map((l) => l.debit)); masuk.set(b, (masuk.get(b) ?? { n: 0, v: ZERO })); const m = masuk.get(b); m.n++; m.v = m.v.plus(v); }
  for (const [b, m] of masuk) Object.assign(ambil(b), { pembayaranMasukTerjurnal: { jumlah: m.n, nilai: uang(m.v) } });
  return { dibuat: new Date().toISOString(), status: "LAPORAN — TIDAK ADA POSTING", perBulan: [...bulanan.values()].sort((x, y) => x.bulan.localeCompare(y.bulan)), backfill: { jendela: backfill.jendela, kelas: backfill.kelas, simulasi: backfill.simulasi }, historis: legacy ? { total: legacy.total, simulasi: legacy.simulasi, cutoff: legacy.cutoff?.tanggal } : null };
}
