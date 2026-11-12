import { useInfiniteQuery, useQuery } from "@tanstack/react-query";
import { create } from "zustand";
import { api } from "@/auth/session";
import type { HalamanBacklog, Papan, PerintahJadwal, RefsJadwal, Sasaran } from "@/features/jadwal";
import { LIVE_MS } from "./production";

// PENJADWALAN dari HP (Admin / Kepala Produksi, izin PRODUCTION_ASSIGNMENT_WRITE) — endpoint yang SAMA dengan Rencana Produksi web:
//   GET  /production-v2/board?date=          papan per tanggal (meja, kapasitas, PIC bawaan, kartu)
//   GET  /production-v2/backlog              "Belum dijadwalkan" (filter & paginasi di server)
//   GET  /production-v2/planning/refs        workshop + PIC yang sah (dengan lini Meja/Corner)
//   POST /production-v2/plans                rencanakan unit (Run dibuka di transaksi yang sama bila belum ada)
//   POST /production-v2/plans/:id/schedule   pindah tanggal/meja/PIC, atau keluarkan dari papan
//   PUT  /production-v2/stations/:code/pic   PIC bawaan meja pada satu tanggal

export const UKURAN_HALAMAN = 25;

export function usePapan(date: string, enabled = true) {
  return useQuery({
    queryKey: ["board", date],
    queryFn: () => api.get<Papan>("/production-v2/board", { query: { date } }),
    refetchInterval: LIVE_MS,
    enabled,
  });
}

export function useBacklog(q: string, enabled = true) {
  return useInfiniteQuery({
    queryKey: ["backlog", q],
    initialPageParam: 1,
    queryFn: ({ pageParam }) => api.get<HalamanBacklog>("/production-v2/backlog", { query: { q: q || undefined, page: String(pageParam), pageSize: String(UKURAN_HALAMAN) } }),
    getNextPageParam: (last, all) => (last.hasMore ? all.length + 1 : undefined),
    refetchInterval: LIVE_MS,
    enabled,
  });
}

export function useRefsJadwal(enabled = true) {
  return useQuery({
    queryKey: ["planning-refs"],
    queryFn: () => api.get<RefsJadwal>("/production-v2/planning/refs"),
    staleTime: 60_000,
    enabled,
  });
}

/** Kirim rencana/jadwal. `kunci` = Idempotency-Key per niat (sama saat diulang setelah galat jaringan). */
export function kirimJadwal(p: PerintahJadwal, kunci: string) {
  return p.jenis === "rencana"
    ? api.command<unknown>("POST", "/production-v2/plans", kunci, { body: p.body })
    : api.command<unknown>("POST", `/production-v2/plans/${p.planId}/schedule`, kunci, { body: p.body });
}

/** PIC bawaan satu meja pada satu tanggal. operatorId null = kosongkan. */
export function simpanPicMeja(stationCode: string, productionDate: string, operatorId: string | null, kunci: string) {
  return api.command<unknown>("PUT", `/production-v2/stations/${encodeURIComponent(stationCode)}/pic`, kunci, { body: { productionDate, operatorId } });
}

/** Kartu yang sedang dibuka di layar Jadwal (diteruskan dari Target tanpa memasukkan data ke URL). */
export const useSasaranJadwal = create<{ sasaran: Sasaran | null; tanggal: string | null; pilih: (s: Sasaran, tanggal: string) => void }>((set) => ({
  sasaran: null,
  tanggal: null,
  pilih: (sasaran, tanggal) => set({ sasaran, tanggal }),
}));
