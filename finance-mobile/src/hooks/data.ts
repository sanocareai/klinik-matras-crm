import { useQuery } from "@tanstack/react-query";
import { ENV } from "@/lib/env";
import { periodeBulanIni } from "@/lib/dates";
import { fetchDashboard } from "@/api/finance";
import { approvalContoh, dashboardContoh, laporanContoh, transaksiContoh, trenContoh } from "@/mocks/data";
import type { ApprovalItem, DashboardData, JenisLaporan, LaporanRingkas, TransaksiItem, TrenBulan } from "@/api/types";

// HOOK DATA — satu tempat yang memilih sumber: data contoh (dev) atau server.
// Endpoint yang belum disambungkan menghasilkan galat "Segera hadir" di build non-contoh
// (TIDAK pernah diam-diam jatuh ke data karangan).

export class BelumTersedia extends Error {
  constructor(nama: string) {
    super(`${nama} belum tersambung ke server pada versi ini`);
    this.name = "BelumTersedia";
  }
}

const tunda = <T,>(v: T, ms = 350) => new Promise<T>((res) => setTimeout(() => res(v), ms));

export function useDashboard() {
  const periode = periodeBulanIni();
  return useQuery<DashboardData>({
    queryKey: ["dashboard", periode.from, periode.to, ENV.useMocks],
    queryFn: () => (ENV.useMocks ? tunda(dashboardContoh) : fetchDashboard(periode)),
    staleTime: 60_000,
  });
}

/** Tren 6 bulan: belum ada endpoint server (gap G-09) → hanya data contoh; di server asli tidak tampil. */
export function useTren() {
  return useQuery<TrenBulan[] | null>({
    queryKey: ["tren", ENV.useMocks],
    queryFn: () => (ENV.useMocks ? tunda(trenContoh) : Promise.resolve(null)),
    staleTime: 5 * 60_000,
  });
}

export function useApprovals() {
  return useQuery<ApprovalItem[]>({
    queryKey: ["approvals", ENV.useMocks],
    queryFn: () => (ENV.useMocks ? tunda(approvalContoh) : Promise.reject(new BelumTersedia("Daftar persetujuan"))),
    retry: false,
  });
}

export function useTransaksi() {
  return useQuery<TransaksiItem[]>({
    queryKey: ["transaksi", ENV.useMocks],
    queryFn: () => (ENV.useMocks ? tunda(transaksiContoh) : Promise.reject(new BelumTersedia("Daftar transaksi"))),
    retry: false,
  });
}

export function useLaporan(jenis: JenisLaporan) {
  return useQuery<LaporanRingkas>({
    queryKey: ["laporan", jenis, ENV.useMocks],
    queryFn: () => (ENV.useMocks ? tunda(laporanContoh[jenis]) : Promise.reject(new BelumTersedia("Laporan"))),
    retry: false,
  });
}
