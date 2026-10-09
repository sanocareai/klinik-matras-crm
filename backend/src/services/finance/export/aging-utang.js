// EXPORT EXCEL — JADWAL & AGING UTANG SUPPLIER. Sumber data = services/finance/agingUtang.js (bacaAgingUtang — fungsi baca yang SAMA dengan layar).
// Filter layar: supplierId, q, fakturDari/Sampai, jatuhTempoDari/Sampai (dikirim sebagai `filter`; tab kelompok tidak membatasi export karena tiap kelompok punya sheet sendiri).
// Enam sheet: Ringkasan Aging, Utang Aktif, Jatuh Tempo, Dibayar Sebagian, Lunas, Tanpa Jatuh Tempo. Total = kartu ringkasan layar.
import { PERMISSIONS as P } from "../../../middleware/authorize.js";
import { bacaAgingUtang, LABEL_STATUS_BARANG, LABEL_STATUS_FAKTUR, LABEL_STATUS_PEMBAYARAN } from "../agingUtang.js";
import { susunLabelFilter } from "./excel.js";

const SUMBER = { MASTER_SUPPLIER: "Master supplier", PO: "PO", OVERRIDE_FAKTUR: "Diganti pada faktur", DATA_LAMA: "Data lama (manual)" };
const jumlah = (rows, key) => rows.reduce((a, r) => a + (Number(r[key]) || 0), 0);

const KOLOM = [
  { key: "supplier", header: "Supplier", tipe: "teks", lebar: 26 }, { key: "po", header: "No. PO", tipe: "teks", lebar: 20 },
  { key: "nomorFaktur", header: "No. Faktur Supplier", tipe: "teks", lebar: 22 }, { key: "nomorTagihan", header: "No. Tagihan", tipe: "teks", lebar: 20 },
  { key: "penerimaan", header: "Penerimaan (jadwal per penerimaan)", tipe: "teks", lebar: 28 },
  { key: "tglDiterima", header: "Tanggal Barang Diterima", tipe: "tanggal" }, { key: "tglFaktur", header: "Tanggal Faktur", tipe: "tanggal" },
  { key: "termin", header: "Termin", tipe: "teks", lebar: 16 }, { key: "sumberTermin", header: "Sumber Termin", tipe: "teks", lebar: 20 },
  { key: "tglJatuhTempo", header: "Tanggal Jatuh Tempo", tipe: "tanggal" }, { key: "umur", header: "Umur Utang (hari)", tipe: "angka" },
  { key: "hariKeJatuhTempo", header: "Hari ke Jatuh Tempo (minus = terlambat)", tipe: "angka" },
  { key: "nilaiFaktur", header: "Nilai Faktur (Rp)", tipe: "uang" }, { key: "dibayar", header: "Sudah Dibayar (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa Utang (Rp)", tipe: "uang" },
  { key: "rencanaBayar", header: "Rencana Bayar", tipe: "tanggal" }, { key: "rekening", header: "Rekening Pembayaran", tipe: "teks", lebar: 24 },
  { key: "statusBarang", header: "Status Barang", tipe: "teks", lebar: 18 }, { key: "statusFaktur", header: "Status Faktur", tipe: "teks", lebar: 16 }, { key: "statusPembayaran", header: "Status Pembayaran", tipe: "teks", lebar: 26 },
  { key: "alasanTermin", header: "Alasan Ganti Termin", tipe: "teks", lebar: 30, sensitif: true }, { key: "catatanJadwal", header: "Catatan Jadwal Bayar", tipe: "teks", lebar: 30, sensitif: true },
];

const barisSheet = (r) => ({
  supplier: r.supplier, po: r.po?.nomor ?? "", penerimaan: r.jadwal ? `${r.jadwal.nomorPenerimaan} (${r.jadwal.ke}/${r.jadwal.dari}) — ${r.jadwal.statusLabel}` : "", nomorFaktur: r.nomorFaktur ?? "", nomorTagihan: r.nomorTagihan, tglDiterima: r.tanggalBarangDiterima, tglFaktur: r.tanggalFaktur,
  termin: r.termin.label ?? "Belum ditetapkan", sumberTermin: r.termin.sumber ? (SUMBER[r.termin.sumber] ?? r.termin.sumber) : "", tglJatuhTempo: r.tanggalJatuhTempo,
  umur: r.umurUtangHari, hariKeJatuhTempo: r.hariKeJatuhTempo, nilaiFaktur: r.nilaiFaktur, dibayar: r.dibayar, sisa: r.sisaUtang,
  rencanaBayar: r.jadwalBayar?.tanggal ?? null, rekening: r.rekeningPembayaran ?? "",
  statusBarang: r.statusBarang ? LABEL_STATUS_BARANG[r.statusBarang] : "Tidak berlaku", statusFaktur: LABEL_STATUS_FAKTUR[r.statusFaktur], statusPembayaran: LABEL_STATUS_PEMBAYARAN[r.statusPembayaran],
  alasanTermin: r.termin.alasanOverride ?? "", catatanJadwal: r.jadwalBayar?.catatan ?? "",
});

async function ambil(db, { filter, filterLabel }) {
  const f = { supplierId: filter.supplierId, q: filter.q, fakturDari: filter.fakturDari, fakturSampai: filter.fakturSampai, jatuhTempoDari: filter.jatuhTempoDari, jatuhTempoSampai: filter.jatuhTempoSampai, termasukLunas: true, hariIni: filter.hariIni };
  const hasil = await bacaAgingUtang(db, f);
  const semua = hasil.baris.map((r) => ({ r, b: barisSheet(r) }));
  const aktif = semua.filter(({ r }) => r.kelompok !== "LUNAS");
  const k = hasil.ringkasan.kartu;

  const tentu = (baris, nama, judul, catatanKosong, tambahan = []) => ({
    nama, judul, kolom: KOLOM, baris: baris.map((x) => x.b),
    total: { label: `TOTAL (${new Set(baris.map((x) => x.r.billId)).size} faktur${baris.length !== new Set(baris.map((x) => x.r.billId)).size ? `, ${baris.length} jadwal` : ""})`, nilai: { nilaiFaktur: jumlah(baris.map((x) => x.b), "nilaiFaktur"), dibayar: jumlah(baris.map((x) => x.b), "dibayar"), sisa: jumlah(baris.map((x) => x.b), "sisa") } },
    pesanKosong: baris.length === 0 ? catatanKosong : undefined, catatan: tambahan.length ? tambahan : undefined,
  });

  const ringkasanBaris = [
    ...hasil.ringkasan.perKelompok.map((g) => ({ kelompok: g.label, jumlah: g.jumlah, nilaiFaktur: g.nilaiFaktur, sisa: g.sisaUtang, ket: "" })),
    { kelompok: "Dibayar sebagian (bagian dari kelompok di atas)", jumlah: k.jumlahDibayarSebagian, nilaiFaktur: null, sisa: k.dibayarSebagian, ket: "Sudah ada pembayaran, sisa masih terbuka" },
    { kelompok: "Jatuh tempo hari ini s.d. 7 hari", jumlah: k.jumlahJatuhTempo7Hari, nilaiFaktur: null, sisa: k.jatuhTempo7Hari, ket: "Kartu: Jatuh Tempo 7 Hari" },
    { kelompok: "Jatuh tempo hari ini s.d. 30 hari", jumlah: k.jumlahJatuhTempo30Hari, nilaiFaktur: null, sisa: k.jatuhTempo30Hari, ket: "Kartu: Jatuh Tempo 30 Hari" },
    { kelompok: "Sudah dijadwalkan bayar", jumlah: k.jumlahDijadwalkan, nilaiFaktur: null, sisa: k.sudahDijadwalkan, ket: "Kartu: Sudah Dijadwalkan" },
  ];

  return {
    nama: "Jadwal dan Aging Utang",
    periodeLabel: `Per ${hasil.hariIni} (aging dihitung dari tanggal jatuh tempo)`,
    filterLabel: filterLabel || susunLabelFilter([["Pencarian", filter.q], ["Faktur dari", filter.fakturDari], ["Faktur sampai", filter.fakturSampai], ["Jatuh tempo dari", filter.jatuhTempoDari], ["Jatuh tempo sampai", filter.jatuhTempoSampai]]),
    sheets: [
      {
        nama: "Ringkasan Aging", judul: "Ringkasan Aging Utang Supplier",
        kolom: [{ key: "kelompok", header: "Kelompok", tipe: "teks", lebar: 46 }, { key: "jumlah", header: "Jumlah Faktur", tipe: "angka" }, { key: "nilaiFaktur", header: "Nilai Faktur (Rp)", tipe: "uang" }, { key: "sisa", header: "Sisa Utang (Rp)", tipe: "uang" }, { key: "ket", header: "Keterangan", tipe: "teks", lebar: 40 }],
        baris: ringkasanBaris,
        total: { label: "TOTAL UTANG AKTIF (tanpa Lunas)", nilai: { jumlah: k.jumlahFakturAktif, sisa: k.totalUtangAktif } },
        catatan: ["Total utang aktif = jumlah sisa semua kelompok kecuali Lunas. Baris Dibayar sebagian dan jatuh tempo 7/30 hari adalah irisan dari kelompok di atas, bukan tambahan.", "Aging memakai tanggal jatuh tempo, bukan tanggal barang datang. Faktur tanpa tanggal jatuh tempo tidak ditebak (kelompok tersendiri)."],
      },
      tentu(aktif, "Utang Aktif", "Utang Aktif (belum lunas)", "Tidak ada utang aktif untuk filter ini."),
      tentu(aktif.filter(({ r }) => ["TERLAMBAT", "HARI_INI", "H1_7"].includes(r.kelompok)), "Jatuh Tempo", "Terlambat dan Jatuh Tempo ≤7 Hari", "Tidak ada faktur yang terlambat atau jatuh tempo dalam 7 hari.", ["Memuat faktur terlambat, jatuh tempo hari ini, dan 1–7 hari ke depan."]),
      tentu(aktif.filter(({ r }) => r.dibayarSebagian), "Dibayar Sebagian", "Faktur Dibayar Sebagian", "Tidak ada faktur yang dibayar sebagian."),
      tentu(semua.filter(({ r }) => r.kelompok === "LUNAS"), "Lunas", "Faktur Lunas", "Belum ada faktur lunas untuk filter ini."),
      tentu(aktif.filter(({ r }) => r.kelompok === "TANPA_JATUH_TEMPO"), "Tanpa Jatuh Tempo", "Faktur Tanpa Tanggal Jatuh Tempo", "Semua faktur aktif sudah punya tanggal jatuh tempo.", ["Data lama atau faktur yang belum diisi termin/tanggalnya. Sistem tidak menebak tanggal jatuh tempo."]),
    ],
  };
}

export default { kunci: "aging-utang", nama: "Aging Utang Supplier", izin: [P.FINANCE_READ], ambil };
