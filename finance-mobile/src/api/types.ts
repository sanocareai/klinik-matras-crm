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
