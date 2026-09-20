import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ENV } from "@/lib/env";
import { ApiError } from "@/api/errors";
import { fetchApprovalBadge, fetchApprovalDetail, fetchApprovals, fetchPemohon } from "@/api/approvals";
import { mockBadge, mockDaftar, mockDetail, mockPemohon } from "@/mocks/approvals";
import { getSkenario } from "@/mocks/skenario";
import { useSession } from "@/auth/session";
import { has } from "@/auth/capabilities";
import type { ApprovalDetail, ApprovalHalaman, FilterApproval } from "@/api/types";

// HOOK DATA INBOX PERSETUJUAN — sumber: server (atau server contoh di mode contoh). Setelah keputusan, semua query
// "approvals" (dan dashboard, karena hitungan antrean) diambil ulang dari server: status resmi, bukan tebakan klien.

const skenario = () => (ENV.useMocks ? getSkenario() : "");
const tanpaUlang4xx = (n: number, e: unknown) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500);

export function useApprovalList(filter: FilterApproval) {
  return useInfiniteQuery<ApprovalHalaman, Error, { pages: ApprovalHalaman[] }, unknown[], number>({
    queryKey: ["approvals", "daftar", filter.tab, filter.jenis.join(","), filter.from, filter.to, filter.pemohonId, filter.q.trim(), ENV.useMocks, skenario()],
    queryFn: ({ pageParam }) => (ENV.useMocks ? mockDaftar(filter, pageParam) : fetchApprovals(filter, pageParam)),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.adaLagi ? last.page + 1 : undefined),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: tanpaUlang4xx,
  });
}

export function useApprovalDetail(jenis: string, id: string) {
  return useQuery<ApprovalDetail>({
    queryKey: ["approvals", "detail", jenis, id, ENV.useMocks, skenario()],
    queryFn: () => (ENV.useMocks ? mockDetail(jenis, id) : fetchApprovalDetail(jenis, id)),
    staleTime: 10_000,
    refetchOnWindowFocus: true,
    retry: tanpaUlang4xx,
  });
}

/** Jumlah menunggu (lencana tab). Hanya untuk yang boleh memutuskan. */
export function useApprovalBadge() {
  const caps = useSession((s) => s.capabilities);
  return useQuery<number>({
    queryKey: ["approvals", "badge", ENV.useMocks, skenario()],
    queryFn: () => (ENV.useMocks ? mockBadge() : fetchApprovalBadge()),
    enabled: has(caps, "financeApprove"),
    staleTime: 30_000,
    refetchOnWindowFocus: true,
    retry: tanpaUlang4xx,
  });
}

export function usePemohon(aktif: boolean) {
  return useQuery<{ id: string; name: string }[]>({
    queryKey: ["approvals", "pemohon", ENV.useMocks],
    queryFn: () => (ENV.useMocks ? mockPemohon() : fetchPemohon()),
    enabled: aktif,
    staleTime: 5 * 60_000,
    retry: tanpaUlang4xx,
  });
}

/** Ambil ulang semua yang bergantung pada status persetujuan (daftar, detail, lencana, dashboard). */
export function useMuatUlangPersetujuan() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["approvals"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
}
