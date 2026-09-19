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

export type Ember = { label: string; total: Money; jumlah: number };

export type DashboardData = {
  periode: { from: string; to: string };
  kasBank: KasBankItem[];
  totalKas: Money;
  labaRugi: {
    pendapatanBruto: Money; retur: Money; pendapatanBersih: Money; bebanPokok: Money;
    labaKotor: Money; bebanOperasional: Money; labaBersih: Money;
  };
  piutang: { total: Money; ember: Ember[]; menungguVerifikasi: { jumlah: number; total: Money } };
  utang: { total: Money; ember: Ember[] };
  antrean: {
    jumlahPembayaranBelumVerifikasi: number;
    lunasBelumDicatat: { jumlah: number; total: Money };
    pengeluaranMenunggu: number;
    pembelianMenunggu: number;
    tagihanMenunggu: number;
    refundMenunggu: number;
  };
  jurnalTerakhir: JurnalRingkas[];
  catatan: { gapTerbuka: number; saldoAwalTerisi: boolean; pesan: string[] };
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
