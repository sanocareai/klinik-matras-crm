// JADWAL & AGING UTANG SUPPLIER — SATU read-model untuk kartu ringkasan, tabel, detail, dan export Excel (angka tidak mungkin berbeda).
//
// Prinsip (jangan dilanggar):
//   • Aging dihitung dari TANGGAL JATUH TEMPO faktur — BUKAN dari tanggal barang datang dan bukan dari status barang.
//   • Tiga status DIPISAHKAN dan tidak saling menurunkan: status BARANG (penerimaan Gudang), status FAKTUR, status PEMBAYARAN.
//   • Yang masuk aging: faktur yang sudah masuk buku (DISETUJUI / DIBAYAR_SEBAGIAN / LUNAS). Faktur belum disetujui belum menjadi utang.
//   • Dibayar = alokasi pembayaran AKTIF (pembayaran yang dibatalkan lewat reversal tidak dihitung). Biaya transfer BUKAN pembayaran utang.
//   • Faktur tanpa tanggal jatuh tempo (data lama) TIDAK ditebak: kelompok sendiri "Tanggal jatuh tempo belum diisi".
//   • FAKTUR ATAS PO dengan dasar TANGGAL_TIBA (Okt 2026): satu faktur dapat mencakup beberapa penerimaan → satu BARIS per penerimaan (jatuh tempo masing-masing = tanggal tiba + termin).
//     Nilai faktur dibagi ke penerimaan menurut alokasi (Σ = nilai faktur), pembayaran diterapkan FIFO menurut jatuh tempo; jumlah faktur dihitung per billId unik — tidak ada hitung ganda.
//   • Murni baca: tidak ada tulis ke database.
import { toMoney, sumMoney, moneyToNumber, ZERO } from "./money.js";
import { todayBookDateWIB } from "./journal.js";
import { labelTermin } from "./termin.js";
import { DASAR_TANGGAL_TIBA, jadwalDariFaktur } from "./jadwalJatuhTempo.js";

export const STATUS_FAKTUR_AGING = ["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"];
export const KELOMPOK_AGING = Object.freeze([
  { kunci: "TERLAMBAT", label: "Terlambat" },
  { kunci: "HARI_INI", label: "Jatuh tempo hari ini" },
  { kunci: "H1_7", label: "1–7 hari" },
  { kunci: "H8_14", label: "8–14 hari" },
  { kunci: "H15_30", label: "15–30 hari" },
  { kunci: "LEBIH_30", label: "Lebih dari 30 hari" },
  { kunci: "TANPA_JATUH_TEMPO", label: "Tanggal jatuh tempo belum diisi" },
  { kunci: "LUNAS", label: "Lunas" },
]);
export const KELOMPOK_FILTER = Object.freeze([...KELOMPOK_AGING.map((k) => k.kunci), "DIBAYAR_SEBAGIAN", "AKTIF"]);

export const LABEL_STATUS_BARANG = { BELUM_DATANG: "Belum Datang", DITERIMA_SEBAGIAN: "Diterima Sebagian", SIAP_DISIMPAN: "Siap Disimpan", SUDAH_MASUK_STOK: "Sudah Masuk Stok", SELESAI: "Selesai" };
export const LABEL_STATUS_FAKTUR = { BELUM_ADA_FAKTUR: "Belum Ada Faktur", FAKTUR_DITERIMA: "Faktur Diterima", PERLU_DITINJAU: "Perlu Ditinjau", DISETUJUI: "Disetujui", DIBATALKAN: "Dibatalkan" };
export const LABEL_STATUS_PEMBAYARAN = {
  BELUM_JATUH_TEMPO: "Belum Jatuh Tempo", JATUH_TEMPO_7_HARI: "Jatuh Tempo ≤7 Hari", JATUH_TEMPO_HARI_INI: "Jatuh Tempo Hari Ini", TERLAMBAT: "Terlambat",
  DIBAYAR_SEBAGIAN: "Dibayar Sebagian", LUNAS: "Lunas", TANPA_JATUH_TEMPO: "Tanggal Jatuh Tempo Belum Diisi",
};

const d = (v) => toMoney(v ?? 0);
const MS_HARI = 86_400_000;
const hariKunci = (x) => (x ? new Date(x).toISOString().slice(0, 10) : null);
const selisihHari = (a, b) => Math.round((new Date(`${hariKunci(a)}T00:00:00Z`) - new Date(`${hariKunci(b)}T00:00:00Z`)) / MS_HARI);

/** Status FAKTUR dari data faktur (terpisah dari barang dan pembayaran). */
export function statusFaktur(bill) {
  if (["DIBATALKAN", "DITOLAK"].includes(bill.status)) return "DIBATALKAN";
  if (["DISETUJUI", "DIBAYAR_SEBAGIAN", "LUNAS"].includes(bill.status)) return "DISETUJUI";
  const adaSelisihHarga = (bill.poLines ?? []).some((l) => !toMoney(l.invoiceUnitPrice).equals(toMoney(l.poUnitPrice)));
  return adaSelisihHarga && !bill.poReviewNote ? "PERLU_DITINJAU" : "FAKTUR_DITERIMA";
}

/** Status BARANG dari penerimaan terkait (PO atau penerimaan tertaut). null = tagihan non-barang (jasa dsb.). */
export function statusBarang({ po, penerimaan }) {
  const aktif = (penerimaan ?? []).filter((r) => r.status !== "REJECTED");
  if (!po && aktif.length === 0 && !(penerimaan ?? []).length) return null;
  const selesai = aktif.filter((r) => r.status === "COMPLETED");
  const siap = aktif.filter((r) => r.status === "READY_FOR_PUTAWAY");
  const berjalan = aktif.filter((r) => ["SCHEDULED", "ARRIVED", "INSPECTION"].includes(r.status) && r.sudahDatang);
  if (po?.status === "SELESAI") return "SELESAI";
  if (selesai.length > 0) return siap.length + berjalan.length > 0 ? "DITERIMA_SEBAGIAN" : "SUDAH_MASUK_STOK";
  if (siap.length > 0) return "SIAP_DISIMPAN";
  if (berjalan.length > 0) return "DITERIMA_SEBAGIAN";
  return "BELUM_DATANG";
}

/**
 * Kelompok aging satu faktur terhadap `hariIni` (tanggal WIB). Faktur lunas → LUNAS. Sisa > 0 dan tanpa jatuh tempo → TANPA_JATUH_TEMPO.
 * Selain itu menurut selisih hari ke jatuh tempo.
 */
export function kelompokAging({ dueDate, sisa, hariIni }) {
  if (!sisa.greaterThan(0)) return "LUNAS";
  if (!dueDate) return "TANPA_JATUH_TEMPO";
  const k = selisihHari(dueDate, hariIni);
  if (k < 0) return "TERLAMBAT";
  if (k === 0) return "HARI_INI";
  if (k <= 7) return "H1_7";
  if (k <= 14) return "H8_14";
  if (k <= 30) return "H15_30";
  return "LEBIH_30";
}

/** Status PEMBAYARAN tunggal. Dibayar sebagian yang sudah lewat/jatuh tempo hari ini tetap TERLAMBAT/HARI_INI (urgensi menang); bendera `dibayarSebagian` selalu ada. */
export function statusPembayaran({ kelompok, dibayarSebagian }) {
  if (kelompok === "LUNAS") return "LUNAS";
  if (kelompok === "TANPA_JATUH_TEMPO") return dibayarSebagian ? "DIBAYAR_SEBAGIAN" : "TANPA_JATUH_TEMPO";
  if (kelompok === "TERLAMBAT") return "TERLAMBAT";
  if (kelompok === "HARI_INI") return "JATUH_TEMPO_HARI_INI";
  if (dibayarSebagian) return "DIBAYAR_SEBAGIAN";
  return kelompok === "H1_7" ? "JATUH_TEMPO_7_HARI" : "BELUM_JATUH_TEMPO";
}

/** Warna indikator aplikasi: merah terlambat, jingga ≤7 hari (termasuk hari ini), biru 8–30 hari, netral >30/tanpa tanggal, hijau lunas. */
export function nadaIndikator(kelompok) {
  if (kelompok === "TERLAMBAT") return "merah";
  if (kelompok === "HARI_INI" || kelompok === "H1_7") return "jingga";
  if (kelompok === "H8_14" || kelompok === "H15_30") return "biru";
  if (kelompok === "LUNAS") return "hijau";
  return "netral";
}

const billInclude = {
  supplier: { select: { id: true, code: true, name: true } },
  purchaseOrder: { select: { id: true, poNumber: true, status: true } },
  goodsReceipt: { select: { id: true, receiptNumber: true, status: true, receivedDate: true } },
  scheduledCashAccount: { select: { id: true, name: true } },
  poLines: { select: { id: true, qty: true, invoiceUnitPrice: true, poUnitPrice: true } },
  poAllocations: { select: { billPoLineId: true, qty: true, goodsReceipt: { select: { id: true, receiptNumber: true, arrivedDate: true, status: true } } } },
  allocations: {
    where: { payment: { cancelledAt: null } },
    orderBy: { createdAt: "asc" },
    select: { amount: true, payment: { select: { id: true, paymentNumber: true, date: true, amount: true, transferFeeAmount: true, reference: true, cashAccount: { select: { id: true, name: true } } } } },
  },
};

async function muatPenerimaanPO(db, poIds) {
  if (poIds.length === 0) return new Map();
  const rows = await db.goodsReceipt.findMany({
    where: { purchaseOrderId: { in: poIds } },
    select: { id: true, receiptNumber: true, status: true, receivedDate: true, arrivedDate: true, purchaseOrderId: true, lines: { select: { receivedQty: true, rejectedQty: true, acceptedQty: true } } },
  });
  const peta = new Map();
  for (const r of rows) {
    const sudahDatang = r.lines.some((l) => Number(l.receivedQty ?? 0) > 0);
    const ditolak = r.status === "COMPLETED" && r.lines.some((l) => Number(l.rejectedQty ?? 0) > 0);
    const x = { id: r.id, receiptNumber: r.receiptNumber, status: r.status, receivedDate: r.arrivedDate ?? r.receivedDate, sudahDatang, ditolak };
    peta.set(r.purchaseOrderId, [...(peta.get(r.purchaseOrderId) ?? []), x]);
  }
  return peta;
}

async function namaUser(db, ids) {
  const unik = [...new Set(ids.filter(Boolean))];
  if (unik.length === 0) return new Map();
  return new Map((await db.user.findMany({ where: { id: { in: unik } }, select: { id: true, name: true } })).map((u) => [u.id, u.name]));
}

function bentukBaris(b, { hariIni, penerimaanPO, nama, item = null, pertama = true, dari = 1, ke = 1 }) {
  // item = satu baris jadwal per penerimaan (faktur atas PO, dasar tanggal tiba): nilai/dibayar/jatuh tempo milik item; selain itu seluruh faktur.
  const totalBayar = b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
  const terbayar = item ? item.dibayar : totalBayar;
  const nilai = item ? item.nilai : d(b.amount);
  const sisa = nilai.minus(terbayar);
  const dibayarSebagian = terbayar.greaterThan(0) && sisa.greaterThan(0);
  const dueDate = item ? item.jatuhTempo : b.dueDate;
  const kelompok = kelompokAging({ dueDate, sisa, hariIni });
  const penerimaan = b.purchaseOrderId
    ? (penerimaanPO.get(b.purchaseOrderId) ?? [])
    : b.goodsReceipt ? [{ ...b.goodsReceipt, sudahDatang: true, ditolak: false }] : [];
  const tglDiterima = item ? item.tanggalTiba : penerimaan.filter((r) => r.status === "COMPLETED" && r.receivedDate).map((r) => hariKunci(r.receivedDate)).sort().pop() ?? null;
  const hariKeJatuhTempo = dueDate ? selisihHari(dueDate, hariIni) : null;
  const pembayaran = (item && !pertama ? [] : b.allocations).map((a) => ({
    paymentId: a.payment.id, nomor: a.payment.paymentNumber, tanggal: hariKunci(a.payment.date), jumlah: moneyToNumber(toMoney(a.amount)),
    rekening: a.payment.cashAccount?.name ?? null, biayaTransfer: moneyToNumber(toMoney(a.payment.transferFeeAmount ?? 0)), referensi: a.payment.reference ?? null,
  }));
  const rekeningTerakhir = pembayaran.length ? pembayaran[pembayaran.length - 1].rekening : null;
  return {
    billId: b.id, nomorTagihan: b.billNumber, nomorFaktur: b.supplierRef ?? null, supplierId: b.supplierId, supplier: b.supplier.name, kodeSupplier: b.supplier.code,
    po: b.purchaseOrder ? { id: b.purchaseOrder.id, nomor: b.purchaseOrder.poNumber } : null,
    rowKey: item ? `${b.id}:${item.receiptId}` : b.id,
    jadwal: item ? { penerimaanId: item.receiptId, nomorPenerimaan: item.receiptNumber, tanggalTiba: item.tanggalTiba, status: item.status, statusLabel: item.statusLabel, ke, dari, nilaiFaktur: moneyToNumber(toMoney(b.amount)) } : null,
    tanggalBarangDiterima: tglDiterima, tanggalFaktur: hariKunci(b.billDate), tanggalJatuhTempo: hariKunci(dueDate),
    termin: {
      jenis: b.termType, hari: b.termDays, label: labelTermin(b.termType, b.termDays), dasar: b.termBasis, sumber: b.termSource ?? (b.dueDate ? "DATA_LAMA" : null),
      alasanOverride: b.termOverrideReason, oleh: nama.get(b.termSetById) ?? null, pada: b.termSetAt,
    },
    umurUtangHari: Math.max(0, selisihHari(hariIni, b.billDate)), hariKeJatuhTempo, hariTerlambat: hariKeJatuhTempo != null && hariKeJatuhTempo < 0 && sisa.greaterThan(0) ? -hariKeJatuhTempo : 0,
    nilaiFaktur: moneyToNumber(nilai), dibayar: moneyToNumber(terbayar), sisaUtang: moneyToNumber(sisa),
    rekeningPembayaran: b.scheduledCashAccount?.name ?? rekeningTerakhir,
    jadwalBayar: b.scheduledPayDate ? { tanggal: hariKunci(b.scheduledPayDate), rekeningId: b.scheduledCashAccountId, rekening: b.scheduledCashAccount?.name ?? null, catatan: b.scheduledNote, oleh: nama.get(b.scheduledById) ?? null, pada: b.scheduledAt } : null,
    kelompok, dibayarSebagian, indikator: nadaIndikator(kelompok),
    statusBarang: statusBarang({ po: b.purchaseOrder, penerimaan }), adaBarangDitolak: penerimaan.some((r) => r.ditolak),
    statusFaktur: statusFaktur(b), statusPembayaran: statusPembayaran({ kelompok, dibayarSebagian }),
    pembayaran,
    _sisa: sisa,
  };
}

/** Baris aging satu faktur: satu baris, atau satu per penerimaan untuk faktur atas PO dengan dasar tanggal tiba (alokasi sudah ada). */
function bentukBarisFaktur(b, ctx) {
  if (b.termBasis === DASAR_TANGGAL_TIBA && b.poAllocations?.length) {
    const alokasi = b.poAllocations.map((a) => ({ billPoLineId: a.billPoLineId, receiptId: a.goodsReceipt.id, receiptNumber: a.goodsReceipt.receiptNumber, tanggalTiba: a.goodsReceipt.arrivedDate, status: a.goodsReceipt.status, qty: Number(a.qty) }));
    const totalBayar = b.allocations.length ? sumMoney(b.allocations.map((a) => a.amount)) : ZERO;
    const jadwal = jadwalDariFaktur({ bill: b, alokasi, dibayar: totalBayar, hariIni: ctx.hariIni });
    if (jadwal?.length) return jadwal.map((item, i) => bentukBaris(b, { ...ctx, item, pertama: i === 0, ke: i + 1, dari: jadwal.length }));
  }
  return [bentukBaris(b, ctx)];
}

function ringkas(baris) {
  const unik = (rows) => new Set(rows.map((r) => r.billId)).size; // satu faktur boleh punya beberapa baris jadwal — hitung per faktur
  const terbuka = baris.filter((r) => r.kelompok !== "LUNAS");
  const jml = (rows) => sumMoney(rows.map((r) => r._sisa));
  const dalam = (maks) => terbuka.filter((r) => r.hariKeJatuhTempo != null && r.hariKeJatuhTempo >= 0 && r.hariKeJatuhTempo <= maks);
  const kartu = {
    totalUtangAktif: moneyToNumber(jml(terbuka)), jumlahFakturAktif: unik(terbuka),
    totalTerlambat: moneyToNumber(jml(terbuka.filter((r) => r.kelompok === "TERLAMBAT"))), jumlahTerlambat: unik(terbuka.filter((r) => r.kelompok === "TERLAMBAT")),
    jatuhTempo7Hari: moneyToNumber(jml(dalam(7))), jumlahJatuhTempo7Hari: unik(dalam(7)),
    jatuhTempo30Hari: moneyToNumber(jml(dalam(30))), jumlahJatuhTempo30Hari: unik(dalam(30)),
    sudahDijadwalkan: moneyToNumber(jml(terbuka.filter((r) => r.jadwalBayar))), jumlahDijadwalkan: unik(terbuka.filter((r) => r.jadwalBayar)),
    tanpaJatuhTempo: moneyToNumber(jml(terbuka.filter((r) => r.kelompok === "TANPA_JATUH_TEMPO"))), jumlahTanpaJatuhTempo: unik(terbuka.filter((r) => r.kelompok === "TANPA_JATUH_TEMPO")),
    dibayarSebagian: moneyToNumber(jml(terbuka.filter((r) => r.dibayarSebagian))), jumlahDibayarSebagian: unik(terbuka.filter((r) => r.dibayarSebagian)),
  };
  const perKelompok = KELOMPOK_AGING.map((k) => {
    const rows = baris.filter((r) => r.kelompok === k.kunci);
    return { kunci: k.kunci, label: k.label, jumlah: unik(rows), sisaUtang: moneyToNumber(jml(rows)), nilaiFaktur: moneyToNumber(sumMoney(rows.map((r) => d(r.nilaiFaktur)))) };
  });
  return { kartu, perKelompok };
}

/**
 * Baca aging. Filter (sama dengan layar & export):
 *   supplierId, kelompok (KELOMPOK_FILTER), q (nomor faktur/tagihan/PO/supplier), fakturDari/fakturSampai (tanggal faktur),
 *   jatuhTempoDari/jatuhTempoSampai, termasukLunas (default: tidak — kecuali kelompok=LUNAS), hariIni (uji).
 * Hasil: { hariIni, baris[], ringkasan:{kartu,perKelompok}, filter } — `baris` terurut prioritas (terlambat paling lama dulu).
 */
export async function bacaAgingUtang(db, filter = {}) {
  const hariIni = hariKunci(filter.hariIni ?? todayBookDateWIB());
  const kelompok = filter.kelompok && KELOMPOK_FILTER.includes(filter.kelompok) ? filter.kelompok : null;
  const termasukLunas = filter.termasukLunas === true || filter.termasukLunas === "1" || kelompok === "LUNAS";
  const tgl = (v) => (v && /^\d{4}-\d{2}-\d{2}$/.test(String(v)) ? new Date(`${v}T00:00:00.000Z`) : null);
  const where = {
    status: { in: termasukLunas ? STATUS_FAKTUR_AGING : ["DISETUJUI", "DIBAYAR_SEBAGIAN"] },
    ...(filter.supplierId && { supplierId: filter.supplierId }),
    ...((tgl(filter.fakturDari) || tgl(filter.fakturSampai)) && { billDate: { ...(tgl(filter.fakturDari) && { gte: tgl(filter.fakturDari) }), ...(tgl(filter.fakturSampai) && { lte: tgl(filter.fakturSampai) }) } }),
    ...((tgl(filter.jatuhTempoDari) || tgl(filter.jatuhTempoSampai)) && { dueDate: { ...(tgl(filter.jatuhTempoDari) && { gte: tgl(filter.jatuhTempoDari) }), ...(tgl(filter.jatuhTempoSampai) && { lte: tgl(filter.jatuhTempoSampai) }) } }),
    ...(filter.q && { OR: [
      { supplierRef: { contains: String(filter.q), mode: "insensitive" } }, { billNumber: { contains: String(filter.q), mode: "insensitive" } },
      { supplier: { name: { contains: String(filter.q), mode: "insensitive" } } }, { purchaseOrder: { poNumber: { contains: String(filter.q), mode: "insensitive" } } },
    ] }),
  };
  const bills = await db.finSupplierBill.findMany({ where, include: billInclude, orderBy: [{ dueDate: "asc" }, { billDate: "asc" }], take: 5000 });
  const penerimaanPO = await muatPenerimaanPO(db, [...new Set(bills.map((b) => b.purchaseOrderId).filter(Boolean))]);
  const nama = await namaUser(db, bills.flatMap((b) => [b.termSetById, b.scheduledById]));
  let baris = bills.flatMap((b) => bentukBarisFaktur(b, { hariIni, penerimaanPO, nama }));
  if (!termasukLunas) baris = baris.filter((r) => r.kelompok !== "LUNAS");
  // Kartu & rekap kelompok dihitung SEBELUM tab/kelompok memilih baris — angkanya tetap sama saat pengguna berpindah tab (dan sama dengan export).
  const ringkasan = ringkas(baris);
  if (kelompok === "DIBAYAR_SEBAGIAN") baris = baris.filter((r) => r.dibayarSebagian);
  else if (kelompok === "AKTIF") baris = baris.filter((r) => r.kelompok !== "LUNAS");
  else if (kelompok) baris = baris.filter((r) => r.kelompok === kelompok);
  // Prioritas: terlambat paling lama dulu → jatuh tempo terdekat → tanpa tanggal → lunas.
  const urut = { TERLAMBAT: 0, HARI_INI: 1, H1_7: 2, H8_14: 3, H15_30: 4, LEBIH_30: 5, TANPA_JATUH_TEMPO: 6, LUNAS: 7 };
  baris.sort((a, b) => urut[a.kelompok] - urut[b.kelompok] || String(a.tanggalJatuhTempo ?? "9999").localeCompare(String(b.tanggalJatuhTempo ?? "9999")) || String(a.tanggalFaktur).localeCompare(String(b.tanggalFaktur)));
  return { hariIni, filter: { ...filter, kelompok, termasukLunas }, baris: baris.map(({ _sisa, ...r }) => r), ringkasan };
}

/** Detail satu faktur (baris + riwayat pembayaran + riwayat perubahan termin dari log aktivitas bila ada). */
export async function bacaDetailUtang(db, billId, { hariIni } = {}) {
  const b = await db.finSupplierBill.findUnique({ where: { id: billId }, include: billInclude });
  if (!b || !STATUS_FAKTUR_AGING.includes(b.status)) return null;
  const penerimaanPO = await muatPenerimaanPO(db, b.purchaseOrderId ? [b.purchaseOrderId] : []);
  const nama = await namaUser(db, [b.termSetById, b.scheduledById]);
  const hari = hariKunci(hariIni ?? todayBookDateWIB());
  const rows = bentukBarisFaktur(b, { hariIni: hari, penerimaanPO, nama }).map(({ _sisa, ...r }) => r);
  // Detail satu faktur: baris faktur (nilai/dibayar/sisa SELURUH faktur) + jadwal jatuh tempo per penerimaan (bila ada) — jumlahnya sama dengan faktur.
  const faktur = rows.length === 1 && !rows[0].jadwal ? rows[0] : { ...bentukBaris(b, { hariIni: hari, penerimaanPO, nama }) };
  const { _sisa, ...utuh } = faktur;
  return { ...utuh, jadwalPerPenerimaan: rows.filter((r) => r.jadwal).map((r) => ({ ...r.jadwal, jatuhTempo: r.tanggalJatuhTempo, nilai: r.nilaiFaktur, dibayar: r.dibayar, sisa: r.sisaUtang, kelompok: r.kelompok, statusPembayaran: r.statusPembayaran })) };
}
