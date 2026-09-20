import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ENV } from "@/lib/env";
import { ApiError } from "@/api/errors";
import { fetchDaftarTx, fetchDetailTx, fetchOpsiForm, fetchRingkasanModul, cariOrderRefund } from "@/api/transaksi";
import { getSkenario } from "@/mocks/skenario";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import type { DetailTx, FilterTx, HalamanTx, ModulTx, OpsiForm, OrderRefund, RingkasanModul } from "@/api/types";

// HOOK DATA TRANSAKSI (S6–S8) — sumber: server (atau server contoh di mode contoh). Setelah perintah, semua data yang bergantung (daftar, detail,
// Inbox Persetujuan S4, pembayaran S5, dashboard) diambil ulang dari server: status resmi, bukan tebakan klien.

const skenario = () => (ENV.useMocks ? getSkenario() : "");
const tanpaUlang4xx = (n: number, e: unknown) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500);

export function useTxList(filter: FilterTx) {
  return useInfiniteQuery<HalamanTx, Error, { pages: HalamanTx[] }, unknown[], number>({
    queryKey: ["tx", "daftar", filter.modul, filter.tab, filter.q.trim(), filter.from, filter.to, filter.supplierId ?? null, !!filter.jatuhTempoLewat, ENV.useMocks, skenario()],
    queryFn: ({ pageParam }) => fetchDaftarTx(filter, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.adaLagi ? last.page + 1 : undefined),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: tanpaUlang4xx,
  });
}

export function useTxDetail(modul: ModulTx, id: string) {
  return useQuery<DetailTx>({
    queryKey: ["tx", "detail", modul, id, ENV.useMocks, skenario()],
    queryFn: () => fetchDetailTx(modul, id),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: tanpaUlang4xx,
  });
}

export function useRingkasanModul() {
  const caps = useSession((s) => s.capabilities);
  return useQuery<RingkasanModul>({
    queryKey: ["tx", "ringkasan", ENV.useMocks, skenario()],
    queryFn: fetchRingkasanModul,
    enabled: has(caps, "financeRead"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: tanpaUlang4xx,
  });
}

export function useOpsiForm(aktif = true) {
  return useQuery<OpsiForm>({
    queryKey: ["tx", "opsi", ENV.useMocks, skenario()],
    queryFn: fetchOpsiForm,
    enabled: aktif,
    staleTime: 60_000,
    retry: tanpaUlang4xx,
  });
}

export function useCariOrderRefund(q: string) {
  return useQuery<OrderRefund[]>({
    queryKey: ["tx", "order", q.trim(), ENV.useMocks, skenario()],
    queryFn: () => cariOrderRefund(q),
    enabled: q.trim().length >= 2,
    staleTime: 15_000,
    retry: tanpaUlang4xx,
  });
}

/** Ambil ulang semua yang bergantung pada transaksi: daftar/detail, Inbox S4, pembayaran S5, dan dashboard. */
export function useMuatUlangTx() {
  const qc = useQueryClient();
  return () => Promise.all([
    qc.invalidateQueries({ queryKey: ["tx"] }), qc.invalidateQueries({ queryKey: ["approvals"] }),
    qc.invalidateQueries({ queryKey: ["pembayaran"] }), qc.invalidateQueries({ queryKey: ["dashboard"] }),
  ]);
}
