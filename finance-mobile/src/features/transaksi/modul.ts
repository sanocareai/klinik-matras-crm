import { Banknote, Building2, FileText, HandCoins, Receipt, RefreshCw, ShoppingCart, Users, Wallet, type LucideIcon } from "lucide-react-native";
import type { Capabilities, ModulTx } from "@/api/types";
import { has, type Need, type NeedMode } from "@/auth/capabilities";

// REGISTRI MODUL TRANSAKSI (S6–S8). Hanya tata letak & label; izin, status, dan aturan bisnis datang dari server (`aksi`) dan capabilities.
export type KonfigModul = {
  modul: ModulTx; label: string; tunggal: string; ikon: LucideIcon;
  /** Izin membuka daftar. */
  baca: Need;
  /** Izin membuat dokumen baru (null = tidak bisa dibuat dari aplikasi). */
  buat: { need: Need | Need[]; mode?: NeedMode } | null;
  tabs: { id: string; label: string }[];
  kosong: { judul: string; isi: string };
  cari: string;
  periode: boolean;
  deskripsi: string;
};

const TAB_DOK = [
  { id: "SEMUA", label: "Semua" }, { id: "DRAF", label: "Draf" }, { id: "MENUNGGU", label: "Menunggu" },
  { id: "DIPROSES", label: "Disetujui" }, { id: "SELESAI", label: "Dibayar" }, { id: "DITOLAK", label: "Ditolak/batal" },
];

export const KONFIG: Record<ModulTx, KonfigModul> = {
  pengeluaran: {
    modul: "pengeluaran", label: "Pengeluaran", tunggal: "pengeluaran", ikon: Receipt, baca: "financeRead", buat: { need: ["financePost", "expenseSubmit"], mode: "any" }, tabs: TAB_DOK,
    kosong: { judul: "Belum ada pengeluaran", isi: "Pengeluaran yang dicatat atau diajukan muncul di sini." }, cari: "Cari nomor, keterangan, nominal…", periode: true,
    deskripsi: "Biaya operasional & reimbursement",
  },
  pembelian: {
    modul: "pembelian", label: "Pembelian", tunggal: "pembelian", ikon: ShoppingCart, baca: "financeRead", buat: { need: ["financePost", "expenseSubmit"], mode: "any" }, tabs: TAB_DOK,
    kosong: { judul: "Belum ada pembelian", isi: "Pembelian bahan baku, aset, dan uang muka muncul di sini." }, cari: "Cari nomor, barang, nominal…", periode: true,
    deskripsi: "Bahan baku, aset, uang muka",
  },
  kasbon: {
    modul: "kasbon", label: "Kasbon", tunggal: "kasbon", ikon: HandCoins, baca: "financeRead", buat: { need: "financePost" },
    tabs: [{ id: "AKTIF", label: "Aktif" }, { id: "LUNAS", label: "Lunas" }, { id: "DIBATALKAN", label: "Dibatalkan" }, { id: "SEMUA", label: "Semua" }],
    kosong: { judul: "Belum ada kasbon", isi: "Kasbon karyawan yang dicatat muncul di sini." }, cari: "Cari karyawan, nomor, alasan…", periode: true, deskripsi: "Uang muka gaji karyawan",
  },
  pemasukan: {
    modul: "pemasukan", label: "Pemasukan Lain", tunggal: "pemasukan lain", ikon: Banknote, baca: "financeRead", buat: { need: "financePost" },
    tabs: [{ id: "AKTIF", label: "Aktif" }, { id: "DIBATALKAN", label: "Dibatalkan" }, { id: "SEMUA", label: "Semua" }],
    kosong: { judul: "Belum ada pemasukan lain", isi: "Bunga bank dan pemasukan non-order muncul di sini." }, cari: "Cari nomor, keterangan, nominal…", periode: true,
    deskripsi: "Di luar pembayaran order",
  },
  piutang: {
    modul: "piutang", label: "Piutang", tunggal: "piutang", ikon: Users, baca: "financeRead", buat: null,
    tabs: [{ id: "SEMUA", label: "Semua" }, { id: "LEWAT", label: "Lewat tempo" }, { id: "BERJALAN", label: "Belum jatuh tempo" }],
    kosong: { judul: "Tidak ada piutang", isi: "Semua tagihan pelanggan sudah lunas." }, cari: "Cari pelanggan, order, invoice…", periode: false, deskripsi: "Tagihan pelanggan & jatuh tempo",
  },
  refund: {
    modul: "refund", label: "Refund", tunggal: "refund", ikon: RefreshCw, baca: "financeRead", buat: { need: "financePost" },
    tabs: [{ id: "MENUNGGU", label: "Menunggu" }, { id: "DISETUJUI", label: "Disetujui" }, { id: "DITOLAK", label: "Ditolak" }, { id: "SEMUA", label: "Semua" }],
    kosong: { judul: "Belum ada refund", isi: "Pengembalian uang ke pelanggan muncul di sini." }, cari: "Cari nomor, order, pelanggan…", periode: false, deskripsi: "Pengembalian uang pelanggan",
  },
  supplier: {
    modul: "supplier", label: "Supplier", tunggal: "supplier", ikon: Building2, baca: "financeRead", buat: { need: "financePost" },
    tabs: [{ id: "AKTIF", label: "Aktif" }, { id: "NONAKTIF", label: "Nonaktif" }, { id: "SEMUA", label: "Semua" }],
    kosong: { judul: "Belum ada supplier", isi: "Supplier yang dicatat muncul di sini." }, cari: "Cari nama, kode, telepon…", periode: false, deskripsi: "Data supplier & sisa utang",
  },
  tagihan: {
    modul: "tagihan", label: "Tagihan supplier", tunggal: "tagihan", ikon: FileText, baca: "financeRead", buat: { need: "financePost" },
    tabs: [{ id: "TERBUKA", label: "Belum lunas" }, { id: "MENUNGGU", label: "Menunggu" }, { id: "LUNAS", label: "Lunas" }, { id: "DITOLAK", label: "Ditolak" }, { id: "SEMUA", label: "Semua" }],
    kosong: { judul: "Belum ada tagihan", isi: "Tagihan supplier yang dicatat muncul di sini." }, cari: "Cari nomor, supplier, keterangan…", periode: true, deskripsi: "Utang usaha & jatuh tempo",
  },
  "pembayaran-supplier": {
    modul: "pembayaran-supplier", label: "Pembayaran supplier", tunggal: "pembayaran supplier", ikon: Wallet, baca: "financeRead", buat: null,
    tabs: [{ id: "AKTIF", label: "Aktif" }, { id: "DIBATALKAN", label: "Dibatalkan" }, { id: "SEMUA", label: "Semua" }],
    kosong: { judul: "Belum ada pembayaran", isi: "Pembayaran tagihan supplier muncul di sini." }, cari: "Cari nomor, supplier, referensi…", periode: true, deskripsi: "Histori pembayaran tagihan",
  },
};

export const URUTAN_MODUL: ModulTx[] = ["pengeluaran", "pembelian", "kasbon", "pemasukan", "piutang", "refund", "tagihan", "supplier", "pembayaran-supplier"];

export const modulValid = (v: string | undefined): v is ModulTx => !!v && v in KONFIG;

export const bisaBuat = (caps: Capabilities | null | undefined, modul: ModulTx): boolean => {
  const b = KONFIG[modul].buat;
  return !!b && has(caps, b.need, b.mode ?? "all");
};
