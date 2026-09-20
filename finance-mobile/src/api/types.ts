// TIPE RESPONS backend SANSS (ringkasan). Semua nilai uang bertipe Money (string desimal);
// hitungan bertipe number. Sumber: backend/src/routes/finance*.js (lihat docs/PRD_FINANCE_ANDROID.md §16).

import type { Money } from "@/lib/money";

export type Preset = "FINANCE" | "OWNER" | "APPROVER" | "ACCOUNTANT" | "SUBMITTER" | "NONE";

export type Capabilities = {
  financeRead: boolean;
  financePost: boolean;
  financeApprove: boolean;
  financeAdmin: boolean;
  paymentRead: boolean;
  paymentWrite: boolean;
  expenseSubmit: boolean;
  financeApp: boolean;
  preset: Preset;
};

export type SessionUser = {
  id: string;
  name: string;
  role: string;
  roles: string[];
  avatarUrl?: string | null;
};

export type LoginResponse = {
  tokenType: "Bearer";
  accessToken: string;
  expiresIn: number;
  accessTokenExpiresAt: string;
  refreshToken: string;
  refreshTokenExpiresAt: string;
  session: { id: string; deviceId: string };
  user: SessionUser;
  capabilities: Capabilities;
};

export type CashAccountKind = "KAS" | "BANK" | "EWALLET";

export type KasBankItem = {
  id: string;
  name: string;
  kind: CashAccountKind;
  /** Nama bank bila ada; nomor rekening TIDAK dibawa ke layar (PRD §13). */
  bankName: string | null;
  saldo: Money;
};

export type JurnalRingkas = {
  id: string;
  entryNumber: string;
  date: string;
  description: string;
  source: string;
  status: string;
  total: Money;
};

/** Satu baris umur piutang/utang. Server hanya mengirim total per ember (bukan jumlah dokumen). */
export type Ember = { label: string; total: Money; jumlah: number | null };

export type LabaRugiRingkas = {
  pendapatanBruto: Money; retur: Money; pendapatanBersih: Money; bebanPokok: Money;
  labaKotor: Money; bebanOperasional: Money; labaBersih: Money;
  /** Persen dari server (bukan uang). null bila tidak dikirim. */
  marginKotor: number | null;
  marginBersih: number | null;
};

export type AntreanRingkas = {
  jumlahPembayaranBelumVerifikasi: number;
  lunasBelumDicatat: { jumlah: number; total: Money; baru: { jumlah: number; total: Money } | null; lama: { jumlah: number; total: Money } | null };
  pengeluaranMenunggu: number;
  pembelianMenunggu: number;
  tagihanMenunggu: number;
  refundMenunggu: number;
};

export type CatatanPembukuan = {
  gapTerbuka: number;
  saldoAwalTerisi: boolean;
  mulaiPembukuan: string | null;
  periodeTerbuka: number | null;
  pesan: string[];
};

/** Bagian respons dashboard. Bila salah satu tidak ada di payload, ia dicatat di `bagianHilang` (data parsial). */
export type BagianDashboard = "kasBank" | "labaRugi" | "piutang" | "utang" | "antrean" | "jurnal" | "catatan";

export type DashboardData = {
  periode: { from: string; to: string };
  kasBank: KasBankItem[];
  totalKas: Money | null;
  labaRugi: LabaRugiRingkas | null;
  piutang: { total: Money; ember: Ember[]; menungguVerifikasi: { jumlah: number; total: Money } | null } | null;
  utang: { total: Money; ember: Ember[] } | null;
  antrean: AntreanRingkas | null;
  /** Gerbang verifikasi pembayaran: aktif = antrean verifikasi memengaruhi status bayar di CRM. */
  gate: { aktif: boolean; sejak: string | null } | null;
  jurnalTerakhir: JurnalRingkas[];
  catatan: CatatanPembukuan | null;
  bagianHilang: BagianDashboard[];
};

export type TrenBulan = { bulan: string; pendapatanBersih: Money; beban: Money };

// ─── Inbox Persetujuan (S4) — bentuk read-model server: GET /api/finance/approvals ───────────────────────
export type JenisApproval = "expense" | "purchase" | "bill" | "refund";
export type TahapApproval = "MENUNGGU" | "DIPROSES" | "DISETUJUI" | "DITOLAK";

/** Keputusan yang boleh diambil pengguna ini — dihitung SERVER (izin + pemisahan tugas + syarat bukti). Klien tidak menghitung ulang. */
export type AksiKeputusan = { boleh: boolean; alasan: string | null; path: string; alasanWajib?: boolean };

export type ApprovalItem = {
  kunci: string;
  id: string;
  jenis: JenisApproval;
  jenisLabel: string;
  nomor: string;
  tanggal: string;
  diajukanPada: string;
  umurHari: number;
  pemohon: { id: string; name: string } | null;
  nominal: Money;
  keterangan: string;
  kategori: string | null;
  rekening: string | null;
  pihak: string | null;
  nomorOrder: string | null;
  mode: string | null;
  status: string;
  statusLabel: string;
  tahap: TahapApproval;
  adaLampiran: boolean;
  alasanTolak: string | null;
  diputuskanOleh: { id: string; name: string } | null;
  diputuskanPada: string | null;
  syarat: { terpenuhi: false; pesan: string } | null;
  aksi: { setujui: AksiKeputusan; tolak: AksiKeputusan };
};

export type LampiranApproval = { id: string; jenis: "foto" | "tautan"; url: string | null; thumbUrl: string | null; kedaluwarsa: string | null };
export type RiwayatApproval = { waktu: string; peristiwa: string; label: string; oleh: string | null; catatan: string | null };

export type ApprovalDetail = ApprovalItem & {
  rincian: Record<string, string | boolean | null>;
  lampiran: LampiranApproval[];
  riwayat: RiwayatApproval[];
};

export type HitungTab = Record<TahapApproval, number>;
export type ApprovalHalaman = { items: ApprovalItem[]; tab: TahapApproval; page: number; limit: number; total: number; adaLagi: boolean; hitung: HitungTab };
export type FilterApproval = { tab: TahapApproval; jenis: JenisApproval[]; from: string | null; to: string | null; pemohonId: string | null; q: string };

// ─── Pembayaran pelanggan (S5) — read-model server: GET /api/finance/pembayaran ──────────────────────────
// Status, jenis (DP/cicilan/pelunasan), peringatan, tagihan, dan `aksi` semuanya dihitung SERVER. Klien hanya memetakan.
export type StatusBayar = "MENUNGGU" | "TERVERIFIKASI" | "DITOLAK" | "DIBATALKAN";
export type TabBayar = "MENUNGGU" | "TERVERIFIKASI" | "DITOLAK";
export type MetodeBayar = "CASH" | "TRANSFER" | "QRIS" | "CARD";
export type JenisBayar = "DP" | "CICILAN" | "PELUNASAN";
export type Orang = { id: string; name: string };
export type AksiPembayaran = { boleh: boolean; alasan: string | null; path: string; alasanWajib?: boolean };

export type PembayaranItem = {
  id: string;
  status: StatusBayar;
  statusLabel: string;
  nominal: Money;
  metode: MetodeBayar | string;
  metodeLabel: string;
  jenis: JenisBayar | null;
  dicatatPada: string;
  tanggal: string;
  order: { id: string; nomor: string; nilai: Money; statusBayar: string } | null;
  pelanggan: Orang | null;
  rekening: Orang | null;
  pencatat: Orang | null;
  sumber: "PENGIRIMAN" | "CRM";
  adaBukti: boolean;
  adaAlokasi: boolean;
  verifikasi: { oleh: Orang | null; pada: string | null } | null;
  pembatalan: { oleh: Orang | null; pada: string | null; alasan: string | null } | null;
  aksi: { verifikasi: AksiPembayaran; tolak: AksiPembayaran };
};

export type BuktiBayar = { jenis: "gambar" | "pdf" | "tautan"; url: string | null; thumbUrl: string | null; kedaluwarsa: string | null };
export type PeringatanBayar = { kode: string; pesan: string };
export type PembayaranDetail = PembayaranItem & {
  tagihan: { nilaiOrder: Money; terbayarTerhitung: Money; sisa: Money; sisaSetelahIni: Money; gerbangVerifikasi: boolean; terhitungSebelumVerifikasi: boolean } | null;
  invoice: { nomor: string; status: string; jatuhTempo: string | null } | null;
  statusOrder: string | null;
  alokasi: { orderId: string; nomor: string | null; nominal: Money; catatan: string | null }[];
  jurnal: { nomor: string | null; status: string; tanggal: string | null } | null;
  belumDibukukan: { pesan: string } | null;
  bukti: BuktiBayar | null;
  /** Field yang memang TIDAK ada di model Payment (mis. referensi, pengirim, catatan) — dinyatakan jujur, bukan dikosongkan diam-diam. */
  tidakTercatat: string[];
  peringatan: PeringatanBayar[];
  riwayat: RiwayatApproval[];
};

export type RingkasanBayar = {
  menunggu: { jumlah: number; nominal: Money };
  terverifikasi: { jumlah: number; nominal: Money };
  ditolak: { jumlah: number; nominal: Money };
  dibatalkan: { jumlah: number; nominal: Money };
  totalMasuk: Money;
};
export type PembayaranHalaman = {
  items: PembayaranItem[];
  nextCursor: string | null;
  hitung: Record<StatusBayar, number>;
  ringkasan: RingkasanBayar;
  diperbaruiPada: string | null;
};
export type FilterPembayaran = { tab: TabBayar; metode: MetodeBayar | null; rekeningId: string | null; from: string | null; to: string | null; q: string };
export type OpsiBayar = { rekening: { id: string; name: string; kind: string }[]; metode: { id: string; label: string }[] };

export type TransaksiItem = {
  id: string;
  jenis: "pengeluaran" | "pembelian" | "kasbon" | "pembayaran" | "jurnal";
  nomor: string;
  tanggal: string;
  judul: string;
  sub: string;
  amount: Money;
  status: string;
  arah: "keluar" | "masuk" | "netral";
};

export type BarisLaporan = { kode?: string; nama: string; nilai: Money };

export type LaporanRingkas = {
  judul: string;
  periode: string;
  ringkasan: { label: string; nilai: Money; tebal?: boolean }[];
  kelompok: { judul: string; baris: BarisLaporan[] }[];
  catatan: string[];
  seimbang?: boolean;
};

export type JenisLaporan = "laba-rugi" | "neraca" | "arus-kas" | "neraca-saldo" | "umur-piutang" | "umur-utang";

// ── S6–S8: transaksi (Pengeluaran, Pembelian, Kasbon, Pemasukan Lain, Piutang, Refund, Supplier, Tagihan, Pembayaran supplier) ──────
export type ModulTx = "pengeluaran" | "pembelian" | "kasbon" | "pemasukan" | "piutang" | "refund" | "supplier" | "tagihan" | "pembayaran-supplier";
export type NadaTx = "success" | "warning" | "danger" | "info" | "neutral";
/** Tindakan pada satu dokumen — boleh/tidaknya, alasan, alamat perintah, dan isian yang dibutuhkan dihitung SERVER. */
export type AksiTx = { boleh: boolean; alasan: string | null; path: string; metode: "POST" | "PATCH"; perlu: string[]; tetap: Record<string, string> | null };
export type TautanTx = { modul: ModulTx; id: string };
export type ItemTx = {
  kunci: string; id: string; modul: ModulTx; nomor: string; tanggal: string | null; nominal: Money; judul: string; sub: string; pihak: string | null; rekening: string | null;
  status: string; statusLabel: string; nada: NadaTx; jatuhTempo: string | null; umurHari: number | null; sisa: Money | null; terbayar: Money | null;
  adaLampiran: boolean; notaWajib: boolean; jumlahTagihanTerbuka: number | null; ember: string | null;
  /** Dokumen menunggu yang boleh diputuskan pengguna ini → dibuka di Inbox Persetujuan (S4). */
  persetujuan: { jenis: JenisApproval; id: string } | null;
  aksi: Record<string, AksiTx>;
};
export type BarisTx = { label: string; nilai: string; jenis: "teks" | "uang" | "tanggal" | "waktu"; tautan: TautanTx | null };
export type BagianTx = { judul: string; baris: BarisTx[] };
export type PembayaranPiutang = {
  id: string; nominal: Money; metode: string; tanggal: string; status: string; statusLabel: string; asalOrderId: string;
  alokasi: { orderId: string; nomor: string | null; nominal: Money }[]; aksiAlokasi: AksiTx;
};
export type SupplierInfo = { telepon: string | null; email: string | null; alamat: string | null; terminHari: number | null; bank: string | null; rekeningBank: string | null; atasNama: string | null; catatan: string | null; aktif: boolean };
export type DetailTx = ItemTx & {
  bagian: BagianTx[]; lampiran: LampiranApproval[]; riwayat: RiwayatApproval[]; catatan: string | null; syarat: string | null;
  pembayaran: PembayaranPiutang[]; orderPelanggan: { id: string; nomor: string | null }[]; supplier: SupplierInfo | null;
};
export type RingkasanTx = {
  total: Money | null; totalSemua: Money | null; sisaAktif: Money | null; utangTerbuka: Money | null;
  lewatTempo: { jumlah: number; total: Money } | null; umur: Record<string, Money> | null; menungguVerifikasi: { jumlah: number; total: Money } | null;
};
export type HalamanTx = { items: ItemTx[]; tab: string; page: number; total: number; adaLagi: boolean; hitung: Record<string, number>; ringkasan: RingkasanTx; diperbaruiPada: string | null };
export type FilterTx = { modul: ModulTx; tab: string; q: string; from: string | null; to: string | null; supplierId?: string | null; jatuhTempoLewat?: boolean };
export type KategoriTx = { id: string; code: string; name: string; division?: string | null };
export type OpsiForm = {
  kategoriPengeluaran: KategoriTx[]; kategoriPembelian: KategoriTx[]; rekening: { id: string; name: string; kind: string; saldo: Money }[];
  supplier: { id: string; code: string; name: string; paymentTermDays: number | null }[]; akunPemasukanLain: { id: string; code: string; name: string }[];
  karyawan: { id: string; name: string }[]; mode: { id: string; label: string }[]; hanyaReimbursement: boolean; ambangNotaRupiah: Money;
};
export type OrderRefund = { id: string; nomor: string; pelanggan: string; nilai: Money; sisaBisaDirefund: Money };
export type RingkasanModul = Record<string, Record<string, number>>;
export type HasilUnggah = { url: string; dipakaiDi: string[] };
