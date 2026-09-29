// EXPORT EXCEL — SUPPLIER & UTANG (B3.9). Halaman punya 3 tab (Tagihan, Pembayaran, Master Supplier) dan MENGIKUTI TAB AKTIF:
//   filter.tab = "tagihan" | "pembayaran" | "supplier"  (bawaan "tagihan")
//   ids        = id baris yang tampil di tab itu setelah pencarian/filter sisi-klien (urutan layar dihormati)
//   tanpa ids  = seluruh data tab menurut filter server: tagihan (status, supplierId, jatuhTempo=lewat), pembayaran (periode + supplierId;
//                tanpa periode = bulan berjalan, sama dengan layar), supplier (includeInactive=1)
// Semua data dibaca lewat services/finance/supplierRead.js + umurUtang (reports.js) — query yang SAMA dengan layar.
// Sheet "Ringkasan" (kartu di kepala halaman: Total Utang Usaha, Lewat Jatuh Tempo, Menunggu Persetujuan, Penerimaan Belum Ditagih) dan
// "Umur Utang" (tagihan terbuka + ember umur) selalu ikut, karena kartu itu tampil di semua tab.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { rentangDariQuery } from "../../../routes/finance.js";
import { todayBookDateWIB } from "../journal.js";
import { umurUtang } from "../reports.js";
import { ambilDaftarTagihan, bentukBill, ambilDaftarPembayaranSupplier, ambilDaftarSupplier, ambilPenerimaanBelumDitagih } from "../supplierRead.js";
import { susunLabelFilter, labelPeriode } from "./excel.js";
import { labelCaraBayar, labelMetodeTransfer } from "./label.js";

// Label status sama dengan yang tampil di layar (StatusBadge di features/finance/shared.jsx).
const LABEL_STATUS_LAYAR = {
  DRAFT: "Draft", MENUNGGU_APPROVAL: "Menunggu Persetujuan", DISETUJUI: "Disetujui", DIBAYAR_SEBAGIAN: "Dibayar Sebagian",
  LUNAS: "Lunas", DITOLAK: "Ditolak", DIBATALKAN: "Dibatalkan",
};
const labelStatusTagihan = (s) => LABEL_STATUS_LAYAR[s] || String(s ?? "");
const STATUS_UTANG_RESMI = ["DISETUJUI", "DIBAYAR_SEBAGIAN"];
const HARI_MS = 86_400_000;

const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);
const TAB = ["tagihan", "pembayaran", "supplier"];
const LABEL_LEWAT = { lewat: "Lewat jatuh tempo", belum: "Belum jatuh tempo", tanpa: "Tanpa tanggal" };

function sheetTagihan(bills, hariIni, filter) {
  const baris = bills.map((b) => {
    const lewat = STATUS_UTANG_RESMI.includes(b.status) && b.dueDate && Number(b.sisa) > 0 && new Date(b.dueDate) < hariIni;
    return {
      nomor: b.billNumber, faktur: b.supplierRef || "", supplier: b.supplier?.name || "", keterangan: b.description,
      jenis: b.jenisTagihan?.label || "", penerimaan: b.goodsReceipt?.receiptNumber || "",
      tanggal: b.billDate, jatuhTempo: b.dueDate || null, nilai: b.amount, terbayar: b.terbayar, sisa: b.sisa,
      status: labelStatusTagihan(b.status), lewat: lewat ? "Ya" : "Tidak", hariLewat: lewat ? Math.floor((hariIni - new Date(b.dueDate)) / HARI_MS) : null,
      versi: [b.replaces?.billNumber && `Menggantikan ${b.replaces.billNumber}`, b.replacedBy?.billNumber && `Diganti ${b.replacedBy.billNumber}`].filter(Boolean).join("; "),
      dicatat: b.createdBy?.name || "", disetujui: b.approvedBy?.name || "", waktuSetuju: b.approvedAt || null,
      alasanTolak: b.status === "DITOLAK" ? (b.rejectReason || "") : "", lampiran: b.attachmentUrl || "",
    };
  });
  // Total sama dasarnya dengan kartu "Total Utang Usaha": hanya tagihan Disetujui / Dibayar Sebagian (utang resmi di buku besar).
  const resmi = bills.filter((b) => STATUS_UTANG_RESMI.includes(b.status));
  return {
    nama: "Tagihan", judul: "Tagihan Supplier (Utang)",
    kolom: [
      { key: "nomor", header: "No. Tagihan", tipe: "teks", lebar: 20 }, { key: "faktur", header: "No. Faktur Supplier", tipe: "teks", lebar: 20 },
      { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 34 },
      { key: "jenis", header: "Jenis Tagihan", tipe: "teks", lebar: 22 }, { key: "penerimaan", header: "Penerimaan Barang", tipe: "teks", lebar: 20 },
      { key: "tanggal", header: "Tanggal Tagihan", tipe: "tanggal" }, { key: "jatuhTempo", header: "Jatuh Tempo", tipe: "tanggal" },
      { key: "nilai", header: "Nilai (Rp)", tipe: "uang" }, { key: "terbayar", header: "Terbayar (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa (Rp)", tipe: "uang" },
      { key: "status", header: "Status", tipe: "teks", lebar: 20 }, { key: "lewat", header: "Lewat Jatuh Tempo", tipe: "teks", lebar: 12 },
      { key: "hariLewat", header: "Hari Lewat Tempo", tipe: "angka", lebar: 12 }, { key: "versi", header: "Versi Koreksi", tipe: "teks", lebar: 28 },
      { key: "dicatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 }, { key: "disetujui", header: "Disetujui Oleh", tipe: "teks", lebar: 18 },
      { key: "waktuSetuju", header: "Waktu Disetujui", tipe: "waktu" },
      { key: "alasanTolak", header: "Alasan Penolakan", tipe: "teks", lebar: 28, sensitif: true },
      { key: "lampiran", header: "Tautan Lampiran", tipe: "teks", lebar: 30, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL UTANG TERBUKA (${resmi.length} tagihan Disetujui / Dibayar Sebagian)`, nilai: { nilai: jumlah(resmi, "amount"), terbayar: jumlah(resmi, "terbayar"), sisa: jumlah(resmi, "sisa") } },
    catatan: [
      "Total hanya menghitung tagihan berstatus Disetujui dan Dibayar Sebagian (utang resmi di buku besar, sama dengan kartu Total Utang Usaha). Draft, Menunggu Persetujuan, Lunas, Ditolak, dan Dibatalkan tidak dihitung.",
      "Lewat Jatuh Tempo hanya berarti untuk tagihan Disetujui / Dibayar Sebagian yang masih punya sisa; tanggal jatuh tempo dibandingkan dengan hari ini (WIB).",
      ...(filter.jatuhTempo ? [`Filter jatuh tempo layar: ${LABEL_LEWAT[filter.jatuhTempo] || filter.jatuhTempo}.`] : []),
    ],
  };
}

function sheetPembayaran(payments) {
  const aktif = payments.filter((p) => !p.cancelledAt);
  const baris = payments.map((p) => ({
    nomor: p.paymentNumber, tanggal: p.date, supplier: p.supplier?.name || "", rekening: p.cashAccount?.name || "",
    tagihan: p.allocations.map((a) => a.bill?.billNumber).filter(Boolean).join(", "), nominal: p.amount,
    caraBayar: labelCaraBayar(p.paymentMethod), metodeTransfer: labelMetodeTransfer(p.transferFeeType), biayaAdmin: Number(p.transferFeeAmount) || 0,
    referensi: p.reference || "", status: p.cancelledAt ? "Dibatalkan" : "Terposting", dicatat: p.createdBy?.name || "",
    waktuBatal: p.cancelledAt || null, alasanBatal: p.cancelledAt ? (p.cancelReason || "") : "", catatan: p.notes || "", lampiran: p.attachmentUrl || "",
  }));
  return {
    nama: "Pembayaran", judul: "Pembayaran ke Supplier",
    kolom: [
      { key: "nomor", header: "No. Pembayaran", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
      { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 }, { key: "rekening", header: "Dari Rekening", tipe: "teks", lebar: 20 },
      { key: "tagihan", header: "Tagihan yang Dilunasi", tipe: "teks", lebar: 34 }, { key: "nominal", header: "Nominal (Rp)", tipe: "uang" },
      { key: "caraBayar", header: "Cara Bayar", tipe: "teks", lebar: 12 }, { key: "metodeTransfer", header: "Metode Transfer", tipe: "teks", lebar: 16 },
      { key: "biayaAdmin", header: "Biaya Admin (Rp)", tipe: "uang" }, { key: "referensi", header: "No. Referensi", tipe: "teks", lebar: 20, sensitif: true },
      { key: "status", header: "Status", tipe: "teks", lebar: 13 }, { key: "dicatat", header: "Dicatat Oleh", tipe: "teks", lebar: 18 },
      { key: "waktuBatal", header: "Waktu Dibatalkan", tipe: "waktu" },
      { key: "alasanBatal", header: "Alasan Pembatalan", tipe: "teks", lebar: 28, sensitif: true },
      { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
      { key: "lampiran", header: "Tautan Lampiran", tipe: "teks", lebar: 30, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL pembayaran terposting (${aktif.length} dari ${payments.length})`, nilai: { nominal: jumlah(aktif, "amount"), biayaAdmin: jumlah(aktif, "transferFeeAmount") } },
    catatan: ["Total hanya menghitung pembayaran berstatus Terposting; pembayaran Dibatalkan tetap tampil sebagai jejak tetapi tidak dijumlahkan."],
  };
}

function sheetAlokasi(payments) {
  const baris = payments.flatMap((p) => p.allocations.map((a) => ({
    pembayaran: p.paymentNumber, tanggal: p.date, supplier: p.supplier?.name || "", tagihan: a.bill?.billNumber || "", nominal: a.amount,
    status: p.cancelledAt ? "Dibatalkan" : "Terposting",
  })));
  const aktif = baris.filter((b) => b.status === "Terposting");
  return {
    nama: "Alokasi", judul: "Alokasi Pembayaran ke Tagihan",
    kolom: [
      { key: "pembayaran", header: "No. Pembayaran", tipe: "teks", lebar: 20 }, { key: "tanggal", header: "Tanggal", tipe: "tanggal" },
      { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 }, { key: "tagihan", header: "No. Tagihan", tipe: "teks", lebar: 20 },
      { key: "nominal", header: "Nominal Dialokasikan (Rp)", tipe: "uang", lebar: 20 }, { key: "status", header: "Status Pembayaran", tipe: "teks", lebar: 16 },
    ],
    baris,
    total: { label: `TOTAL alokasi terposting (${aktif.length})`, nilai: { nominal: jumlah(aktif, "nominal") } },
  };
}

function sheetSupplier(suppliers) {
  const baris = suppliers.map((s) => ({
    kode: s.code, nama: s.name, telepon: s.phone || "", email: s.email || "", termin: s.paymentTermDays ?? null,
    bank: s.bankName || "", rekening: s.bankAccount || "", atasNama: s.bankHolder || "",
    tagihanTerbuka: s.jumlahTagihanTerbuka, sisaUtang: s.sisaUtang, status: s.active ? "Aktif" : "Nonaktif", alamat: s.address || "", catatan: s.notes || "",
  }));
  return {
    nama: "Master Supplier", judul: "Master Supplier",
    kolom: [
      { key: "kode", header: "Kode", tipe: "teks", lebar: 12 }, { key: "nama", header: "Nama Supplier", tipe: "teks", lebar: 28 },
      { key: "telepon", header: "Telepon", tipe: "teks", lebar: 16 }, { key: "email", header: "Email", tipe: "teks", lebar: 24 },
      { key: "termin", header: "Termin Bayar (hari)", tipe: "angka", lebar: 12 }, { key: "bank", header: "Bank", tipe: "teks", lebar: 16 },
      { key: "rekening", header: "No. Rekening", tipe: "teks", lebar: 20, sensitif: true }, { key: "atasNama", header: "Atas Nama Rekening", tipe: "teks", lebar: 22, sensitif: true },
      { key: "tagihanTerbuka", header: "Tagihan Terbuka", tipe: "angka", lebar: 12 }, { key: "sisaUtang", header: "Sisa Utang (Rp)", tipe: "uang" },
      { key: "status", header: "Status", tipe: "teks", lebar: 12 }, { key: "alamat", header: "Alamat", tipe: "teks", lebar: 30 },
      { key: "catatan", header: "Catatan Internal", tipe: "teks", lebar: 30, sensitif: true },
    ],
    baris,
    total: { label: `TOTAL (${baris.length} supplier)`, nilai: { tagihanTerbuka: jumlah(baris, "tagihanTerbuka"), sisaUtang: jumlah(baris, "sisaUtang") } },
  };
}

/** Kartu ringkasan di kepala halaman + sebaran umur utang (angka dari umurUtang — sama dengan yang dipakai kartu di layar). */
function sheetRingkasan({ aging, tagihanLayar, penerimaan }) {
  const lewat = aging.baris.filter((b) => b.hariLewat > 0);
  const menunggu = tagihanLayar.filter((b) => b.status === "MENUNGGU_APPROVAL");
  const baris = [
    { indikator: "Utang Usaha — kartu Total Utang Usaha (tagihan disetujui, belum lunas)", jumlah: aging.baris.length, nilai: aging.total },
    { indikator: "Lewat Jatuh Tempo", jumlah: lewat.length, nilai: lewat.reduce((s, b) => s + b.sisa, 0) },
    { indikator: "Tagihan Menunggu Persetujuan (belum menjadi utang)", jumlah: menunggu.length, nilai: null },
    { indikator: "Penerimaan Barang Belum Ditagih", jumlah: penerimaan.length, nilai: null },
    ...(aging.ember || []).map((e) => ({
      indikator: `Umur utang: ${e.label}`,
      jumlah: aging.baris.filter((b) => b.ember === e.key).length, nilai: aging.ringkasan?.[e.key] ?? 0,
    })),
  ];
  return {
    nama: "Ringkasan", judul: "Ringkasan Utang Usaha",
    kolom: [
      { key: "indikator", header: "Indikator", tipe: "teks", lebar: 52 }, { key: "jumlah", header: "Jumlah", tipe: "angka", lebar: 12 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" },
    ],
    baris,
    catatan: [
      `Posisi umur utang per ${String(aging.perTanggal instanceof Date ? aging.perTanggal.toISOString() : aging.perTanggal).slice(0, 10)} (akhir bulan berjalan, sama dengan kartu di layar).`,
      "Menunggu Persetujuan dihitung dari daftar tagihan yang dimuat layar (maks. 300 tagihan terbaru menurut jatuh tempo).",
    ],
  };
}

function sheetUmurUtang(aging) {
  const baris = aging.baris.map((b) => ({
    tagihan: b.billNumber, faktur: b.supplierRef || "", supplier: b.supplierName, keterangan: b.description, tanggal: b.billDate, jatuhTempo: b.dueDate || null,
    acuan: b.sumberJatuhTempo === "tagihan" ? "Jatuh tempo tagihan" : "Tanggal tagihan", nilai: b.nilaiTagihan, terbayar: b.terbayar, sisa: b.sisa,
    hariLewat: b.hariLewat, ember: (aging.ember || []).find((e) => e.key === b.ember)?.label || b.ember,
  }));
  return {
    nama: "Umur Utang", judul: "Umur Utang Usaha per Tagihan",
    kolom: [
      { key: "tagihan", header: "No. Tagihan", tipe: "teks", lebar: 20 }, { key: "faktur", header: "No. Faktur Supplier", tipe: "teks", lebar: 20 },
      { key: "supplier", header: "Supplier", tipe: "teks", lebar: 24 }, { key: "keterangan", header: "Keterangan", tipe: "teks", lebar: 34 },
      { key: "tanggal", header: "Tanggal Tagihan", tipe: "tanggal" }, { key: "jatuhTempo", header: "Jatuh Tempo", tipe: "tanggal" },
      { key: "acuan", header: "Acuan Umur", tipe: "teks", lebar: 20 }, { key: "nilai", header: "Nilai (Rp)", tipe: "uang" },
      { key: "terbayar", header: "Terbayar (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa (Rp)", tipe: "uang" },
      { key: "hariLewat", header: "Hari Lewat", tipe: "angka", lebar: 11 }, { key: "ember", header: "Kelompok Umur", tipe: "teks", lebar: 18 },
    ],
    baris,
    total: { label: `TOTAL utang terbuka (${baris.length} tagihan)`, nilai: { nilai: jumlah(baris, "nilai"), terbayar: jumlah(baris, "terbayar"), sisa: jumlah(baris, "sisa") } },
    catatan: ["Hari Lewat = selisih posisi laporan dengan jatuh tempo (bila tanpa jatuh tempo: tanggal tagihan); nilai negatif berarti belum jatuh tempo."],
  };
}

async function ambil(db, { filter, periode, ids, filterLabel }) {
  const tab = TAB.includes(filter.tab) ? filter.tab : "tagihan";
  const hariIni = todayBookDateWIB();
  const rentang = rentangDariQuery({ from: periode.from ?? filter.from, to: periode.to ?? filter.to });

  // Kartu & Umur Utang: query yang sama dengan layar (GET /reports/payables tanpa parameter; GET /bills bawaan untuk hitungan "menunggu").
  const [aging, tagihanLayarMentah, penerimaan] = await Promise.all([
    umurUtang(db, { to: rentangDariQuery({}).to }),
    ambilDaftarTagihan(db, {}, { take: 300 }),
    ambilPenerimaanBelumDitagih(db),
  ]);

  let sheets;
  let label;
  let periodeLabel;
  if (tab === "tagihan") {
    const mentah = ids ? await ambilDaftarTagihan(db, {}, { ids }) : await ambilDaftarTagihan(db, { status: filter.status, supplierId: filter.supplierId, jatuhTempo: filter.jatuhTempo }, { take: 50_001 });
    sheets = [sheetTagihan(mentah.map(bentukBill), hariIni, filter)];
    label = susunLabelFilter([["Tab", "Tagihan (Utang)"], ["Status", filter.status && labelStatusTagihan(filter.status)], ["Jatuh tempo", filter.jatuhTempo && (LABEL_LEWAT[filter.jatuhTempo] || filter.jatuhTempo)], ["Baris", ids ? "sesuai baris yang tampil di layar" : ""]]);
  } else if (tab === "pembayaran") {
    const payments = await ambilDaftarPembayaranSupplier(db, { rentang, supplierId: filter.supplierId }, { take: 50_001, ids });
    sheets = [sheetPembayaran(payments)];
    if (payments.some((p) => p.allocations.length > 0)) sheets.push(sheetAlokasi(payments));
    label = susunLabelFilter([["Tab", "Pembayaran"], ["Baris", ids ? "sesuai baris yang tampil di layar" : ""]]);
    periodeLabel = labelPeriode({ from: rentang.fromStr ?? rentang.from.toISOString().slice(0, 10), to: rentang.toStr ?? rentang.to.toISOString().slice(0, 10) });
  } else {
    const suppliers = await ambilDaftarSupplier(db, { includeInactive: filter.includeInactive === "1" || filter.includeInactive === true }, { ids });
    sheets = [sheetSupplier(suppliers)];
    label = susunLabelFilter([["Tab", "Master Supplier"], ["Baris", ids ? "sesuai baris yang tampil di layar" : ""]]);
  }
  sheets.push(sheetRingkasan({ aging, tagihanLayar: tagihanLayarMentah, penerimaan }), sheetUmurUtang(aging));

  return { nama: "Supplier & Utang", filterLabel: filterLabel || label, ...(periodeLabel ? { periodeLabel } : {}), sheets };
}

export default { kunci: "supplier-utang", nama: "Supplier & Utang", izin: [P.FINANCE_READ], ambil };
