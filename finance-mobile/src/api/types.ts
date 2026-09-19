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

export type JenisApproval = "expense" | "purchase" | "bill" | "refund";

export type ApprovalItem = {
  id: string;
  jenis: JenisApproval;
  nomor: string;
  tanggal: string;
  diajukanOleh: string;
  keterangan: string;
  kategori: string | null;
  divisi: string | null;
  mode: string | null;
  amount: Money;
  adaBukti: boolean;
  /** Pengaju tidak boleh menyetujui pengajuannya sendiri (kecuali FINANCE_ADMIN). */
  bolehDisetujuiSaya: boolean;
};

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
