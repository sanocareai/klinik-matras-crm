import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ENV } from "@/lib/env";
import { ApiError } from "@/api/errors";
import { fetchLencanaBayar, fetchOpsiBayar, fetchPembayaran, fetchPembayaranDetail } from "@/api/pembayaran";
import { mockDaftarBayar, mockDetailBayar, mockLencanaBayar, mockOpsiBayar } from "@/mocks/pembayaran";
import { getSkenario } from "@/mocks/skenario";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import type { FilterPembayaran, OpsiBayar, PembayaranDetail, PembayaranHalaman } from "@/api/types";

// HOOK DATA PEMBAYARAN PELANGGAN — sumber: server (atau server contoh di mode contoh). Setelah keputusan, semua query "pembayaran"
// (dan dashboard, karena hitungan antrean verifikasi) diambil ulang dari server: status resmi, bukan tebakan klien.

const skenario = () => (ENV.useMocks ? getSkenario() : "");
const tanpaUlang4xx = (n: number, e: unknown) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500);

export function usePembayaranList(filter: FilterPembayaran) {
  return useInfiniteQuery<PembayaranHalaman, Error, { pages: PembayaranHalaman[] }, unknown[], string | null>({
    queryKey: ["pembayaran", "daftar", filter.tab, filter.metode, filter.rekeningId, filter.from, filter.to, filter.q.trim(), ENV.useMocks, skenario()],
    queryFn: ({ pageParam }) => (ENV.useMocks ? mockDaftarBayar(filter, pageParam) : fetchPembayaran(filter, pageParam)),
    initialPageParam: null,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: tanpaUlang4xx,
  });
}

export function usePembayaranDetail(id: string) {
  return useQuery<PembayaranDetail>({
    queryKey: ["pembayaran", "detail", id, ENV.useMocks, skenario()],
    queryFn: () => (ENV.useMocks ? mockDetailBayar(id) : fetchPembayaranDetail(id)),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: tanpaUlang4xx,
  });
}

/** Jumlah pembayaran menunggu verifikasi (lencana). Untuk yang boleh membaca data keuangan. */
export function usePembayaranLencana() {
  const caps = useSession((s) => s.capabilities);
  return useQuery<number>({
    queryKey: ["pembayaran", "lencana", ENV.useMocks, skenario()],
    queryFn: () => (ENV.useMocks ? mockLencanaBayar() : fetchLencanaBayar()),
    enabled: has(caps, "financeRead"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: tanpaUlang4xx,
  });
}

export function useOpsiBayar(aktif: boolean) {
  return useQuery<OpsiBayar>({
    queryKey: ["pembayaran", "opsi", ENV.useMocks],
    queryFn: () => (ENV.useMocks ? mockOpsiBayar() : fetchOpsiBayar()),
    enabled: aktif,
    staleTime: 5 * 60_000,
    retry: tanpaUlang4xx,
  });
}

/** Ambil ulang semua yang bergantung pada status pembayaran (daftar, detail, lencana, dashboard). */
export function useMuatUlangPembayaran() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["pembayaran"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
}
