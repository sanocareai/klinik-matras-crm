import type { Capabilities } from "@/api/types";

// CAPABILITY GUARD — semua menu, tombol, route, dan command bergantung pada `capabilities` dari server
// (GET /auth/me). Klien TIDAK menyalin peta role→izin: nama role hanya dipakai untuk tata letak
// (`preset`), bukan untuk izin. Server tetap penentu akhir (403 diperlakukan sebagai kejadian normal).

export type Need =
  | "financeRead" | "financePost" | "financeApprove" | "financeAdmin"
  | "paymentRead" | "paymentWrite" | "expenseSubmit";

export type NeedMode = "all" | "any";

export function has(caps: Capabilities | null | undefined, need: Need | Need[], mode: NeedMode = "all"): boolean {
  if (!caps) return false;
  const daftar = Array.isArray(need) ? need : [need];
  if (daftar.length === 0) return true;
  return mode === "any" ? daftar.some((n) => caps[n] === true) : daftar.every((n) => caps[n] === true);
}

export const LABEL_NEED: Record<Need, string> = {
  financeRead: "membaca laporan dan data keuangan",
  financePost: "mencatat transaksi",
  financeApprove: "menyetujui atau menolak pengajuan",
  financeAdmin: "administrasi keuangan (koreksi, pembatalan, tinjau bukti)",
  paymentRead: "melihat pembayaran pelanggan",
  paymentWrite: "memverifikasi pembayaran pelanggan",
  expenseSubmit: "mengajukan pengeluaran",
};

/** Daftar kemampuan yang dimiliki pengguna, untuk ditampilkan di layar Keamanan ("Hak akses Anda"). */
export function ringkasHakAkses(caps: Capabilities | null | undefined): { need: Need; label: string; boleh: boolean }[] {
  const urutan: Need[] = ["financeRead", "financePost", "financeApprove", "paymentWrite", "financeAdmin"];
  return urutan.map((need) => ({ need, label: LABEL_NEED[need], boleh: has(caps, need) }));
}

export class AksesDitolak extends Error {
  readonly need: Need[];
  constructor(need: Need | Need[]) {
    const daftar = Array.isArray(need) ? need : [need];
    super(`Akun Anda tidak punya izin untuk ${daftar.map((n) => LABEL_NEED[n]).join(" dan ")}.`);
    this.name = "AksesDitolak";
    this.need = daftar;
  }
}

export function assertCan(caps: Capabilities | null | undefined, need: Need | Need[], mode: NeedMode = "all"): void {
  if (!has(caps, need, mode)) throw new AksesDitolak(need);
}

/** Boleh melihat tombol "+" (FAB)? Hanya yang boleh mencatat atau memverifikasi pembayaran. */
export function bisaMencatatAtauVerifikasi(caps: Capabilities | null | undefined): boolean {
  return has(caps, ["financePost", "paymentWrite"], "any");
}

export type NamaTab = "index" | "transaksi" | "persetujuan" | "laporan" | "lainnya";

/** Izin yang dibutuhkan tiap tab. Tab tanpa izin tidak ditampilkan dan layarnya ditolak. */
export const NEED_TAB: Record<NamaTab, Need | undefined> = {
  index: "financeRead",
  transaksi: "financeRead",
  persetujuan: "financeApprove",
  laporan: "financeRead",
  lainnya: undefined,
};

export function tabTerlihat(caps: Capabilities | null | undefined): NamaTab[] {
  return (Object.keys(NEED_TAB) as NamaTab[]).filter((t) => !NEED_TAB[t] || has(caps, NEED_TAB[t] as Need));
}
