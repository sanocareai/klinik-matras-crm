import { keepPreviousData, useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { ENV } from "@/lib/env";
import { ApiError } from "@/api/errors";
import { fetchAkun, fetchBukuBesar, fetchDetailJurnal, fetchJurnal, fetchRekon, fetchRekonDetail } from "@/api/buku";
import { fetchLaporan } from "@/api/laporan";
import { getSkenario } from "@/mocks/skenario";
import type { AkunPilihan, BukuBesarHalaman, DetailJurnal, FilterJurnal, HalamanJurnal, JenisLaporanNyata, LaporanNyata, RekonDetail, RekonItem } from "@/api/types";

// HOOK DATA BUKU & LAPORAN (S9–S10) — sumber: server (atau server contoh). Setelah pencocokan, data buku/laporan diambil ulang: status resmi, bukan tebakan klien.

const skenario = () => (ENV.useMocks ? getSkenario() : "");
const tanpaUlang4xx = (n: number, e: unknown) => n < 1 && !(e instanceof ApiError && e.status >= 400 && e.status < 500);

export function useJurnalList(filter: FilterJurnal) {
  return useInfiniteQuery<HalamanJurnal, Error, { pages: HalamanJurnal[] }, unknown[], number>({
    queryKey: ["buku", "jurnal", filter.from, filter.to, filter.q.trim(), filter.source, filter.status, filter.akunId, ENV.useMocks, skenario()],
    queryFn: ({ pageParam }) => fetchJurnal(filter, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.adaLagi ? last.page + 1 : undefined),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: tanpaUlang4xx,
  });
}

export function useJurnalDetail(id: string) {
  return useQuery<DetailJurnal>({ queryKey: ["buku", "jurnal-detail", id, ENV.useMocks, skenario()], queryFn: () => fetchDetailJurnal(id), staleTime: 10_000, refetchOnWindowFocus: true, retry: tanpaUlang4xx });
}

export function useAkun(q: string) {
  return useQuery<AkunPilihan[]>({ queryKey: ["buku", "akun", q.trim(), ENV.useMocks, skenario()], queryFn: () => fetchAkun(q), staleTime: 60_000, placeholderData: keepPreviousData, retry: tanpaUlang4xx });
}

export function useBukuBesar(akunId: string, from: string, to: string) {
  return useInfiniteQuery<BukuBesarHalaman, Error, { pages: BukuBesarHalaman[] }, unknown[], number>({
    queryKey: ["buku", "besar", akunId, from, to, ENV.useMocks, skenario()],
    queryFn: ({ pageParam }) => fetchBukuBesar(akunId, from, to, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last) => (last.adaLagi ? last.page + 1 : undefined),
    staleTime: 20_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: tanpaUlang4xx,
  });
}

export function useRekonList() {
  return useQuery<RekonItem[]>({ queryKey: ["buku", "rekon", ENV.useMocks, skenario()], queryFn: fetchRekon, staleTime: 20_000, refetchOnWindowFocus: true, retry: tanpaUlang4xx });
}

export function useRekonDetail(id: string) {
  return useQuery<RekonDetail>({ queryKey: ["buku", "rekon-detail", id, ENV.useMocks, skenario()], queryFn: () => fetchRekonDetail(id), staleTime: 10_000, refetchOnWindowFocus: true, retry: tanpaUlang4xx });
}

export function useLaporanNyata(jenis: JenisLaporanNyata, periode: { from: string; to: string }) {
  return useQuery<LaporanNyata>({
    queryKey: ["laporan-nyata", jenis, periode.from, periode.to, ENV.useMocks, skenario()],
    queryFn: () => fetchLaporan(jenis, periode),
    staleTime: 60_000,
    refetchOnWindowFocus: true,
    placeholderData: keepPreviousData,
    retry: tanpaUlang4xx,
  });
}

/** Ambil ulang buku, rekonsiliasi, laporan, dan dashboard setelah pencocokan. */
export function useMuatUlangBuku() {
  const qc = useQueryClient();
  return () => Promise.all([qc.invalidateQueries({ queryKey: ["buku"] }), qc.invalidateQueries({ queryKey: ["laporan-nyata"] }), qc.invalidateQueries({ queryKey: ["dashboard"] })]);
}
