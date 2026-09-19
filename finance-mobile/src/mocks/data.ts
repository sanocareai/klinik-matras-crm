// DATA CONTOH — hanya untuk pengembangan/uji tampilan (ENV.useMocks, tidak pernah aktif di production).
// Bentuk & istilah mengikuti data Klinik Matras (SANOBANK Kemal, PT Sano, kasbon = gaji dicairkan lebih awal).
// Angka di sini karangan: TIDAK BOLEH dipakai sebagai referensi keuangan.

import { toMoney } from "@/lib/money";
import type {
  ApprovalItem, DashboardData, JenisLaporan, LaporanRingkas, TransaksiItem, TrenBulan,
} from "@/api/types";

const m = toMoney;

export const dashboardContoh: DashboardData = {
  periode: { from: "2026-09-01", to: "2026-09-30" },
  kasBank: [
    { id: "kb1", name: "SANOBANK Kemal", kind: "BANK", saldo: m("158420350.00") },
    { id: "kb2", name: "PT Sano", kind: "BANK", saldo: m("96780125.50") },
    { id: "kb3", name: "Kas Kantor", kind: "KAS", saldo: m("12450000.00") },
    { id: "kb4", name: "QRIS / e-wallet", kind: "EWALLET", saldo: m("5300250.00") },
  ],
  totalKas: m("272950725.50"),
  labaRugi: {
    pendapatanBruto: m("418600000.00"), retur: m("3200000.00"), pendapatanBersih: m("415400000.00"),
    bebanPokok: m("201350000.00"), labaKotor: m("214050000.00"), bebanOperasional: m("172300000.00"), labaBersih: m("41750000.00"),
  },
  piutang: {
    total: m("236900000.00"),
    ember: [
      { label: "Belum jatuh tempo", total: m("118400000.00"), jumlah: 14 },
      { label: "1–30 hari", total: m("64200000.00"), jumlah: 9 },
      { label: "31–60 hari", total: m("31800000.00"), jumlah: 5 },
      { label: "61–90 hari", total: m("14500000.00"), jumlah: 3 },
      { label: "> 90 hari", total: m("8000000.00"), jumlah: 2 },
    ],
    menungguVerifikasi: { jumlah: 12, total: m("38600000.00") },
  },
  utang: {
    total: m("57450000.00"),
    ember: [
      { label: "Belum jatuh tempo", total: m("31200000.00"), jumlah: 4 },
      { label: "1–30 hari", total: m("18750000.00"), jumlah: 3 },
      { label: "31–60 hari", total: m("7500000.00"), jumlah: 1 },
      { label: "61–90 hari", total: m("0.00"), jumlah: 0 },
      { label: "> 90 hari", total: m("0.00"), jumlah: 0 },
    ],
  },
  antrean: {
    jumlahPembayaranBelumVerifikasi: 4,
    lunasBelumDicatat: { jumlah: 12, total: m("38600000.00") },
    pengeluaranMenunggu: 3,
    pembelianMenunggu: 2,
    tagihanMenunggu: 1,
    refundMenunggu: 1,
  },
  jurnalTerakhir: [
    { id: "j1", entryNumber: "JV-19092026-014", date: "2026-09-19", description: "Pembelian kain Ekstra Fleece — CV Tekstil Jaya", source: "PEMBELIAN", status: "POSTED", total: m("18450000.00") },
    { id: "j2", entryNumber: "JV-19092026-013", date: "2026-09-19", description: "Pelunasan piutang order RES-05092026-027", source: "PEMBAYARAN_ORDER", status: "POSTED", total: m("4750000.00") },
    { id: "j3", entryNumber: "JV-18092026-011", date: "2026-09-18", description: "Kasbon — Ujang Sigit", source: "KASBON", status: "POSTED", total: m("500000.00") },
    { id: "j4", entryNumber: "JV-18092026-010", date: "2026-09-18", description: "Upah harian tukang jahit (Ferdy)", source: "PENGELUARAN", status: "POSTED", total: m("1350000.00") },
    { id: "j5", entryNumber: "JV-18092026-009", date: "2026-09-18", description: "Transfer SANOBANK Kemal → PT Sano", source: "TRANSFER_KAS", status: "POSTED", total: m("25000000.00") },
    { id: "j6", entryNumber: "JV-17092026-021", date: "2026-09-17", description: "Bensin kendaraan operasional (Apriansyah)", source: "BIAYA_KENDARAAN", status: "POSTED", total: m("385000.00") },
    { id: "j7", entryNumber: "JV-17092026-020", date: "2026-09-17", description: "Pengakuan pendapatan order NEW-12092026-004", source: "PENGAKUAN_PENDAPATAN", status: "POSTED", total: m("12900000.00") },
    { id: "j8", entryNumber: "JV-17092026-018", date: "2026-09-17", description: "Biaya iklan Meta Ads (Digital & Technology)", source: "BIAYA_IKLAN", status: "POSTED", total: m("7250000.00") },
  ],
  catatan: {
    gapTerbuka: 2,
    saldoAwalTerisi: true,
    pesan: ["2 transaksi belum bisa dibukukan (lihat Data Belum Lengkap). Selama itu belum dibereskan, angka di laporan ini KURANG dari kenyataan."],
  },
};

export const trenContoh: TrenBulan[] = [
  { bulan: "2026-04", pendapatanBersih: m("286000000.00"), beban: m("241000000.00") },
  { bulan: "2026-05", pendapatanBersih: m("331500000.00"), beban: m("276300000.00") },
  { bulan: "2026-06", pendapatanBersih: m("302400000.00"), beban: m("289900000.00") },
  { bulan: "2026-07", pendapatanBersih: m("368800000.00"), beban: m("301200000.00") },
  { bulan: "2026-08", pendapatanBersih: m("397200000.00"), beban: m("346800000.00") },
  { bulan: "2026-09", pendapatanBersih: m("415400000.00"), beban: m("373650000.00") },
];

export const approvalContoh: ApprovalItem[] = [
  { id: "ap1", jenis: "expense", nomor: "EXP-19092026-006", tanggal: "2026-09-19", diajukanOleh: "Natasha", keterangan: "Sewa forklift bongkar kain (2 hari)", kategori: "Sewa alat", divisi: "GUDANG", mode: "LANGSUNG", amount: m("2500000.00"), adaBukti: true, bolehDisetujuiSaya: true },
  { id: "ap2", jenis: "purchase", nomor: "PUR-19092026-003", tanggal: "2026-09-19", diajukanOleh: "Natasha", keterangan: "Busa HD density 26 — 40 lembar", kategori: "Bahan Baku (input manual)", divisi: "PRODUKSI", mode: "LANGSUNG", amount: m("14800000.00"), adaBukti: true, bolehDisetujuiSaya: true },
  { id: "ap3", jenis: "expense", nomor: "EXP-18092026-011", tanggal: "2026-09-18", diajukanOleh: "Imam", keterangan: "Upah lembur tukang finishing", kategori: "Upah produksi", divisi: "PRODUKSI", mode: "REIMBURSEMENT", amount: m("1250000.00"), adaBukti: false, bolehDisetujuiSaya: true },
  { id: "ap4", jenis: "bill", nomor: "BILL-17092026-002", tanggal: "2026-09-17", diajukanOleh: "Natasha", keterangan: "Tagihan CV Tekstil Jaya — kain Sept minggu 3", kategori: null, divisi: null, mode: null, amount: m("18450000.00"), adaBukti: true, bolehDisetujuiSaya: true },
  { id: "ap5", jenis: "refund", nomor: "RFD-17092026-001", tanggal: "2026-09-17", diajukanOleh: "Natasha", keterangan: "Refund order RES-02092026-014 (batal servis)", kategori: null, divisi: null, mode: null, amount: m("1750000.00"), adaBukti: true, bolehDisetujuiSaya: true },
  { id: "ap6", jenis: "expense", nomor: "EXP-16092026-009", tanggal: "2026-09-16", diajukanOleh: "Gilang", keterangan: "Meeting survey supplier kain (bensin & makan)", kategori: "Meeting & survey", divisi: "MANAGEMENT", mode: "REIMBURSEMENT", amount: m("640000.00"), adaBukti: true, bolehDisetujuiSaya: false },
];

export const transaksiContoh: TransaksiItem[] = [
  { id: "t1", jenis: "pengeluaran", nomor: "EXP-19092026-006", tanggal: "2026-09-19", judul: "Sewa forklift bongkar kain", sub: "Sewa alat · Gudang · Natasha", amount: m("2500000.00"), status: "MENUNGGU_APPROVAL", arah: "keluar" },
  { id: "t2", jenis: "pembelian", nomor: "PUR-19092026-003", tanggal: "2026-09-19", judul: "Busa HD density 26 — 40 lembar", sub: "Bahan Baku (input manual) · Produksi", amount: m("14800000.00"), status: "MENUNGGU_APPROVAL", arah: "keluar" },
  { id: "t3", jenis: "pembayaran", nomor: "RES-05092026-027", tanggal: "2026-09-19", judul: "Pelunasan — Erni", sub: "Transfer · SANOBANK Kemal · sales Risel", amount: m("4750000.00"), status: "TERVERIFIKASI", arah: "masuk" },
  { id: "t4", jenis: "kasbon", nomor: "KSB-18092026-004", tanggal: "2026-09-18", judul: "Ujang Sigit", sub: "Biaya berobat anak · sisa Rp 500.000", amount: m("500000.00"), status: "AKTIF", arah: "keluar" },
  { id: "t5", jenis: "pengeluaran", nomor: "EXP-18092026-010", tanggal: "2026-09-18", judul: "Upah harian tukang jahit", sub: "Upah produksi · Produksi · Ferdy", amount: m("1350000.00"), status: "DIBAYAR", arah: "keluar" },
  { id: "t6", jenis: "pembayaran", nomor: "NEW-12092026-004", tanggal: "2026-09-18", judul: "DP kasur baru — Ibu Sari", sub: "QRIS · menunggu dicek uang masuknya", amount: m("3000000.00"), status: "BELUM_DIVERIFIKASI", arah: "masuk" },
  { id: "t7", jenis: "jurnal", nomor: "JV-18092026-009", tanggal: "2026-09-18", judul: "Transfer SANOBANK Kemal → PT Sano", sub: "Transfer kas · Terbukukan", amount: m("25000000.00"), status: "POSTED", arah: "netral" },
  { id: "t8", jenis: "pengeluaran", nomor: "EXP-17092026-014", tanggal: "2026-09-17", judul: "Bensin kendaraan operasional", sub: "Biaya kendaraan · Delivery · Apriansyah", amount: m("385000.00"), status: "DIBAYAR", arah: "keluar" },
  { id: "t9", jenis: "kasbon", nomor: "KSB-15092026-003", tanggal: "2026-09-15", judul: "Agung", sub: "Kebutuhan sekolah · dipotong dari gaji", amount: m("750000.00"), status: "LUNAS", arah: "keluar" },
];

const l = (judul: string, periode: string, ringkasan: LaporanRingkas["ringkasan"], kelompok: LaporanRingkas["kelompok"], extra: Partial<LaporanRingkas> = {}): LaporanRingkas => ({
  judul, periode, ringkasan, kelompok, catatan: dashboardContoh.catatan.pesan, ...extra,
});

export const laporanContoh: Record<JenisLaporan, LaporanRingkas> = {
  "laba-rugi": l("Laba Rugi", "September 2026", [
    { label: "Pendapatan bersih", nilai: m("415400000.00") },
    { label: "Laba kotor", nilai: m("214050000.00") },
    { label: "Laba bersih", nilai: m("41750000.00"), tebal: true },
  ], [
    { judul: "Pendapatan", baris: [{ kode: "4-1100", nama: "Pendapatan Kasur Baru", nilai: m("262300000.00") }, { kode: "4-1200", nama: "Pendapatan Layanan Upgrade", nilai: m("156300000.00") }] },
    { judul: "Beban pokok", baris: [{ kode: "5-1100", nama: "HPP Bahan Baku", nilai: m("174200000.00") }, { kode: "5-1150", nama: "Pembelian Bahan Baku (Input Manual)", nilai: m("27150000.00") }] },
    { judul: "Beban operasional", baris: [{ kode: "6-1100", nama: "Beban Gaji", nilai: m("96400000.00") }, { kode: "6-2100", nama: "Beban Iklan", nilai: m("41200000.00") }, { kode: "6-3100", nama: "Beban Kendaraan", nilai: m("14700000.00") }, { kode: "6-9900", nama: "Beban Lain-lain", nilai: m("20000000.00") }] },
  ]),
  neraca: l("Neraca", "per 19 September 2026", [
    { label: "Total aset", nilai: m("612300000.00") },
    { label: "Total kewajiban", nilai: m("94850000.00") },
    { label: "Total ekuitas", nilai: m("517450000.00"), tebal: true },
  ], [
    { judul: "Aset", baris: [{ kode: "1-1100", nama: "Kas & Bank", nilai: m("272950725.50") }, { kode: "1-1300", nama: "Piutang Usaha", nilai: m("236900000.00") }, { kode: "1-1350", nama: "Piutang Karyawan", nilai: m("3250000.00") }, { kode: "1-1400", nama: "Persediaan", nilai: m("99199274.50") }] },
    { judul: "Kewajiban", baris: [{ kode: "2-1100", nama: "Utang Usaha", nilai: m("57450000.00") }, { kode: "2-1300", nama: "Uang Muka Pelanggan", nilai: m("37400000.00") }] },
    { judul: "Ekuitas", baris: [{ kode: "3-1100", nama: "Modal", nilai: m("475700000.00") }, { kode: "3-9000", nama: "Laba tahun berjalan", nilai: m("41750000.00") }] },
  ], { seimbang: true }),
  "arus-kas": l("Arus Kas", "September 2026", [
    { label: "Kas masuk", nilai: m("389200000.00") },
    { label: "Kas keluar", nilai: m("351750000.00") },
    { label: "Arus bersih", nilai: m("37450000.00"), tebal: true },
  ], [
    { judul: "Operasi", baris: [{ nama: "Penerimaan dari pelanggan", nilai: m("389200000.00") }, { nama: "Pembayaran ke supplier", nilai: m("-201350000.00") }, { nama: "Pembayaran gaji & operasional", nilai: m("-150400000.00") }] },
  ]),
  "neraca-saldo": l("Neraca Saldo", "September 2026", [
    { label: "Total debit", nilai: m("1284600000.00") },
    { label: "Total kredit", nilai: m("1284600000.00") },
    { label: "Selisih", nilai: m("0.00"), tebal: true },
  ], [
    { judul: "Akun", baris: [{ kode: "1-1100", nama: "Kas & Bank", nilai: m("272950725.50") }, { kode: "1-1300", nama: "Piutang Usaha", nilai: m("236900000.00") }, { kode: "2-1100", nama: "Utang Usaha", nilai: m("57450000.00") }] },
  ], { seimbang: true }),
  "umur-piutang": l("Umur Piutang", "per 19 September 2026", [
    { label: "Total piutang", nilai: m("236900000.00"), tebal: true },
    { label: "Menunggu verifikasi (Lunas di CRM)", nilai: m("38600000.00") },
  ], [
    { judul: "Per umur", baris: dashboardContoh.piutang.ember.map((e) => ({ nama: e.label, nilai: e.total })) },
  ]),
  "umur-utang": l("Umur Utang", "per 19 September 2026", [
    { label: "Total utang", nilai: m("57450000.00"), tebal: true },
  ], [
    { judul: "Per umur", baris: dashboardContoh.utang.ember.map((e) => ({ nama: e.label, nilai: e.total })) },
  ]),
};
