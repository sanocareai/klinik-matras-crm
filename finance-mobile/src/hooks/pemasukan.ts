import { keepPreviousData, useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { ENV } from "@/lib/env";
import { ApiError } from "@/api/errors";
import { fetchDaftarPemasukan, fetchRingkasanPemasukan, type FilterPemasukan, type HalamanPemasukan, type RingkasanPemasukan } from "@/api/pemasukan";
import { getSkenario } from "@/mocks/skenario";

const skenario = () => (ENV.useMocks ? getSkenario() : "");
const tanpaUlang4xx = (n: number, e: unknown) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500);

export function useRingkasanPemasukan(from: string, to: string, aktif = true) {
  return useQuery<RingkasanPemasukan>({
    queryKey: ["pemasukan", "ringkasan", from, to, ENV.useMocks, skenario()], queryFn: () => fetchRingkasanPemasukan(from, to),
    enabled: aktif, staleTime: 30_000, refetchOnWindowFocus: true, placeholderData: keepPreviousData, retry: tanpaUlang4xx,
  });
}

/** Daftar dengan paginasi; `aktif=false` (tab tak terlihat) mematikan pengambilan data. */
export function useDaftarPemasukan(filter: FilterPemasukan, aktif = true) {
  return useInfiniteQuery<HalamanPemasukan, Error, { pages: HalamanPemasukan[] }, unknown[], number>({
    queryKey: ["pemasukan", "daftar", filter.from, filter.to, filter.kategori, filter.q.trim(), ENV.useMocks, skenario()],
    queryFn: ({ pageParam }) => fetchDaftarPemasukan(filter, pageParam),
    initialPageParam: 1, getNextPageParam: (last) => (last.adaLagi ? last.page + 1 : undefined),
    enabled: aktif, staleTime: 30_000, refetchOnWindowFocus: true, placeholderData: keepPreviousData, retry: tanpaUlang4xx,
  });
}
